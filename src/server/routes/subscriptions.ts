import { Hono } from 'hono';
import { compilePublicationDelivery, resolvePublicationDelivery } from '../../application/publications';
import { getSubscriptionFile } from '../../application/rulesets';
import { createLogger } from '../../infrastructure/logging/logger';
import { safeFileName, tokenMatches } from '../../lib/auth';
import { json } from '../../lib/response';
import { SUPPORTED_TEMPLATE_CLIENTS, TEMPLATE_CLIENTS } from '../../shared/clients';
import {
  computeSubscriptionEtag,
  matchCachedPublication,
  matchCachedSubscription,
  matchesIfNoneMatch,
  storeCachedPublication,
  storeCachedSubscription,
  SUBSCRIPTION_CACHE_CONTROL,
} from '../cache/subscription-cache';
import { externalBaseUrl, type AppBindings, type AppContext } from '../helpers';

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

async function servePublication(c: AppContext, slug: string, file: string, access: 'public' | 'token', token?: string) {
  if (!safeFileName(slug) || !safeFileName(file)) return c.notFound();

  const baseUrl = externalBaseUrl(c);
  const delivery = await resolvePublicationDelivery(c.env, {
    slug,
    file,
    access,
    token,
    baseUrl,
  });

  if (delivery.status === 'not_found') {
    return c.notFound();
  }
  if (delivery.status === 'unsupported_client') {
    return json(
      {
        ok: false,
        error: delivery.message,
        code: 'NOT_FOUND',
        details: { client: delivery.client, supportedClients: [...SUPPORTED_TEMPLATE_CLIENTS] },
      },
      { status: 404 },
    );
  }

  const isBClassWithBindings = TEMPLATE_CLIENTS[delivery.client].nodeAccess === 'B' && delivery.bindingRows.length > 0;
  const staleSlotIds = delivery.staleSlotIds ?? [];
  const hasStaleFromDelivery = staleSlotIds.length > 0;

  const ifNoneMatch = c.req.header('if-none-match');
  if (!hasStaleFromDelivery) {
    const cached = await matchCachedPublication(c.env, delivery.cacheIdentity);
    if (cached) {
      const cachedEtag = cached.headers.get('etag');
      if (cachedEtag && matchesIfNoneMatch(ifNoneMatch, cachedEtag)) {
        return notModifiedResponse(cachedEtag);
      }
      const headers = new Headers(cached.headers);
      return new Response(cached.body, { status: cached.status, headers });
    }
  }

  const compiled = await compilePublicationDelivery(c.env, delivery, baseUrl);
  const reportHasStale = compiled.report.items.some((item) => item.code === 'STALE_NODE_SNAPSHOT');
  const isStale = hasStaleFromDelivery || reportHasStale;

  const etag = await computeSubscriptionEtag(compiled.content, compiled.contentType);
  const headers: Record<string, string> = {
    'content-type': compiled.contentType,
    'cache-control': isStale ? 'no-cache' : SUBSCRIPTION_CACHE_CONTROL,
    etag,
    'x-robots-tag': 'noindex, nofollow',
  };

  if (isStale) {
    headers['x-node-snapshot-status'] = 'stale';
    headers['x-node-snapshot-stale'] = 'true';
    if (staleSlotIds.length > 0) {
      headers['x-node-snapshot-stale-slots'] = staleSlotIds.join(',');
    }
    headers.warning = '110 - "Node snapshot is stale"';
  } else if (isBClassWithBindings) {
    headers['x-node-snapshot-status'] = 'fresh';
  }

  const response = new Response(compiled.content, {
    status: 200,
    headers,
  });

  if (!isStale) {
    await storeCachedPublication(c.env, delivery.cacheIdentity, response);
  }

  if (!isStale && matchesIfNoneMatch(ifNoneMatch, etag)) {
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
  })
  .get('/p/:slug/:file', (c) => servePublication(c, c.req.param('slug'), c.req.param('file'), 'public'))
  .get('/t/:token/:slug/:file', (c) => {
    const token = c.req.param('token');
    if (!tokenMatches(c.env, token)) return c.notFound();
    return servePublication(c, c.req.param('slug'), c.req.param('file'), 'token', token);
  });
