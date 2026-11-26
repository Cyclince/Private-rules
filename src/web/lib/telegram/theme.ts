import { getTelegramWebApp, type TelegramWebApp } from './webapp';

const SAFE_HEX = /^#[0-9a-f]{3,8}$/i;

function isSafeHex(value: unknown): value is string {
  return typeof value === 'string' && SAFE_HEX.test(value.trim());
}

/**
 * Maps Telegram Mini App `themeParams` onto Miku CSS tokens while strictly
 * keeping `--primary` as Miku cyan (`#39c5bb` dark / `#137a7f` light) per design §13.7.
 */
export function applyTelegramTheme(webApp: TelegramWebApp | undefined = getTelegramWebApp()): 'dark' | 'light' | null {
  if (!webApp || typeof document === 'undefined') return null;

  const root = document.documentElement;
  const scheme: 'dark' | 'light' = webApp.colorScheme === 'light' ? 'light' : 'dark';
  const params = webApp.themeParams ?? {};

  root.dataset.telegram = 'true';
  root.dataset.theme = scheme;
  root.classList.toggle('dark', scheme === 'dark');
  root.classList.toggle('light', scheme === 'light');

  // Preserve Miku cyan primary token regardless of Telegram button_color.
  root.style.removeProperty('--primary');
  root.style.removeProperty('--primary-foreground');

  if (isSafeHex(params.bg_color)) {
    root.style.setProperty('--bg', params.bg_color.trim());
  }
  if (isSafeHex(params.secondary_bg_color)) {
    root.style.setProperty('--surface', params.secondary_bg_color.trim());
  }
  if (isSafeHex(params.section_bg_color)) {
    root.style.setProperty('--surface-muted', params.section_bg_color.trim());
  } else if (isSafeHex(params.secondary_bg_color)) {
    root.style.setProperty('--surface-muted', params.secondary_bg_color.trim());
  }
  if (isSafeHex(params.text_color)) {
    root.style.setProperty('--text', params.text_color.trim());
  }
  if (isSafeHex(params.hint_color)) {
    root.style.setProperty('--text-muted', params.hint_color.trim());
  }
  if (isSafeHex(params.section_separator_color)) {
    root.style.setProperty('--border', params.section_separator_color.trim());
  }

  for (const [key, value] of Object.entries(params)) {
    if (isSafeHex(value)) {
      root.style.setProperty(`--tg-${key.replace(/_/g, '-')}`, value.trim());
    }
  }

  try {
    webApp.ready();
    webApp.expand();
  } catch {
    // Ignore errors from mock/partial Telegram bridge stubs.
  }

  return scheme;
}
