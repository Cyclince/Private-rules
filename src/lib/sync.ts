import type { Env } from '../types';
import type { DomainRule } from '../types/domain-rules';
import { parseBulkImport } from './parser';
import { id } from './slug';
import { now } from './db';
import { loadGeositeRules } from './geosite';

type SourceRecord = { id: string; category_id: string; name: string; url: string; last_synced_at: string | null; sync_interval_minutes: number | null; user_agent: string | null; source_type: 'url' | 'geosite' | 'geoip' | null; geosite_name: string | null; geoip_name: string | null };
export type SyncResult = { sourceId: string; categoryId: string; name: string; ok: boolean; count: number; error?: string; syncedAt: string };

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

function ruleStatement(env: Env, source: SourceRecord, rule: DomainRule, index: number) {
  return env.DB.prepare(
    'INSERT OR IGNORE INTO rules (id, category_id, value, type, display_type, note, enabled, sort_order, source_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)',
  ).bind(id('rule'), source.category_id, rule.value, rule.type, rule.displayType ?? '', rule.note ?? '', Date.now() + index, source.id, rule.createdAt, rule.updatedAt);
}

async function syncSource(env: Env, source: SourceRecord): Promise<SyncResult> {
  const syncedAt = now();
  try {
    let text: string;
    if (source.source_type === 'geosite' && source.geosite_name) text = await loadGeositeRules(source.geosite_name);
    else if (source.source_type === 'geoip' && source.geoip_name) {
      const textUrl = `https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(source.geoip_name)}.txt`;
      const response = await fetch(textUrl, { headers: { accept: 'text/plain' } });
      if (!response.ok) throw new Error(`GeoIP ${source.geoip_name} 返回 HTTP ${response.status}`);
      const networks = (await response.text()).split(/\s+/).map((value) => value.trim()).filter(Boolean);
      text = networks.map((network) => `IP-CIDR,${network}`).join('\n');
    }
    else {
      const response = await fetch(source.url, { headers: {
        accept: 'text/plain, application/yaml, application/json;q=0.8',
        'user-agent': source.user_agent || 'clash-verge/v2.5.1',
      } });
      if (!response.ok) throw new Error(`上游返回 HTTP ${response.status}`);
      text = await response.text();
    }
    if (text.length > 5_000_000) throw new Error('上游文件超过 5MB 限制');
    const preview = parseBulkImport(source.source_type === 'geosite' || source.source_type === 'geoip' ? text : normalizeUpstreamText(text), []);
    if (!preview.rules.length) throw new Error('未从上游识别出有效规则');
    await env.DB.prepare('DELETE FROM rules WHERE source_id = ?').bind(source.id).run();
    for (let offset = 0; offset < preview.rules.length; offset += 80) {
      await env.DB.batch(preview.rules.slice(offset, offset + 80).map((rule, index) => ruleStatement(env, source, rule, offset + index)));
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE category_sources SET last_synced_at = ?, last_status = 'success', last_count = ?, last_error = NULL, updated_at = ? WHERE id = ?").bind(syncedAt, preview.rules.length, syncedAt, source.id),
      env.DB.prepare('UPDATE categories SET updated_at = ? WHERE id = ?').bind(syncedAt, source.category_id),
    ]);
    return { sourceId: source.id, categoryId: source.category_id, name: source.name, ok: true, count: preview.rules.length, syncedAt };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '同步失败';
    await env.DB.prepare("UPDATE category_sources SET last_synced_at = ?, last_status = 'error', last_error = ?, updated_at = ? WHERE id = ?").bind(syncedAt, message.slice(0, 500), syncedAt, source.id).run();
    return { sourceId: source.id, categoryId: source.category_id, name: source.name, ok: false, count: 0, error: message, syncedAt };
  }
}

export async function syncRuleSources(env: Env, categoryId?: string, force = true) {
  const query = categoryId
    ? env.DB.prepare('SELECT id, category_id, name, url, last_synced_at, sync_interval_minutes, user_agent, source_type, geosite_name, geoip_name FROM category_sources WHERE enabled = 1 AND category_id = ?').bind(categoryId)
    : env.DB.prepare('SELECT id, category_id, name, url, last_synced_at, sync_interval_minutes, user_agent, source_type, geosite_name, geoip_name FROM category_sources WHERE enabled = 1');
  const sources = await query.all<SourceRecord>();
  const results: SyncResult[] = [];
  const dueSources = (sources.results ?? []).filter((source) => isSourceDue(source, force));
  for (const source of dueSources) results.push(await syncSource(env, source));
  return results;
}
