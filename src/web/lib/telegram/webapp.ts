export type TelegramThemeParams = {
  bg_color?: string;
  secondary_bg_color?: string;
  section_bg_color?: string;
  text_color?: string;
  hint_color?: string;
  section_separator_color?: string;
  button_color?: string;
  button_text_color?: string;
  [key: string]: string | undefined;
};

export type TelegramWebApp = {
  initData: string;
  colorScheme?: 'light' | 'dark';
  themeParams?: TelegramThemeParams;
  ready: () => void;
  expand: () => void;
};

export function getTelegramWebApp(): TelegramWebApp | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

export function isTelegramMiniApp(): boolean {
  return Boolean(getTelegramWebApp()?.initData);
}
