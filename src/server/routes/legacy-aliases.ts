import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth';
import { json } from '../../lib/response';
import type { AppBindings } from '../helpers';
import { persistentRateLimit } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import { handleBackupExport, handleBackupImport } from './backup';
import {
  handleAddRule,
  handleBatchRules,
  handleCreateRuleset,
  handleDeleteRule,
  handleDeleteRuleset,
  handleImportRules,
  handleListRulesets,
  handleSyncRuleset,
  handleUpdateRule,
  handleUpdateRuleset,
} from './rulesets';
import {
  addRuleBodySchema,
  batchRulesBodySchema,
  createRulesetBodySchema,
  importRulesBodySchema,
  sourceInputBodySchema,
  sourceIntervalBodySchema,
  sourceToggleBodySchema,
  updateRuleBodySchema,
  updateRulesetBodySchema,
} from './schemas';
import {
  handleCreateSource,
  handleDeleteSource,
  handleGetSource,
  handleListSources,
  handlePreviewSource,
  handleSyncSource,
  handleToggleSource,
  handleUpdateSource,
  handleUpdateSourceInterval,
} from './sources';

/**
 * 1.0.x compatibility aliases (`/api/categories/*`, `/api/data`, `/api`) kept
 * throughout 1.1.x so existing 1.0.x clients and the legacy frontend remain
 * fully operational (design §12.2).
 */
export const legacyAliasRoutes = new Hono<AppBindings>()
  .get('/api', requireAuth, async () =>
    json({
      name: 'Private Rules API',
      version: 1,
      authentication: 'Authorization: Bearer <API_KEY>',
      endpoints: {
        rules: '/api/categories',
        rulesets: '/api/rulesets',
        backup: '/api/backup',
        legacyBackup: '/api/data',
        settings: '/api/settings',
        sync: '/api/sync',
      },
    }),
  )
  .get('/api/categories', requireAuth, handleListRulesets)
  .post('/api/categories', requireAuth, validate('json', createRulesetBodySchema), (c) =>
    handleCreateRuleset(c, c.req.valid('json')),
  )
  .patch('/api/categories/:id', requireAuth, validate('json', updateRulesetBodySchema), (c) =>
    handleUpdateRuleset(c, c.req.param('id'), c.req.valid('json')),
  )
  .delete('/api/categories/:id', requireAuth, (c) => handleDeleteRuleset(c, c.req.param('id')))
  .post('/api/categories/:id/rules', requireAuth, validate('json', addRuleBodySchema), (c) =>
    handleAddRule(c, c.req.param('id'), c.req.valid('json')),
  )
  .patch('/api/categories/:id/rules/:ruleId', requireAuth, validate('json', updateRuleBodySchema), (c) =>
    handleUpdateRule(c, c.req.param('id'), c.req.param('ruleId'), c.req.valid('json')),
  )
  .delete('/api/categories/:id/rules/:ruleId', requireAuth, (c) =>
    handleDeleteRule(c, c.req.param('id'), c.req.param('ruleId')),
  )
  .post('/api/categories/:id/rules/batch', requireAuth, validate('json', batchRulesBodySchema), (c) =>
    handleBatchRules(c, c.req.param('id'), c.req.valid('json')),
  )
  .post('/api/categories/:id/rules/bulk-import', requireAuth, validate('json', importRulesBodySchema), (c) =>
    handleImportRules(c, c.req.param('id'), c.req.valid('json')),
  )
  .post('/api/categories/:id/sync', requireAuth, persistentRateLimit('sync-category', 10), (c) =>
    handleSyncRuleset(c, c.req.param('id')),
  )
  .get('/api/categories/:categoryId/sources', requireAuth, (c) => handleListSources(c, c.req.param('categoryId')))
  .get('/api/categories/:categoryId/sources/:sourceId', requireAuth, (c) =>
    handleGetSource(c, c.req.param('categoryId'), c.req.param('sourceId')),
  )
  .post(
    '/api/categories/:categoryId/sources/preview',
    requireAuth,
    persistentRateLimit('source-preview', 10),
    validate('json', sourceInputBodySchema),
    (c) => handlePreviewSource(c, c.req.valid('json')),
  )
  .post(
    '/api/categories/:categoryId/sources',
    requireAuth,
    persistentRateLimit('source-create', 10),
    validate('json', sourceInputBodySchema),
    (c) => handleCreateSource(c, c.req.param('categoryId'), c.req.valid('json')),
  )
  .patch('/api/categories/:categoryId/sources/:sourceId', requireAuth, validate('json', sourceInputBodySchema), (c) =>
    handleUpdateSource(c, c.req.param('categoryId'), c.req.param('sourceId'), c.req.valid('json')),
  )
  .delete('/api/categories/:categoryId/sources/:sourceId', requireAuth, (c) =>
    handleDeleteSource(c, c.req.param('categoryId'), c.req.param('sourceId')),
  )
  .post(
    '/api/categories/:categoryId/sources/:sourceId/toggle',
    requireAuth,
    validate('json', sourceToggleBodySchema),
    (c) => handleToggleSource(c, c.req.param('categoryId'), c.req.param('sourceId'), c.req.valid('json').enabled),
  )
  .post(
    '/api/categories/:categoryId/sources/:sourceId/interval',
    requireAuth,
    validate('json', sourceIntervalBodySchema),
    (c) =>
      handleUpdateSourceInterval(
        c,
        c.req.param('categoryId'),
        c.req.param('sourceId'),
        c.req.valid('json').syncIntervalMinutes,
      ),
  )
  .post(
    '/api/categories/:categoryId/sources/:sourceId/sync',
    requireAuth,
    persistentRateLimit('source-sync', 10),
    (c) => handleSyncSource(c, c.req.param('categoryId'), c.req.param('sourceId')),
  )
  .get('/api/data', requireAuth, handleBackupExport)
  .put('/api/data', requireAuth, handleBackupImport);
