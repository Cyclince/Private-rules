import { z } from 'zod';
import { OUTPUT_PROFILES, TEMPLATE_CLIENT_IDS, type TemplateClientId } from '../clients';

export const outputProfileSchema = z.enum(OUTPUT_PROFILES);
export const templateClientIdSchema = z.enum(TEMPLATE_CLIENT_IDS as [TemplateClientId, ...TemplateClientId[]]);

export const PUBLICATION_ACCESS_VALUES = ['token', 'public', 'disabled'] as const;
export const publicationAccessSchema = z.enum(PUBLICATION_ACCESS_VALUES);
export type PublicationAccess = z.infer<typeof publicationAccessSchema>;

const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined)
  .optional();

const optionalPositiveInt = z
  .number()
  .int()
  .positive()
  .nullish()
  .transform((value) => value ?? undefined)
  .optional();

const optionalOutputProfile = outputProfileSchema
  .nullish()
  .transform((value) => value ?? undefined)
  .optional();

/** Full publication record (aligned with `publications` table; never contains node bindings). */
export const publicationSchema = z.object({
  id: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  templateId: z.string().trim().min(1),
  pinnedVersion: optionalPositiveInt,
  clients: z.array(templateClientIdSchema).min(1),
  access: publicationAccessSchema,
  output: optionalOutputProfile,
  experimentalFullConfig: z.boolean().default(false),
  createdAt: optionalText,
  updatedAt: optionalText,
});
export type Publication = z.output<typeof publicationSchema>;

/** Form / API create-or-update schema for a publication. */
export const publicationFormSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, '发布标识仅支持字母、数字、连字符和下划线'),
  templateId: z.string().trim().min(1),
  pinnedVersion: optionalPositiveInt,
  clients: z.array(templateClientIdSchema).min(1),
  access: publicationAccessSchema,
  output: optionalOutputProfile,
  experimentalFullConfig: z.boolean().optional().default(false),
  inheritSlotBindings: z.boolean().optional().default(false),
});
export type PublicationFormValues = z.infer<typeof publicationFormSchema>;

/** Publication metadata in a version-2 backup: never contains `node_bindings` or `node_snapshots` (design §8.4). */
export const backupPublicationSchema = z.object({
  id: optionalText,
  slug: z.string().trim().min(1),
  templateId: z.string().trim().min(1),
  pinnedVersion: optionalPositiveInt,
  clients: z.array(templateClientIdSchema).min(1),
  access: publicationAccessSchema,
  output: optionalOutputProfile,
  experimentalFullConfig: z.boolean().optional(),
  createdAt: optionalText,
  updatedAt: optionalText,
});
export type BackupPublication = z.output<typeof backupPublicationSchema>;
