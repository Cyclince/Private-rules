import { z } from 'zod';
import { backupRuleSetSchema } from './ruleset';
import { settingsPatchSchema } from './settings';

export const backupSchema = z
  .object({
    version: z.literal(1).optional(),
    settings: settingsPatchSchema,
    categories: z.array(backupRuleSetSchema),
    updatedAt: z.string().optional(),
  })
  .superRefine((backup, ctx) => {
    const ids = new Set<string>();
    const slugs = new Set<string>();
    backup.categories.forEach((category, index) => {
      if (category.id) {
        if (ids.has(category.id))
          ctx.addIssue({
            code: 'custom',
            path: ['categories', index, 'id'],
            message: `规则集 id 重复：${category.id}`,
          });
        ids.add(category.id);
      }
      if (category.slug) {
        if (slugs.has(category.slug))
          ctx.addIssue({
            code: 'custom',
            path: ['categories', index, 'slug'],
            message: `规则集 slug 重复：${category.slug}`,
          });
        slugs.add(category.slug);
      }
    });
  });
export type Backup = z.output<typeof backupSchema>;

/** Flattens zod issues into `path: message` strings for API responses. */
export function describeIssues(error: z.ZodError, limit = 20): string[] {
  return error.issues.slice(0, limit).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}
