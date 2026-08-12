import { telegramWebApp } from './telegram-webapp';

export function applyTelegramTheme() {
  const webApp = telegramWebApp();
  if (!webApp) return false;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(webApp.themeParams ?? {})) {
    if (/^#[0-9a-f]{3,8}$/i.test(value)) root.style.setProperty(`--tg-${key.replace(/_/g, '-')}`, value);
  }
  root.dataset.telegram = 'true';
  root.dataset.theme = webApp.colorScheme === 'dark' ? 'dark' : 'light';
  webApp.ready();
  webApp.expand();
  return true;
}
