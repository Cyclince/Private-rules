import { defineConfig } from '@playwright/test';
import { E2E_ORIGIN, E2E_PORT } from './tests/helpers/e2e-env';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: { baseURL: E2E_ORIGIN, locale: 'zh-CN', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm build && pnpm start',
    url: `${E2E_ORIGIN}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ADMIN_PASSWORD: 'e2e-password',
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      RULE_TOKEN: 'e2e-rule-token',
      DATABASE_PATH: './data/e2e.db',
      HOST: '127.0.0.1',
      PORT: E2E_PORT,
      NODE_ENV: 'test',
      SCHEDULER_ENABLED: 'false',
      TELEGRAM_BOT_TOKEN: '123456:e2e-test-token',
      TELEGRAM_WEBHOOK_SECRET: 'e2e-webhook-secret',
      TELEGRAM_USER_ID: '2001',
      BASE_URL: E2E_ORIGIN,
    },
  },
});
