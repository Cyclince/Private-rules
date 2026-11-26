import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { z } from 'zod';
import { AppError } from '../../shared/errors';

/**
 * Wraps `@hono/zod-validator` so every schema validation error throws a
 * canonical `AppError('VALIDATION_FAILED', ...)` while preserving Hono RPC
 * type inference for `hc<AppType>`.
 */
export function validate<Target extends keyof ValidationTargets, T extends z.ZodType>(target: Target, schema: T) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      }));
      const summary = issues
        .slice(0, 3)
        .map((item) => (item.path ? `${item.path}: ${item.message}` : item.message))
        .join('；');
      throw new AppError('VALIDATION_FAILED', summary || '请求参数校验失败。', { issues });
    }
  });
}
