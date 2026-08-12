import type { Env } from '../../types';
import type { RuleOptimizationMode, RuleSource } from '../../types/domain-rules';
import { normalizeUserAgent, now, sourceNameFromUrl } from '../../lib/db';
import { id } from '../../lib/slug';
import { previewSourceRules, syncSourceById } from '../../lib/sync';
import { validateRemoteSourceUrl } from '../../lib/remote-source-security';

export type SourceInput = {
  name?: string;
  sourceType: 'url' | 'geosite' | 'geoip';
  url?: string;
  geositeName?: string;
  geoipName?: string;
  userAgent?: string;
  syncIntervalMinutes?: number;
  enabled?: boolean;
  ruleOptimization?: RuleOptimizationMode;
};

const GEO_NAME = /^[a-z0-9_!@.-]{1,120}$/i;
const SYNC_INTERVALS = new Set([15, 30, 60, 360, 720, 1440]);

type NormalizedSourceInput = {
  sourceType: 'url' | 'geosite' | 'geoip';
  url: string;
  geositeName: string | null;
  geoipName: string | null;
  name: string;
  userAgent: string;
  ruleOptimization: RuleOptimizationMode;
  syncIntervalMinutes: number;
  enabled: boolean;
};

function normalizeInput(input: SourceInput): NormalizedSourceInput {
  const sourceType = input.sourceType;
  const syncIntervalMinutes = input.syncIntervalMinutes ?? 60;
  if (!SYNC_INTERVALS.has(syncIntervalMinutes)) throw new Error('同步周期无效。');
  const enabled = input.enabled !== false;
  if (sourceType === 'url') {
    const url = validateRemoteSourceUrl(input.url ?? '');
    return {
      sourceType, url, geositeName: null, geoipName: null,
      name: input.name?.trim().slice(0, 120) || sourceNameFromUrl(url, 'Remote'),
      userAgent: normalizeUserAgent(input.userAgent),
      ruleOptimization: input.ruleOptimization === 'conservative' || input.ruleOptimization === 'aggressive' ? input.ruleOptimization : 'none',
      syncIntervalMinutes, enabled,
    };
  }
  const geoName = (sourceType === 'geosite' ? input.geositeName : input.geoipName)?.trim().toLowerCase() ?? '';
  if (!GEO_NAME.test(geoName)) throw new Error(`${sourceType === 'geosite' ? 'GeoSite' : 'GeoIP'} 名称无效。`);
  const url = sourceType === 'geosite'
    ? `https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/${encodeURIComponent(geoName)}`
    : `https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(geoName)}.txt`;
  return {
    sourceType, url,
    geositeName: sourceType === 'geosite' ? geoName : null,
    geoipName: sourceType === 'geoip' ? geoName : null,
    name: input.name?.trim().slice(0, 120) || `${sourceType === 'geosite' ? 'GeoSite' : 'GeoIP'} · ${geoName}`,
    userAgent: normalizeUserAgent(input.userAgent),
    ruleOptimization: 'none' as RuleOptimizationMode,
    syncIntervalMinutes, enabled,
  };
}

type SourceRow = {
  id: string; category_id: string; name: string; url: string; enabled: number; last_synced_at: string | null;
  last_status: RuleSource['lastStatus']; last_count: number; last_original_count: number; last_error: string | null;
  sync_interval_minutes: number; user_agent: string | null; source_type: 'url' | 'geosite' | 'geoip';
  geosite_name: string | null; geoip_name: string | null; rule_optimization: RuleOptimizationMode;
};

function mapSource(row: SourceRow): RuleSource {
  return {
    id: row.id, categoryId: row.category_id, name: row.name, url: row.url, enabled: row.enabled !== 0,
    lastSyncedAt: row.last_synced_at ?? undefined, lastStatus: row.last_status ?? 'pending',
    lastCount: row.last_count ?? 0, lastOriginalCount: row.last_original_count ?? 0,
    lastError: row.last_error ?? undefined, syncIntervalMinutes: row.sync_interval_minutes ?? 60,
    userAgent: row.user_agent ?? undefined, sourceType: row.source_type ?? 'url',
    geositeName: row.geosite_name ?? undefined, geoipName: row.geoip_name ?? undefined,
    ruleOptimization: row.rule_optimization ?? 'none',
  };
}

export async function listSources(env: Env, categoryId: string) {
  const rows = await env.DB.prepare('SELECT * FROM category_sources WHERE category_id = ? ORDER BY created_at ASC').bind(categoryId).all<SourceRow>();
  return (rows.results ?? []).map(mapSource);
}

export async function getSource(env: Env, sourceId: string, categoryId?: string) {
  const row = categoryId
    ? await env.DB.prepare('SELECT * FROM category_sources WHERE id = ? AND category_id = ?').bind(sourceId, categoryId).first<SourceRow>()
    : await env.DB.prepare('SELECT * FROM category_sources WHERE id = ?').bind(sourceId).first<SourceRow>();
  return row ? mapSource(row) : null;
}

export async function previewSource(env: Env, input: SourceInput) {
  return previewSourceRules(env, normalizeInput(input));
}

export async function createSource(env: Env, categoryId: string, input: SourceInput) {
  const category = await env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(categoryId).first();
  if (!category) throw new Error('分类不存在。');
  const source = normalizeInput(input);
  const duplicate = await env.DB.prepare('SELECT id FROM category_sources WHERE category_id = ? AND url = ?').bind(categoryId, source.url).first();
  if (duplicate) throw new Error('该来源已存在。');
  const sourceId = id('src');
  const timestamp = now();
  await env.DB.prepare(`INSERT INTO category_sources
    (id, category_id, name, url, enabled, last_status, sync_interval_minutes, user_agent, source_type,
     geosite_name, geoip_name, rule_optimization, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(sourceId, categoryId, source.name, source.url, source.enabled ? 1 : 0, source.syncIntervalMinutes,
      source.userAgent, source.sourceType, source.geositeName, source.geoipName, source.ruleOptimization, timestamp, timestamp).run();
  return getSource(env, sourceId);
}

export async function updateSource(env: Env, sourceId: string, input: SourceInput) {
  const current = await getSource(env, sourceId);
  if (!current) throw new Error('来源不存在。');
  const source = normalizeInput(input);
  const duplicate = await env.DB.prepare('SELECT id FROM category_sources WHERE category_id = ? AND url = ? AND id <> ?')
    .bind(current.categoryId, source.url, sourceId).first();
  if (duplicate) throw new Error('该来源已存在。');
  await env.DB.prepare(`UPDATE category_sources SET name = ?, url = ?, enabled = ?, sync_interval_minutes = ?,
    user_agent = ?, source_type = ?, geosite_name = ?, geoip_name = ?, rule_optimization = ?, updated_at = ? WHERE id = ?`)
    .bind(source.name, source.url, source.enabled ? 1 : 0, source.syncIntervalMinutes, source.userAgent,
      source.sourceType, source.geositeName, source.geoipName, source.ruleOptimization, now(), sourceId).run();
  return getSource(env, sourceId);
}

export async function toggleSource(env: Env, sourceId: string, enabled: boolean) {
  const result = await env.DB.prepare('UPDATE category_sources SET enabled = ?, updated_at = ? WHERE id = ?').bind(enabled ? 1 : 0, now(), sourceId).run();
  if (!(result.changes ?? 0)) throw new Error('来源不存在。');
  return getSource(env, sourceId);
}

export async function deleteSource(env: Env, sourceId: string) {
  const source = await getSource(env, sourceId);
  if (!source) throw new Error('来源不存在。');
  const activeLease = await env.DB.prepare("SELECT owner_id FROM sync_leases WHERE resource_type = 'source' AND resource_id = ? AND expires_at > ?")
    .bind(sourceId, now()).first();
  if (activeLease) throw new Error('来源正在同步，暂时不能删除。');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rules WHERE source_id = ?').bind(sourceId),
    env.DB.prepare('DELETE FROM category_sources WHERE id = ?').bind(sourceId),
    env.DB.prepare('UPDATE categories SET updated_at = ? WHERE id = ?').bind(now(), source.categoryId),
  ]);
  return source;
}

export { syncSourceById };
export { validateRemoteSourceUrl };
