import { Hono } from 'hono';
import { z } from 'zod';
import { ALL_STARTER_TEMPLATE_TIERS } from '../../builtin';
import {
  createTemplate,
  deleteTemplate,
  getSimpleTemplateView,
  getTemplateById,
  getTemplateVersion,
  importTemplate,
  lintTemplateById,
  listTemplates,
  listTemplateVersions,
  patchSimpleTemplateView,
  previewSubscription,
  previewTemplateById,
  probeTemplateById,
  quickCreateTemplate,
  rebaseTemplate,
  restoreTemplateVersion,
  updateTemplate,
} from '../../application/templates';
import { requireAuth } from '../../lib/auth';
import { json } from '../../lib/response';
import { AppError } from '../../shared/errors';
import { outputProfileSchema, templateClientIdSchema } from '../../shared/schemas/publication';
import {
  previewSubscriptionSchema,
  quickCreateTemplateSchema,
  simpleTemplatePatchSchema,
} from '../../shared/schemas/quick-create';
import {
  templateBaseKindSchema,
  templateBodySchema,
  templateCardRefSchema,
  templateGroupModeSchema,
  templateOverlayOpSchema,
  templateOverlaySchema,
} from '../../shared/schemas/template';
import { purgeAllPublicationCaches, purgePublicationCacheForTemplate } from '../cache/subscription-cache';
import { externalBaseUrl, rejectTelegramWrite, type AppBindings } from '../helpers';
import { persistentRateLimit } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';

const starterTierSchema = z.enum(ALL_STARTER_TEMPLATE_TIERS);

const listTemplatesQuerySchema = z.object({
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.string().optional(),
});

const createTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, '模板标识仅支持字母、数字、连字符和下划线')
    .optional(),
  description: z.string().max(1000).optional(),
  starterTier: starterTierSchema.optional(),
  groupMode: templateGroupModeSchema.optional(),
  output: outputProfileSchema.optional(),
  baseKind: templateBaseKindSchema.optional(),
  baseSourceUrl: z.string().trim().url().optional(),
  baseBody: templateBodySchema.optional(),
  overlay: templateOverlaySchema.optional(),
  note: z.string().max(500).optional(),
});

const updateTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, '模板标识仅支持字母、数字、连字符和下划线')
    .optional(),
  description: z.string().max(1000).optional(),
  baseKind: templateBaseKindSchema.optional(),
  baseSourceUrl: z.string().trim().url().nullish(),
  baseBody: templateBodySchema.optional(),
  overlay: templateOverlaySchema.optional(),
  note: z.string().max(500).optional(),
});

const importTemplateBodySchema = z.object({
  format: z.enum(['acl4ssr-ini', 'mihomo-yaml']),
  content: z
    .string()
    .max(5 * 1024 * 1024)
    .optional(),
  sourceUrl: z.string().trim().url().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, '模板标识仅支持字母、数字、连字符和下划线')
    .optional(),
  description: z.string().max(1000).optional(),
  save: z.boolean().optional().default(true),
  note: z.string().max(500).optional(),
});

const conflictResolutionSchema = z.discriminatedUnion('action', [
  z.object({ opIndex: z.number().int().nonnegative(), action: z.literal('keep') }),
  z.object({ opIndex: z.number().int().nonnegative(), action: z.literal('drop') }),
  z.object({
    opIndex: z.number().int().nonnegative(),
    action: z.literal('retarget'),
    replacement: templateOverlayOpSchema,
  }),
]);

const rebaseTemplateBodySchema = z.object({
  baseBody: templateBodySchema.optional(),
  format: z.enum(['acl4ssr-ini', 'mihomo-yaml']).optional(),
  content: z
    .string()
    .max(5 * 1024 * 1024)
    .optional(),
  sourceUrl: z.string().trim().url().optional(),
  resolutions: z.array(conflictResolutionSchema).optional(),
  apply: z.boolean().optional().default(true),
  note: z.string().max(500).optional(),
});

const restoreVersionBodySchema = z
  .object({
    note: z.string().max(500).optional(),
  })
  .optional()
  .default({});

const lintTemplateBodySchema = z
  .object({
    body: templateBodySchema.optional(),
    overlay: templateOverlaySchema.optional(),
    previousBody: templateBodySchema.optional(),
    previousCards: z.array(templateCardRefSchema).optional(),
    clients: z.array(templateClientIdSchema).optional(),
    nodeNamesBySlot: z.record(z.string(), z.array(z.string())).optional(),
    nodeNames: z.array(z.string()).optional(),
    sampleTargets: z.array(z.string()).max(100).optional(),
  })
  .optional()
  .default({});

const probeTemplateBodySchema = z.object({
  target: z.string().trim().min(1, '请输入域名、URL 或 IP。').max(1024),
  meta: z
    .object({
      srcIp: z.string().optional(),
      dstPort: z.number().int().min(1).max(65_535).optional(),
      srcPort: z.number().int().min(1).max(65_535).optional(),
      processName: z.string().optional(),
      userAgent: z.string().optional(),
      resolvedIp: z.string().optional(),
    })
    .optional(),
  body: templateBodySchema.optional(),
  overlay: templateOverlaySchema.optional(),
});

const previewTemplateQuerySchema = z.object({
  client: templateClientIdSchema.optional().default('mihomo'),
  output: outputProfileSchema.optional(),
  experimentalFullConfig: z.enum(['1', 'true', '0', 'false']).optional(),
});

const previewTemplateBodySchema = z
  .object({
    output: outputProfileSchema.optional(),
    body: templateBodySchema.optional(),
    overlay: templateOverlaySchema.optional(),
    experimentalFullConfig: z.boolean().optional(),
  })
  .optional()
  .default({});

function parseVersionParam(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new AppError('VALIDATION_FAILED', '模板版本号必须为正整数。');
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError('VALIDATION_FAILED', '模板版本号必须为正整数。');
  }
  return value;
}

const FORBIDDEN_SUBSCRIPTION_QUERY_PARAMS = ['subscriptionUrl', 'url', 'subscriptions'] as const;

async function rejectSubscriptionQueryParams(c: { req: { url: string } }, next: () => Promise<void>): Promise<void> {
  const url = new URL(c.req.url);
  for (const param of FORBIDDEN_SUBSCRIPTION_QUERY_PARAMS) {
    if (url.searchParams.has(param)) {
      throw new AppError('VALIDATION_FAILED', '订阅地址禁止通过 URL 参数传递，请使用 JSON 请求体提交。');
    }
  }
  await next();
}

export const templateRoutes = new Hono<AppBindings>()
  .get('/api/templates', requireAuth, validate('query', listTemplatesQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const requestedLimit = query.limit === undefined ? 100 : Number(query.limit);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.trunc(requestedLimit), 200)) : 100;
    return json(
      await listTemplates(c.env, {
        query: query.q || undefined,
        cursor: query.cursor || undefined,
        limit,
      }),
    );
  })
  .post('/api/templates', requireAuth, rejectTelegramWrite, validate('json', createTemplateBodySchema), async (c) => {
    const result = await createTemplate(c.env, c.req.valid('json'));
    return json(result, { status: 201 });
  })
  .post(
    '/api/templates/quick-create',
    requireAuth,
    rejectTelegramWrite,
    rejectSubscriptionQueryParams,
    validate('json', quickCreateTemplateSchema),
    async (c) => {
      const baseUrl = externalBaseUrl(c);
      const ruleToken = c.get('authType') === 'apiKey' ? undefined : c.env.RULE_TOKEN;
      const result = await quickCreateTemplate(c.env, c.req.valid('json'), {
        baseUrl,
        ruleToken,
      });
      await purgeAllPublicationCaches(c.env);
      return json(result, { status: 201 });
    },
  )
  .post(
    '/api/templates/preview-subscription',
    requireAuth,
    rejectTelegramWrite,
    persistentRateLimit('template-preview-sub', 15),
    rejectSubscriptionQueryParams,
    validate('json', previewSubscriptionSchema),
    async (c) => {
      const result = await previewSubscription(c.req.valid('json'));
      return json(result);
    },
  )
  .post(
    '/api/templates/import',
    requireAuth,
    rejectTelegramWrite,
    validate('json', importTemplateBodySchema),
    async (c) => {
      const result = await importTemplate(c.env, c.req.valid('json'));
      if (result.saved) {
        await purgeAllPublicationCaches(c.env);
        return json(result, { status: 201 });
      }
      return json(result);
    },
  )
  .get('/api/templates/:id/simple', requireAuth, async (c) => {
    const ruleToken = c.get('authType') === 'apiKey' ? undefined : c.env.RULE_TOKEN;
    return json(
      await getSimpleTemplateView(c.env, c.req.param('id'), {
        baseUrl: externalBaseUrl(c),
        ruleToken,
      }),
    );
  })
  .patch(
    '/api/templates/:id/simple',
    requireAuth,
    rejectTelegramWrite,
    rejectSubscriptionQueryParams,
    validate('json', simpleTemplatePatchSchema),
    async (c) => {
      const templateId = c.req.param('id');
      const ruleToken = c.get('authType') === 'apiKey' ? undefined : c.env.RULE_TOKEN;
      const result = await patchSimpleTemplateView(c.env, templateId, c.req.valid('json'), {
        baseUrl: externalBaseUrl(c),
        ruleToken,
      });
      await purgePublicationCacheForTemplate(c.env, templateId);
      return json(result);
    },
  )
  .get('/api/templates/:id', requireAuth, async (c) => {
    return json(await getTemplateById(c.env, c.req.param('id')));
  })
  .patch(
    '/api/templates/:id',
    requireAuth,
    rejectTelegramWrite,
    validate('json', updateTemplateBodySchema),
    async (c) => {
      const templateId = c.req.param('id');
      const result = await updateTemplate(c.env, templateId, c.req.valid('json'));
      await purgePublicationCacheForTemplate(c.env, templateId);
      return json(result);
    },
  )
  .delete('/api/templates/:id', requireAuth, rejectTelegramWrite, async (c) => {
    const templateId = c.req.param('id');
    const result = await deleteTemplate(c.env, templateId);
    await purgePublicationCacheForTemplate(c.env, templateId);
    return json(result);
  })
  .post(
    '/api/templates/:id/rebase',
    requireAuth,
    rejectTelegramWrite,
    validate('json', rebaseTemplateBodySchema),
    async (c) => {
      const templateId = c.req.param('id');
      const result = await rebaseTemplate(c.env, templateId, c.req.valid('json'));
      if (result.applied) {
        await purgePublicationCacheForTemplate(c.env, templateId);
      }
      return json(result);
    },
  )
  .get('/api/templates/:id/versions', requireAuth, async (c) => {
    const versions = await listTemplateVersions(c.env, c.req.param('id'));
    return json({ versions });
  })
  .get('/api/templates/:id/versions/:v', requireAuth, async (c) => {
    const version = parseVersionParam(c.req.param('v'));
    const record = await getTemplateVersion(c.env, c.req.param('id'), version);
    return json({ version: record });
  })
  .post(
    '/api/templates/:id/versions/:v/restore',
    requireAuth,
    rejectTelegramWrite,
    validate('json', restoreVersionBodySchema),
    async (c) => {
      const templateId = c.req.param('id');
      const version = parseVersionParam(c.req.param('v'));
      const result = await restoreTemplateVersion(c.env, templateId, version, c.req.valid('json').note);
      await purgePublicationCacheForTemplate(c.env, templateId);
      return json(result);
    },
  )
  .post('/api/templates/:id/lint', requireAuth, validate('json', lintTemplateBodySchema), async (c) => {
    return json(await lintTemplateById(c.env, c.req.param('id'), c.req.valid('json')));
  })
  .post('/api/templates/:id/probe', requireAuth, validate('json', probeTemplateBodySchema), async (c) => {
    return json(await probeTemplateById(c.env, c.req.param('id'), c.req.valid('json')));
  })
  .post(
    '/api/templates/:id/preview',
    requireAuth,
    validate('query', previewTemplateQuerySchema),
    validate('json', previewTemplateBodySchema),
    async (c) => {
      const query = c.req.valid('query');
      const body = c.req.valid('json');
      const queryExp =
        query.experimentalFullConfig === '1' || query.experimentalFullConfig === 'true'
          ? true
          : query.experimentalFullConfig === '0' || query.experimentalFullConfig === 'false'
            ? false
            : undefined;
      const compiled = await previewTemplateById(c.env, c.req.param('id'), {
        client: query.client,
        output: body.output ?? query.output,
        body: body.body,
        overlay: body.overlay,
        baseUrl: externalBaseUrl(c),
        experimentalFullConfig: body.experimentalFullConfig ?? queryExp,
      });
      return json({ preview: compiled });
    },
  );
