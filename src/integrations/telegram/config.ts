export type TelegramConfig = {
  enabled: boolean;
  botToken: string;
  webhookSecret: string;
  webhookUrl: string;
  miniAppUrl: string;
  userId: string;
  notificationChatId: string;
  updateMaxAgeSeconds: number;
  sessionTtlSeconds: number;
  rateLimitPerMinute: number;
  syncNotificationEnabled: boolean;
  production: boolean;
};

type RawEnvironment = Record<string, string | undefined>;

function optional(value: string | undefined) {
  return value === undefined ? '' : value.trim();
}

function telegramId(value: string | undefined, name: string) {
  const input = optional(value);
  if (!input) return '';
  if (!/^\d+$/.test(input)) throw new Error(`${name} 必须是 Telegram 数字用户 ID。`);
  return BigInt(input).toString();
}

function normalizedUrl(value: string, name: string) {
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${name} 必须使用 HTTP 或 HTTPS。`);
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function parseTelegramConfig(env: RawEnvironment, production: boolean): TelegramConfig {
  const botToken = optional(env.TELEGRAM_BOT_TOKEN);
  const enabled = Boolean(botToken);
  const webhookSecret = optional(env.TELEGRAM_WEBHOOK_SECRET);
  const baseUrl = normalizedUrl(optional(env.BASE_URL), 'BASE_URL');
  const userId = telegramId(env.TELEGRAM_USER_ID, 'TELEGRAM_USER_ID');
  if (enabled && !baseUrl) throw new Error('启用 Telegram Bot 时必须配置 BASE_URL。');
  if (enabled && !userId) throw new Error('启用 Telegram Bot 时必须配置 TELEGRAM_USER_ID。');
  return {
    enabled,
    botToken,
    webhookSecret,
    webhookUrl: baseUrl ? `${baseUrl}/api/telegram/webhook` : '',
    miniAppUrl: baseUrl,
    userId,
    notificationChatId: userId,
    updateMaxAgeSeconds: 300,
    sessionTtlSeconds: 1800,
    rateLimitPerMinute: 30,
    syncNotificationEnabled: true,
    production,
  };
}
