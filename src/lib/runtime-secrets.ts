import type { Env } from '../types';

function randomSecret(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return [...value].map((item) => item.toString(16).padStart(2, '0')).join('');
}

async function loadOrCreateSecret(env: Env, key: string, configured?: string) {
  const supplied = configured?.trim();
  if (supplied) return supplied;
  const existing = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string | null }>();
  if (existing?.value) return existing.value;
  const generated = randomSecret();
  await env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(key, generated).run();
  const stored = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string | null }>();
  if (!stored?.value) throw new Error('无法生成内部安全密钥。');
  return stored.value;
}

export async function ensureRuntimeSecrets(env: Env) {
  if (env.EXPLICIT_SESSION_SECRET === undefined) {
    env.EXPLICIT_SESSION_SECRET = env.SESSION_SECRET?.trim() ?? '';
  }
  env.SESSION_SECRET = await loadOrCreateSecret(env, 'internalSessionSecret', env.SESSION_SECRET);
  if (env.TELEGRAM?.enabled) {
    env.TELEGRAM.webhookSecret = await loadOrCreateSecret(env, 'internalTelegramWebhookSecret', env.TELEGRAM.webhookSecret);
  }
}

/**
 * Returns the explicitly configured `SESSION_SECRET` env var, or `undefined`
 * when the runtime fell back to a database-stored secret (design §8.4).
 */
export function resolveExplicitSessionSecret(env: Env): string | undefined {
  if (env.EXPLICIT_SESSION_SECRET !== undefined) {
    return env.EXPLICIT_SESSION_SECRET.trim() || undefined;
  }
  return env.SESSION_SECRET?.trim() || undefined;
}
