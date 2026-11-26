import { z } from 'zod';
import { CATALOG_CATEGORY_VALUES, backupCardSchema, catalogCategorySchema, type BackupCard } from './card';
import {
  backupPublicationSchema,
  outputProfileSchema,
  templateClientIdSchema,
  type BackupPublication,
} from './publication';
import { backupRuleSetSchema } from './ruleset';
import { settingsPatchSchema } from './settings';
import { backupTemplateSchema, type BackupTemplate } from './template';

/** Current backup format version exported by 1.1.0; version 1 remains importable. */
export const BACKUP_FORMAT_VERSION = 2 as const;

export {
  CATALOG_CATEGORY_VALUES,
  backupCardSchema,
  backupPublicationSchema,
  backupTemplateSchema,
  catalogCategorySchema,
  outputProfileSchema,
  templateClientIdSchema,
  type BackupCard,
  type BackupPublication,
  type BackupTemplate,
};

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
