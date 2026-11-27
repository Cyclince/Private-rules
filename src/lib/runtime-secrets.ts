import type { Env } from '../types';

function randomSecret(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return [...value].map((item) => item.toString(16).padStart(2, '0')).join('');
}

async function loadOrCreateSecret(
  env: Env,
  key: string,
  configured?: string,
): Promise<{ value: string; created: boolean }> {
  const supplied = configured?.trim();
  if (supplied) return { value: supplied, created: false };
  const existing = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind(key)
    .first<{ value: string | null }>();
  if (existing?.value) return { value: existing.value, created: false };
  const generated = randomSecret();
  await env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(key, generated).run();
  const stored = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind(key)
    .first<{ value: string | null }>();
  if (!stored?.value) throw new Error('无法生成内部安全密钥。');
  return { value: stored.value, created: stored.value === generated };
}

export async function ensureRuntimeSecrets(env: Env) {
  const sessionSecret = await loadOrCreateSecret(env, 'internalSessionSecret', env.SESSION_SECRET);
  env.SESSION_SECRET = sessionSecret.value;
  if (sessionSecret.created) {
    console.info('[private-rules] 已自动生成加密密钥，备份时请连同数据目录一起备份');
  }
  if (env.TELEGRAM?.enabled) {
    const webhookSecret = await loadOrCreateSecret(env, 'internalTelegramWebhookSecret', env.TELEGRAM.webhookSecret);
    env.TELEGRAM.webhookSecret = webhookSecret.value;
  }
}

/**
 * Resolves the active `SESSION_SECRET` for session signing and node-binding
 * AES-256-GCM encryption: uses the explicitly configured env var when provided,
 * otherwise reuses or lazily generates the persistent 32-byte key stored in DB.
 */
export async function resolveSessionSecret(env: Env): Promise<string> {
  const existing = env.SESSION_SECRET?.trim();
  if (existing) return existing;
  await ensureRuntimeSecrets(env);
  return env.SESSION_SECRET!.trim();
}
