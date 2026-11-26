import { Hono } from 'hono';
import { getRulesOverview, listRules } from '../../application/rulesets';
import { syncRuleSources } from '../../application/sync';
import { requireAuth } from '../../lib/auth';
import { searchGeoSources } from '../../lib/geosite';
import { json } from '../../lib/response';
import { UPSTREAM_RULE_PREVIEW_LIMIT } from '../../types/domain-rules';
import { purgeAllSubscriptionCaches } from '../cache/subscription-cache';
import { withLinks, type AppBindings } from '../helpers';
import { persistentRateLimit } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import { geoSearchQuerySchema, rulesQuerySchema } from './schemas';

export const syncRoutes = new Hono<AppBindings>()
  .get(
    '/api/rules',
    requireAuth,
    persistentRateLimit('rule-search', 60),
    validate('query', rulesQuerySchema),
    async (c) => {
      const query = c.req.valid('query');
      const requestedLimit = Number(query.limit ?? String(UPSTREAM_RULE_PREVIEW_LIMIT));
      const limit =
        query.all === '1' ? 0 : Number.isFinite(requestedLimit) ? requestedLimit : UPSTREAM_RULE_PREVIEW_LIMIT;
      return json({
        rules: await listRules(c.env, {
          categoryId: query.categoryId || undefined,
          query: query.q || undefined,
          source: query.source,
          limit,
        }),
      });
    },
  )
  .get('/api/geo/search', requireAuth, validate('query', geoSearchQuerySchema), async (c) => {
    const { q } = c.req.valid('query');
    return json({ results: await searchGeoSources(q) });
  })
  .post('/api/sync', requireAuth, persistentRateLimit('sync-all', 5), async (c) => {
    const results = await syncRuleSources(c.env);
    await purgeAllSubscriptionCaches(c.env);
    return json({ results, ...withLinks(c, await getRulesOverview(c.env)) });
  });
