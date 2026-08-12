import type { Env } from '../types';
import type { DomainRule } from '../types/domain-rules';
import { parseBulkImport } from './parser';
import { id } from './slug';
import { getSettings, now } from './db';
import { loadGeositeRules } from './geosite';
import { compactRules } from './rule-compactor';
import { rewriteGithubUrl } from './github-mirror';
import { validateRemoteSourceUrl } from './remote-source-security';

type SourceRecord = { id: string; category_id: string; name: string; url: string; last_synced_at: string | null; sync_interval_minutes: number | null; user_agent: string | null; source_type: 'url' | 'geosite' | 'geoip' | null; geosite_name: string | null; geoip_name: string | null; rule_optimization: 'none' | 'conservative' | 'aggressive' | 'balanced' | null };
export type SyncResult = { sourceId: string; categoryId: string; name: string; ok: boolean; count: number; originalCount?: number; optimized?: boolean; error?: string; syncedAt: string };

const staleSourceError = '来源已删除或所属分类已变更，已取消同步';

export function isSourceDue(source: Pick<SourceRecord, 'last_synced_at' | 'sync_interval_minutes'>, force = false, nowMs = Date.now()) {
  if (force || !source.last_synced_at) return true;
  const lastSync = Date.parse(source.last_synced_at);
  return !Number.isFinite(lastSync) || nowMs - lastSync >= (source.sync_interval_minutes ?? 60) * 60_000;
}

function normalizeUpstreamText(text: string) {
  return text.split(/\r?\n/).map((line) => {
    let value = line.trim().replace(/^\uFEFF/, '');
    if (!value || /^(payload|rules|rule-providers)\s*:/i.test(value)) return '';
    value = value.replace(/^[-]\s*/, '').replace(/^['"]|['"]$/g, '').trim();
    value = value.replace(/^(HOST-SUFFIX|HOST-KEYWORD|HOST),/i, (type) => `${type.toUpperCase() === 'HOST' ? 'DOMAIN' : type.toUpperCase().replace('HOST', 'DOMAIN')},`);
    const parts = value.split(',').map((part) => part.trim());
    if (/^(DOMAIN|DOMAIN-SUFFIX|DOMAIN-KEYWORD|IP-CIDR|SRC-IP-CIDR|IP-ASN|DST-PORT|GEOSITE|GEOIP)$/i.test(parts[0]) && parts.length > 2) {
      value = `${parts[0]},${parts[1]}`;
    }
    return value;
  }).filter(Boolean).join('\n');
}

async function sourceStillExists(env: Env, source: SourceRecord) {
  return Boolean(await env.DB.prepare('SELECT 1 AS present FROM category_sources WHERE id = ? AND category_id = ? AND enabled = 1').bind(source.id, source.category_id).first());
}

function staleSourceResult(source: SourceRecord, syncedAt: string): SyncResult {
  return { sourceId: source.id, categoryId: source.category_id, name: source.name, ok: false, count: 0, error: staleSourceError, syncedAt };
}

function safeSyncError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : '同步失败';
  return message
    .replace(/([?&](?:token|key|auth|signature)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(authorization|cookie):\s*[^\s]+/gi, '$1: [redacted]')
    .slice(0, 500);
}

type PreviewSource = {
  sourceType: 'url' | 'geosite' | 'geoip';
  url: string;
  geositeName: string | null;
  geoipName: string | null;
  userAgent: string;
  ruleOptimization: 'none' | 'conservative' | 'aggressive';
};

async function fetchSourceRules(source: PreviewSource, githubMirrorUrl: string) {
  let text: string;
  if (source.sourceType === 'geosite' && source.geositeName) text = await loadGeositeRules(source.geositeName, githubMirrorUrl);
  else if (source.sourceType === 'geoip' && source.geoipName) {
    const textUrl = `https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(source.geoipName)}.txt`;
    const response = await fetch(rewriteGithubUrl(textUrl, githubMirrorUrl), { headers: { accept: 'text/plain' }, redirect: 'error' });
    if (!response.ok) throw new Error(`GeoIP ${source.geoipName} 返回 HTTP ${response.status}`);
    const networks = (await response.text()).split(/\s+/).map((value) => value.trim()).filter(Boolean);
    text = networks.map((network) => `IP-CIDR,${network}`).join('\n');
  } else {
    const requestUrl = validateRemoteSourceUrl(rewriteGithubUrl(source.url, githubMirrorUrl));
    const response = await fetch(requestUrl, { headers: {
      accept: 'text/plain, application/yaml, application/json;q=0.8',
      'user-agent': source.userAgent || 'clash-verge/v2.5.1',
    }, redirect: 'error' });
    if (!response.ok) throw new Error(`上游返回 HTTP ${response.status}`);
    text = await response.text();
  }
  if (text.length > 5_000_000) throw new Error('上游文件超过 5MB 限制');
  const preview = parseBulkImport(source.sourceType === 'geosite' || source.sourceType === 'geoip' ? text : normalizeUpstreamText(text), []);
  if (!preview.rules.length) throw new Error('未从上游识别出有效规则');
  const optimization = source.ruleOptimization;
  const optimized = source.sourceType === 'url' && (optimization === 'conservative' || optimization === 'aggressive');
  return {
    rules: optimized ? compactRules(preview.rules, optimization).rules : preview.rules,
    originalCount: preview.rules.length,
    optimized,
    invalidCount: preview.invalidValues.length,
  };
}

export async function previewSourceRules(env: Env, source: PreviewSource) {
  const { githubMirrorUrl } = await getSettings(env);
  const preview = await fetchSourceRules(source, githubMirrorUrl);
  return {
    count: preview.rules.length,
    originalCount: preview.originalCount,
    optimized: preview.optimized,
    invalidCount: preview.invalidCount,
    rules: preview.rules.slice(0, 20).map((rule) => ({ type: rule.type, value: rule.value })),
  };
}

async function syncSource(env: Env, source: SourceRecord, githubMirrorUrl: string): Promise<SyncResult> {
  const syncedAt = now();
  const ownerId = id('sync');
  const claimed = await env.DB.prepare(`INSERT OR IGNORE INTO sync_leases
    (resource_type, resource_id, owner_id, acquired_at, expires_at) VALUES ('source', ?, ?, ?, ?)`)
    .bind(source.id, ownerId, syncedAt, new Date(Date.now() + 15 * 60_000).toISOString()).run();
  if (!(claimed.changes ?? 0)) return { sourceId: source.id, categoryId: source.category_id, name: source.name, ok: false, count: 0, error: '任务正在执行', syncedAt };
  const stageId = id('stage');
  try {
    const preview = await fetchSourceRules({
      sourceType: source.source_type ?? 'url',
      url: source.url,
      geositeName: source.geosite_name,
      geoipName: source.geoip_name,
      userAgent: source.user_agent ?? 'clash-verge/v2.5.1',
      ruleOptimization: source.rule_optimization === 'balanced' ? 'aggressive' : source.rule_optimization ?? 'none',
    }, githubMirrorUrl);
    const syncedRules = preview.rules;
    if (!await sourceStillExists(env, source)) return staleSourceResult(source, syncedAt);
    for (let offset = 0; offset < syncedRules.length; offset += 80) {
      await env.DB.batch(syncedRules.slice(offset, offset + 80).map((rule, index) => env.DB.prepare(
        `INSERT INTO source_rule_staging
          (sync_id, id, source_id, category_id, value, type, display_type, note, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(stageId, id('rule'), source.id, source.category_id, rule.value, rule.type, rule.displayType ?? '',
        rule.note ?? '', Date.now() + offset + index, rule.createdAt, rule.updatedAt)));
    }
    if (!await sourceStillExists(env, source)) return staleSourceResult(source, syncedAt);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM rules WHERE source_id = ?').bind(source.id),
      env.DB.prepare(`INSERT OR IGNORE INTO rules
        (id, category_id, value, type, display_type, note, enabled, sort_order, source_id, created_at, updated_at)
        SELECT id, category_id, value, type, display_type, note, 1, sort_order, source_id, created_at, updated_at
        FROM source_rule_staging WHERE sync_id = ?`).bind(stageId),
      env.DB.prepare('DELETE FROM source_rule_staging WHERE sync_id = ?').bind(stageId),
      env.DB.prepare("UPDATE category_sources SET last_synced_at = ?, last_status = 'success', last_count = ?, last_original_count = ?, last_error = NULL, updated_at = ? WHERE id = ? AND category_id = ?").bind(syncedAt, syncedRules.length, preview.originalCount, syncedAt, source.id, source.category_id),
      env.DB.prepare('UPDATE categories SET updated_at = ? WHERE id = ?').bind(syncedAt, source.category_id),
    ]);
    return { sourceId: source.id, categoryId: source.category_id, name: source.name, ok: true, count: syncedRules.length, originalCount: preview.originalCount, optimized: preview.optimized, syncedAt };
  } catch (cause) {
    const message = safeSyncError(cause);
    await env.DB.prepare('DELETE FROM source_rule_staging WHERE sync_id = ?').bind(stageId).run().catch(() => undefined);
    await env.DB.prepare("UPDATE category_sources SET last_synced_at = ?, last_status = 'error', last_error = ?, updated_at = ? WHERE id = ?").bind(syncedAt, message.slice(0, 500), syncedAt, source.id).run();
    return { sourceId: source.id, categoryId: source.category_id, name: source.name, ok: false, count: 0, error: message, syncedAt };
  } finally {
    await env.DB.prepare("DELETE FROM sync_leases WHERE resource_type = 'source' AND resource_id = ? AND owner_id = ?").bind(source.id, ownerId).run().catch(() => undefined);
  }
}

export async function syncRuleSources(env: Env, categoryId?: string, force = true) {
  const { githubMirrorUrl } = await getSettings(env);
  const query = categoryId
    ? env.DB.prepare('SELECT id, category_id, name, url, last_synced_at, sync_interval_minutes, user_agent, source_type, geosite_name, geoip_name, rule_optimization FROM category_sources WHERE enabled = 1 AND category_id = ?').bind(categoryId)
    : env.DB.prepare('SELECT id, category_id, name, url, last_synced_at, sync_interval_minutes, user_agent, source_type, geosite_name, geoip_name, rule_optimization FROM category_sources WHERE enabled = 1');
  const sources = await query.all<SourceRecord>();
  const results: SyncResult[] = [];
  const dueSources = (sources.results ?? []).filter((source) => isSourceDue(source, force));
  for (const source of dueSources) results.push(await syncSource(env, source, githubMirrorUrl));
  return results;
}

export async function syncSourceById(env: Env, sourceId: string) {
  const { githubMirrorUrl } = await getSettings(env);
  const source = await env.DB.prepare(`SELECT id, category_id, name, url, last_synced_at, sync_interval_minutes,
    user_agent, source_type, geosite_name, geoip_name, rule_optimization
    FROM category_sources WHERE id = ? AND enabled = 1`).bind(sourceId).first<SourceRecord>();
  if (!source) throw new Error('来源不存在或已停用。');
  return syncSource(env, source, githubMirrorUrl);
}

export async function retryFailedSources(env: Env) {
  const { githubMirrorUrl } = await getSettings(env);
  const rows = await env.DB.prepare(`SELECT id, category_id, name, url, last_synced_at, sync_interval_minutes,
    user_agent, source_type, geosite_name, geoip_name, rule_optimization
    FROM category_sources WHERE enabled = 1 AND last_status = 'error'`).all<SourceRecord>();
  const results: SyncResult[] = [];
  for (const source of rows.results ?? []) results.push(await syncSource(env, source, githubMirrorUrl));
  return results;
}
