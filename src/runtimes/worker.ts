import { cleanupExpiredSessions } from '../application/auth';
import { refreshIconPacks } from '../application/settings';
import { syncRuleSources } from '../application/sync';
import { ensureDatabaseMigrated } from '../data/migrate';
import { parseCloudflareConfig, type CloudflareConfigBindings } from '../infrastructure/config/cloudflare';
import { D1DatabaseAdapter } from '../infrastructure/database/d1/adapter';
import { TelegramHttpClient } from '../integrations/telegram/client';
import { ensureTelegramRegistration } from '../integrations/telegram/registration';
import { cleanupTelegramMessages } from '../integrations/telegram/services/message-cleanup';
import { notifyScheduledSync } from '../integrations/telegram/services/notifications';
import { ensureRuntimeSecrets } from '../lib/runtime-secrets';
import { createApp } from '../server/app';
import { purgeAllSubscriptionCaches } from '../server/cache/subscription-cache';
import type { Env } from '../types';
import { APP_VERSION } from '../version';

type CloudflareBindings = CloudflareConfigBindings & {
  DB: D1Database;
  ASSETS: Fetcher;
};

let telegramClient: TelegramHttpClient | undefined;
let telegramClientToken = '';

function dependencies(bindings: CloudflareBindings, context?: ExecutionContext): Env {
  const config = parseCloudflareConfig(bindings);
  if (config.telegram.enabled && (!telegramClient || telegramClientToken !== config.telegram.botToken)) {
    telegramClient = new TelegramHttpClient(config.telegram.botToken);
    telegramClientToken = config.telegram.botToken;
  }
  return {
    DB: new D1DatabaseAdapter(bindings.DB),
    ASSETS: { fetch: (request) => bindings.ASSETS.fetch(request) },
    ADMIN_PASSWORD: config.adminPassword,
    RULE_TOKEN: config.ruleToken,
    SESSION_SECRET: config.sessionSecret,
    BASE_URL: config.baseUrl,
    TELEGRAM: config.telegram,
    TELEGRAM_CLIENT: config.telegram.enabled ? telegramClient : undefined,
    BACKGROUND_TASKS: context ? { schedule: (task) => context.waitUntil(task) } : undefined,
    RUNTIME: 'cloudflare',
    APP_VERSION,
    TRUST_PROXY: false,
  };
}

const app = createApp();

export default {
  async fetch(request: Request, bindings: CloudflareBindings, context: ExecutionContext) {
    const env = dependencies(bindings, context);
    await ensureDatabaseMigrated(env.DB);
    await ensureRuntimeSecrets(env);
    context.waitUntil(
      ensureTelegramRegistration(env.TELEGRAM!, env.TELEGRAM_CLIENT).catch((cause) =>
        console.error('[telegram:registration]', cause instanceof Error ? cause.message : 'unknown error'),
      ),
    );
    return app.fetch(request, env, context);
  },
  scheduled(_controller: ScheduledController, bindings: CloudflareBindings, context: ExecutionContext) {
    const env = dependencies(bindings, context);
    context.waitUntil(
      ensureDatabaseMigrated(env.DB).then(async () => {
        await ensureRuntimeSecrets(env);
        await ensureTelegramRegistration(env.TELEGRAM!, env.TELEGRAM_CLIENT);
        await cleanupExpiredSessions(env.DB).catch((cause) =>
          console.error('[sessions:cleanup]', cause instanceof Error ? cause.message : 'unknown error'),
        );
        await cleanupTelegramMessages(env);
        await refreshIconPacks(env).catch((cause) =>
          console.error('[icon-packs:update]', cause instanceof Error ? cause.message : 'unknown error'),
        );
        const startedAt = Date.now();
        const results = await syncRuleSources(env, undefined, false);
        if (results.length > 0) {
          await purgeAllSubscriptionCaches(env).catch(() => undefined);
        }
        await notifyScheduledSync(env, results, { startedAt, completedAt: Date.now() });
      }),
    );
  },
};
