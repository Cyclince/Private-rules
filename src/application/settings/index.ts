import { createRepositories } from '../../data/repositories';
import { safeFetchText } from '../../infrastructure/http/fetch';
import { redactString } from '../../infrastructure/logging/logger';
import type { Env } from '../../types';
import type { RuleSettings } from '../../types/domain-rules';

export const PRESET_ICON_PACK_URLS = ['https://raw.githubusercontent.com/Koolson/Qure/master/Other/QureColor-All.json'];

export type CachedPackIcon = { name: string; url: string };
export type IconPackRefreshResult = { url: string; ok: boolean; count: number; error?: string; updatedAt: string };

export async function getSettings(env: Env): Promise<RuleSettings> {
  return createRepositories(env.DB).settings.getAll();
}

export async function saveSettings(env: Env, input: Partial<RuleSettings>): Promise<RuleSettings> {
  return createRepositories(env.DB).settings.save(input);
}

function readPackIcons(payload: unknown): CachedPackIcon[] {
  let values: unknown[] = [];
  if (Array.isArray(payload)) values = payload;
  else if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.icons)) values = record.icons;
    else values = Object.entries(record).map(([name, url]) => ({ name, url }));
  }
  return values
    .flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const icon = value as Record<string, unknown>;
      if (typeof icon.name !== 'string' || typeof icon.url !== 'string' || !/^https?:\/\//i.test(icon.url)) return [];
      return [{ name: icon.name.slice(0, 160), url: icon.url.slice(0, 2048) }];
    })
    .slice(0, 5000);
}

function safeError(cause: unknown): string {
  return redactString(cause instanceof Error ? cause.message : '图标包更新失败').slice(0, 300);
}

async function refreshOne(env: Env, rawUrl: string): Promise<IconPackRefreshResult> {
  const updatedAt = new Date().toISOString();
  const { iconPacks } = createRepositories(env.DB);
  try {
    const response = await safeFetchText(rawUrl, {
      headers: { accept: 'application/json' },
      maxBytes: 5_000_000,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const icons = readPackIcons(JSON.parse(response.text));
    if (!icons.length) throw new Error('没有找到有效图标');
    await iconPacks.upsertSuccess(rawUrl, JSON.stringify(icons), icons.length, updatedAt);
    return { url: rawUrl, ok: true, count: icons.length, updatedAt };
  } catch (cause) {
    const error = safeError(cause);
    await iconPacks.upsertError(rawUrl, error, updatedAt);
    return { url: rawUrl, ok: false, count: 0, error, updatedAt };
  }
}

export async function refreshIconPacks(env: Env, force = false, currentTime = Date.now()) {
  const settings = await getSettings(env);
  const lastUpdated = Date.parse(settings.iconPackLastUpdatedAt || '');
  const due =
    !Number.isFinite(lastUpdated) || currentTime - lastUpdated >= settings.iconPackUpdateIntervalHours * 3_600_000;
  if (!force && (!settings.iconPackAutoUpdate || !due)) {
    return {
      skipped: true,
      results: [] as IconPackRefreshResult[],
      updatedAt: settings.iconPackLastUpdatedAt,
    };
  }
  const urls = [...new Set([...PRESET_ICON_PACK_URLS, ...settings.customIconPackUrls])];
  const results: IconPackRefreshResult[] = [];
  for (const url of urls) results.push(await refreshOne(env, url));
  const updatedAt = new Date(currentTime).toISOString();
  await saveSettings(env, { iconPackLastUpdatedAt: updatedAt });
  return { skipped: false, results, updatedAt };
}

export async function getCachedIconPack(env: Env, rawUrl: string) {
  const settings = await getSettings(env);
  const allowed = new Set([...PRESET_ICON_PACK_URLS, ...settings.customIconPackUrls]);
  if (!allowed.has(rawUrl)) throw new Error('图标包未配置。');
  const { iconPacks } = createRepositories(env.DB);
  let row = await iconPacks.findByUrl(rawUrl);
  if (!row?.payload) {
    await refreshOne(env, rawUrl);
    row = await iconPacks.findByUrl(rawUrl);
  }
  if (!row?.payload) throw new Error(row?.lastError || '图标包尚未成功更新。');
  return {
    icons: JSON.parse(row.payload) as CachedPackIcon[],
    count: row.iconCount,
    status: row.lastStatus,
    updatedAt: row.updatedAt,
  };
}
