type TelegramWebApp = {
  initData: string;
  colorScheme?: 'light' | 'dark';
  themeParams?: Record<string, string>;
  ready(): void;
  expand(): void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function telegramWebApp() {
  return window.Telegram?.WebApp;
}

export function isTelegramMiniApp() {
  return Boolean(telegramWebApp()?.initData);
}
