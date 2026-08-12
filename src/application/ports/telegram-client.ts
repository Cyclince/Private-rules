export type TelegramInlineButton =
  | { text: string; callbackData: string }
  | { text: string; url: string }
  | { text: string; webAppUrl: string }
  | { text: string; copyText: string };

export type TelegramReplyMarkup = { inlineKeyboard: TelegramInlineButton[][] };

export interface TelegramClient {
  sendMessage(chatId: string, text: string, options?: { replyMarkup?: TelegramReplyMarkup; parseMode?: 'HTML'; disableNotification?: boolean }): Promise<unknown>;
  sendPhoto(chatId: string, photo: string, options?: { caption?: string; replyMarkup?: TelegramReplyMarkup; parseMode?: 'HTML' }): Promise<unknown>;
  editMessageText(chatId: string, messageId: number, text: string, options?: { replyMarkup?: TelegramReplyMarkup; parseMode?: 'HTML' }): Promise<unknown>;
  editMessageCaption(chatId: string, messageId: number, caption: string, options?: { replyMarkup?: TelegramReplyMarkup; parseMode?: 'HTML' }): Promise<unknown>;
  deleteMessage(chatId: string, messageId: number): Promise<unknown>;
  answerCallbackQuery(callbackQueryId: string, options?: { text?: string; showAlert?: boolean }): Promise<unknown>;
  setWebhook(url: string, options: { secretToken: string; allowedUpdates: string[] }): Promise<unknown>;
  setMyCommands(commands: Array<{ command: string; description: string }>): Promise<unknown>;
  setChatMenuButton(options: { text: string; webAppUrl: string }): Promise<unknown>;
  getMe(): Promise<{ id?: number; username?: string }>;
  deleteWebhook?(): Promise<unknown>;
}
