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
  'src/builtin/**/*.ts',
  'src/infrastructure/http/**/*.ts',
  'src/infrastructure/logging/**/*.ts',
  'src/infrastructure/crypto/**/*.ts',
  'src/web/**/*.{ts,tsx}',
  'src/server/middleware/**/*.ts',
  'src/server/routes/**/*.ts',
  'tests/shared/**/*.ts',
  'tests/domain/**/*.ts',
  'tests/unit/http-fetch.test.ts',
  'tests/unit/logger.test.ts',
  'tests/unit/node-secrets.test.ts',
  'tests/integration/migration.test.ts',
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.wrangler/**', 'coverage/**'] },
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
