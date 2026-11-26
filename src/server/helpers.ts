import type { Context, MiddlewareHandler } from 'hono';
import type { getRulesData } from '../application/rulesets';
import { linksByCategory } from '../lib/links';
import { AppError } from '../shared/errors';
import type { AppVariables, Env } from '../types';

export type AppBindings = { Bindings: Env; Variables: AppVariables };
export type AppContext = Context<AppBindings>;

/**
 * Rejects write operations initiated from a Telegram Mini App session with 403
 * while keeping read endpoints accessible (design §12.1, §13.7).
 */
export const rejectTelegramWrite: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.get('authType') === 'telegram') {
    throw new AppError('FORBIDDEN', 'Telegram 会话不允许修改应用组件、模板或发布配置。');
  }
  await next();
};

export function externalRequestUrl(c: AppContext): string {
  if (c.env.BASE_URL) return `${c.env.BASE_URL}${new URL(c.req.url).pathname}`;
  if (!c.env.TRUST_PROXY) return c.req.url;
  const original = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0].trim() || original.protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host')?.split(',')[0].trim() || original.host;
  return `${proto}://${host}${original.pathname}${original.search}`;
}

export function externalBaseUrl(c: AppContext): string {
  if (c.env.BASE_URL) return c.env.BASE_URL.replace(/\/+$/, '');
  const parsed = new URL(externalRequestUrl(c));
  return parsed.origin;
}

export function withLinks(c: AppContext, data: Awaited<ReturnType<typeof getRulesData>>) {
  return {
    data,
    links: linksByCategory(data, externalRequestUrl(c), c.get('authType') === 'apiKey' ? undefined : c.env.RULE_TOKEN),
  };
}

async function htmlEntryApp(c: AppContext, entryPathname: string): Promise<Response> {
  const url = new URL(c.req.url);
  url.pathname = entryPathname;
  url.search = '';
  // Pass an explicit init: using the incoming Request as RequestInit fails
  // undici's brand check on newer Node releases ("Illegal invocation").
  const response = await c.env.ASSETS.fetch(new Request(url, { method: 'GET', headers: c.req.raw.headers }));
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');
  headers.delete('etag');
  headers.delete('last-modified');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function adminApp(c: AppContext): Promise<Response> {
  // Assets canonicalises /index.html to /. Fetching / directly avoids a
  // redirect back into the application's authenticated root route.
  return htmlEntryApp(c, '/');
}
