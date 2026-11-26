import { z } from 'zod';

/**
 * Canonical rule types stored in the database (design §9.1).
 * `SRC-PORT` is kept for 1.0.x compatibility; IPv6 CIDR rules are stored under
 * `IP-CIDR` so upgraded 1.0.x subscriptions remain byte-compatible and clients
 * split IPv4/IPv6 at output time.
 */
export const RULE_TYPE_VALUES = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'DOMAIN-REGEX',
  'IP-CIDR',
  'SRC-IP-CIDR',
  'IP-ASN',
  'DST-PORT',
  'SRC-PORT',
  'GEOSITE',
  'GEOIP',
  'PROCESS-NAME',
  'USER-AGENT',
  'URL-REGEX',
] as const;

/** Input rule types accepted on import; `IP-CIDR6` normalizes to `IP-CIDR`. */
export const RULE_INPUT_TYPE_VALUES = [...RULE_TYPE_VALUES, 'IP-CIDR6'] as const;

export const storedRuleTypeSchema = z.enum(RULE_TYPE_VALUES);
export type RuleType = z.infer<typeof storedRuleTypeSchema>;
export type RuleInputType = (typeof RULE_INPUT_TYPE_VALUES)[number];

export const ruleTypeSchema = z
  .enum(RULE_INPUT_TYPE_VALUES)
  .transform((type): RuleType => (type === 'IP-CIDR6' ? 'IP-CIDR' : type));

export const ruleOptionsSchema = z.object({
  noResolve: z.boolean().optional(),
});
export type RuleOptions = z.infer<typeof ruleOptionsSchema>;

const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);

export const ruleSchema = z.object({
  id: z.string().min(1).optional(),
  value: z.string().trim().min(1),
  type: ruleTypeSchema,
  displayType: optionalText,
  options: ruleOptionsSchema
    .nullish()
    .transform((value) => (value && Object.keys(value).length > 0 ? value : undefined)),
  note: optionalText,
  enabled: z
    .boolean()
    .nullish()
    .transform((value) => value !== false),
  sortOrder: z
    .number()
    .finite()
    .nullish()
    .transform((value) => value ?? undefined),
  sourceId: optionalText,
  createdAt: optionalText,
  updatedAt: optionalText,
});
export type RuleInput = z.input<typeof ruleSchema>;
export type Rule = z.output<typeof ruleSchema>;

/** Shared form schema for adding or editing a single manual rule. */
export const manualRuleFormSchema = z.object({
  value: z.string().trim().min(1),
  type: z.enum(['AUTO', ...RULE_INPUT_TYPE_VALUES]),
  note: z.string().max(500),
  enabled: z.boolean(),
  noResolve: z.boolean(),
});
export type ManualRuleFormValues = z.infer<typeof manualRuleFormSchema>;

/** Shared form schema for the 3-step bulk import wizard. */
export const bulkImportFormSchema = z.object({
  text: z.string().trim().min(1),
  replaceConflicts: z.boolean(),
});
export type BulkImportFormValues = z.infer<typeof bulkImportFormSchema>;
