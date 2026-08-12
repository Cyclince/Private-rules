import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { TelegramRepository } from '../../application/telegram/repository';
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
  if (!raw || raw.length > 16_384) throw new Error('initData 格式错误。');
  const params = new URLSearchParams(raw);
  const receivedHash = params.get('hash') ?? '';
  if (!/^[a-f0-9]{64}$/i.test(receivedHash)) throw new Error('initData 签名无效。');
  const expectedHash = await signTelegramInitData(params, config.botToken);
  if (!timingSafeEqual(receivedHash.toLowerCase(), expectedHash.toLowerCase())) throw new Error('initData 签名无效。');
  const authDate = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(authDate) || authDate > nowSeconds + 30 || nowSeconds - authDate > config.updateMaxAgeSeconds) throw new Error('initData 已过期。');
  const userText = params.get('user');
  if (!userText) throw new Error('initData 缺少用户。');
  let user: { id?: number; username?: string; first_name?: string; last_name?: string };
  try { user = JSON.parse(userText) as typeof user; } catch { throw new Error('initData 用户格式错误。'); }
  if (!Number.isSafeInteger(user.id)) throw new Error('initData 用户格式错误。');
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

export async function createTelegramSession(c: Context<{ Bindings: Env; Variables: AppVariables }>, rawInitData: string) {
  const config = c.env.TELEGRAM;
  if (!config?.enabled) throw new Error('Telegram 未启用。');
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
  if (!user) throw new Error('Telegram 用户没有权限。');
  const replayExpiresAt = new Date((validated.authDate + config.updateMaxAgeSeconds) * 1000).toISOString();
  if (!await repository.claimInitData(validated.replayHash, user.telegramUserId, replayExpiresAt)) throw new Error('initData 已被使用。');
  const token = randomToken();
  await repository.createSession(user.telegramUserId, await sha256(token), config.sessionTtlSeconds);
  setCookie(c, TELEGRAM_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureRequest(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: config.sessionTtlSeconds,
  });
  return { user: { telegramUserId: user.telegramUserId, username: user.username, displayName: user.displayName }, expiresIn: config.sessionTtlSeconds };
}

export async function currentTelegramSession(c: Context<{ Bindings: Env; Variables: AppVariables }>) {
  const token = getCookie(c, TELEGRAM_SESSION_COOKIE);
  if (!token) return null;
  const repository = new TelegramRepository(c.env.DB);
  const row = await repository.getSession(await sha256(token));
  if (!row || row.telegram_user_id !== c.env.TELEGRAM?.userId) return null;
  await repository.touchSession(row.id);
  return { id: row.id, telegramUserId: row.telegram_user_id, expiresAt: row.expires_at };
}

export async function logoutTelegramSession(c: Context<{ Bindings: Env; Variables: AppVariables }>) {
  const token = getCookie(c, TELEGRAM_SESSION_COOKIE);
  if (token) await new TelegramRepository(c.env.DB).revokeSession(await sha256(token));
  setCookie(c, TELEGRAM_SESSION_COOKIE, '', { httpOnly: true, secure: secureRequest(c), sameSite: 'Lax', path: '/', maxAge: 0 });
}
