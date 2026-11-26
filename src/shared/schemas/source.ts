import { z } from 'zod';

export const sourceTypeSchema = z.enum(['url', 'geosite', 'geoip']);
export const ruleOptimizationSchema = z.enum(['none', 'conservative', 'aggressive']);

const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);

export const backupSourceSchema = z
  .object({
    id: optionalText,
    name: optionalText,
    url: optionalText,
    enabled: z
      .boolean()
      .nullish()
      .transform((value) => value !== false),
    sourceType: sourceTypeSchema.nullish().transform((value) => value ?? 'url'),
    geositeName: optionalText,
    geoipName: optionalText,
    userAgent: optionalText,
    syncIntervalMinutes: z
      .number()
      .int()
      .positive()
      .nullish()
      .transform((value) => value ?? undefined),
    ruleOptimization: ruleOptimizationSchema.nullish().transform((value) => value ?? undefined),
    coverageDedup: z
      .boolean()
      .nullish()
      .transform((value) => value ?? undefined),
    lastSyncedAt: optionalText,
    lastStatus: z
      .enum(['success', 'error', 'pending'])
      .nullish()
      .transform((value) => value ?? undefined),
    lastCount: z
      .number()
      .int()
      .nonnegative()
      .nullish()
      .transform((value) => value ?? undefined),
    lastOriginalCount: z
      .number()
      .int()
      .nonnegative()
      .nullish()
      .transform((value) => value ?? undefined),
    lastError: optionalText,
  })
  .superRefine((source, ctx) => {
    if (source.sourceType === 'url' && !source.url)
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'URL 来源必须提供 url' });
    if (source.sourceType === 'geosite' && !source.url && !source.geositeName)
      ctx.addIssue({ code: 'custom', path: ['geositeName'], message: '缺少 geositeName 或 url' });
    if (source.sourceType === 'geoip' && !source.url && !source.geoipName)
      ctx.addIssue({ code: 'custom', path: ['geoipName'], message: '缺少 geoipName 或 url' });
  });
export type BackupSource = z.output<typeof backupSourceSchema>;

export const SOURCE_SYNC_INTERVALS = [15, 30, 60, 360, 720, 1440] as const;

/** Shared form schema for creating, editing, or previewing a rule source. */
export const sourceFormSchema = z
  .object({
    sourceType: sourceTypeSchema,
    name: z.string().max(120),
    url: z.string().max(2000),
    geositeName: z.string().max(120),
    geoipName: z.string().max(120),
    syncIntervalMinutes: z.number().int().min(15).max(1440),
    userAgent: z.string().max(256),
    ruleOptimization: ruleOptimizationSchema,
    enabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.sourceType === 'url' && !value.url.trim()) {
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'url_required' });
    }
    if (value.sourceType === 'geosite' && !value.geositeName.trim()) {
      ctx.addIssue({ code: 'custom', path: ['geositeName'], message: 'geosite_required' });
    }
    if (value.sourceType === 'geoip' && !value.geoipName.trim()) {
      ctx.addIssue({ code: 'custom', path: ['geoipName'], message: 'geoip_required' });
    }
  });
export type SourceFormValues = z.infer<typeof sourceFormSchema>;
