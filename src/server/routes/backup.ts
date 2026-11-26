import { Hono } from 'hono';
import { getBackupData, importRulesData, validateBackupPayload } from '../../application/backup';
import { listRulesetSlugs } from '../../application/rulesets';
import { requireAuth } from '../../lib/auth';
import { json } from '../../lib/response';
import { purgeSubscriptionCacheForSlugs } from '../cache/subscription-cache';
import { withLinks, type AppBindings, type AppContext } from '../helpers';

export async function handleBackupExport(c: AppContext) {
  return json(await getBackupData(c.env));
}

export async function handleBackupValidate(c: AppContext) {
  const payload = await c.req.json().catch(() => null);
  return json(validateBackupPayload(payload).summary);
}

export async function handleBackupImport(c: AppContext) {
  const payload = await c.req.json().catch(() => null);
  const oldSlugs = await listRulesetSlugs(c.env);
  const data = await importRulesData(c.env, payload);
  const newSlugs = data.categories.map((category) => category.slug);
  await purgeSubscriptionCacheForSlugs(c.env, [...oldSlugs, ...newSlugs]);
  return json(withLinks(c, data));
}

export const backupRoutes = new Hono<AppBindings>()
  .get('/api/backup', requireAuth, handleBackupExport)
  .post('/api/backup/validate', requireAuth, handleBackupValidate)
  .put('/api/backup', requireAuth, handleBackupImport);
