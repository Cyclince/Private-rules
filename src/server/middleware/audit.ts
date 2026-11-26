import type { MiddlewareHandler } from 'hono';
import { TelegramRepository } from '../../application/telegram/repository';
import type { AppVariables, Env } from '../../types';

export const telegramAuditMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> = async (
  c,
  next,
) => {
  await next();
  if (c.req.method === 'GET' || c.get('authType') !== 'telegram' || c.req.path.startsWith('/api/telegram/session')) {
    return;
  }
  const telegramUserId = c.get('telegramUserId');
  if (!telegramUserId) return;
  await new TelegramRepository(c.env.DB)
    .audit({
      telegramUserId,
      action: `${c.req.method} ${c.req.path}`.slice(0, 180),
      targetType: 'api',
      result: c.res.status < 400 ? 'success' : c.res.status === 403 ? 'denied' : 'failure',
      summary: `status=${c.res.status}`,
    })
    .catch(() => undefined);
};
