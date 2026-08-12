import type { TelegramClient, TelegramReplyMarkup } from '../../src/application/ports/telegram-client';

export class FakeTelegramClient implements TelegramClient {
  sent: Array<{ chatId: string; text: string; replyMarkup?: TelegramReplyMarkup; disableNotification?: boolean }> = [];
  photos: Array<{ chatId: string; photo: string; caption?: string; replyMarkup?: TelegramReplyMarkup }> = [];
  edited: Array<{ chatId: string; messageId: number; text: string; replyMarkup?: TelegramReplyMarkup }> = [];
  editedCaptions: Array<{ chatId: string; messageId: number; caption: string; replyMarkup?: TelegramReplyMarkup }> = [];
  deleted: Array<{ chatId: string; messageId: number }> = [];
  answered: Array<{ callbackQueryId: string; text?: string; showAlert?: boolean }> = [];
  webhook?: { url: string; secretToken: string; allowedUpdates: string[] };
  commands: Array<{ command: string; description: string }> = [];
  menuButton?: { text: string; webAppUrl: string };
  getMeError?: Error;
  getMeCalls = 0;

  async sendMessage(chatId: string, text: string, options: { replyMarkup?: TelegramReplyMarkup; disableNotification?: boolean } = {}) {
    this.sent.push({ chatId, text, replyMarkup: options.replyMarkup, disableNotification: options.disableNotification });
    return { message_id: this.sent.length };
  }
  async sendPhoto(chatId: string, photo: string, options: { caption?: string; replyMarkup?: TelegramReplyMarkup } = {}) {
    this.photos.push({ chatId, photo, caption: options.caption, replyMarkup: options.replyMarkup });
    return { message_id: this.photos.length };
  }
  async editMessageText(chatId: string, messageId: number, text: string, options: { replyMarkup?: TelegramReplyMarkup } = {}) {
    this.edited.push({ chatId, messageId, text, replyMarkup: options.replyMarkup });
    return true;
  }
  async editMessageCaption(chatId: string, messageId: number, caption: string, options: { replyMarkup?: TelegramReplyMarkup } = {}) {
    this.editedCaptions.push({ chatId, messageId, caption, replyMarkup: options.replyMarkup });
    return true;
  }
  async deleteMessage(chatId: string, messageId: number) {
    this.deleted.push({ chatId, messageId });
    return true;
  }
  async answerCallbackQuery(callbackQueryId: string, options: { text?: string; showAlert?: boolean } = {}) {
    this.answered.push({ callbackQueryId, ...options });
    return true;
  }
  async setWebhook(url: string, options: { secretToken: string; allowedUpdates: string[] }) {
    this.webhook = { url, ...options };
    return true;
  }
  async setMyCommands(commands: Array<{ command: string; description: string }>) {
    this.commands = commands;
    return true;
  }
  async setChatMenuButton(options: { text: string; webAppUrl: string }) {
    this.menuButton = options;
    return true;
  }
  async getMe() {
    this.getMeCalls += 1;
    if (this.getMeError) throw this.getMeError;
    return { id: 123456, username: 'private_rules_bot' };
  }
}
