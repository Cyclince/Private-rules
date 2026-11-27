import { z } from 'zod';
import { templateClientIdSchema } from './publication';

/** Three template complexity tiers (design §2, D12): simple / advanced / pro. */
export const COMPLEXITY_TIERS = ['simple', 'advanced', 'pro'] as const;
export const complexityTierSchema = z.enum(COMPLEXITY_TIERS);
export type ComplexityTier = z.infer<typeof complexityTierSchema>;

/**
 * Common scenario IDs shown in the 3-step quick-create wizard (plan §4.6).
 * Order matches the wizard UI layout.
 */
export const WIZARD_SCENARIO_IDS = [
  'domestic-direct',
  'ad-block',
  'ai',
  'telegram',
  'streaming',
  'bilibili-hkmt',
  'social',
  'github',
  'gaming',
  'apple-ms-google',
] as const;
export const wizardScenarioIdSchema = z.enum(WIZARD_SCENARIO_IDS);
export type WizardScenarioId = z.infer<typeof wizardScenarioIdSchema>;

/** Maximum number of airport subscriptions supported per template (design §6.2). */
export const MAX_TEMPLATE_SUBSCRIPTIONS = 10;

/** Node selection strategy in the quick-create wizard (plan §4.2 / §5). */
export const WIZARD_GROUP_MODES = ['auto', 'select', 'region'] as const;
export const wizardGroupModeSchema = z.enum(WIZARD_GROUP_MODES);
export type WizardGroupMode = z.infer<typeof wizardGroupModeSchema>;

/** Multi-airport node combination strategy (design §6.3). */
export const NODE_COMBINE_MODES = ['merge', 'perProvider'] as const;
export const nodeCombineModeSchema = z.enum(NODE_COMBINE_MODES);
export type NodeCombineMode = z.infer<typeof nodeCombineModeSchema>;

/** Route destination for a scenario or referenced ruleset. */
export type WizardRouteTarget = 'proxy' | 'auto' | 'direct' | 'reject' | `region:${string}`;

export const wizardRouteTargetSchema: z.ZodType<WizardRouteTarget> = z.union([
  z.literal('proxy'),
  z.literal('auto'),
  z.literal('direct'),
  z.literal('reject'),
  z
    .string()
    .trim()
    .regex(/^region:[A-Za-z]{2,8}$/, '地区去向格式无效')
    .transform((value) => `region:${value.slice('region:'.length).toUpperCase()}` as `region:${string}`),
]);

export const quickCreateScenarioInputSchema = z.object({
  id: wizardScenarioIdSchema,
  enabled: z.boolean(),
  route: wizardRouteTargetSchema.optional(),
});
export type QuickCreateScenarioInput = z.output<typeof quickCreateScenarioInputSchema>;

export const quickCreateRulesetInputSchema = z.object({
  rulesetId: z.string().trim().min(1),
  route: wizardRouteTargetSchema.default('proxy'),
});
export type QuickCreateRulesetInput = z.output<typeof quickCreateRulesetInputSchema>;

export const quickCreatePreviewSummarySchema = z.object({
  nodeCount: z.number().int().nonnegative(),
  regions: z.record(z.string(), z.number().int().nonnegative()).default({}),
  status: z.enum(['ok', 'error']).optional(),
  checkedAt: z.string().optional(),
});
export type QuickCreatePreviewSummary = z.output<typeof quickCreatePreviewSummarySchema>;

const optionalUserAgentSchema = z
  .string()
  .trim()
  .max(256)
  .nullish()
  .transform((value) => (value && value.length > 0 ? value : undefined));

export const quickCreateSubscriptionInputSchema = z.object({
  name: z.string().trim().max(60).optional(),
  url: z.string().trim().min(1, '请输入订阅地址').max(4096),
  userAgent: optionalUserAgentSchema,
  previewSummary: quickCreatePreviewSummarySchema.optional(),
});
export type QuickCreateSubscriptionInput = z.output<typeof quickCreateSubscriptionInputSchema>;

/**
 * Metadata embedded in `TemplateBody.wizardMeta` when a template is created via
 * the quick-create wizard, enabling M2b simple-view editing and friendly list display.
 */
export const templateWizardMetaSchema = z.object({
  createdByWizard: z.literal(true),
  complexity: complexityTierSchema.optional(),
  groupMode: wizardGroupModeSchema,
  combineMode: nodeCombineModeSchema.optional(),
  clientDisplayNames: z.array(z.string().trim().min(1).max(60)).optional(),
  clientLabels: z.partialRecord(templateClientIdSchema, z.string().trim().min(1).max(80)).optional(),
  scenarios: z.array(quickCreateScenarioInputSchema).optional(),
  rulesets: z.array(quickCreateRulesetInputSchema).optional(),
  previewSummary: quickCreatePreviewSummarySchema.optional(),
  subscriptionPreviews: z.record(z.string(), quickCreatePreviewSummarySchema).optional(),
});
export type TemplateWizardMeta = z.output<typeof templateWizardMetaSchema>;

/** Request payload for B1 `POST /api/templates/quick-create`. */
export const quickCreateTemplateSchema = z.object({
  name: z.string().trim().min(1, '请输入模板名称').max(120).default('我的配置'),
  complexity: complexityTierSchema.default('simple'),
  clients: z.array(templateClientIdSchema).min(1, '请至少选择一个客户端'),
  clientDisplayNames: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  clientLabels: z.partialRecord(templateClientIdSchema, z.string().trim().min(1).max(80)).optional(),
  scenarios: z.array(quickCreateScenarioInputSchema).default([]),
  rulesets: z.array(quickCreateRulesetInputSchema).default([]),
  groupMode: wizardGroupModeSchema.default('auto'),
  combineMode: nodeCombineModeSchema.default('merge'),
  subscriptions: z
    .array(quickCreateSubscriptionInputSchema)
    .max(MAX_TEMPLATE_SUBSCRIPTIONS, '最多支持 10 条机场订阅')
    .optional(),
  /** Legacy single-subscription field; equivalent to a single entry in `subscriptions`. */
  subscriptionUrl: z
    .string()
    .trim()
    .max(4096)
    .nullish()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  detectedRegions: z
    .array(
      z
        .string()
        .trim()
        .min(2)
        .max(8)
        .transform((code) => code.toUpperCase()),
    )
    .optional(),
  previewSummary: quickCreatePreviewSummarySchema.optional(),
});
export type QuickCreateTemplateInput = z.output<typeof quickCreateTemplateSchema>;

/** Plain-language error codes returned by B2 `POST /api/templates/preview-subscription`. */
export const PREVIEW_SUBSCRIPTION_ERROR_CODES = [
  'LINK_INVALID',
  'NEEDS_USER_AGENT',
  'NOT_SUBSCRIPTION',
  'TIMEOUT',
] as const;
export type PreviewSubscriptionErrorCode = (typeof PREVIEW_SUBSCRIPTION_ERROR_CODES)[number];

export const previewSubscriptionItemSchema = z.object({
  name: z.string().trim().max(60).optional(),
  url: z.string().trim().min(1, '请输入订阅地址').max(4096),
  userAgent: optionalUserAgentSchema,
});
export type PreviewSubscriptionItemInput = z.output<typeof previewSubscriptionItemSchema>;

export const previewSubscriptionBatchSchema = z.object({
  subscriptions: z
    .array(previewSubscriptionItemSchema)
    .min(1, '请至少提供一条订阅地址')
    .max(MAX_TEMPLATE_SUBSCRIPTIONS, '一次最多预览 10 条订阅'),
});
export type PreviewSubscriptionBatchInput = z.output<typeof previewSubscriptionBatchSchema>;

export const previewSubscriptionSingleSchema = z.object({
  subscriptionUrl: z.string().trim().min(1, '请输入订阅地址').max(4096),
  userAgent: z.string().trim().max(256).optional(),
  name: z.string().trim().max(60).optional(),
});
export type PreviewSubscriptionSingleInput = z.output<typeof previewSubscriptionSingleSchema>;

/** Request payload for B2 `POST /api/templates/preview-subscription` (supports multi-item batch or legacy single URL). */
export const previewSubscriptionSchema = z.union([previewSubscriptionBatchSchema, previewSubscriptionSingleSchema]);
export type PreviewSubscriptionInput = z.output<typeof previewSubscriptionSchema>;

export const simpleAddSubscriptionSchema = z.object({
  name: z.string().trim().max(60).optional(),
  url: z.string().trim().min(1, '请输入订阅地址').max(4096),
  userAgent: optionalUserAgentSchema,
  previewSummary: quickCreatePreviewSummarySchema.optional(),
});
export type SimpleAddSubscriptionInput = z.output<typeof simpleAddSubscriptionSchema>;

export const simpleRenameSubscriptionSchema = z.object({
  slotId: z.string().trim().min(1),
  name: z.string().trim().min(1, '请输入机场名称').max(60),
});
export type SimpleRenameSubscriptionInput = z.output<typeof simpleRenameSubscriptionSchema>;

export const simpleReplaceSubscriptionUrlSchema = z.object({
  slotId: z.string().trim().min(1),
  url: z.string().trim().min(1, '请输入订阅地址').max(4096),
  userAgent: optionalUserAgentSchema,
  previewSummary: quickCreatePreviewSummarySchema.optional(),
});
export type SimpleReplaceSubscriptionUrlInput = z.output<typeof simpleReplaceSubscriptionUrlSchema>;

/** Request payload for B3 `PATCH /api/templates/:id/simple`. */
export const simpleTemplatePatchSchema = z.object({
  name: z.string().trim().min(1, '请输入模板名称').max(120).optional(),
  complexity: complexityTierSchema.optional(),
  scenarios: z.array(quickCreateScenarioInputSchema).optional(),
  rulesets: z.array(quickCreateRulesetInputSchema).optional(),
  groupMode: wizardGroupModeSchema.optional(),
  combineMode: nodeCombineModeSchema.optional(),
  addSubscriptions: z
    .array(simpleAddSubscriptionSchema)
    .max(MAX_TEMPLATE_SUBSCRIPTIONS, '最多支持 10 条机场订阅')
    .optional(),
  renameSubscriptions: z.array(simpleRenameSubscriptionSchema).optional(),
  replaceSubscriptionUrls: z.array(simpleReplaceSubscriptionUrlSchema).optional(),
  removeSlotIds: z.array(z.string().trim().min(1)).optional(),
  note: z.string().max(500).optional(),
});
export type SimpleTemplatePatchInput = z.output<typeof simpleTemplatePatchSchema>;
