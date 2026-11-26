import { Hono } from 'hono';
import { getRulesetsSummary } from '../../application/rulesets';
import { requireAuth } from '../../lib/auth';
import { linksByCategory } from '../../lib/links';
import { json } from '../../lib/response';
import { externalRequestUrl, type AppBindings } from '../helpers';

export const linksRoutes = new Hono<AppBindings>().get('/api/links', requireAuth, async (c) => {
  const data = await getRulesetsSummary(c.env);
  return json({
    links: linksByCategory(data, externalRequestUrl(c), c.get('authType') === 'apiKey' ? undefined : c.env.RULE_TOKEN),
  });
});
