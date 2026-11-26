import { z } from 'zod';
import { OUTPUT_PROFILES, TEMPLATE_CLIENT_IDS, type TemplateClientId } from '../clients';
import { backupRuleSetSchema } from './ruleset';
import { settingsPatchSchema } from './settings';

/** Current backup format version exported by 1.1.0; version 1 remains importable. */
export const BACKUP_FORMAT_VERSION = 2 as const;

export const CATALOG_CATEGORY_VALUES = [
  'ai',
  'streaming',
  'social',
  'gaming',
  'advertising',
  'domestic',
  'infrastructure',
  'other',
] as const;

export const catalogCategorySchema = z.enum(CATALOG_CATEGORY_VALUES);
export const outputProfileSchema = z.enum(OUTPUT_PROFILES);
export const templateClientIdSchema = z.enum(TEMPLATE_CLIENT_IDS as [TemplateClientId, ...TemplateClientId[]]);

const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);

export const backupCardSchema = z.object({
  id: optionalText,
  slug: z.string().trim().min(1),
  name: z.string().trim().min(1),
  icon: optionalText,
  category: catalogCategorySchema,
  body: z.record(z.string(), z.unknown()),
  origin: z
    .enum(['builtin', 'user', 'fork'])
    .nullish()
    .transform((value) => value ?? undefined),
  forkedFrom: optionalText,
  createdAt: optionalText,
  updatedAt: optionalText,
});
export type BackupCard = z.output<typeof backupCardSchema>;

/** Template snapshot in a backup: current state only, no version history (design §4.1). */
export const backupTemplateSchema = z.object({
  id: optionalText,
  slug: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: optionalText,
  baseKind: z.enum(['blank', 'acl4ssr-ini', 'mihomo-yaml', 'builtin']),
  baseSourceUrl: optionalText,
  baseBody: z.record(z.string(), z.unknown()),
  overlay: z
    .array(z.record(z.string(), z.unknown()))
    .nullish()
    .transform((value) => value ?? []),
  output: outputProfileSchema.nullish().transform((value) => value ?? undefined),
  createdAt: optionalText,
  updatedAt: optionalText,
});
export type BackupTemplate = z.output<typeof backupTemplateSchema>;

/** Publication metadata in a backup: never contains `node_bindings` or `node_snapshots` (design §8.4). */
export const backupPublicationSchema = z.object({
  id: optionalText,
  slug: z.string().trim().min(1),
  templateId: z.string().trim().min(1),
  pinnedVersion: z
    .number()
    .int()
    .positive()
    .nullish()
    .transform((value) => value ?? undefined),
  clients: z.array(templateClientIdSchema).min(1),
  access: z.enum(['token', 'public', 'disabled']),
  output: outputProfileSchema.nullish().transform((value) => value ?? undefined),
  createdAt: optionalText,
  updatedAt: optionalText,
});
export type BackupPublication = z.output<typeof backupPublicationSchema>;

function checkUniqueIdsAndSlugs(
  items: Array<{ id?: string; slug?: string }>,
  field: string,
  label: string,
  ctx: z.RefinementCtx,
) {
  const ids = new Set<string>();
  const slugs = new Set<string>();
  items.forEach((item, index) => {
    if (item.id) {
      if (ids.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [field, index, 'id'],
          message: `${label} id 重复：${item.id}`,
        });
      }
      ids.add(item.id);
    }
    if (item.slug) {
      if (slugs.has(item.slug)) {
        ctx.addIssue({
          code: 'custom',
          path: [field, index, 'slug'],
          message: `${label} slug 重复：${item.slug}`,
        });
      }
      slugs.add(item.slug);
    }
  });
}

export const backupSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(BACKUP_FORMAT_VERSION)]).optional(),
    settings: settingsPatchSchema,
    categories: z.array(backupRuleSetSchema),
    cards: z.array(backupCardSchema).optional(),
    templates: z.array(backupTemplateSchema).optional(),
    publications: z.array(backupPublicationSchema).optional(),
    updatedAt: z.string().optional(),
  })
  .superRefine((backup, ctx) => {
    checkUniqueIdsAndSlugs(backup.categories, 'categories', '规则集', ctx);
    if (backup.cards) checkUniqueIdsAndSlugs(backup.cards, 'cards', '应用组件', ctx);
    if (backup.templates) checkUniqueIdsAndSlugs(backup.templates, 'templates', '模板', ctx);
    if (backup.publications) checkUniqueIdsAndSlugs(backup.publications, 'publications', '发布', ctx);
  });
export type Backup = z.output<typeof backupSchema>;

/** Flattens zod issues into `path: message` strings for API responses. */
export function describeIssues(error: z.ZodError, limit = 20): string[] {
  return error.issues.slice(0, limit).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}
