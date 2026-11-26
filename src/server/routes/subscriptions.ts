import { Hono } from 'hono';
import { getSubscriptionFile } from '../../application/rulesets';
import { createLogger } from '../../infrastructure/logging/logger';
import { safeFileName, tokenMatches } from '../../lib/auth';
import {
  computeSubscriptionEtag,
  matchCachedSubscription,
  matchesIfNoneMatch,
  storeCachedSubscription,
  SUBSCRIPTION_CACHE_CONTROL,
} from '../cache/subscription-cache';
import type { AppBindings, AppContext } from '../helpers';

const subscriptionLogger = createLogger({ component: 'subscription' });

function notModifiedResponse(etag: string): Response {
  return new Response(null, {
    status: 304,
    headers: {
      etag,
      'cache-control': SUBSCRIPTION_CACHE_CONTROL,
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

async function serveSubscription(c: AppContext, file: string, access: 'public' | 'token', token?: string) {
  if (!safeFileName(file)) return c.notFound();

  const ifNoneMatch = c.req.header('if-none-match');
  const cached = await matchCachedSubscription(c.env, access, file, token);
  if (cached) {
    const cachedEtag = cached.headers.get('etag');
    if (cachedEtag && matchesIfNoneMatch(ifNoneMatch, cachedEtag)) {
      return notModifiedResponse(cachedEtag);
    }
    const headers = new Headers(cached.headers);
    return new Response(cached.body, { status: cached.status, headers });
  }

  const result = await getSubscriptionFile(c.env, file, access);
  if (!result) return c.notFound();

  if (result.skipped.length > 0) {
    subscriptionLogger.warn('skipped unsupported rules during formatting', {
      rulesetId: result.category.id,
      formatter: result.formatter.id,
      skippedCount: result.skipped.length,
      skippedTypes: [...new Set(result.skipped.map((item) => item.type))],
    });
  }

  const etag = await computeSubscriptionEtag(result.body, result.contentType);
  const response = new Response(result.body, {
    status: 200,
    headers: {
      'content-type': result.contentType,
      'cache-control': SUBSCRIPTION_CACHE_CONTROL,
      etag,
      'x-robots-tag': 'noindex, nofollow',
    },
  });

  await storeCachedSubscription(c.env, access, file, response, token);

  if (matchesIfNoneMatch(ifNoneMatch, etag)) {
    return notModifiedResponse(etag);
  }
  return response;
}

export const subscriptionRoutes = new Hono<AppBindings>()
  .get('/rules/:file', (c) => serveSubscription(c, c.req.param('file'), 'public'))
  .get('/sub/:token/:file', (c) => {
    const token = c.req.param('token');
    if (!tokenMatches(c.env, token)) return c.notFound();
    return serveSubscription(c, c.req.param('file'), 'token', token);
  });
