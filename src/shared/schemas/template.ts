import { z } from 'zod';
import { appCardOverrideSchema, groupHealthCheckSchema, groupTypeSchema, policyRefSchema } from './card';
import { outputProfileSchema, templateClientIdSchema } from './publication';
import { templateWizardMetaSchema } from './quick-create';

/** Origins supported for template `base_kind` (design §8.3). */
export const TEMPLATE_BASE_KIND_VALUES = ['blank', 'acl4ssr-ini', 'mihomo-yaml', 'builtin'] as const;
export const templateBaseKindSchema = z.enum(TEMPLATE_BASE_KIND_VALUES);
export type TemplateBaseKind = z.infer<typeof templateBaseKindSchema>;

/** Template-level business group mode toggle (design §10.4). */
export const TEMPLATE_GROUP_MODE_VALUES = ['select', 'fallback'] as const;
export const templateGroupModeSchema = z.enum(TEMPLATE_GROUP_MODE_VALUES);
export type TemplateGroupMode = z.infer<typeof templateGroupModeSchema>;

/** DNS configuration profile modes (design §10.2). */
export const DNS_MODE_VALUES = ['fake-ip', 'redir-host', 'custom'] as const;
export const dnsModeSchema = z.enum(DNS_MODE_VALUES);
export type DnsMode = z.infer<typeof dnsModeSchema>;

export const LOG_LEVEL_VALUES = ['silent', 'error', 'warning', 'info', 'debug'] as const;
export const logLevelSchema = z.enum(LOG_LEVEL_VALUES);
export type LogLevel = z.infer<typeof logLevelSchema>;

const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined)
  .optional();

/** Node slot declaration inside a template; subscription URLs live only in publications (design §10.2, §11.1). */
export const nodeSlotSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  excludeInfo: z.boolean().default(true),
  udp: z.boolean().optional(),
  healthCheck: groupHealthCheckSchema.optional(),
});
export type NodeSlot = z.output<typeof nodeSlotSchema>;

/** Region-based node group backed by the built-in region dictionary (design §10.11). */
export const regionGroupSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  region: z
    .string()
    .trim()
    .min(2)
    .max(8)
    .transform((code) => code.toUpperCase()),
  type: groupTypeSchema,
  extraInclude: z.string().min(1).optional(),
  extraExclude: z.string().min(1).optional(),
  test: groupHealthCheckSchema.optional(),
  slotId: z.string().trim().min(1).optional(),
});
export type RegionGroup = z.output<typeof regionGroupSchema>;

/** Ordered card reference inside a template (order determines rule priority). */
export const templateCardRefSchema = z.object({
  cardId: z.string().trim().min(1),
  enabled: z.boolean(),
  overrides: appCardOverrideSchema.optional(),
});
export type TemplateCardRef = z.output<typeof templateCardRefSchema>;

/** DNS profile attached to a template (omitted when output profile is `minimal`). */
export const dnsProfileSchema = z.object({
  mode: dnsModeSchema,
  enable: z.boolean().optional(),
  ipv6: z.boolean().optional(),
  nameserver: z.array(z.string().trim().min(1)).optional(),
  fallback: z.array(z.string().trim().min(1)).optional(),
  defaultNameserver: z.array(z.string().trim().min(1)).optional(),
  fakeIpFilter: z.array(z.string().trim().min(1)).optional(),
  respectRules: z.boolean().optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});
export type DnsProfile = z.output<typeof dnsProfileSchema>;

/** Optional client runtime defaults (omitted when output profile is `minimal`). */
export const generalSettingsSchema = z.object({
  testUrl: z.string().trim().url().optional(),
  testIntervalSec: z.number().int().positive().max(86_400).optional(),
  ipv6: z.boolean().optional(),
  skipProxy: z.array(z.string().trim().min(1)).optional(),
  allowLan: z.boolean().optional(),
  mixedPort: z.number().int().min(1).max(65_535).optional(),
  logLevel: logLevelSchema.optional(),
});
export type GeneralSettings = z.output<typeof generalSettingsSchema>;

/** Enhancement module activation entry on a template (design §10.12). */
export const templateModuleBindingSchema = z.object({
  id: z.string().trim().min(1),
  enabled: z.boolean(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type TemplateModuleBinding = z.output<typeof templateModuleBindingSchema>;

/** Raw client-specific patches keyed by client id. */
export const clientPatchesSchema = z.partialRecord(templateClientIdSchema, z.string());
export type ClientPatches = z.output<typeof clientPatchesSchema>;

/** Complete intermediate structure of a template body (design §10.2). */
export const templateBodySchema = z.object({
  slots: z.array(nodeSlotSchema),
  regionGroups: z.array(regionGroupSchema),
  cards: z.array(templateCardRefSchema),
  groupMode: templateGroupModeSchema,
  final: policyRefSchema,
  output: outputProfileSchema,
  dns: dnsProfileSchema,
  general: generalSettingsSchema.optional(),
  modules: z.array(templateModuleBindingSchema),
  clientPatches: clientPatchesSchema.optional(),
  wizardMeta: templateWizardMetaSchema.optional(),
});
export type TemplateBody = z.output<typeof templateBodySchema>;

const regionGroupPatchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  region: z
    .string()
    .trim()
    .min(2)
    .max(8)
    .transform((code) => code.toUpperCase())
    .optional(),
  type: groupTypeSchema.optional(),
  extraInclude: z.string().min(1).nullable().optional(),
  extraExclude: z.string().min(1).nullable().optional(),
  test: groupHealthCheckSchema.nullable().optional(),
  slotId: z.string().trim().min(1).nullable().optional(),
});

const nodeSlotPatchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  excludeInfo: z.boolean().optional(),
  udp: z.boolean().nullable().optional(),
  healthCheck: groupHealthCheckSchema.nullable().optional(),
});

/** Deterministic user modification operations replayed on top of `baseBody` (design §10.3). */
export const templateOverlayOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('addCard'),
    cardId: z.string().trim().min(1),
    enabled: z.boolean().optional(),
    afterCardId: z.string().trim().min(1).nullable().optional(),
    beforeCardId: z.string().trim().min(1).nullable().optional(),
    overrides: appCardOverrideSchema.optional(),
  }),
  z.object({
    op: z.literal('removeCard'),
    cardId: z.string().trim().min(1),
  }),
  z.object({
    op: z.literal('moveCard'),
    cardId: z.string().trim().min(1),
    toIndex: z.number().int().nonnegative().optional(),
    afterCardId: z.string().trim().min(1).nullable().optional(),
    beforeCardId: z.string().trim().min(1).nullable().optional(),
  }),
  z.object({
    op: z.literal('setCardEnabled'),
    cardId: z.string().trim().min(1),
    enabled: z.boolean(),
  }),
  z.object({
    op: z.literal('setCardOverride'),
    cardId: z.string().trim().min(1),
    overrides: appCardOverrideSchema.nullable(),
  }),
  z.object({
    op: z.literal('addRegionGroup'),
    regionGroup: regionGroupSchema,
  }),
  z.object({
    op: z.literal('removeRegionGroup'),
    regionGroupId: z.string().trim().min(1),
  }),
  z.object({
    op: z.literal('updateRegionGroup'),
    regionGroupId: z.string().trim().min(1),
    patch: regionGroupPatchSchema,
  }),
  z.object({
    op: z.literal('addSlot'),
    slot: nodeSlotSchema,
  }),
  z.object({
    op: z.literal('removeSlot'),
    slotId: z.string().trim().min(1),
  }),
  z.object({
    op: z.literal('updateSlot'),
    slotId: z.string().trim().min(1),
    patch: nodeSlotPatchSchema,
  }),
  z.object({
    op: z.literal('setGroupMode'),
    groupMode: templateGroupModeSchema,
  }),
  z.object({
    op: z.literal('setFinal'),
    final: policyRefSchema,
  }),
  z.object({
    op: z.literal('setOutput'),
    output: outputProfileSchema,
  }),
  z.object({
    op: z.literal('setDns'),
    dns: dnsProfileSchema,
  }),
  z.object({
    op: z.literal('setGeneral'),
    general: generalSettingsSchema.nullable(),
  }),
  z.object({
    op: z.literal('setModule'),
    moduleId: z.string().trim().min(1),
    enabled: z.boolean(),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    op: z.literal('setPatch'),
    client: templateClientIdSchema,
    patch: z.string().nullable(),
  }),
]);
export type TemplateOverlayOp = z.output<typeof templateOverlayOpSchema>;

export const templateOverlaySchema = z.array(templateOverlayOpSchema);
export type TemplateOverlay = z.output<typeof templateOverlaySchema>;

/** Complete template record aligned with `templates` table (design §8.3). */
export const templateSchema = z.object({
  id: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().default(''),
  baseKind: templateBaseKindSchema,
  baseSourceUrl: optionalText,
  baseBody: templateBodySchema,
  overlay: templateOverlaySchema.default([]),
  currentVersion: z.number().int().positive().default(1),
  createdAt: optionalText,
  updatedAt: optionalText,
});
export type TemplateRecord = z.output<typeof templateSchema>;

/**
 * Backup template base body schema: validates known fields strictly when present
 * while allowing sparse draft/legacy snapshots written before M4.1.
 */
export const backupTemplateBodySchema = z
  .object({
    slots: z.array(nodeSlotSchema).optional(),
    regionGroups: z.array(regionGroupSchema).optional(),
    cards: z.array(templateCardRefSchema).optional(),
    groupMode: templateGroupModeSchema.optional(),
    final: policyRefSchema.optional(),
    output: outputProfileSchema.optional(),
    dns: dnsProfileSchema.optional(),
    general: generalSettingsSchema.optional(),
    modules: z.array(templateModuleBindingSchema).optional(),
    clientPatches: clientPatchesSchema.optional(),
  })
  .catchall(z.unknown());
export type BackupTemplateBody = z.output<typeof backupTemplateBodySchema>;

/** Template snapshot in a version-2 backup: current state only, no version history (design §4.1). */
export const backupTemplateSchema = z.object({
  id: optionalText,
  slug: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: optionalText,
  baseKind: templateBaseKindSchema,
  baseSourceUrl: optionalText,
  baseBody: backupTemplateBodySchema,
  overlay: templateOverlaySchema.nullish().transform((value) => value ?? []),
  output: outputProfileSchema.nullish().transform((value) => value ?? undefined),
  createdAt: optionalText,
  updatedAt: optionalText,
});
export type BackupTemplate = z.output<typeof backupTemplateSchema>;
