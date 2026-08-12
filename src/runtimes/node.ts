import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { NodeAssetsAdapter } from '../infrastructure/assets/node';
import { parseNodeConfig } from '../infrastructure/config/node';
import { SqliteDatabaseAdapter } from '../infrastructure/database/sqlite/adapter';
import { applySqliteMigrations } from '../infrastructure/database/sqlite/migrations';
import { NodeScheduler } from '../infrastructure/scheduler/node';
import { ensureDatabase } from '../lib/db';
import { syncRuleSources } from '../lib/sync';
import { createApp } from '../server/app';
import type { Env } from '../types';
import { APP_VERSION } from '../version';
import { NodeBackgroundTaskAdapter } from '../infrastructure/background/node';
import { TelegramHttpClient } from '../integrations/telegram/client';
import { notifyScheduledSync } from '../integrations/telegram/services/notifications';
import { ensureTelegramRegistration } from '../integrations/telegram/registration';
import { ensureRuntimeSecrets } from '../lib/runtime-secrets';
import { cleanupTelegramMessages } from '../integrations/telegram/services/message-cleanup';
import { refreshIconPacks } from '../lib/icon-packs';

const config = parseNodeConfig(process.env);
await mkdir(dirname(config.databasePath), { recursive: true });
const database = new SqliteDatabaseAdapter(config.databasePath);
await applySqliteMigrations(database, resolve(process.cwd(), 'migrations'));
const backgroundTasks = new NodeBackgroundTaskAdapter();
const env: Env = {
  DB: database,
  ASSETS: new NodeAssetsAdapter(resolve(process.cwd(), 'dist/client')),
  ADMIN_PASSWORD: config.adminPassword,
  SESSION_SECRET: config.sessionSecret,
  RULE_TOKEN: config.ruleToken,
  BASE_URL: config.baseUrl,
  TRUST_PROXY: config.trustProxy,
  RUNTIME: 'node',
  APP_VERSION,
  BACKGROUND_TASKS: backgroundTasks,
  TELEGRAM: config.telegram,
  TELEGRAM_CLIENT: config.telegram.enabled ? new TelegramHttpClient(config.telegram.botToken) : undefined,
};
await ensureDatabase(env);
await ensureRuntimeSecrets(env);
const app = createApp();
const logger = {
  info: (message: string) => console.info(`[private-rules] ${message}`),
  error: (message: string, error?: unknown) => console.error(`[private-rules] ${message}`, error instanceof Error ? error.message : ''),
};
const scheduler = new NodeScheduler(config.scheduler.intervalSeconds, async () => {
  await cleanupTelegramMessages(env);
  await refreshIconPacks(env).catch((cause) => logger.error('Icon pack auto-update failed', cause));
  const startedAt = Date.now();
  const results = await syncRuleSources(env, undefined, false);
  await notifyScheduledSync(env, results, { startedAt, completedAt: Date.now() });
}, logger);
if (config.scheduler.enabled) scheduler.start();
const server = serve({ hostname: config.host, port: config.port, fetch: (request) => app.fetch(request, env) }, (info) => logger.info(`listening on http://${info.address}:${info.port}`));
if (config.nodeEnv !== 'test') {
  void ensureTelegramRegistration(env.TELEGRAM!, env.TELEGRAM_CLIENT)
    .then(() => {
      if (config.telegram.enabled) logger.info('Telegram Bot configured automatically');
    })
    .catch((cause) => logger.error('Telegram Bot auto-configuration failed', cause));
}

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info(`received ${signal}; shutting down`);
  scheduler.stop();
  server.close(() => {
    void backgroundTasks.close().finally(() => { database.close(); process.exit(0); });
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
