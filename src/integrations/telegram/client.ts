import type { TelegramClient, TelegramInlineButton, TelegramReplyMarkup } from '../../application/ports/telegram-client';

type TelegramApiResponse<T> = { ok: boolean; result?: T; description?: string };
type Fetch = typeof globalThis.fetch;

function button(input: TelegramInlineButton) {
  if ('callbackData' in input) return { text: input.text, callback_data: input.callbackData };
  if ('webAppUrl' in input) return { text: input.text, web_app: { url: input.webAppUrl } };
  if ('copyText' in input) return { text: input.text, copy_text: { text: input.copyText } };
  return { text: input.text, url: input.url };
}

function markup(replyMarkup?: TelegramReplyMarkup) {
  return replyMarkup ? { inline_keyboard: replyMarkup.inlineKeyboard.map((row) => row.map(button)) } : undefined;
}

export class TelegramHttpClient implements TelegramClient {
  private readonly endpoint: string;

  constructor(token: string, private readonly request: Fetch = globalThis.fetch) {
    this.endpoint = `https://api.telegram.org/bot${token}`;
  }

  private async call<T = unknown>(method: string, payload: Record<string, unknown> = {}) {
    const response = await this.request(`${this.endpoint}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => null) as TelegramApiResponse<T> | null;
    if (!response.ok || !body?.ok) {
      throw new Error(`Telegram API ${method} 失败：${body?.description || `HTTP ${response.status}`}`);
    }
    return body.result as T;
  }

  sendMessage(chatId: string, text: string, options: { replyMarkup?: TelegramReplyMarkup; parseMode?: 'HTML'; disableNotification?: boolean } = {}) {
    return this.call('sendMessage', { chat_id: chatId, text, reply_markup: markup(options.replyMarkup), parse_mode: options.parseMode, disable_notification: options.disableNotification });
  }

  sendPhoto(chatId: string, photo: string, options: { caption?: string; replyMarkup?: TelegramReplyMarkup; parseMode?: 'HTML' } = {}) {
    return this.call('sendPhoto', {
      chat_id: chatId,
      photo,
      caption: options.caption,
      reply_markup: markup(options.replyMarkup),
      parse_mode: options.parseMode,
    });
  }

  editMessageText(chatId: string, messageId: number, text: string, options: { replyMarkup?: TelegramReplyMarkup; parseMode?: 'HTML' } = {}) {
    return this.call('editMessageText', { chat_id: chatId, message_id: messageId, text, reply_markup: markup(options.replyMarkup), parse_mode: options.parseMode });
  }

  editMessageCaption(chatId: string, messageId: number, caption: string, options: { replyMarkup?: TelegramReplyMarkup; parseMode?: 'HTML' } = {}) {
    return this.call('editMessageCaption', { chat_id: chatId, message_id: messageId, caption, reply_markup: markup(options.replyMarkup), parse_mode: options.parseMode });
  }

  deleteMessage(chatId: string, messageId: number) {
    return this.call('deleteMessage', { chat_id: chatId, message_id: messageId });
  }

  answerCallbackQuery(callbackQueryId: string, options: { text?: string; showAlert?: boolean } = {}) {
    return this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, text: options.text, show_alert: options.showAlert });
  }

  setWebhook(url: string, options: { secretToken: string; allowedUpdates: string[] }) {
    return this.call('setWebhook', { url, secret_token: options.secretToken, allowed_updates: options.allowedUpdates });
  }

  setMyCommands(commands: Array<{ command: string; description: string }>) {
    return this.call('setMyCommands', { commands });
  }

  setChatMenuButton(options: { text: string; webAppUrl: string }) {
    return this.call('setChatMenuButton', {
      menu_button: { type: 'web_app', text: options.text, web_app: { url: options.webAppUrl } },
    });
  }

  getMe() {
    return this.call<{ id?: number; username?: string }>('getMe');
  }

  deleteWebhook() {
    return this.call('deleteWebhook');
  }
}
