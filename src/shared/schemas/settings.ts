import { z } from 'zod';

export const settingsSchema = z.object({
  baseUrl: z.string(),
  policyName: z.string(),
  githubMirrorUrl: z.string(),
  publicLinksEnabled: z.boolean(),
  tokenLinksEnabled: z.boolean(),
  customIconPackUrls: z.array(z.string()),
  customIconPackNames: z.record(z.string(), z.string()),
  iconPackPriority: z.array(z.string().max(500)).max(50),
  iconPackDisabled: z.array(z.string().max(500)).max(50),
  iconPackIndexMatching: z.boolean(),
  iconPackAutoUpdate: z.boolean(),
  iconPackUpdateIntervalHours: z.number().int().min(1).max(720),
  iconPackLastUpdatedAt: z.string().optional(),
});
export type Settings = z.infer<typeof settingsSchema>;

/** Settings in a backup may be partial; missing keys keep their current value. */
export const settingsPatchSchema = settingsSchema.partial();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Shared form schema for general & icon-pack settings in the web UI. */
export const settingsFormSchema = z.object({
  baseUrl: z.string().max(500),
  policyName: z.string().max(120),
  githubMirrorUrl: z.string().max(500),
  publicLinksEnabled: z.boolean(),
  tokenLinksEnabled: z.boolean(),
  customIconPackUrlsText: z.string().max(5000),
  iconPackIndexMatching: z.boolean(),
  iconPackAutoUpdate: z.boolean(),
  iconPackUpdateIntervalHours: z.number().int().min(1).max(720),
});
export type SettingsFormValues = z.infer<typeof settingsFormSchema>;

export const apiKeyNoteFormSchema = z.object({
  note: z.string().max(80),
});
export type ApiKeyNoteFormValues = z.infer<typeof apiKeyNoteFormSchema>;

export const telegramNotificationFormSchema = z.object({
  mode: z.enum(['immediate', 'digest', 'off']),
  muted: z.boolean(),
  digestTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  syncFailed: z.boolean(),
  syncCompleted: z.boolean(),
  securityAlerts: z.boolean(),
});
export type TelegramNotificationFormValues = z.infer<typeof telegramNotificationFormSchema>;
