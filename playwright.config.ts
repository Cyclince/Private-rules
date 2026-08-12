import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:5180', locale: 'zh-CN', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://127.0.0.1:5180/health',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ADMIN_PASSWORD: 'e2e-password',
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      RULE_TOKEN: 'e2e-rule-token',
      DATABASE_PATH: './data/e2e.db',
      HOST: '127.0.0.1',
      PORT: '5180',
      NODE_ENV: 'test',
      SCHEDULER_ENABLED: 'false',
      TELEGRAM_BOT_TOKEN: '123456:e2e-test-token',
      TELEGRAM_WEBHOOK_SECRET: 'e2e-webhook-secret',
      TELEGRAM_USER_ID: '2001',
      BASE_URL: 'http://127.0.0.1:5180',
    },
  },
});
