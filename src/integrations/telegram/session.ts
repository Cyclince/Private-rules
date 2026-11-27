import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { TelegramRepository } from '../../application/telegram/repository';
import { AppError } from '../../shared/errors';
import type { AppVariables, Env } from '../../types';
import type { TelegramConfig } from './config';

export const TELEGRAM_SESSION_COOKIE = 'private_rules_telegram_session';

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmac(keyBytes: Uint8Array, value: string) {
  const rawKey = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

export async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function signTelegramInitData(params: URLSearchParams, botToken: string) {
  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = await hmac(new TextEncoder().encode('WebAppData'), botToken);
  return bytesToHex(await hmac(secret, dataCheckString));
}

export async function validateTelegramInitData(raw: string, config: TelegramConfig, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!raw || raw.length > 16_384) throw new AppError('UNAUTHENTICATED', 'initData 格式错误。');
  const params = new URLSearchParams(raw);
  const receivedHash = params.get('hash') ?? '';
  if (!/^[a-f0-9]{64}$/i.test(receivedHash)) throw new AppError('UNAUTHENTICATED', 'initData 签名无效。');
  const expectedHash = await signTelegramInitData(params, config.botToken);
  if (!timingSafeEqual(receivedHash.toLowerCase(), expectedHash.toLowerCase())) throw new AppError('UNAUTHENTICATED', 'initData 签名无效。');
  const authDate = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(authDate) || authDate > nowSeconds + 30 || nowSeconds - authDate > config.updateMaxAgeSeconds) throw new AppError('UNAUTHENTICATED', 'initData 已过期。');
  const userText = params.get('user');
  if (!userText) throw new AppError('UNAUTHENTICATED', 'initData 缺少用户。');
  let user: { id?: number; username?: string; first_name?: string; last_name?: string };
  try { user = JSON.parse(userText) as typeof user; } catch { throw new AppError('UNAUTHENTICATED', 'initData 用户格式错误。'); }
  if (!Number.isSafeInteger(user.id)) throw new AppError('UNAUTHENTICATED', 'initData 用户格式错误。');
  return { params, authDate, user: user as typeof user & { id: number }, replayHash: await sha256(raw) };
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function secureRequest(c: Context<{ Bindings: Env; Variables: AppVariables }>) {
  if (c.env.BASE_URL) return new URL(c.env.BASE_URL).protocol === 'https:';
  if (c.env.TRUST_PROXY && c.req.header('x-forwarded-proto')) return c.req.header('x-forwarded-proto')!.split(',')[0].trim() === 'https';
  return new URL(c.req.url).protocol === 'https:';
}

function telegramCookieOptions(c: Context<{ Bindings: Env; Variables: AppVariables }>, maxAge: number) {
  return {
    httpOnly: true,
    secure: secureRequest(c),
    sameSite: 'Lax' as const,
    path: '/',
    maxAge,
  };
}

export async function createTelegramSession(c: Context<{ Bindings: Env; Variables: AppVariables }>, rawInitData: string) {
  const config = c.env.TELEGRAM;
  if (!config?.enabled) throw new AppError('UNAUTHENTICATED', 'Telegram 未启用。');
  const validated = await validateTelegramInitData(rawInitData, config);
  const repository = new TelegramRepository(c.env.DB);
  const chatText = validated.params.get('chat');
  let chatId = String(validated.user.id);
  if (chatText) {
    try {
      const chat = JSON.parse(chatText) as { id?: number };
      if (Number.isSafeInteger(chat.id)) chatId = String(chat.id);
    } catch { /* User authorization below remains authoritative. */ }
  }
  const user = await repository.authorizeUser(config, {
    telegramUserId: String(validated.user.id),
    chatId,
    username: validated.user.username,
    displayName: [validated.user.first_name, validated.user.last_name].filter(Boolean).join(' '),
  });
  if (!user) throw new AppError('UNAUTHENTICATED', 'Telegram 用户没有权限。');
  const replayExpiresAt = new Date((validated.authDate + config.updateMaxAgeSeconds) * 1000).toISOString();
  if (!await repository.claimInitData(validated.replayHash, user.telegramUserId, replayExpiresAt)) throw new AppError('UNAUTHENTICATED', 'initData 已被使用。');
  const token = randomToken();
  await repository.createSession(user.telegramUserId, await sha256(token), config.sessionTtlSeconds);
  setCookie(c, TELEGRAM_SESSION_COOKIE, token, telegramCookieOptions(c, config.sessionTtlSeconds));
  return { user: { telegramUserId: user.telegramUserId, username: user.username, displayName: user.displayName }, expiresIn: config.sessionTtlSeconds };
}

export async function currentTelegramSession(c: Context<{ Bindings: Env; Variables: AppVariables }>) {
  const token = getCookie(c, TELEGRAM_SESSION_COOKIE);
  const config = c.env.TELEGRAM;
  if (!token || !config) return null;
  const repository = new TelegramRepository(c.env.DB);
  const nowDate = new Date();
  const row = await repository.getSession(await sha256(token), nowDate);
  if (!row || row.telegram_user_id !== config.userId) return null;

  let expiresAt = row.expires_at;
  const nowMs = nowDate.getTime();
  const expiresAtMs = Date.parse(row.expires_at);
  const createdAtMs = Date.parse(row.created_at);
  const remainingMs = expiresAtMs - nowMs;
  const halfTtlMs = (config.sessionTtlSeconds * 1000) / 2;
  const maxExpiresMs = createdAtMs + config.sessionMaxLifetimeSeconds * 1000;

  if (remainingMs < halfTtlMs && Math.min(nowMs + config.sessionTtlSeconds * 1000, maxExpiresMs) > expiresAtMs) {
    const extendedExpiresAt = await repository.extendSession(
      row.id,
      config.sessionTtlSeconds,
      config.sessionMaxLifetimeSeconds,
      nowDate,
    );
    if (extendedExpiresAt) {
      expiresAt = extendedExpiresAt;
      const maxAge = Math.max(1, Math.floor((Date.parse(extendedExpiresAt) - nowMs) / 1000));
      setCookie(c, TELEGRAM_SESSION_COOKIE, token, telegramCookieOptions(c, maxAge));
      // Materialize Hono's response holder so raw Response returns (e.g. json()) inherit Set-Cookie.
      void c.res;
    }
  }

  return { id: row.id, telegramUserId: row.telegram_user_id, expiresAt };
}

export async function logoutTelegramSession(c: Context<{ Bindings: Env; Variables: AppVariables }>) {
  const token = getCookie(c, TELEGRAM_SESSION_COOKIE);
  if (token) await new TelegramRepository(c.env.DB).revokeSession(await sha256(token));
  setCookie(c, TELEGRAM_SESSION_COOKIE, '', telegramCookieOptions(c, 0));
}
