import { z } from 'zod';
import { ruleSchema } from './rule';
import { backupSourceSchema } from './source';

const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);
const optionalBoolean = z
  .boolean()
  .nullish()
  .transform((value) => value ?? undefined);

/** A rule set (stored as `categories` for 1.0.x compatibility) as it appears in a backup. */
export const backupRuleSetSchema = z.object({
  id: optionalText,
  name: z.string().trim().min(1),
  slug: optionalText,
  icon: optionalText,
  description: optionalText,
  note: optionalText,
  enabled: optionalBoolean,
  sortOrder: z
    .number()
    .finite()
    .nullish()
    .transform((value) => value ?? undefined),
  publicLinksEnabled: optionalBoolean,
  tokenLinksEnabled: optionalBoolean,
  syncIntervalMinutes: z
    .number()
    .int()
    .positive()
    .nullish()
    .transform((value) => value ?? undefined),
  createdAt: optionalText,
  updatedAt: optionalText,
  rules: z.array(ruleSchema),
  sources: z
    .array(backupSourceSchema)
    .nullish()
    .transform((value) => value ?? []),
});
export type BackupRuleSet = z.output<typeof backupRuleSetSchema>;
