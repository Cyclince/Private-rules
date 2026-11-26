import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppVariables, Env } from '../types';
import { AppError } from '../shared/errors';
import { slugify } from './slug';
import {
  authenticateApiKeyToken,
  createApiKeyRecord,
  createSessionRecord,
  deleteApiKeyRecord,
  deleteSessionRecord,
  findValidSessionRecord,
  hasAnyApiKey,
  listApiKeys,
  updateApiKeyNoteRecord,
} from '../application/auth';
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

/** Compares two strings in time that depends only on their lengths. */
export function timingSafeEqual(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

async function verify(secret: string, value?: string) {
  if (!value?.includes('.')) return null;
  const [sessionId, signature] = value.split('.');
  const expected = await hmac(secret, sessionId);
  return timingSafeEqual(signature ?? '', expected) ? sessionId : null;
}

export async function apiKeyConfigured(env: Env) {
  return hasAnyApiKey(env);
}

export async function createApiKey(env: Env, note = '') {
  return createApiKeyRecord(env, note);
}

export async function deleteApiKey(env: Env, keyId: string) {
  await deleteApiKeyRecord(env, keyId);
}

export async function updateApiKeyNote(env: Env, keyId: string, note: string) {
  await updateApiKeyNoteRecord(env, keyId, note);
}

export async function apiKeyStatus(env: Env) {
  return listApiKeys(env);
}

async function validApiKey(c: Context<{ Bindings: Env; Variables: AppVariables }>) {
  const authorization = c.req.header('authorization') ?? '';
  const match = authorization.match(/^Bearer\s+(prk_[A-Za-z0-9_-]+)$/i);
  if (!match) return false;
  return authenticateApiKeyToken(c.env, match[1]);
}

export async function createSession(c: Context<{ Bindings: Env; Variables: AppVariables }>) {
  const { sessionId } = await createSessionRecord(c.env.DB, maxAgeSeconds);
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
  if (sessionId) await deleteSessionRecord(c.env.DB, sessionId);
  setCookie(c, COOKIE_NAME, '', { path: '/', maxAge: 0, httpOnly: true, secure: requestIsSecure(c), sameSite: 'Lax' });
}

export async function currentSessionId(c: Context<{ Bindings: Env; Variables: AppVariables }>) {
  if (!c.env.SESSION_SECRET) return null;
  const sessionId = await verify(c.env.SESSION_SECRET, getCookie(c, COOKIE_NAME));
  if (!sessionId) return null;
  const row = await findValidSessionRecord(c.env.DB, sessionId);
  return row?.id ?? null;
}

export async function isAuthenticated(c: Context<{ Bindings: Env; Variables: AppVariables }>) {
  return Boolean(await currentSessionId(c) || await currentTelegramSession(c));
}

export const requireSessionAuth: MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> = async (c, next) => {
  const sessionId = await currentSessionId(c);
  if (!sessionId) throw new AppError('UNAUTHENTICATED', '请先登录。');
  c.set('sessionId', sessionId);
  c.set('authType', 'session');
  await next();
};

export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> = async (c, next) => {
  const authorization = c.req.header('authorization') ?? '';
  if (/^Bearer\s+/i.test(authorization)) {
    if (!(await validApiKey(c))) throw new AppError('UNAUTHENTICATED', 'API Key 无效。');
    c.set('authType', 'apiKey');
    await next();
    return;
  }
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
  throw new AppError('UNAUTHENTICATED', '登录会话或 API Key 无效。');
};

export async function checkPassword(env: Env, password: string) {
  return Boolean(env.ADMIN_PASSWORD) && timingSafeEqual(password, env.ADMIN_PASSWORD!);
}

export function authConfigured(env: Env) {
  return Boolean(env.ADMIN_PASSWORD && env.SESSION_SECRET);
}

export function safeFileName(file: string) {
  return /^[A-Za-z0-9_.-]+$/.test(file) && !file.includes('..') && !file.includes('/') && !file.includes('\\');
}

export function tokenMatches(env: Env, token: string) {
  return Boolean(env.RULE_TOKEN) && timingSafeEqual(token, env.RULE_TOKEN!);
}

export function safeSlug(value: string) {
  return slugify(value).toLowerCase();
}

/**
 * Identifies the client for rate limiting. Forwarding headers are only trusted
 * when TRUST_PROXY is enabled; on Cloudflare the edge-set cf-connecting-ip is used.
 */
export function clientIdentity(c: Context<{ Bindings: Env; Variables: AppVariables }>) {
  if (c.env.RUNTIME !== 'node') {
    const edge = c.req.header('cf-connecting-ip')?.trim();
    if (edge) return edge;
  }
  if (c.env.TRUST_PROXY) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return c.env.CLIENT_ADDRESS || 'unknown';
}
