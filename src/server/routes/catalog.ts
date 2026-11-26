import { Hono } from 'hono';
import { z } from 'zod';
import { getCatalogEntry, listCatalog } from '../../application/catalog';
import { requireAuth } from '../../lib/auth';
import { json } from '../../lib/response';
import { catalogCategorySchema } from '../../shared/schemas/card';
import type { AppBindings } from '../helpers';
import { validate } from '../middleware/validate';

const catalogQuerySchema = z.object({
  q: z.string().optional(),
  category: catalogCategorySchema.optional(),
  provider: z.string().optional(),
  kind: z.enum(['builtin', 'ruleset', 'geosite', 'geoip']).optional(),
  cursor: z.string().optional(),
  limit: z.string().optional(),
});

export const catalogRoutes = new Hono<AppBindings>()
  .get('/api/catalog', requireAuth, validate('query', catalogQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const requestedLimit = query.limit === undefined ? 100 : Number(query.limit);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.trunc(requestedLimit), 200)) : 100;
    const result = await listCatalog(c.env, {
      query: query.q || undefined,
      category: query.category,
      provider: query.provider || undefined,
      kind: query.kind,
      cursor: query.cursor || undefined,
      limit,
    });
    return json(result);
  })
  .get('/api/catalog/:entryId', requireAuth, async (c) => {
    const entry = await getCatalogEntry(c.env, decodeURIComponent(c.req.param('entryId')));
    return json({ entry });
  });
