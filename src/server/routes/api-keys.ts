import { Hono } from 'hono';
import { apiKeyStatus, createApiKey, deleteApiKey, requireSessionAuth, updateApiKeyNote } from '../../lib/auth';
import { json } from '../../lib/response';
import type { AppBindings } from '../helpers';
import { validate } from '../middleware/validate';
import { apiKeyNoteBodySchema } from './schemas';

export const apiKeyRoutes = new Hono<AppBindings>()
  .get('/api/api-keys', requireSessionAuth, async (c) => json(await apiKeyStatus(c.env)))
  .post('/api/api-keys', requireSessionAuth, validate('json', apiKeyNoteBodySchema), async (c) => {
    const body = c.req.valid('json');
    return json(await createApiKey(c.env, body.note), { status: 201 });
  })
  .delete('/api/api-keys/:id', requireSessionAuth, async (c) => {
    await deleteApiKey(c.env, c.req.param('id'));
    return json({ deleted: true });
  })
  .patch('/api/api-keys/:id', requireSessionAuth, validate('json', apiKeyNoteBodySchema), async (c) => {
    const body = c.req.valid('json');
    await updateApiKeyNote(c.env, c.req.param('id'), body.note);
    return json({ updated: true });
  });
