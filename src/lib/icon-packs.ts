import type { Env } from '../types';
import { getSettings, saveSettings } from './db';
import { validateRemoteSourceUrl } from './remote-source-security';

export const PRESET_ICON_PACK_URLS = ['https://raw.githubusercontent.com/Koolson/Qure/master/Other/QureColor-All.json'];

export type CachedPackIcon = { name: string; url: string };
export type IconPackRefreshResult = { url: string; ok: boolean; count: number; error?: string; updatedAt: string };

function readPackIcons(payload: unknown): CachedPackIcon[] {
  let values: unknown[] = [];
  if (Array.isArray(payload)) values = payload;
  else if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.icons)) values = record.icons;
    else values = Object.entries(record).map(([name, url]) => ({ name, url }));
  }
  return values.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const icon = value as Record<string, unknown>;
    if (typeof icon.name !== 'string' || typeof icon.url !== 'string' || !/^https?:\/\//i.test(icon.url)) return [];
    return [{ name: icon.name.slice(0, 160), url: icon.url.slice(0, 2048) }];
  }).slice(0, 5000);
}

function safeError(cause: unknown) {
  return (cause instanceof Error ? cause.message : '图标包更新失败')
    .replace(/([?&](?:token|key|auth|signature)=)[^&\s]+/gi, '$1[redacted]').slice(0, 300);
}

async function refreshOne(env: Env, rawUrl: string): Promise<IconPackRefreshResult> {
  const updatedAt = new Date().toISOString();
  try {
    const url = validateRemoteSourceUrl(rawUrl);
    const response = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > 5_000_000) throw new Error('图标包超过 5 MB 限制');
    const text = await response.text();
    if (text.length > 5_000_000) throw new Error('图标包超过 5 MB 限制');
    const icons = readPackIcons(JSON.parse(text));
    if (!icons.length) throw new Error('没有找到有效图标');
    const payload = JSON.stringify(icons);
    await env.DB.prepare(`INSERT INTO icon_pack_cache (url, payload, icon_count, last_status, last_error, updated_at)
      VALUES (?, ?, ?, 'success', NULL, ?)
      ON CONFLICT(url) DO UPDATE SET payload = excluded.payload, icon_count = excluded.icon_count,
      last_status = excluded.last_status, last_error = NULL, updated_at = excluded.updated_at`)
      .bind(rawUrl, payload, icons.length, updatedAt).run();
    return { url: rawUrl, ok: true, count: icons.length, updatedAt };
  } catch (cause) {
    const error = safeError(cause);
    await env.DB.prepare(`INSERT INTO icon_pack_cache (url, payload, icon_count, last_status, last_error, updated_at)
      VALUES (?, NULL, 0, 'error', ?, ?)
      ON CONFLICT(url) DO UPDATE SET last_status = excluded.last_status, last_error = excluded.last_error, updated_at = excluded.updated_at`)
      .bind(rawUrl, error, updatedAt).run();
    return { url: rawUrl, ok: false, count: 0, error, updatedAt };
  }
}

export async function refreshIconPacks(env: Env, force = false, currentTime = Date.now()) {
  const settings = await getSettings(env);
  const lastUpdated = Date.parse(settings.iconPackLastUpdatedAt || '');
  const due = !Number.isFinite(lastUpdated) || currentTime - lastUpdated >= settings.iconPackUpdateIntervalHours * 3_600_000;
  if (!force && (!settings.iconPackAutoUpdate || !due)) return { skipped: true, results: [] as IconPackRefreshResult[], updatedAt: settings.iconPackLastUpdatedAt };
  const urls = [...new Set([...PRESET_ICON_PACK_URLS, ...settings.customIconPackUrls])];
  // Each pack can temporarily occupy several copies of a 5 MB payload while
  // it is downloaded, parsed and serialized. Process packs one at a time so
  // custom packs do not multiply the container's peak memory usage.
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
  let row = await env.DB.prepare('SELECT payload, icon_count, last_status, last_error, updated_at FROM icon_pack_cache WHERE url = ?')
    .bind(rawUrl).first<{ payload: string | null; icon_count: number; last_status: string; last_error: string | null; updated_at: string }>();
  if (!row?.payload) {
    await refreshOne(env, rawUrl);
    row = await env.DB.prepare('SELECT payload, icon_count, last_status, last_error, updated_at FROM icon_pack_cache WHERE url = ?')
      .bind(rawUrl).first<{ payload: string | null; icon_count: number; last_status: string; last_error: string | null; updated_at: string }>();
  }
  if (!row?.payload) throw new Error(row?.last_error || '图标包尚未成功更新。');
  return { icons: JSON.parse(row.payload) as CachedPackIcon[], count: row.icon_count, status: row.last_status, updatedAt: row.updated_at };
}
