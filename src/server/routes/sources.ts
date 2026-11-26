import { Hono } from 'hono';
import { findRulesetSlug } from '../../application/rulesets';
import {
  createSource,
  deleteSource,
  getSource,
  listSources,
  previewSource,
  syncSourceById,
  toggleSource,
  updateSource,
  type SourceInput,
} from '../../application/sources';
import { requireAuth } from '../../lib/auth';
import { json } from '../../lib/response';
import { AppError } from '../../shared/errors';
import { purgeSubscriptionCacheForSlugs } from '../cache/subscription-cache';
import type { AppBindings, AppContext } from '../helpers';
import { persistentRateLimit } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import { sourceInputBodySchema, sourceIntervalBodySchema, sourceToggleBodySchema } from './schemas';

async function purgeCategoryCache(c: AppContext, categoryId: string) {
  const slug = await findRulesetSlug(c.env, categoryId);
  if (slug) await purgeSubscriptionCacheForSlugs(c.env, [slug]);
}

export async function handleListSources(c: AppContext, categoryId: string) {
  return json({ sources: await listSources(c.env, categoryId) });
}

export async function handleGetSource(c: AppContext, categoryId: string, sourceId: string) {
  const source = await getSource(c.env, sourceId, categoryId);
  if (!source) throw new AppError('SOURCE_NOT_FOUND', '来源不存在。');
  return json({ source });
}

export async function handlePreviewSource(c: AppContext, input: SourceInput) {
  return json({ preview: await previewSource(c.env, input) });
}

export async function handleCreateSource(c: AppContext, categoryId: string, input: SourceInput) {
  const source = await createSource(c.env, categoryId, input);
  await purgeCategoryCache(c, categoryId);
  return json({ source }, { status: 201 });
}

export async function handleUpdateSource(c: AppContext, categoryId: string, sourceId: string, input: SourceInput) {
  const existing = await getSource(c.env, sourceId, categoryId);
  if (!existing) throw new AppError('SOURCE_NOT_FOUND', '来源不存在。');
  const source = await updateSource(c.env, existing.id, input);
  await purgeCategoryCache(c, categoryId);
  return json({ source });
}

export async function handleDeleteSource(c: AppContext, categoryId: string, sourceId: string) {
  const existing = await getSource(c.env, sourceId, categoryId);
  if (!existing) throw new AppError('SOURCE_NOT_FOUND', '来源不存在。');
  const deleted = await deleteSource(c.env, existing.id);
  await purgeCategoryCache(c, categoryId);
  return json({ deleted });
}

export async function handleToggleSource(c: AppContext, categoryId: string, sourceId: string, enabled: boolean) {
  const existing = await getSource(c.env, sourceId, categoryId);
  if (!existing) throw new AppError('SOURCE_NOT_FOUND', '来源不存在。');
  const source = await toggleSource(c.env, existing.id, enabled);
  await purgeCategoryCache(c, categoryId);
  return json({ source });
}

export async function handleUpdateSourceInterval(
  c: AppContext,
  categoryId: string,
  sourceId: string,
  syncIntervalMinutes: number,
) {
  const existing = await getSource(c.env, sourceId, categoryId);
  if (!existing) throw new AppError('SOURCE_NOT_FOUND', '来源不存在。');
  const source = await updateSource(c.env, existing.id, {
    sourceType: existing.sourceType ?? 'url',
    name: existing.name,
    url: existing.url,
    geositeName: existing.geositeName,
    geoipName: existing.geoipName,
    userAgent: existing.userAgent,
    ruleOptimization: existing.ruleOptimization,
    coverageDedup: existing.coverageDedup,
    enabled: existing.enabled,
    syncIntervalMinutes,
  });
  return json({ source });
}

export async function handleSyncSource(c: AppContext, categoryId: string, sourceId: string) {
  const existing = await getSource(c.env, sourceId, categoryId);
  if (!existing) throw new AppError('SOURCE_NOT_FOUND', '来源不存在。');
  const result = await syncSourceById(c.env, existing.id);
  await purgeCategoryCache(c, categoryId);
  return json({ result });
}

export const sourceRoutes = new Hono<AppBindings>()
  .get('/api/rulesets/:id/sources', requireAuth, (c) => handleListSources(c, c.req.param('id')))
  .get('/api/rulesets/:id/sources/:sourceId', requireAuth, (c) =>
    handleGetSource(c, c.req.param('id'), c.req.param('sourceId')),
  )
  .post(
    '/api/rulesets/:id/sources/preview',
    requireAuth,
    persistentRateLimit('source-preview', 10),
    validate('json', sourceInputBodySchema),
    (c) => handlePreviewSource(c, c.req.valid('json')),
  )
  .post(
    '/api/rulesets/:id/sources',
    requireAuth,
    persistentRateLimit('source-create', 10),
    validate('json', sourceInputBodySchema),
    (c) => handleCreateSource(c, c.req.param('id'), c.req.valid('json')),
  )
  .patch('/api/rulesets/:id/sources/:sourceId', requireAuth, validate('json', sourceInputBodySchema), (c) =>
    handleUpdateSource(c, c.req.param('id'), c.req.param('sourceId'), c.req.valid('json')),
  )
  .delete('/api/rulesets/:id/sources/:sourceId', requireAuth, (c) =>
    handleDeleteSource(c, c.req.param('id'), c.req.param('sourceId')),
  )
  .post('/api/rulesets/:id/sources/:sourceId/toggle', requireAuth, validate('json', sourceToggleBodySchema), (c) =>
    handleToggleSource(c, c.req.param('id'), c.req.param('sourceId'), c.req.valid('json').enabled),
  )
  .post('/api/rulesets/:id/sources/:sourceId/interval', requireAuth, validate('json', sourceIntervalBodySchema), (c) =>
    handleUpdateSourceInterval(c, c.req.param('id'), c.req.param('sourceId'), c.req.valid('json').syncIntervalMinutes),
  )
  .post('/api/rulesets/:id/sources/:sourceId/sync', requireAuth, persistentRateLimit('source-sync', 10), (c) =>
    handleSyncSource(c, c.req.param('id'), c.req.param('sourceId')),
  );
