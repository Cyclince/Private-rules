import type { MiddlewareHandler } from 'hono';
import { createRepositories } from '../../data/repositories';
import { clientIdentity } from '../../lib/auth';
import { AppError } from '../../shared/errors';
import type { AppVariables, Env } from '../../types';

export function persistentRateLimit(
  operation: string,
  limit: number,
  windowSeconds = 60,
): MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> {
  return async (c, next) => {
    const identity = c.get('telegramUserId') || c.get('sessionId') || clientIdentity(c);
    const result = await createRepositories(c.env.DB).rateLimits.consume(identity, operation, limit, windowSeconds);
    if (!result.allowed) {
      throw new AppError('RATE_LIMITED', '操作过于频繁，请稍后再试。');
    }
    await next();
  };
}
