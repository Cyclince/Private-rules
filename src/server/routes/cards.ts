import { Hono } from 'hono';
import { z } from 'zod';
import { createCard, deleteCard, forkCard, getCardById, listCards, updateCard } from '../../application/cards';
import { requireAuth } from '../../lib/auth';
import { json } from '../../lib/response';
import {
  appCardGroupSchema,
  cardOriginSchema,
  catalogCategorySchema,
  matcherSchema,
  stageSchema,
} from '../../shared/schemas/card';
import { purgeAllPublicationCaches } from '../cache/subscription-cache';
import { rejectTelegramWrite, type AppBindings } from '../helpers';
import { validate } from '../middleware/validate';

const listCardsQuerySchema = z.object({
  q: z.string().optional(),
  category: catalogCategorySchema.optional(),
  origin: cardOriginSchema.optional(),
  stage: stageSchema.optional(),
  cursor: z.string().optional(),
  limit: z.string().optional(),
});

const createCardBodySchema = z.object({
  name: z.string().trim().min(1, '组件名称不能为空').max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, '组件标识仅支持字母、数字、连字符和下划线')
    .optional(),
  icon: z.string().max(120).optional(),
  category: catalogCategorySchema,
  stage: stageSchema,
  group: appCardGroupSchema,
  matchers: z.array(matcherSchema),
  hidden: z.boolean().optional(),
});

const updateCardBodySchema = z.object({
  name: z.string().trim().min(1, '组件名称不能为空').max(120).optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, '组件标识仅支持字母、数字、连字符和下划线')
    .optional(),
  icon: z.string().max(120).nullish(),
  category: catalogCategorySchema.optional(),
  stage: stageSchema.optional(),
  group: appCardGroupSchema.optional(),
  matchers: z.array(matcherSchema).optional(),
  hidden: z.boolean().optional(),
});

const forkCardBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9][a-z0-9_-]*$/i, '组件标识仅支持字母、数字、连字符和下划线')
      .optional(),
    icon: z.string().max(120).optional(),
    category: catalogCategorySchema.optional(),
    stage: stageSchema.optional(),
    group: appCardGroupSchema.optional(),
    matchers: z.array(matcherSchema).optional(),
    hidden: z.boolean().optional(),
  })
  .optional()
  .default({});

export const cardRoutes = new Hono<AppBindings>()
  .get('/api/cards', requireAuth, validate('query', listCardsQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const requestedLimit = query.limit === undefined ? 100 : Number(query.limit);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.trunc(requestedLimit), 200)) : 100;
    const result = await listCards(c.env, {
      query: query.q || undefined,
      category: query.category,
      origin: query.origin,
      stage: query.stage,
      cursor: query.cursor || undefined,
      limit,
    });
    return json(result);
  })
  .post('/api/cards', requireAuth, rejectTelegramWrite, validate('json', createCardBodySchema), async (c) => {
    const card = await createCard(c.env, c.req.valid('json'));
    await purgeAllPublicationCaches(c.env);
    return json({ card }, { status: 201 });
  })
  .get('/api/cards/:id', requireAuth, async (c) => {
    const card = await getCardById(c.env, c.req.param('id'));
    return json({ card });
  })
  .patch('/api/cards/:id', requireAuth, rejectTelegramWrite, validate('json', updateCardBodySchema), async (c) => {
    const card = await updateCard(c.env, c.req.param('id'), c.req.valid('json'));
    await purgeAllPublicationCaches(c.env);
    return json({ card });
  })
  .delete('/api/cards/:id', requireAuth, rejectTelegramWrite, async (c) => {
    const result = await deleteCard(c.env, c.req.param('id'));
    await purgeAllPublicationCaches(c.env);
    return json(result);
  })
  .post('/api/cards/:id/fork', requireAuth, rejectTelegramWrite, validate('json', forkCardBodySchema), async (c) => {
    const card = await forkCard(c.env, c.req.param('id'), c.req.valid('json'));
    await purgeAllPublicationCaches(c.env);
    return json({ card }, { status: 201 });
  });
