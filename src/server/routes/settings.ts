import { Hono } from 'hono';
import { getRulesOverview, optimizeManualRules, previewManualRuleOptimization } from '../../application/rulesets';
import { getCachedIconPack, refreshIconPacks, saveSettings } from '../../application/settings';
import { requireAuth, requireSessionAuth } from '../../lib/auth';
import { json } from '../../lib/response';
import { purgeAllSubscriptionCaches } from '../cache/subscription-cache';
import { withLinks, type AppBindings } from '../helpers';
import { persistentRateLimit } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import { iconPackContentQuerySchema, settingsUpdateBodySchema } from './schemas';

export const settingsRoutes = new Hono<AppBindings>()
  .get('/api/settings', requireAuth, async (c) => {
    const data = await getRulesOverview(c.env);
    return json({ settings: data.settings, meta: data.meta });
  })
  .patch('/api/settings', requireAuth, validate('json', settingsUpdateBodySchema), async (c) => {
    const input = c.req.valid('json');
    await saveSettings(c.env, input);
    await purgeAllSubscriptionCaches(c.env);
    return json(withLinks(c, await getRulesOverview(c.env)));
  })
  .get('/api/icon-packs/content', requireAuth, validate('query', iconPackContentQuerySchema), async (c) => {
    const { url } = c.req.valid('query');
    return json(await getCachedIconPack(c.env, url));
  })
  .post('/api/icon-packs/refresh', requireSessionAuth, persistentRateLimit('icon-pack-refresh', 5), async (c) => {
    const result = await refreshIconPacks(c.env, true);
    return json(result);
  })
  .get('/api/settings/manual-rule-optimization', requireSessionAuth, async (c) => {
    return json({ preview: await previewManualRuleOptimization(c.env) });
  })
  .post('/api/settings/manual-rule-optimization', requireSessionAuth, async (c) => {
    const result = await optimizeManualRules(c.env);
    await purgeAllSubscriptionCaches(c.env);
    return json({ preview: result.preview, ...withLinks(c, result.data) });
  });
