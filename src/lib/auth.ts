import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppVariables, Env } from '../types';
import { error } from './response';
import { id, slugify } from './slug';
import { currentTelegramSession } from '../integrations/telegram/session';

const COOKIE_NAME = 'private_rules_session';
const maxAgeSeconds = 60 * 60 * 24 * 14;

function requestIsSecure(c: Context<{ Bindings: Env; Variables: AppVariables }>) {
  if (c.env.BASE_URL) return new URL(c.env.BASE_URL).protocol === 'https:';
  if (c.env.TRUST_PROXY) {
    const forwardedProto = c.req.header('x-forwarded-proto')?.split(',')[0].trim().toLowerCase();
    if (forwardedProto) return forwardedProto === 'https';
  }
  return new URL(c.req.url).protocol === 'https:';
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signed(secret: string, sessionId: string) {
  return `${sessionId}.${await hmac(secret, sessionId)}`;
}

async function verify(secret: string, value?: string) {
  if (!value?.includes('.')) return null;
  const [sessionId, signature] = value.split('.');
  const expected = await hmac(secret, sessionId);
  return signature === expected ? sessionId : null;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomApiKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `prk_${token}`;
}

export async function apiKeyConfigured(env: Env) {
  return Boolean(await env.DB.prepare('SELECT id FROM api_keys LIMIT 1').first());
}

export async function createApiKey(env: Env, note = '') {
  const apiKey = randomApiKey();
  const keyId = id('key');
  const createdAt = new Date().toISOString();
  const cleanNote = note.trim().slice(0, 80);
  await env.DB.prepare('INSERT INTO api_keys (id, note, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(keyId, cleanNote, await sha256(apiKey), `${apiKey.slice(0, 12)}…`, createdAt).run();
  return { id: keyId, apiKey, note: cleanNote, keyPrefix: `${apiKey.slice(0, 12)}…`, createdAt };
}

export async function deleteApiKey(env: Env, keyId: string) {
  await env.DB.prepare('DELETE FROM api_keys WHERE id = ?').bind(keyId).run();
}

export async function updateApiKeyNote(env: Env, keyId: string, note: string) {
  await env.DB.prepare('UPDATE api_keys SET note = ? WHERE id = ?').bind(note.trim().slice(0, 80), keyId).run();
}

export async function apiKeyStatus(env: Env) {
  const rows = await env.DB.prepare('SELECT id, note, key_prefix, created_at, last_used_at FROM api_keys ORDER BY created_at DESC')
    .all<{ id: string; note: string; key_prefix: string; created_at: string; last_used_at: string | null }>();
  return { keys: (rows.results ?? []).map((row) => ({
    id: row.id, note: row.note, keyPrefix: row.key_prefix, createdAt: row.created_at, lastUsedAt: row.last_used_at ?? undefined,
  })) };
}

async function validApiKey(c: Context<{ Bindings: Env; Variables: AppVariables }>) {
  const authorization = c.req.header('authorization') ?? '';
  const match = authorization.match(/^Bearer\s+(prk_[A-Za-z0-9_-]+)$/i);
  if (!match) return false;
  const hash = await sha256(match[1]);
  const row = await c.env.DB.prepare('SELECT id FROM api_keys WHERE key_hash = ?').bind(hash).first<{ id: string }>();
  if (!row) return false;
  await c.env.DB.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(new Date().toISOString(), row.id).run();
  return true;
}

export async function createSession(c: Context<{ Bindings: Env; Variables: AppVariables }>) {
  const sessionId = id('sess');
  const created = new Date();
  const expires = new Date(created.getTime() + maxAgeSeconds * 1000);
  await c.env.DB.prepare('INSERT INTO sessions (id, expires_at, created_at) VALUES (?, ?, ?)')
    .bind(sessionId, expires.toISOString(), created.toISOString())
    .run();
  setCookie(c, COOKIE_NAME, await signed(c.env.SESSION_SECRET!, sessionId), {
    httpOnly: true,
    secure: requestIsSecure(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

export async function destroySession(c: Context<{ Bindings: Env; Variables: AppVariables }>) {
  const sessionId = await currentSessionId(c);
  if (sessionId) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
  setCookie(c, COOKIE_NAME, '', { path: '/', maxAge: 0, httpOnly: true, secure: requestIsSecure(c), sameSite: 'Lax' });
}

export async function currentSessionId(c: Context<{ Bindings: Env; Variables: AppVariables }>) {
  if (!c.env.SESSION_SECRET) return null;
  const sessionId = await verify(c.env.SESSION_SECRET, getCookie(c, COOKIE_NAME));
  if (!sessionId) return null;
  const row = await c.env.DB.prepare('SELECT id FROM sessions WHERE id = ? AND expires_at > ?')
    .bind(sessionId, new Date().toISOString())
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function isAuthenticated(c: Context<{ Bindings: Env; Variables: AppVariables }>) {
  return Boolean(await currentSessionId(c) || await currentTelegramSession(c));
}

export const requireSessionAuth: MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> = async (c, next) => {
  const sessionId = await currentSessionId(c);
  if (!sessionId) return error('请先登录。', 401);
  c.set('sessionId', sessionId);
  c.set('authType', 'session');
  await next();
};

export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> = async (c, next) => {
  const sessionId = await currentSessionId(c);
  if (sessionId) {
    c.set('sessionId', sessionId);
    c.set('authType', 'session');
    await next();
    return;
  }
  const telegramSession = await currentTelegramSession(c);
  if (telegramSession) {
    c.set('authType', 'telegram');
    c.set('telegramUserId', telegramSession.telegramUserId);
    await next();
    return;
  }
  if (!(await validApiKey(c))) return error('登录会话或 API Key 无效。', 401);
  c.set('authType', 'apiKey');
  await next();
};

export async function checkPassword(env: Env, password: string) {
  return Boolean(env.ADMIN_PASSWORD) && password === env.ADMIN_PASSWORD;
}

export function authConfigured(env: Env) {
  return Boolean(env.ADMIN_PASSWORD && env.SESSION_SECRET);
}

export function safeFileName(file: string) {
  return /^[A-Za-z0-9_.-]+$/.test(file) && !file.includes('..') && !file.includes('/') && !file.includes('\\');
}

export function tokenMatches(env: Env, token: string) {
  return Boolean(env.RULE_TOKEN) && token === env.RULE_TOKEN;
}

export function safeSlug(value: string) {
  return slugify(value).toLowerCase();
}
