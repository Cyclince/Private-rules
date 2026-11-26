import { Hono } from 'hono';
import { z } from 'zod';
import {
  createPublication,
  deleteNodeSlotBinding,
  deletePublication,
  fetchNodeSlotNames,
  getPublicationById,
  listPublications,
  updatePublication,
  upsertNodeSlotBinding,
} from '../../application/publications';
import { requireAuth } from '../../lib/auth';
import { json } from '../../lib/response';
import { AppError } from '../../shared/errors';
import {
  outputProfileSchema,
  publicationAccessSchema,
  publicationFormSchema,
  templateClientIdSchema,
} from '../../shared/schemas/publication';
import { purgePublicationCacheForIds, purgePublicationCacheForSlugs } from '../cache/subscription-cache';
import { rejectTelegramWrite, type AppBindings } from '../helpers';
import { persistentRateLimit } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';

const listPublicationsQuerySchema = z.object({
  q: z.string().optional(),
  templateId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.string().optional(),
});

const updatePublicationBodySchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, '发布标识仅支持字母、数字、连字符和下划线')
    .optional(),
  templateId: z.string().trim().min(1).optional(),
  pinnedVersion: z.number().int().positive().nullable().optional(),
  clients: z.array(templateClientIdSchema).min(1).optional(),
  access: publicationAccessSchema.optional(),
  output: outputProfileSchema.nullable().optional(),
});

const upsertSlotBindingBodySchema = z.object({
  subscriptionUrl: z.string().trim().min(1, '请输入订阅地址。').max(4096),
  userAgent: z.string().max(256).nullish(),
});

export const publicationRoutes = new Hono<AppBindings>()
  .get('/api/publications', requireAuth, validate('query', listPublicationsQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const requestedLimit = query.limit === undefined ? 100 : Number(query.limit);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.trunc(requestedLimit), 200)) : 100;
    return json(
      await listPublications(c.env, {
        query: query.q || undefined,
        templateId: query.templateId || undefined,
        cursor: query.cursor || undefined,
        limit,
      }),
    );
  })
  .post('/api/publications', requireAuth, rejectTelegramWrite, validate('json', publicationFormSchema), async (c) => {
    const result = await createPublication(c.env, c.req.valid('json'));
    await purgePublicationCacheForSlugs(c.env, [result.publication.slug]);
    return json(result, { status: 201 });
  })
  .get('/api/publications/:id', requireAuth, async (c) => {
    const publication = await getPublicationById(c.env, c.req.param('id'));
    return json({ publication });
  })
  .patch(
    '/api/publications/:id',
    requireAuth,
    rejectTelegramWrite,
    validate('json', updatePublicationBodySchema),
    async (c) => {
      const publicationId = c.req.param('id');
      const result = await updatePublication(c.env, publicationId, c.req.valid('json'));
      await Promise.all([
        purgePublicationCacheForIds(c.env, [publicationId]),
        purgePublicationCacheForSlugs(c.env, [result.previousSlug, result.publication.slug]),
      ]);
      return json({ publication: result.publication, lint: result.lint });
    },
  )
  .delete('/api/publications/:id', requireAuth, rejectTelegramWrite, async (c) => {
    const publicationId = c.req.param('id');
    const result = await deletePublication(c.env, publicationId);
    await Promise.all([
      purgePublicationCacheForIds(c.env, [publicationId]),
      purgePublicationCacheForSlugs(c.env, [result.slug]),
    ]);
    return json(result);
  })
  .put(
    '/api/publications/:id/slots/:slotId',
    requireAuth,
    rejectTelegramWrite,
    async (c, next) => {
      // Never allow sensitive subscription URLs to be passed via query parameters (design §14).
      const url = new URL(c.req.url);
      if (url.searchParams.has('subscriptionUrl') || url.searchParams.has('url')) {
        throw new AppError('VALIDATION_FAILED', '订阅地址禁止通过 URL 参数传递，请使用 JSON 请求体提交。');
      }
      await next();
    },
    validate('json', upsertSlotBindingBodySchema),
    async (c) => {
      const publicationId = c.req.param('id');
      const slotId = c.req.param('slotId');
      const result = await upsertNodeSlotBinding(c.env, publicationId, slotId, c.req.valid('json'));
      await Promise.all([
        purgePublicationCacheForIds(c.env, [publicationId]),
        purgePublicationCacheForSlugs(c.env, [result.publicationSlug]),
      ]);
      return json({ binding: result.binding });
    },
  )
  .delete('/api/publications/:id/slots/:slotId', requireAuth, rejectTelegramWrite, async (c) => {
    const publicationId = c.req.param('id');
    const slotId = c.req.param('slotId');
    const result = await deleteNodeSlotBinding(c.env, publicationId, slotId);
    await Promise.all([
      purgePublicationCacheForIds(c.env, [publicationId]),
      purgePublicationCacheForSlugs(c.env, [result.publicationSlug]),
    ]);
    return json({ deleted: true, publicationId: result.publicationId, slotId: result.slotId });
  })
  .post(
    '/api/publications/:id/slots/:slotId/fetch-names',
    requireAuth,
    rejectTelegramWrite,
    persistentRateLimit('node-fetch-names', 10),
    async (c) => {
      const result = await fetchNodeSlotNames(c.env, c.req.param('id'), c.req.param('slotId'));
      return json(result);
    },
  );
