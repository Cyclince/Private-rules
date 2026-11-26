import { z } from 'zod';

/** Rule types stored by 1.0.x; 1.1.0 keeps them byte-compatible. */
export const RULE_TYPE_VALUES = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'IP-CIDR',
  'SRC-IP-CIDR',
  'IP-ASN',
  'DST-PORT',
  'SRC-PORT',
  'GEOSITE',
  'GEOIP',
] as const;

export const ruleTypeSchema = z.enum(RULE_TYPE_VALUES);
export type RuleType = z.infer<typeof ruleTypeSchema>;

const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);

export const ruleSchema = z.object({
  id: z.string().min(1).optional(),
  value: z.string().trim().min(1),
  type: ruleTypeSchema,
  displayType: optionalText,
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
