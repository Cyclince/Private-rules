import { Hono } from 'hono';
import { getRulesOverview, optimizeManualRules, previewManualRuleOptimization } from '../../application/rulesets';
import { getCachedIconPack, refreshIconPacks, saveSettings } from '../../application/settings';
import { requireAuth, requireSessionAuth } from '../../lib/auth';
import { json } from '../../lib/response';
import { AppError } from '../../shared/errors';
import { purgeAllSubscriptionCaches } from '../cache/subscription-cache';
import { withLinks, type AppBindings } from '../helpers';
import { persistentRateLimit } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import { iconPackContentQuerySchema, settingsUpdateBodySchema } from './schemas';

/**
 * Only non-infrastructure display/icon-sync preferences may be modified from a
 * Telegram Mini App session. High-risk settings (`baseUrl`, `githubMirrorUrl`,
 * `publicLinksEnabled`, `tokenLinksEnabled`, `customIconPackUrls`, `customIconPackNames`,
 * `iconPackPriority`, `iconPackDisabled`, `iconPackIndexMatching`, `iconPackLastUpdatedAt`,
 * or unknown keys) require an admin session or API key.
 */
const TELEGRAM_ALLOWED_SETTINGS_KEYS = new Set(['policyName', 'iconPackAutoUpdate', 'iconPackUpdateIntervalHours']);

export const settingsRoutes = new Hono<AppBindings>()
  .get('/api/settings', requireAuth, async (c) => {
    const data = await getRulesOverview(c.env);
    return json({ settings: data.settings, meta: data.meta });
  })
  .patch('/api/settings', requireAuth, validate('json', settingsUpdateBodySchema), async (c) => {
    const input = c.req.valid('json');
    if (
      c.get('authType') === 'telegram' &&
      Object.entries(input).some(([key, value]) => value !== undefined && !TELEGRAM_ALLOWED_SETTINGS_KEYS.has(key))
    ) {
      throw new AppError(
        'FORBIDDEN',
        'Telegram 会话不允许修改站点地址、GitHub 镜像、全局访问策略或自定义图标包来源等高风险设置。',
      );
    }
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
