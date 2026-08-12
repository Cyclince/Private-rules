import { describe, expect, it } from 'vitest';
import { parseNodeConfig } from '../../src/infrastructure/config/node';
import { parseTelegramConfig } from '../../src/integrations/telegram/config';
const valid = { ADMIN_PASSWORD: 'password' };
describe('node configuration', () => {
  it('parses booleans without treating "false" as true and normalizes BASE_URL', () => {
    const config = parseNodeConfig({ ...valid, TRUST_PROXY: 'false', BASE_URL: 'https://example.com///' });
    expect(config.trustProxy).toBe(false);
    expect(config.baseUrl).toBe('https://example.com');
    expect(config.port).toBe(5173);
    expect(config.scheduler.intervalSeconds).toBe(60);
  });
  it('allows generated secrets but rejects unsafe custom secrets and invalid ranges', () => {
    expect(parseNodeConfig({ ...valid, NODE_ENV: 'production' }).sessionSecret).toBe('');
    expect(() => parseNodeConfig({ ...valid, NODE_ENV: 'production', SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() => parseNodeConfig({ ...valid, SCHEDULER_INTERVAL_SECONDS: '0' })).toThrow(/SCHEDULER_INTERVAL_SECONDS/);
    expect(() => parseNodeConfig({ ...valid, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
  });
});

describe('telegram configuration', () => {
  it('stays disabled when no Bot Token is configured', () => {
    expect(parseTelegramConfig({}, true)).toMatchObject({ enabled: false, botToken: '' });
  });

  it('requires the public URL and one numeric admin ID when enabled', () => {
    expect(() => parseTelegramConfig({ TELEGRAM_BOT_TOKEN: 'test' }, false)).toThrow(/BASE_URL/);
    expect(() => parseTelegramConfig({
      TELEGRAM_BOT_TOKEN: 'test', BASE_URL: 'https://example.com',
    }, false)).toThrow(/TELEGRAM_USER_ID/);
    expect(() => parseTelegramConfig({ TELEGRAM_USER_ID: '123,456' }, false)).toThrow(/数字用户 ID/);
  });

  it('derives Telegram URLs and notifications from the public URL and admin ID', () => {
    const config = parseTelegramConfig({
      BASE_URL: 'https://example.com/',
      TELEGRAM_BOT_TOKEN: 'test',
      TELEGRAM_USER_ID: '00123',
    }, false);
    expect(config).toMatchObject({
      enabled: true,
      userId: '123',
      webhookUrl: 'https://example.com/api/telegram/webhook',
      miniAppUrl: 'https://example.com',
      notificationChatId: '123',
      webhookSecret: '',
    });
  });
});
