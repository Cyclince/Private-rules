import { telegramWebApp } from './telegram-webapp';

export async function authenticateTelegramMiniApp() {
  const webApp = telegramWebApp();
  if (!webApp?.initData) return null;
  const existing = await fetch('/api/auth/me');
  if (existing.ok) {
    const current = await existing.json() as { authenticated?: boolean; authType?: string };
    if (current.authenticated && current.authType === 'telegram') return current;
  }
  const response = await fetch('/api/telegram/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData: webApp.initData }),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; user?: unknown };
  if (!response.ok) throw new Error(payload.error ?? 'Telegram 登录失败。');
  return payload;
}
