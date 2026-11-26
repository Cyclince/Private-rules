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
