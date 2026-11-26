import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Lint covers code written for 1.1.0. Legacy 1.0.x directories are added here
 * as they are rewritten; until then they are only type-checked.
 */
export const LINTED = [
  'drizzle.config.ts',
  'src/shared/**/*.ts',
  'src/domain/**/*.ts',
  'src/data/**/*.ts',
  'src/application/auth/**/*.ts',
  'src/application/backup/**/*.ts',
  'src/application/rulesets/**/*.ts',
  'src/application/settings/**/*.ts',
  'src/application/sources/**/*.ts',
  'src/application/sync/**/*.ts',
  'src/builtin/**/*.ts',
  'src/infrastructure/http/**/*.ts',
  'src/infrastructure/logging/**/*.ts',
  'src/infrastructure/crypto/**/*.ts',
  'src/web/**/*.{ts,tsx}',
  'src/runtimes/worker.ts',
  'src/server/**/*.ts',
  'scripts/bundle-size.ts',
  'scripts/check-contrast.ts',
  'scripts/generate-zh-tw.ts',
  'tests/shared/**/*.ts',
  'tests/domain/**/*.ts',
  'tests/unit/contrast.test.ts',
  'tests/unit/http-fetch.test.ts',
  'tests/unit/logger.test.ts',
  'tests/unit/node-secrets.test.ts',
  'tests/unit/sync-scheduler.test.ts',
  'tests/unit/web-i18n-and-assets.test.ts',
  'tests/unit/web-query-and-api.test.ts',
  'tests/integration/migration.test.ts',
  'tests/integration/rulesets-pagination.test.ts',
  'tests/integration/security-hardening.test.ts',
  'tests/integration/subscriptions-cache.test.ts',
  'tests/e2e/preview-layout.spec.ts',
  'tests/e2e/preview-auth-and-telegram.spec.ts',
  'tests/e2e/preview-rulesets-and-rules.spec.ts',
  'tests/e2e/preview-sources-settings-backup.spec.ts',
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.wrangler/**', 'coverage/**', 'src/web/routeTree.gen.ts'] },
  {
    files: LINTED,
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
);
