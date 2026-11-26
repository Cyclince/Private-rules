import { z } from 'zod';

export const settingsSchema = z.object({
  baseUrl: z.string(),
  policyName: z.string(),
  githubMirrorUrl: z.string(),
  publicLinksEnabled: z.boolean(),
  tokenLinksEnabled: z.boolean(),
  customIconPackUrls: z.array(z.string()),
  customIconPackNames: z.record(z.string(), z.string()),
  iconPackAutoUpdate: z.boolean(),
  iconPackUpdateIntervalHours: z.number().int().min(1).max(720),
  iconPackLastUpdatedAt: z.string().optional(),
});
export type Settings = z.infer<typeof settingsSchema>;

/** Settings in a backup may be partial; missing keys keep their current value. */
export const settingsPatchSchema = settingsSchema.partial();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
