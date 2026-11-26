import { Hono } from 'hono';
import {
  addRule,
  batchUpdateRules,
  bulkImportRules,
  createCategory,
  deleteCategory,
  deleteRule,
  findRulesetSlug,
  getRulesetById,
  getRulesetsSummary,
  getRulesOverview,
  listRulesPaginated,
  updateCategory,
  updateRule,
} from '../../application/rulesets';
import { syncRuleSources } from '../../application/sync';
import { requireAuth } from '../../lib/auth';
import { json } from '../../lib/response';
import { AppError } from '../../shared/errors';
import { UPSTREAM_RULE_PREVIEW_LIMIT } from '../../types/domain-rules';
import { purgeSubscriptionCacheForSlugs } from '../cache/subscription-cache';
import { withLinks, type AppBindings, type AppContext } from '../helpers';
import { persistentRateLimit } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import {
  addRuleBodySchema,
  batchRulesBodySchema,
  createRulesetBodySchema,
  importRulesBodySchema,
  rulesetsQuerySchema,
  rulesQuerySchema,
  updateRuleBodySchema,
  updateRulesetBodySchema,
} from './schemas';

export async function handleListRulesets(c: AppContext) {
  const data = c.req.query('summary') === '1' ? await getRulesetsSummary(c.env) : await getRulesOverview(c.env);
  return json(withLinks(c, data));
}

export async function handleCreateRuleset(c: AppContext, input: ReturnType<typeof createRulesetBodySchema.parse>) {
  let data = await createCategory(c.env, input);
  const created =
    data.categories.find((category) => category.name === input.name) ??
    [...data.categories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (input.sourceUrls?.length || input.geositeNames?.length || input.geoipNames?.length) {
    if (created) await syncRuleSources(c.env, created.id);
    data = await getRulesOverview(c.env);
  }
  if (created) {
    await purgeSubscriptionCacheForSlugs(c.env, [created.slug]);
  }
  return json(withLinks(c, data), { status: 201 });
}

export async function handleUpdateRuleset(
  c: AppContext,
  id: string,
  input: ReturnType<typeof updateRulesetBodySchema.parse>,
) {
  if (
    c.get('authType') === 'telegram' &&
    Object.keys(input).some((key) => !['enabled', 'tokenLinksEnabled', 'publicLinksEnabled'].includes(key))
  ) {
    throw new AppError('FORBIDDEN', 'Telegram 会话只能修改分类启用状态和订阅策略。');
  }
  const previousSlug = await findRulesetSlug(c.env, id);
  const data = await updateCategory(c.env, id, input as Record<string, unknown>);
  const updatedSlug = data.categories.find((category) => category.id === id)?.slug;
  await purgeSubscriptionCacheForSlugs(c.env, [previousSlug ?? '', updatedSlug ?? '']);
  return json(withLinks(c, data));
}

export async function handleDeleteRuleset(c: AppContext, id: string) {
  const previousSlug = await findRulesetSlug(c.env, id);
  const data = await deleteCategory(c.env, id);
  if (previousSlug) {
    await purgeSubscriptionCacheForSlugs(c.env, [previousSlug]);
  }
  return json(withLinks(c, data));
}

export async function handleAddRule(
  c: AppContext,
  categoryId: string,
  input: ReturnType<typeof addRuleBodySchema.parse>,
) {
  const result = await addRule(c.env, categoryId, input);
  if ('conflicts' in result) {
    return json(
      {
        ok: false,
        error: '新规则与现有规则重复或冲突。',
        code: 'RULE_CONFLICT',
        conflicts: result.conflicts,
        details: { conflicts: result.conflicts },
      },
      { status: 409 },
    );
  }
  const slug = result.categories.find((category) => category.id === categoryId)?.slug;
  if (slug) await purgeSubscriptionCacheForSlugs(c.env, [slug]);
  return json({ replaced: result.replaced, ...withLinks(c, result) }, { status: 201 });
}

export async function handleUpdateRule(
  c: AppContext,
  categoryId: string,
  ruleId: string,
  input: ReturnType<typeof updateRuleBodySchema.parse>,
) {
  const data = await updateRule(c.env, categoryId, ruleId, input as Record<string, unknown>);
  const slug = data.categories.find((category) => category.id === categoryId)?.slug;
  if (slug) await purgeSubscriptionCacheForSlugs(c.env, [slug]);
  return json(withLinks(c, data));
}

export async function handleDeleteRule(c: AppContext, categoryId: string, ruleId: string) {
  const data = await deleteRule(c.env, categoryId, ruleId);
  const slug = data.categories.find((category) => category.id === categoryId)?.slug;
  if (slug) await purgeSubscriptionCacheForSlugs(c.env, [slug]);
  return json(withLinks(c, data));
}

export async function handleBatchRules(
  c: AppContext,
  categoryId: string,
  body: ReturnType<typeof batchRulesBodySchema.parse>,
) {
  const data = await batchUpdateRules(c.env, categoryId, body.ruleIds, body.action);
  const slug = data.categories.find((category) => category.id === categoryId)?.slug;
  if (slug) await purgeSubscriptionCacheForSlugs(c.env, [slug]);
  return json(withLinks(c, data));
}

export async function handleImportRules(
  c: AppContext,
  categoryId: string,
  body: ReturnType<typeof importRulesBodySchema.parse>,
) {
  const outcome = await bulkImportRules(c.env, categoryId, body);
  if (outcome.status === 'preview') return json({ preview: outcome.preview });
  if (outcome.status === 'conflict') {
    return json(
      {
        ok: false,
        error: '批量规则与现有规则重复或冲突。',
        code: 'RULE_CONFLICT',
        preview: outcome.preview,
        details: { preview: outcome.preview },
      },
      { status: 409 },
    );
  }
  const slug = outcome.data.categories.find((category) => category.id === categoryId)?.slug;
  if (slug) await purgeSubscriptionCacheForSlugs(c.env, [slug]);
  return json({ preview: outcome.preview, replaced: outcome.replaced, ...withLinks(c, outcome.data) });
}

export async function handleSyncRuleset(c: AppContext, categoryId: string) {
  const results = await syncRuleSources(c.env, categoryId);
  const overview = await getRulesOverview(c.env);
  const slug = overview.categories.find((category) => category.id === categoryId)?.slug;
  if (slug) await purgeSubscriptionCacheForSlugs(c.env, [slug]);
  return json({ results, ...withLinks(c, overview) });
}

export const rulesetRoutes = new Hono<AppBindings>()
  .get('/api/rulesets', requireAuth, validate('query', rulesetsQuerySchema), handleListRulesets)
  .post('/api/rulesets', requireAuth, validate('json', createRulesetBodySchema), async (c) => {
    return handleCreateRuleset(c, c.req.valid('json'));
  })
  .get('/api/rulesets/:id', requireAuth, async (c) => {
    const ruleset = await getRulesetById(c.env, c.req.param('id'));
    return json({ ruleset });
  })
  .patch('/api/rulesets/:id', requireAuth, validate('json', updateRulesetBodySchema), async (c) => {
    return handleUpdateRuleset(c, c.req.param('id'), c.req.valid('json'));
  })
  .delete('/api/rulesets/:id', requireAuth, async (c) => {
    return handleDeleteRuleset(c, c.req.param('id'));
  })
  .get(
    '/api/rulesets/:id/rules',
    requireAuth,
    persistentRateLimit('rule-search', 60),
    validate('query', rulesQuerySchema),
    async (c) => {
      const query = c.req.valid('query');
      const defaultLimit = query.cursor ? 50 : UPSTREAM_RULE_PREVIEW_LIMIT;
      const requestedLimit = Number(query.limit ?? String(defaultLimit));
      const limit = query.all === '1' ? 0 : Number.isFinite(requestedLimit) ? requestedLimit : defaultLimit;
      const page = await listRulesPaginated(c.env, {
        categoryId: c.req.param('id'),
        query: query.q || undefined,
        source: query.source,
        cursor: query.cursor || undefined,
        limit,
      });
      return json(page);
    },
  )
  .post('/api/rulesets/:id/rules', requireAuth, validate('json', addRuleBodySchema), async (c) => {
    return handleAddRule(c, c.req.param('id'), c.req.valid('json'));
  })
  .patch('/api/rulesets/:id/rules/:ruleId', requireAuth, validate('json', updateRuleBodySchema), async (c) => {
    return handleUpdateRule(c, c.req.param('id'), c.req.param('ruleId'), c.req.valid('json'));
  })
  .delete('/api/rulesets/:id/rules/:ruleId', requireAuth, async (c) => {
    return handleDeleteRule(c, c.req.param('id'), c.req.param('ruleId'));
  })
  .post('/api/rulesets/:id/rules/batch', requireAuth, validate('json', batchRulesBodySchema), async (c) => {
    return handleBatchRules(c, c.req.param('id'), c.req.valid('json'));
  })
  .post('/api/rulesets/:id/rules/import', requireAuth, validate('json', importRulesBodySchema), async (c) => {
    return handleImportRules(c, c.req.param('id'), c.req.valid('json'));
  })
  .post('/api/rulesets/:id/sync', requireAuth, persistentRateLimit('sync-category', 10), async (c) => {
    return handleSyncRuleset(c, c.req.param('id'));
  });
