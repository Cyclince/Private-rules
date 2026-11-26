import type { MiddlewareHandler } from 'hono';
import type { AppVariables, Env } from '../../types';

/**
 * Allows cross-origin fetches strictly on public subscription routes
 * (`/rules/*`, `/sub/*`, `/p/*`, `/t/*`). `/api/*` never sets `ACAO: *` (design §14).
 */
export const publicSubscriptionCors: MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> = async (
  c,
  next,
) => {
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
        'access-control-allow-headers': 'If-None-Match',
        'access-control-max-age': '86400',
      },
    });
  }
  await next();
  c.res.headers.set('access-control-allow-origin', '*');
};
