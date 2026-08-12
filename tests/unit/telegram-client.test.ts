import { describe, expect, it, vi } from 'vitest';
import { TelegramHttpClient } from '../../src/integrations/telegram/client';

describe('TelegramHttpClient', () => {
  it('maps the application client contract to the Telegram HTTP API', async () => {
    const request = vi.fn(async () => Response.json({ ok: true, result: { message_id: 42 } }));
    const client = new TelegramHttpClient('123:test-token', request as typeof fetch);

    await client.sendMessage('1001', '<b>ready</b>', {
      parseMode: 'HTML',
      disableNotification: true,
      replyMarkup: { inlineKeyboard: [[{ text: 'Open', webAppUrl: 'https://example.com/app' }]] },
    });

    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bot123:test-token/sendMessage');
    expect(JSON.parse(String(init?.body))).toEqual({
      chat_id: '1001',
      text: '<b>ready</b>',
      parse_mode: 'HTML',
      disable_notification: true,
      reply_markup: { inline_keyboard: [[{ text: 'Open', web_app: { url: 'https://example.com/app' } }]] },
    });
  });

  it('surfaces Telegram API errors without exposing the bot token', async () => {
    const request = vi.fn(async () => Response.json({ ok: false, description: 'Bad Request: chat not found' }, { status: 400 }));
    const client = new TelegramHttpClient('secret-token', request as typeof fetch);

    await expect(client.getMe()).rejects.toThrow('Telegram API getMe 失败：Bad Request: chat not found');
    await expect(client.getMe()).rejects.not.toThrow('secret-token');
  });
});
