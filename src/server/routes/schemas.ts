import { z } from 'zod';
import { ruleOptionsSchema, ruleTypeSchema } from '../../shared/schemas/rule';
import { settingsPatchSchema } from '../../shared/schemas/settings';
import { ruleOptimizationSchema, sourceTypeSchema } from '../../shared/schemas/source';

export const loginBodySchema = z.object({
  password: z.string().optional().default(''),
});

export const apiKeyNoteBodySchema = z.object({
  note: z.string().max(200).optional().default(''),
});

export const createRulesetBodySchema = z.object({
  name: z.string().trim().min(1, '分类名称不能为空').max(120),
  icon: z.string().max(500).optional(),
  description: z.string().max(500).optional(),
  note: z.string().max(2000).optional(),
  sourceUrls: z.array(z.string()).optional(),
  geositeNames: z.array(z.string()).optional(),
  geoipNames: z.array(z.string()).optional(),
  syncIntervalMinutes: z.number().finite().optional(),
  userAgent: z.string().max(256).optional(),
  ruleOptimization: ruleOptimizationSchema.optional(),
  publicLinksEnabled: z.boolean().optional(),
  tokenLinksEnabled: z.boolean().optional(),
});

export const updateRulesetBodySchema = z
  .object({
    name: z.string().trim().min(1, '分类名称不能为空').max(120).optional(),
    icon: z.string().max(500).nullish(),
    description: z.string().max(500).nullish(),
    note: z.string().max(2000).nullish(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().finite().optional(),
    publicLinksEnabled: z.boolean().optional(),
    tokenLinksEnabled: z.boolean().optional(),
    sourceUrls: z.array(z.string()).optional(),
    geositeNames: z.array(z.string()).optional(),
    geoipNames: z.array(z.string()).optional(),
    syncIntervalMinutes: z.number().finite().optional(),
    userAgent: z.string().max(256).optional(),
    ruleOptimization: ruleOptimizationSchema.optional(),
  })
  .strict();

export const addRuleBodySchema = z.object({
  value: z.string().optional().default(''),
  type: ruleTypeSchema.optional(),
  note: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
  options: ruleOptionsSchema.optional(),
  replaceConflicts: z.boolean().optional(),
});

export const updateRuleBodySchema = z
  .object({
    value: z.string().optional(),
    type: ruleTypeSchema.optional(),
    note: z.string().max(500).nullish(),
    enabled: z.boolean().optional(),
    options: ruleOptionsSchema.nullish(),
    sortOrder: z.number().finite().optional(),
  })
  .passthrough();

export const batchRulesBodySchema = z.object({
  ruleIds: z.array(z.string()).default([]),
  action: z.enum(['enable', 'disable', 'delete']),
});

export const importRulesBodySchema = z.object({
  text: z.string().optional().default(''),
  confirm: z.boolean().optional().default(false),
  replaceConflicts: z.boolean().optional().default(false),
});

export const sourceInputBodySchema = z.object({
  sourceType: sourceTypeSchema.optional().default('url'),
  name: z.string().max(200).optional(),
  url: z.string().max(2000).optional(),
  geositeName: z.string().max(200).optional(),
  geoipName: z.string().max(200).optional(),
  enabled: z.boolean().optional(),
  syncIntervalMinutes: z.number().finite().optional(),
  userAgent: z.string().max(256).optional(),
  ruleOptimization: ruleOptimizationSchema.optional(),
});

export const sourceToggleBodySchema = z.object({
  enabled: z.boolean(),
});

export const sourceIntervalBodySchema = z.object({
  syncIntervalMinutes: z.number().finite(),
});

export const rulesetsQuerySchema = z.object({
  summary: z.string().optional(),
});

export const rulesQuerySchema = z.object({
  categoryId: z.string().optional(),
  q: z.string().optional(),
  source: z.enum(['manual', 'upstream', 'url', 'geo']).optional(),
  cursor: z.string().optional(),
  limit: z.string().optional(),
  all: z.string().optional(),
});

export const geoSearchQuerySchema = z.object({
  q: z.string().optional().default(''),
});

export const iconPackContentQuerySchema = z.object({
  url: z.string().min(1, '缺少图标包地址。'),
});

export const settingsUpdateBodySchema = settingsPatchSchema.passthrough();

export const telegramSessionBodySchema = z.object({
  initData: z.string().optional().default(''),
});

export const telegramAuditLogsQuerySchema = z.object({
  limit: z.string().optional(),
});

export const telegramNotificationsBodySchema = z.object({
  mode: z.enum(['immediate', 'digest', 'off']).optional(),
  muted: z.boolean().optional(),
  digestTime: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, '摘要时间无效。')
    .optional(),
  syncFailed: z.boolean().optional(),
  syncCompleted: z.boolean().optional(),
  securityAlerts: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const telegramChatIdParamSchema = z.object({
  chatId: z.string().regex(/^-?\d+$/, 'Chat ID 无效。'),
});
