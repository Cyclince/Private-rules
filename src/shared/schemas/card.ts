import { z } from 'zod';
import { ruleOptionsSchema, ruleTypeSchema } from './rule';

// Category vocabulary lives in a dependency-free module so routes can import it without zod.
export {
  CATALOG_CATEGORY_VALUES,
  CATEGORY_EMOJI,
  LEGACY_CATEGORY_MAP,
  LEGACY_CATALOG_CATEGORY_VALUES,
  isPrimaryCatalogCategory,
  normalizeCatalogCategory,
} from '../app-categories';
export type { CatalogCategory, LegacyCatalogCategory, PrimaryCatalogCategory } from '../app-categories';

import {
  CATALOG_CATEGORY_VALUES as PRIMARY_CATEGORY_VALUES,
  LEGACY_CATALOG_CATEGORY_VALUES as LEGACY_CATEGORY_VALUES,
  normalizeCatalogCategory as normalizeCategory,
  type CatalogCategory as CategoryUnion,
} from '../app-categories';

/** Accepts both current and legacy ids on input, and always yields a current category. */
export const catalogCategorySchema = z
  .union([z.enum(PRIMARY_CATEGORY_VALUES), z.enum(LEGACY_CATEGORY_VALUES)])
  // Output is typed as CatalogCategory (which still admits the legacy ids) so read paths and
  // legacy comparisons keep type-checking; runtime values are always one of the 15 categories.
  .transform((value): CategoryUnion => normalizeCategory(value) ?? 'other');

/** Default route recommendation on rule catalog entries. */
export const CATALOG_DEFAULT_ROUTE_VALUES = ['proxy', 'direct', 'reject'] as const;
export const catalogDefaultRouteSchema = z.enum(CATALOG_DEFAULT_ROUTE_VALUES);
export type CatalogDefaultRoute = z.infer<typeof catalogDefaultRouteSchema>;

/** Fixed 7-layer rule stratification stages (design §10.10). */
export const STAGE_VALUES = ['pre-direct', 'app', 'proxy-fallback', 'ip', 'domestic', 'port', 'final'] as const;
export const stageSchema = z.enum(STAGE_VALUES);
export type Stage = z.infer<typeof stageSchema>;

/** Supported strategy group types (design §10.2). */
export const GROUP_TYPE_VALUES = ['select', 'url-test', 'fallback', 'load-balance'] as const;
export const groupTypeSchema = z.enum(GROUP_TYPE_VALUES);
export type GroupType = z.infer<typeof groupTypeSchema>;

/** Built-in terminal policies available on every client. */
export const BUILTIN_POLICY_IDS = ['DIRECT', 'REJECT', 'REJECT-DROP'] as const;
export const builtinPolicyIdSchema = z.enum(BUILTIN_POLICY_IDS);
export type BuiltinPolicyId = z.infer<typeof builtinPolicyIdSchema>;

/** Origin of an app card record. */
export const CARD_ORIGIN_VALUES = ['builtin', 'user', 'fork'] as const;
export const cardOriginSchema = z.enum(CARD_ORIGIN_VALUES);
export type CardOrigin = z.infer<typeof cardOriginSchema>;

/** Supported remote ruleset behaviors and formats (design §10.2). */
export const REMOTE_RULE_BEHAVIOR_VALUES = ['domain', 'ipcidr', 'classical'] as const;
export const remoteRuleBehaviorSchema = z.enum(REMOTE_RULE_BEHAVIOR_VALUES);
export type RemoteRuleBehavior = z.infer<typeof remoteRuleBehaviorSchema>;

export const REMOTE_RULE_FORMAT_VALUES = ['yaml', 'text', 'mrs'] as const;
export const remoteRuleFormatSchema = z.enum(REMOTE_RULE_FORMAT_VALUES);
export type RemoteRuleFormat = z.infer<typeof remoteRuleFormatSchema>;

const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined)
  .optional();

/** Node name filter used by slot references and region matching (design §10.2). */
export const nodeFilterSchema = z.object({
  regions: z
    .array(
      z
        .string()
        .trim()
        .min(2)
        .max(8)
        .transform((code) => code.toUpperCase()),
    )
    .optional(),
  include: z.string().min(1).optional(),
  exclude: z.string().min(1).optional(),
});
export type NodeFilter = z.output<typeof nodeFilterSchema>;

/** Policy reference inside a strategy group's candidate list or template `final` (design §10.2). */
export const policyRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('builtin'),
    id: builtinPolicyIdSchema,
  }),
  z.object({
    kind: z.literal('card'),
    cardId: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal('region'),
    regionGroupId: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal('pool'),
    poolId: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal('slot'),
    slotId: z.string().trim().min(1),
    filter: nodeFilterSchema.optional(),
  }),
]);
export type PolicyRef = z.output<typeof policyRefSchema>;

/** Inline rule leaf used inside condition trees (design §10.2). */
export const inlineRuleSchema = z.object({
  type: ruleTypeSchema,
  value: z.string().trim().min(1),
  options: ruleOptionsSchema.optional(),
});
export type InlineRule = z.output<typeof inlineRuleSchema>;

/** Recursive condition tree for inline matchers (design §10.2). */
export type Condition =
  { op: 'rule'; rule: InlineRule } | { op: 'and' | 'or'; items: Condition[] } | { op: 'not'; item: Condition };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({
      op: z.literal('rule'),
      rule: inlineRuleSchema,
    }),
    z.object({
      op: z.literal('and'),
      items: z.array(conditionSchema).min(1),
    }),
    z.object({
      op: z.literal('or'),
      items: z.array(conditionSchema).min(1),
    }),
    z.object({
      op: z.literal('not'),
      item: conditionSchema,
    }),
  ]),
);

const matcherInterval = z.number().int().positive().max(604_800).optional();

/** Matcher source attached to an app card (design §10.2). */
export const matcherSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ruleset'),
    ruleSetId: z.string().trim().min(1),
    updateIntervalSec: matcherInterval,
  }),
  z.object({
    kind: z.literal('catalog'),
    entryId: z.string().trim().min(1),
    updateIntervalSec: matcherInterval,
  }),
  z.object({
    kind: z.literal('geosite'),
    name: z.string().trim().min(1),
    updateIntervalSec: matcherInterval,
  }),
  z.object({
    kind: z.literal('geoip'),
    name: z.string().trim().min(1),
    noResolve: z.boolean().optional(),
    updateIntervalSec: matcherInterval,
  }),
  z.object({
    kind: z.literal('remote'),
    url: z.string().trim().url(),
    behavior: remoteRuleBehaviorSchema,
    format: remoteRuleFormatSchema.optional(),
    updateIntervalSec: matcherInterval,
  }),
  z.object({
    kind: z.literal('inline'),
    conditions: z.array(conditionSchema).min(1),
    updateIntervalSec: matcherInterval,
  }),
]);
export type Matcher = z.output<typeof matcherSchema>;

/** Health-check parameters for url-test / fallback / load-balance groups. */
export const groupHealthCheckSchema = z.object({
  url: z.string().trim().url(),
  intervalSec: z.number().int().positive().max(86_400),
  toleranceMs: z.number().int().nonnegative().max(10_000).optional(),
});
export type GroupHealthCheck = z.output<typeof groupHealthCheckSchema>;

/** Strategy group definition inside an app card (design §10.2). */
export const appCardGroupSchema = z.object({
  type: groupTypeSchema,
  candidates: z.array(policyRefSchema).min(1),
  test: groupHealthCheckSchema.optional(),
});
export type AppCardGroup = z.output<typeof appCardGroupSchema>;

/** Structured JSON payload stored in `app_cards.body`. */
export const appCardBodySchema = z.object({
  stage: stageSchema,
  group: appCardGroupSchema,
  matchers: z.array(matcherSchema),
  hidden: z.boolean().optional(),
});
export type AppCardBody = z.output<typeof appCardBodySchema>;

/** Full app card intermediate representation (design §10.2). */
export const appCardSchema = z.object({
  id: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  name: z.string().trim().min(1),
  icon: optionalText,
  category: catalogCategorySchema,
  stage: stageSchema,
  group: appCardGroupSchema,
  matchers: z.array(matcherSchema),
  hidden: z.boolean().optional(),
  origin: cardOriginSchema.optional(),
  forkedFrom: optionalText,
  createdAt: optionalText,
  updatedAt: optionalText,
});
export type AppCard = z.output<typeof appCardSchema>;

/** Partial overrides applied when referencing an app card inside a template. */
export const appCardOverrideSchema = z.object({
  name: z.string().trim().min(1).optional(),
  icon: z.string().trim().optional(),
  stage: stageSchema.optional(),
  group: z
    .object({
      type: groupTypeSchema.optional(),
      candidates: z.array(policyRefSchema).min(1).optional(),
      test: groupHealthCheckSchema.optional(),
    })
    .optional(),
  matchers: z.array(matcherSchema).optional(),
  hidden: z.boolean().optional(),
});
export type AppCardOverride = z.output<typeof appCardOverrideSchema>;

/** Rule catalog entry schema aligned with `catalog_entries` table (design §8.3). */
export const catalogEntrySchema = z.object({
  id: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  parentId: optionalText,
  name: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).default([]),
  category: catalogCategorySchema,
  defaultRoute: catalogDefaultRouteSchema,
  sourceUrl: z.string().trim().url(),
  behavior: remoteRuleBehaviorSchema.optional(),
  format: remoteRuleFormatSchema.optional(),
  ruleCount: z.number().int().nonnegative().nullable().optional(),
});
export type CatalogEntry = z.output<typeof catalogEntrySchema>;

/**
 * Backup card body schema: validates known fields strictly when present while
 * accepting sparse legacy/draft bodies written before M4.1.
 */
export const backupCardBodySchema = z
  .object({
    stage: stageSchema.optional(),
    group: z
      .object({
        type: groupTypeSchema.optional(),
        candidates: z.array(policyRefSchema).optional(),
        test: groupHealthCheckSchema.optional(),
      })
      .optional(),
    matchers: z.array(matcherSchema).optional(),
    hidden: z.boolean().optional(),
  })
  .catchall(z.unknown());
export type BackupCardBody = z.output<typeof backupCardBodySchema>;

/** App card record as stored in version-2 backups (aligned with `app_cards` table). */
export const backupCardSchema = z.object({
  id: optionalText,
  slug: z.string().trim().min(1),
  name: z.string().trim().min(1),
  icon: optionalText,
  category: catalogCategorySchema,
  body: backupCardBodySchema,
  origin: cardOriginSchema.nullish().transform((value) => value ?? undefined),
  forkedFrom: optionalText,
  createdAt: optionalText,
  updatedAt: optionalText,
});
export type BackupCard = z.output<typeof backupCardSchema>;
