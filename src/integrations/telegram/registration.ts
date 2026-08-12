import type { TelegramClient } from '../../application/ports/telegram-client';
import type { TelegramConfig } from './config';
import { TELEGRAM_COMMANDS } from './commands';

const registrations = new WeakMap<TelegramClient, Promise<void>>();

export function ensureTelegramRegistration(config: TelegramConfig, client?: TelegramClient) {
  if (!config.enabled || !client) return Promise.resolve();
  const existing = registrations.get(client);
  if (existing) return existing;

  const registration = Promise.all([
    client.setMyCommands([...TELEGRAM_COMMANDS]),
    client.setChatMenuButton({ text: '面板', webAppUrl: `${config.miniAppUrl}/admin?view=dashboard` }),
    client.setWebhook(config.webhookUrl, {
      secretToken: config.webhookSecret,
      allowedUpdates: ['message', 'callback_query'],
    }),
  ]).then(() => undefined).catch((cause) => {
    registrations.delete(client);
    throw cause;
  });
  registrations.set(client, registration);
  return registration;
}
