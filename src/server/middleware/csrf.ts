import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { TELEGRAM_SESSION_COOKIE } from '../../integrations/telegram/session';
import { AppError } from '../../shared/errors';
import type { AppVariables, Env } from '../../types';

const ADMIN_SESSION_COOKIE = 'private_rules_session';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_EXEMPT_PATHS = new Set(['/api/telegram/webhook', '/api/auth/login', '/api/telegram/session']);

function expectedOrigin(requestUrl: string, env: Env, forwardedProto?: string, forwardedHost?: string): string {
  if (env.BASE_URL) {
    try {
      return new URL(env.BASE_URL).origin;
    } catch {
      // Fall back to request origin when BASE_URL is malformed.
    }
  }
  const parsed = new URL(requestUrl);
  if (env.TRUST_PROXY) {
    const proto = forwardedProto?.split(',')[0].trim() || parsed.protocol.replace(':', '');
    const host = forwardedHost?.split(',')[0].trim() || parsed.host;
    return `${proto}://${host}`;
  }
  return parsed.origin;
}

/**
 * Enforces Origin same-origin + `Content-Type: application/json` on Cookie-based
 * write requests (admin session & Telegram Mini App session). Bearer API Key
 * requests are exempt from CSRF checks (design §14).
 */
export const csrfProtection: MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method.toUpperCase())) {
    await next();
    return;
  }
  if (CSRF_EXEMPT_PATHS.has(c.req.path)) {
    await next();
    return;
  }

  // Bearer API Key requests are exempt (requireAuth rejects invalid Bearer tokens without falling back to Cookie).
  const authorization = c.req.header('authorization') ?? '';
  if (/^Bearer\s+/i.test(authorization)) {
    await next();
    return;
  }

  const hasSessionCookie = Boolean(getCookie(c, ADMIN_SESSION_COOKIE) || getCookie(c, TELEGRAM_SESSION_COOKIE));
  if (!hasSessionCookie) {
    await next();
    return;
  }

  const contentType = (c.req.header('content-type') ?? '').trim().toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new AppError('CSRF_REJECTED', '跨站请求被拒绝：写操作必须使用 application/json。');
  }

  const origin = c.req.header('origin')?.trim();
  const expected = expectedOrigin(
    c.req.url,
    c.env,
    c.req.header('x-forwarded-proto'),
    c.req.header('x-forwarded-host'),
  );
  if (!origin || origin !== expected) {
    throw new AppError('CSRF_REJECTED', '跨站请求被拒绝：Origin 不匹配。');
  }

  await next();
};
