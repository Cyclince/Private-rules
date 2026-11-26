import { eq } from 'drizzle-orm';
import { normalizeGithubMirrorUrl } from '../../lib/github-mirror';
import type { RuleSettings } from '../../types/domain-rules';
import type { AppDatabase } from '../db';
import { settings } from '../schema';

export const DEFAULT_SETTINGS: RuleSettings = {
  baseUrl: '',
  policyName: '',
  githubMirrorUrl: '',
  publicLinksEnabled: true,
  tokenLinksEnabled: true,
  customIconPackUrls: [],
  customIconPackNames: {},
  iconPackAutoUpdate: true,
  iconPackUpdateIntervalHours: 24,
  iconPackLastUpdatedAt: '',
};

export function resolveSettingsPatch(current: RuleSettings, input: Partial<RuleSettings> = {}): RuleSettings {
  return {
    baseUrl: input.baseUrl ?? current.baseUrl,
    policyName: input.policyName ?? current.policyName,
    githubMirrorUrl:
      input.githubMirrorUrl === undefined ? current.githubMirrorUrl : normalizeGithubMirrorUrl(input.githubMirrorUrl),
    publicLinksEnabled: input.publicLinksEnabled ?? current.publicLinksEnabled,
    tokenLinksEnabled: input.tokenLinksEnabled ?? current.tokenLinksEnabled,
    customIconPackUrls: input.customIconPackUrls ?? current.customIconPackUrls,
    customIconPackNames: input.customIconPackNames ?? current.customIconPackNames,
    iconPackAutoUpdate: input.iconPackAutoUpdate ?? current.iconPackAutoUpdate,
    iconPackUpdateIntervalHours: Math.max(
      1,
      Math.min(720, Number(input.iconPackUpdateIntervalHours ?? current.iconPackUpdateIntervalHours) || 24),
    ),
    iconPackLastUpdatedAt: input.iconPackLastUpdatedAt ?? current.iconPackLastUpdatedAt,
  };
}

export function serializeSettingsEntries(resolved: RuleSettings): Array<{ key: string; value: string }> {
  return Object.entries(resolved).map(([key, value]) => ({
    key,
    value: typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''),
  }));
}

export class SettingsRepository {
  constructor(private readonly db: AppDatabase) {}

  async getAll(): Promise<RuleSettings> {
    const rows = await this.db.select().from(settings);
    const result: RuleSettings = {
      ...DEFAULT_SETTINGS,
      customIconPackUrls: [...DEFAULT_SETTINGS.customIconPackUrls],
      customIconPackNames: { ...DEFAULT_SETTINGS.customIconPackNames },
    };
    for (const row of rows) {
      if (row.key === 'baseUrl') result.baseUrl = row.value ?? '';
      if (row.key === 'policyName') result.policyName = row.value ?? '';
      if (row.key === 'githubMirrorUrl') result.githubMirrorUrl = row.value ?? '';
      if (row.key === 'publicLinksEnabled') result.publicLinksEnabled = row.value !== 'false';
      if (row.key === 'tokenLinksEnabled') result.tokenLinksEnabled = row.value !== 'false';
      if (row.key === 'customIconPackUrls') {
        try {
          result.customIconPackUrls = JSON.parse(row.value || '[]') as string[];
        } catch {
          result.customIconPackUrls = [];
        }
      }
      if (row.key === 'customIconPackNames') {
        try {
          result.customIconPackNames = JSON.parse(row.value || '{}') as Record<string, string>;
        } catch {
          result.customIconPackNames = {};
        }
      }
      if (row.key === 'iconPackAutoUpdate') result.iconPackAutoUpdate = row.value !== 'false';
      if (row.key === 'iconPackUpdateIntervalHours') {
        result.iconPackUpdateIntervalHours = Math.max(1, Number(row.value) || 24);
      }
      if (row.key === 'iconPackLastUpdatedAt') result.iconPackLastUpdatedAt = row.value ?? '';
    }
    return result;
  }

  async save(patch: Partial<RuleSettings>): Promise<RuleSettings> {
    const next = resolveSettingsPatch(await this.getAll(), patch);
    const entries = serializeSettingsEntries(next);
    const queries = entries.map((entry) =>
      this.db
        .insert(settings)
        .values(entry)
        .onConflictDoUpdate({ target: settings.key, set: { value: entry.value } }),
    );
    await this.db.batch(queries as [(typeof queries)[0], ...(typeof queries)[0][]]);
    return next;
  }

  async getRaw(key: string): Promise<string | null> {
    const rows = await this.db.select().from(settings).where(eq(settings.key, key)).limit(1);
    return rows[0]?.value ?? null;
  }

  async setRawIfMissing(key: string, value: string): Promise<void> {
    await this.db.insert(settings).values({ key, value }).onConflictDoNothing();
  }
}
