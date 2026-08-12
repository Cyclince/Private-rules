export type TelegramUserPayload = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramChatPayload = { id: number; type?: string };

export type TelegramMessagePayload = {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  photo?: unknown[];
  from?: TelegramUserPayload;
  chat: TelegramChatPayload;
};

export type TelegramCallbackPayload = {
  id: string;
  from: TelegramUserPayload;
  data?: string;
  message?: TelegramMessagePayload;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessagePayload;
  callback_query?: TelegramCallbackPayload;
};
