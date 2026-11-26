import type { ClientLink, RulesData } from './types/domain-rules';
import type { AssetsPort } from './application/ports/assets';
import type { DatabasePort } from './application/ports/database';
import type { BackgroundTaskPort } from './application/ports/background-task';
import type { TelegramClient } from './application/ports/telegram-client';
import type { TelegramConfig } from './integrations/telegram/config';

export type SubscriptionCacheStore = {
  match(request: Request | string): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
  delete(request: Request | string): Promise<boolean>;
};

export type Env = {
  DB: DatabasePort;
  ASSETS: AssetsPort;
  ADMIN_PASSWORD?: string;
  RULE_TOKEN?: string;
  SESSION_SECRET?: string;
  BASE_URL?: string;
  RUNTIME?: 'cloudflare' | 'node';
  APP_VERSION?: string;
  TRUST_PROXY?: boolean;
  /** Socket address of the direct peer (Node runtime only). */
  CLIENT_ADDRESS?: string;
  BACKGROUND_TASKS?: BackgroundTaskPort;
  /** Optional Workers Cache API override (defaults to `caches.default` on Cloudflare). */
  SUBSCRIPTION_CACHE?: SubscriptionCacheStore;
  TELEGRAM?: TelegramConfig;
  TELEGRAM_CLIENT?: TelegramClient;
};

export type AppVariables = {
  sessionId?: string;
  authType?: 'session' | 'apiKey' | 'telegram';
  telegramUserId?: string;
};

export type ApiOk<T> = {
  ok: true;
  data: T;
};

export type CategoriesPayload = {
  data: RulesData;
  links: Record<string, ClientLink[]>;
};
