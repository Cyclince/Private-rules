import { createRepositories } from '../../data/repositories';
import {
  BUILTIN_ICON_PACK_PRESETS,
  LIGE_ICON_PACK_SOURCE_URL,
  QURE_ICON_PACK_SOURCE_URL,
  listIconPackSourceUrls,
  parseIconPackPayload,
  resolveIconPackOrder,
} from '../../domain/templates';
import { safeFetchText } from '../../infrastructure/http/fetch';
import { redactString } from '../../infrastructure/logging/logger';
import { AppError } from '../../shared/errors';
import type { Env } from '../../types';
import type { RuleSettings } from '../../types/domain-rules';

/**
 * Preset icon packs refreshed into `icon_pack_cache`. Qure is the 1.0.x default; lige is the
 * classified community pack. Extension packs stay user-configured URLs.
 */
export const PRESET_ICON_PACK_URLS = [QURE_ICON_PACK_SOURCE_URL, LIGE_ICON_PACK_SOURCE_URL];

export type CachedPackIcon = { name: string; url: string };
export type IconPackRefreshResult = { url: string; ok: boolean; count: number; error?: string; updatedAt: string };

export async function getSettings(env: Env): Promise<RuleSettings> {
  return createRepositories(env.DB).settings.getAll();
}

export async function saveSettings(env: Env, input: Partial<RuleSettings>): Promise<RuleSettings> {
  return createRepositories(env.DB).settings.save(input);
}

function readPackIcons(payload: unknown): CachedPackIcon[] {
  return parseIconPackPayload(payload);
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
  // Disabled packs are not refreshed; custom URLs that duplicate a preset fold into it.
  const urls = listIconPackSourceUrls(settings);
  const results: IconPackRefreshResult[] = [];
  for (const url of urls) results.push(await refreshOne(env, url));
  const updatedAt = new Date(currentTime).toISOString();
  await saveSettings(env, { iconPackLastUpdatedAt: updatedAt });
  return { skipped: false, results, updatedAt };
}

export async function getCachedIconPack(env: Env, rawUrl: string) {
  const settings = await getSettings(env);
  const allowed = new Set([
    ...BUILTIN_ICON_PACK_PRESETS.map((preset) => preset.sourceUrl),
    ...settings.customIconPackUrls,
    ...resolveIconPackOrder(settings).map((pack) => pack.sourceUrl),
  ]);
  if (!allowed.has(rawUrl)) throw new AppError('VALIDATION_FAILED', '图标包未配置。');
  const { iconPacks } = createRepositories(env.DB);
  let row = await iconPacks.findByUrl(rawUrl);
  if (!row?.payload) {
    await refreshOne(env, rawUrl);
    row = await iconPacks.findByUrl(rawUrl);
  }
  if (!row?.payload) throw new AppError('UPSTREAM_FAILED', row?.lastError || '图标包尚未成功更新。');
  return {
    icons: JSON.parse(row.payload) as CachedPackIcon[],
    count: row.iconCount,
    status: row.lastStatus,
    updatedAt: row.updatedAt,
  };
}
