import type { BackupRuleSource, DomainRule, DomainRuleType, ManualRuleOptimizationPreview, RuleCategory, RuleConflict, RuleOptimizationMode, RuleSettings, RuleSource, RulesBackupData, RulesData } from '../types/domain-rules';
import { UPSTREAM_RULE_PREVIEW_LIMIT } from '../types/domain-rules';
import type { Env } from '../types';
import { normalizeGithubMirrorUrl, sourceNameFromSubscriptionUrl } from './github-mirror';
import { parseRuleInput } from './parser';
import { RULE_TYPES } from './rule-types';
import { RuleConflictIndex } from '../domain/rules/conflicts';
import { id, slugify, validateCategoryName } from './slug';
import { backupSchema, describeIssues } from '../shared/schemas/backup';
import { AppError } from '../shared/errors';

const LEGACY_RULE_TYPES: ReadonlySet<string> = new Set<DomainRuleType>(RULE_TYPES);

function isLegacyRuleType(type: string): type is DomainRuleType {
  return LEGACY_RULE_TYPES.has(type);
}

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  description: string | null;
  note: string | null;
  sort_order: number | null;
  enabled: number | null;
  created_at: string;
  updated_at: string;
  public_links_enabled: number | null;
  token_links_enabled: number | null;
};

type RuleRow = {
  id: string;
  category_id: string;
  value: string;
  type: DomainRule['type'];
  display_type: string | null;
  note: string | null;
  enabled: number | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
  source_id: string | null;
  source_name?: string | null;
  source_type?: 'url' | 'geosite' | 'geoip' | null;
  source_enabled?: number | null;
  category_name?: string | null;
  category_description?: string | null;
};

type RuleCountRow = {
  category_id: string;
  rule_count: number;
  enabled_rule_count: number;
  manual_rule_count: number;
  url_rule_count: number;
  geo_rule_count: number;
};

type SourceRow = {
  id: string; category_id: string; name: string; url: string; enabled: number | null;
  last_synced_at: string | null; last_status: RuleSource['lastStatus'] | null;
  last_count: number | null; last_error: string | null;
  last_original_count: number | null;
  sync_interval_minutes: number | null;
  user_agent: string | null;
  source_type: 'url' | 'geosite' | 'geoip' | null;
  geosite_name: string | null;
  geoip_name: string | null;
  rule_optimization: RuleOptimizationMode | 'balanced' | null;
};

const defaultSettings: RuleSettings = {
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

export function now() {
  return new Date().toISOString();
}

export function sourceNameFromUrl(value: string, fallback = '') {
  return sourceNameFromSubscriptionUrl(value, fallback);
}

function sourceFromRow(row: SourceRow): RuleSource {
  const name = (row.source_type ?? 'url') === 'url' ? sourceNameFromUrl(row.url, row.name) : row.name;
  return { id: row.id, categoryId: row.category_id, name, url: row.url, enabled: row.enabled !== 0,
    lastSyncedAt: row.last_synced_at ?? undefined, lastStatus: row.last_status ?? 'pending',
    lastCount: row.last_count ?? 0, lastOriginalCount: row.last_original_count ?? row.last_count ?? 0, lastError: row.last_error ?? undefined, syncIntervalMinutes: row.sync_interval_minutes ?? 60,
    userAgent: row.user_agent ?? 'clash-verge/v2.5.1',
    sourceType: row.source_type ?? 'url', geositeName: row.geosite_name ?? undefined, geoipName: row.geoip_name ?? undefined,
    ruleOptimization: row.rule_optimization === 'balanced' ? 'aggressive' : row.rule_optimization ?? 'none' };
}

function categoryFromRow(row: CategoryRow, rules: DomainRule[], sources: RuleSource[], counts?: RuleCountRow): RuleCategory {
  const uniqueRules = new Map<string, DomainRule>();
  for (const rule of rules) {
    const key = `${rule.type}:${rule.value}`.toLowerCase();
    const existing = uniqueRules.get(key);
    if (!existing || (!rule.sourceId && existing.sourceId)) uniqueRules.set(key, rule);
  }
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: row.icon ?? undefined,
    description: row.description ?? undefined,
    note: row.note ?? undefined,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rules: [...uniqueRules.values()],
    publicLinksEnabled: row.public_links_enabled !== 0,
    tokenLinksEnabled: row.token_links_enabled !== 0,
    sources,
    lastSyncedAt: sources.reduce<string | undefined>((latest, source) => !latest || (source.lastSyncedAt ?? '') > latest ? source.lastSyncedAt : latest, undefined),
    syncIntervalMinutes: sources[0]?.syncIntervalMinutes ?? 60,
    ruleCount: counts?.rule_count ?? uniqueRules.size,
    enabledRuleCount: counts?.enabled_rule_count ?? [...uniqueRules.values()].filter((rule) => rule.enabled).length,
    manualRuleCount: counts?.manual_rule_count ?? [...uniqueRules.values()].filter((rule) => !rule.sourceId).length,
    urlRuleCount: counts?.url_rule_count ?? [...uniqueRules.values()].filter((rule) => rule.sourceType === 'url').length,
    geoRuleCount: counts?.geo_rule_count ?? [...uniqueRules.values()].filter((rule) => rule.sourceId && rule.sourceType !== 'url').length,
  };
}

function ruleFromRow(row: RuleRow): DomainRule {
  return {
    id: row.id,
    categoryId: row.category_id,
    value: row.value,
    type: row.type,
    displayType: row.display_type ?? undefined,
    note: row.note ?? undefined,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceId: row.source_id ?? undefined,
    sourceName: row.source_name ?? undefined,
    sourceType: row.source_type ?? undefined,
    sourceEnabled: row.source_id ? row.source_enabled !== 0 : undefined,
    enabled: row.enabled !== 0 && (!row.source_id || row.source_enabled !== 0),
  };
}

const deduplicatedRuleCte = `WITH ranked_rules AS (
  SELECT r.*, s.name AS source_name, COALESCE(s.source_type, 'url') AS source_type, COALESCE(s.enabled, 1) AS source_enabled,
    c.name AS category_name, c.description AS category_description,
    ROW_NUMBER() OVER (
      PARTITION BY r.category_id, LOWER(r.type), LOWER(r.value)
      ORDER BY CASE WHEN r.source_id IS NULL THEN 0 ELSE 1 END, r.sort_order ASC, r.created_at ASC
    ) AS duplicate_rank
  FROM rules r
  LEFT JOIN category_sources s ON s.id = r.source_id
  LEFT JOIN categories c ON c.id = r.category_id
)`;

async function getRuleCounts(env: Env) {
  const rows = await env.DB.prepare(`${deduplicatedRuleCte}
    SELECT category_id,
      COUNT(*) AS rule_count,
      SUM(CASE WHEN enabled <> 0 AND (source_id IS NULL OR source_enabled <> 0) THEN 1 ELSE 0 END) AS enabled_rule_count,
      SUM(CASE WHEN source_id IS NULL THEN 1 ELSE 0 END) AS manual_rule_count,
      SUM(CASE WHEN source_id IS NOT NULL AND source_type = 'url' THEN 1 ELSE 0 END) AS url_rule_count,
      SUM(CASE WHEN source_id IS NOT NULL AND source_type <> 'url' THEN 1 ELSE 0 END) AS geo_rule_count
    FROM ranked_rules WHERE duplicate_rank = 1 GROUP BY category_id`).all<RuleCountRow>();
  return new Map((rows.results ?? []).map((row) => [row.category_id, row]));
}

export async function getSettings(env: Env): Promise<RuleSettings> {
  const rows = await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string | null }>();
  const settings = { ...defaultSettings };
  for (const row of rows.results ?? []) {
    if (row.key === 'baseUrl') settings.baseUrl = row.value ?? '';
    if (row.key === 'policyName') settings.policyName = row.value ?? '';
    if (row.key === 'githubMirrorUrl') settings.githubMirrorUrl = row.value ?? '';
    if (row.key === 'publicLinksEnabled') settings.publicLinksEnabled = row.value !== 'false';
    if (row.key === 'tokenLinksEnabled') settings.tokenLinksEnabled = row.value !== 'false';
    if (row.key === 'customIconPackUrls') {
      try { settings.customIconPackUrls = JSON.parse(row.value || '[]') as string[]; } catch { settings.customIconPackUrls = []; }
    }
    if (row.key === 'customIconPackNames') {
      try { settings.customIconPackNames = JSON.parse(row.value || '{}') as Record<string, string>; } catch { settings.customIconPackNames = {}; }
    }
    if (row.key === 'iconPackAutoUpdate') settings.iconPackAutoUpdate = row.value !== 'false';
    if (row.key === 'iconPackUpdateIntervalHours') settings.iconPackUpdateIntervalHours = Math.max(1, Number(row.value) || 24);
    if (row.key === 'iconPackLastUpdatedAt') settings.iconPackLastUpdatedAt = row.value ?? '';
  }
  return settings;
}

function resolveSettings(current: RuleSettings, input: Partial<RuleSettings> = {}): RuleSettings {
  return {
    baseUrl: input.baseUrl ?? current.baseUrl,
    policyName: input.policyName ?? current.policyName,
    githubMirrorUrl: input.githubMirrorUrl === undefined ? current.githubMirrorUrl : normalizeGithubMirrorUrl(input.githubMirrorUrl),
    publicLinksEnabled: input.publicLinksEnabled ?? current.publicLinksEnabled,
    tokenLinksEnabled: input.tokenLinksEnabled ?? current.tokenLinksEnabled,
    customIconPackUrls: input.customIconPackUrls ?? current.customIconPackUrls,
    customIconPackNames: input.customIconPackNames ?? current.customIconPackNames,
    iconPackAutoUpdate: input.iconPackAutoUpdate ?? current.iconPackAutoUpdate,
    iconPackUpdateIntervalHours: Math.max(1, Math.min(720, Number(input.iconPackUpdateIntervalHours ?? current.iconPackUpdateIntervalHours) || 24)),
    iconPackLastUpdatedAt: input.iconPackLastUpdatedAt ?? current.iconPackLastUpdatedAt,
  };
}

function settingsStatements(env: Env, settings: RuleSettings) {
  return Object.entries(settings).map(([key, value]) =>
    env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, typeof value === 'object' ? JSON.stringify(value) : String(value)),
  );
}

export async function saveSettings(env: Env, input: Partial<RuleSettings>) {
  const next = resolveSettings(await getSettings(env), input);
  await env.DB.batch(settingsStatements(env, next));
  return next;
}

export async function getRulesData(env: Env): Promise<RulesData> {
  const [categoryRows, ruleRows, sourceRows, settings, apiKeyRow] = await Promise.all([
    env.DB.prepare('SELECT * FROM categories ORDER BY sort_order ASC, created_at ASC').all<CategoryRow>(),
    env.DB.prepare('SELECT * FROM rules ORDER BY sort_order ASC, created_at ASC').all<RuleRow>(),
    env.DB.prepare('SELECT * FROM category_sources ORDER BY created_at ASC').all<SourceRow>(),
    getSettings(env),
    env.DB.prepare('SELECT id FROM api_keys LIMIT 1').first<{ id: string }>(),
  ]);

  const rulesByCategory = new Map<string, DomainRule[]>();
  for (const row of ruleRows.results ?? []) {
    const list = rulesByCategory.get(row.category_id) ?? [];
    list.push(ruleFromRow(row));
    rulesByCategory.set(row.category_id, list);
  }

  const sources = (sourceRows.results ?? []).map(sourceFromRow);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  for (const list of rulesByCategory.values()) for (const rule of list) if (rule.sourceId) {
    const source = sourceById.get(rule.sourceId);
    rule.sourceName = source?.name;
    rule.sourceType = source?.sourceType ?? 'url';
    rule.sourceEnabled = source?.enabled;
    if (source?.enabled === false) rule.enabled = false;
  }
  const categories = (categoryRows.results ?? []).map((row) => categoryFromRow(row, rulesByCategory.get(row.id) ?? [], sources.filter((source) => source.categoryId === row.id)));
  const updatedAt = categories.reduce((latest, category) => (category.updatedAt > latest ? category.updatedAt : latest), '');

  return {
    version: 1,
    settings,
    meta: {
      d1Ready: true,
      adminPasswordConfigured: Boolean(env.ADMIN_PASSWORD),
      ruleTokenConfigured: Boolean(env.RULE_TOKEN),
      sessionSecretConfigured: Boolean(env.SESSION_SECRET),
      apiKeyConfigured: Boolean(apiKeyRow?.id),
    },
    categories,
    updatedAt: updatedAt || now(),
    lastSyncedAt: sources.reduce<string | undefined>((latest, source) => !latest || (source.lastSyncedAt ?? '') > latest ? source.lastSyncedAt : latest, undefined),
  };
}

/**
 * Lightweight payload for the admin UI. Custom rules stay editable, while
 * mirrored upstream rules are capped per category until the user explicitly
 * expands a list or starts a server-side search.
 */
export async function getRulesOverview(env: Env, upstreamPreviewLimit = UPSTREAM_RULE_PREVIEW_LIMIT): Promise<RulesData> {
  const [categoryRows, manualRuleRows, upstreamRuleRows, sourceRows, settings, apiKeyRow, countsByCategory] = await Promise.all([
    env.DB.prepare('SELECT * FROM categories ORDER BY sort_order ASC, created_at ASC').all<CategoryRow>(),
    env.DB.prepare('SELECT * FROM rules WHERE source_id IS NULL ORDER BY sort_order ASC, created_at ASC').all<RuleRow>(),
    env.DB.prepare(`SELECT id, category_id, value, type, display_type, note, enabled, sort_order, created_at, updated_at, source_id
      FROM (
        SELECT r.*, ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY sort_order ASC, created_at ASC) AS preview_row
        FROM rules r WHERE source_id IS NOT NULL
      ) WHERE preview_row <= ? ORDER BY category_id, sort_order ASC, created_at ASC`).bind(upstreamPreviewLimit).all<RuleRow>(),
    env.DB.prepare('SELECT * FROM category_sources ORDER BY created_at ASC').all<SourceRow>(),
    getSettings(env),
    env.DB.prepare('SELECT id FROM api_keys LIMIT 1').first<{ id: string }>(),
    getRuleCounts(env),
  ]);

  const sources = (sourceRows.results ?? []).map(sourceFromRow);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const rulesByCategory = new Map<string, DomainRule[]>();
  for (const row of [...(manualRuleRows.results ?? []), ...(upstreamRuleRows.results ?? [])]) {
    const rule = ruleFromRow(row);
    const source = rule.sourceId ? sourceById.get(rule.sourceId) : undefined;
    if (source) {
      rule.sourceName = source.name;
      rule.sourceType = source.sourceType ?? 'url';
      rule.sourceEnabled = source.enabled;
      if (!source.enabled) rule.enabled = false;
    }
    const list = rulesByCategory.get(row.category_id) ?? [];
    list.push(rule);
    rulesByCategory.set(row.category_id, list);
  }

  const categories = (categoryRows.results ?? []).map((row) => categoryFromRow(
    row,
    rulesByCategory.get(row.id) ?? [],
    sources.filter((source) => source.categoryId === row.id),
    countsByCategory.get(row.id),
  ));
  const updatedAt = categories.reduce((latest, category) => category.updatedAt > latest ? category.updatedAt : latest, '');
  return {
    version: 1,
    settings,
    meta: {
      d1Ready: true,
      adminPasswordConfigured: Boolean(env.ADMIN_PASSWORD),
      ruleTokenConfigured: Boolean(env.RULE_TOKEN),
      sessionSecretConfigured: Boolean(env.SESSION_SECRET),
      apiKeyConfigured: Boolean(apiKeyRow?.id),
    },
    categories,
    updatedAt: updatedAt || now(),
    lastSyncedAt: sources.reduce<string | undefined>((latest, source) => !latest || (source.lastSyncedAt ?? '') > latest ? source.lastSyncedAt : latest, undefined),
  };
}

export type RuleSourceFilter = 'manual' | 'upstream' | 'url' | 'geo';

export async function listRules(env: Env, options: {
  categoryId?: string;
  query?: string;
  source?: RuleSourceFilter;
  limit?: number;
} = {}) {
  const conditions = ['duplicate_rank = 1'];
  const bindings: unknown[] = [];
  if (options.categoryId) {
    conditions.push('category_id = ?');
    bindings.push(options.categoryId);
  }
  if (options.source === 'manual') conditions.push('source_id IS NULL');
  if (options.source === 'upstream') conditions.push('source_id IS NOT NULL');
  if (options.source === 'url') conditions.push("source_id IS NOT NULL AND source_type = 'url'");
  if (options.source === 'geo') conditions.push("source_id IS NOT NULL AND source_type <> 'url'");
  const query = options.query?.trim();
  if (query) {
    conditions.push(`(LOWER(value) LIKE LOWER(?) ESCAPE '\\' OR LOWER(COALESCE(note, '')) LIKE LOWER(?) ESCAPE '\\'
      OR LOWER(type) LIKE LOWER(?) ESCAPE '\\' OR LOWER(COALESCE(display_type, '')) LIKE LOWER(?) ESCAPE '\\'
      OR LOWER(COALESCE(source_name, '')) LIKE LOWER(?) ESCAPE '\\' OR LOWER(COALESCE(category_name, '')) LIKE LOWER(?) ESCAPE '\\'
      OR LOWER(COALESCE(category_description, '')) LIKE LOWER(?) ESCAPE '\\')`);
    const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    bindings.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }
  const limit = options.limit === undefined ? UPSTREAM_RULE_PREVIEW_LIMIT : Math.max(0, Math.min(options.limit, 100_000));
  const statement = env.DB.prepare(`${deduplicatedRuleCte}
    SELECT id, category_id, value, type, display_type, note, enabled, sort_order, created_at, updated_at,
      source_id, source_name, source_type, source_enabled
    FROM ranked_rules WHERE ${conditions.join(' AND ')}
    ORDER BY category_id, sort_order ASC, created_at ASC${limit ? ' LIMIT ?' : ''}`);
  if (limit) bindings.push(limit);
  const rows = await statement.bind(...bindings).all<RuleRow>();
  return (rows.results ?? []).map(ruleFromRow);
}

export async function getBackupData(env: Env): Promise<RulesBackupData> {
  const data = await getRulesData(env);
  const { meta: _meta, lastSyncedAt: _lastSyncedAt, categories, ...backup } = data;
  return {
    ...backup,
    categories: categories.map((category) => {
      const { lastSyncedAt: _categoryLastSyncedAt, syncIntervalMinutes: _syncIntervalMinutes, sources, rules, ...categoryBackup } = category;
      return {
        ...categoryBackup,
        rules: rules.filter((rule) => !rule.sourceId),
        sources: sources?.map((source): BackupRuleSource => {
          const common = { sourceType: source.sourceType ?? 'url', enabled: source.enabled, syncIntervalMinutes: source.syncIntervalMinutes };
          if (common.sourceType === 'geosite') return { ...common, geositeName: source.geositeName };
          if (common.sourceType === 'geoip') return { ...common, geoipName: source.geoipName };
          return { ...common, url: source.url, userAgent: source.userAgent, ruleOptimization: source.ruleOptimization ?? 'none' };
        }),
      };
    }),
  };
}

type CategoryInput = Partial<RuleCategory> & { sourceUrls?: string[]; geositeNames?: string[]; geoipNames?: string[]; syncIntervalMinutes?: number; userAgent?: string; ruleOptimization?: RuleOptimizationMode };

const DEFAULT_USER_AGENT = 'clash-verge/v2.5.1';

export function normalizeUserAgent(value?: string | null) {
  const normalized = value?.trim() || DEFAULT_USER_AGENT;
  if (normalized.length > 256 || /[\r\n\0]/.test(normalized)) throw new Error('User-Agent 格式不正确');
  return normalized;
}

export async function createCategory(env: Env, input: CategoryInput) {
  const timestamp = now();
  const name = input.name?.trim() ?? '';
  const nameError = validateCategoryName(name);
  if (nameError) throw new Error(nameError);
  const categoryId = id('cat');
  const slug = slugify(input.slug?.trim() || name);
  const sortOrder = input.sortOrder ?? Date.now();
  const hasUpstream = Boolean(input.sourceUrls?.length || input.geositeNames?.length || input.geoipNames?.length);
  const tokenAccess = input.tokenLinksEnabled ?? !hasUpstream;
  const publicAccess = !tokenAccess && (input.publicLinksEnabled ?? hasUpstream);

  await env.DB.prepare(
    'INSERT INTO categories (id, name, slug, icon, description, note, sort_order, enabled, public_links_enabled, token_links_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      categoryId,
      name,
      slug,
      input.icon?.trim() || name.slice(0, 2).toUpperCase(),
      input.description?.trim() || '',
      input.note?.trim() || '',
      sortOrder,
      input.enabled === false ? 0 : 1,
      publicAccess ? 1 : 0,
      tokenAccess ? 1 : 0,
      timestamp,
      timestamp,
    )
    .run();
  if (input.sourceUrls?.length || input.geositeNames?.length || input.geoipNames?.length) await replaceCategorySources(env, categoryId, input.sourceUrls ?? [], input.syncIntervalMinutes ?? 60, input.geositeNames ?? [], input.geoipNames ?? [], input.userAgent, input.ruleOptimization);
  return getRulesOverview(env);
}

export async function updateCategory(env: Env, categoryId: string, input: CategoryInput) {
  if (input.sourceUrls || input.geositeNames || input.geoipNames) {
    throw new Error('来源必须通过来源级 Use Case 修改，不能整体替换分类来源。');
  }
  const current = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(categoryId).first<CategoryRow>();
  if (!current) throw new Error('分类不存在。');
  const name = input.name?.trim() || current.name;
  const nameError = validateCategoryName(name);
  if (nameError) throw new Error(nameError);
  const timestamp = now();
  let tokenAccess = input.tokenLinksEnabled === undefined ? current.token_links_enabled !== 0 : input.tokenLinksEnabled;
  let publicAccess = input.publicLinksEnabled === undefined ? current.public_links_enabled !== 0 : input.publicLinksEnabled;
  if (tokenAccess) publicAccess = false;
  await env.DB.prepare(
    'UPDATE categories SET name = ?, slug = ?, icon = ?, description = ?, note = ?, sort_order = ?, enabled = ?, public_links_enabled = ?, token_links_enabled = ?, updated_at = ? WHERE id = ?',
  )
    .bind(
      name,
      (input.slug?.trim() || name !== current.name) ? slugify(input.slug?.trim() || name) : current.slug,
      input.icon ?? current.icon,
      input.description ?? current.description,
      input.note ?? current.note,
      input.sortOrder ?? current.sort_order ?? 0,
      input.enabled === undefined ? current.enabled ?? 1 : input.enabled ? 1 : 0,
      publicAccess ? 1 : 0,
      tokenAccess ? 1 : 0,
      timestamp,
      categoryId,
    )
    .run();
  return getRulesOverview(env);
}

export async function replaceCategorySources(env: Env, categoryId: string, sourceUrls: string[], syncIntervalMinutes = 60, geositeNames: string[] = [], geoipNames: string[] = [], userAgent?: string | null, ruleOptimization: RuleOptimizationMode = 'none') {
  const normalizedUserAgent = normalizeUserAgent(userAgent);
  const normalizedRuleOptimization: RuleOptimizationMode = ruleOptimization === 'conservative' || ruleOptimization === 'aggressive' ? ruleOptimization : 'none';
  const urls = [...new Set(sourceUrls.map((url) => url.trim()).filter((url) => /^https?:\/\//i.test(url)))];
  const geosites = [...new Set(geositeNames.map((name) => name.trim().toLowerCase()).filter((name) => /^[a-z0-9_!@.-]+$/i.test(name)))];
  const geositeUrls = geosites.map((name) => `https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/${encodeURIComponent(name)}`);
  const geoips = [...new Set(geoipNames.map((name) => name.trim().toLowerCase()).filter((name) => /^[a-z0-9_!-]+$/i.test(name)))];
  const geoipUrls = geoips.map((name) => `https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(name)}.txt`);
  const desiredUrls = [...urls, ...geositeUrls, ...geoipUrls];
  const existing = await env.DB.prepare('SELECT * FROM category_sources WHERE category_id = ?').bind(categoryId).all<SourceRow>();
  const existingByUrl = new Map((existing.results ?? []).map((source) => [source.url, source]));
  const removedSourceIds = (existing.results ?? []).filter((source) => !desiredUrls.includes(source.url)).map((source) => source.id);
  const timestamp = now();
  await env.DB.batch([
    ...removedSourceIds.map((sourceId) => env.DB.prepare('DELETE FROM rules WHERE source_id = ?').bind(sourceId)),
    ...urls.filter((url) => !existingByUrl.has(url)).map((url, index) => env.DB.prepare(
      "INSERT INTO category_sources (id, category_id, name, url, enabled, last_status, sync_interval_minutes, user_agent, source_type, rule_optimization, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'url', ?, ?, ?)",
    ).bind(id('src'), categoryId, sourceNameFromUrl(url, `来源 ${index + 1}`), url, 'pending', syncIntervalMinutes, normalizedUserAgent, normalizedRuleOptimization, timestamp, timestamp)),
    ...geosites.filter((name) => !existingByUrl.has(`https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/${encodeURIComponent(name)}`)).map((name) => env.DB.prepare(
      "INSERT INTO category_sources (id, category_id, name, url, enabled, last_status, sync_interval_minutes, source_type, geosite_name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, 'geosite', ?, ?, ?)",
    ).bind(id('src'), categoryId, `GeoSite · ${name}`, `https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/${encodeURIComponent(name)}`, 'pending', syncIntervalMinutes, name, timestamp, timestamp)),
    ...geoips.filter((name) => !existingByUrl.has(`https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(name)}.txt`)).map((name) => env.DB.prepare(
      "INSERT INTO category_sources (id, category_id, name, url, enabled, last_status, sync_interval_minutes, source_type, geoip_name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, 'geoip', ?, ?, ?)",
    ).bind(id('src'), categoryId, `GeoIP · ${name}`, `https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(name)}.txt`, 'pending', syncIntervalMinutes, name, timestamp, timestamp)),
    ...desiredUrls.filter((url) => existingByUrl.has(url)).map((url) => env.DB.prepare("UPDATE category_sources SET sync_interval_minutes = ?, user_agent = CASE WHEN source_type = 'url' THEN ? ELSE user_agent END, rule_optimization = CASE WHEN source_type = 'url' THEN ? ELSE 'none' END, updated_at = ? WHERE category_id = ? AND url = ?").bind(syncIntervalMinutes, normalizedUserAgent, normalizedRuleOptimization, timestamp, categoryId, url)),
    env.DB.prepare(desiredUrls.length
      ? `DELETE FROM category_sources WHERE category_id = ? AND url NOT IN (${desiredUrls.map(() => '?').join(',')})`
      : 'DELETE FROM category_sources WHERE category_id = ?').bind(categoryId, ...desiredUrls),
  ]);
}

export async function deleteCategory(env: Env, categoryId: string) {
  await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(categoryId).run();
  return getRulesOverview(env);
}

const MANUAL_DOMAIN_RULE_TYPES = new Set<DomainRule['type']>(['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD']);

function normalizedDomainValue(value: string) {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

function manualDomainRuleCovers(covering: Pick<DomainRule, 'type' | 'value'>, candidate: Pick<DomainRule, 'type' | 'value'>) {
  if (!MANUAL_DOMAIN_RULE_TYPES.has(covering.type) || !MANUAL_DOMAIN_RULE_TYPES.has(candidate.type)) return false;
  const coveringValue = normalizedDomainValue(covering.value);
  const candidateValue = normalizedDomainValue(candidate.value);
  if (!coveringValue || !candidateValue) return false;
  if (covering.type === 'DOMAIN-KEYWORD') return candidateValue.includes(coveringValue);
  if (covering.type === 'DOMAIN-SUFFIX' && candidate.type !== 'DOMAIN-KEYWORD') {
    return candidateValue === coveringValue || candidateValue.endsWith(`.${coveringValue}`);
  }
  return covering.type === 'DOMAIN' && candidate.type === 'DOMAIN' && candidateValue === coveringValue;
}

function manualDomainRulePriority(rule: DomainRule) {
  const value = normalizedDomainValue(rule.value);
  const typePriority = rule.type === 'DOMAIN-KEYWORD' ? 0 : rule.type === 'DOMAIN-SUFFIX' ? 1 : 2;
  const scopeSize = rule.type === 'DOMAIN-SUFFIX' ? value.split('.').length : value.length;
  return [typePriority, scopeSize, rule.sortOrder ?? 0, rule.createdAt, rule.id] as const;
}

function compareManualDomainRulePriority(left: DomainRule, right: DomainRule) {
  const a = manualDomainRulePriority(left);
  const b = manualDomainRulePriority(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) continue;
    return a[index]! < b[index]! ? -1 : 1;
  }
  return 0;
}

export async function previewManualRuleOptimization(env: Env): Promise<ManualRuleOptimizationPreview> {
  const rows = await env.DB.prepare(`SELECT r.*, c.name AS category_name
    FROM rules r JOIN categories c ON c.id = r.category_id
    WHERE r.source_id IS NULL AND r.type IN ('DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD')
    ORDER BY r.category_id, r.enabled DESC, r.sort_order ASC, r.created_at ASC`).all<RuleRow>();
  const categoryNames = new Map<string, string>();
  const grouped = new Map<string, DomainRule[]>();
  for (const row of rows.results ?? []) {
    const rule = ruleFromRow(row);
    categoryNames.set(row.category_id, row.category_name ?? '未知分类');
    const key = `${row.category_id}:${rule.enabled ? 'enabled' : 'disabled'}`;
    grouped.set(key, [...(grouped.get(key) ?? []), rule]);
  }
  const removals: ManualRuleOptimizationPreview['removals'] = [];
  for (const rules of grouped.values()) {
    const kept: DomainRule[] = [];
    for (const rule of [...rules].sort(compareManualDomainRulePriority)) {
      const covering = kept.find((candidate) => manualDomainRuleCovers(candidate, rule));
      if (!covering) {
        kept.push(rule);
        continue;
      }
      const duplicate = covering.type === rule.type && normalizedDomainValue(covering.value) === normalizedDomainValue(rule.value);
      removals.push({
        rule,
        keptRule: covering,
        categoryName: categoryNames.get(rule.categoryId ?? '') ?? '未知分类',
        reason: duplicate ? '与保留规则完全重复' : '已被范围更广的规则覆盖',
      });
    }
  }
  return {
    scanned: rows.results?.length ?? 0,
    remaining: (rows.results?.length ?? 0) - removals.length,
    affectedCategories: new Set(removals.map((item) => item.rule.categoryId)).size,
    removals,
  };
}

export async function optimizeManualRules(env: Env) {
  const preview = await previewManualRuleOptimization(env);
  if (!preview.removals.length) return { preview, data: await getRulesOverview(env) };
  const removalsByCategory = new Map<string, string[]>();
  for (const { rule } of preview.removals) {
    const categoryId = rule.categoryId!;
    removalsByCategory.set(categoryId, [...(removalsByCategory.get(categoryId) ?? []), rule.id]);
  }
  for (const [categoryId, ruleIds] of removalsByCategory) {
    for (let offset = 0; offset < ruleIds.length; offset += 500) {
      const chunk = ruleIds.slice(offset, offset + 500);
      await env.DB.prepare(`DELETE FROM rules WHERE category_id = ? AND source_id IS NULL AND id IN (${chunk.map(() => '?').join(',')})`)
        .bind(categoryId, ...chunk).run();
    }
    await touchCategory(env, categoryId);
  }
  return { preview, data: await getRulesOverview(env) };
}

export async function createManualRuleConflictIndex(env: Env): Promise<RuleConflictIndex> {
  const rows = await env.DB.prepare(`SELECT r.id, r.category_id, r.value, r.type, c.name AS category_name
    FROM rules r JOIN categories c ON c.id = r.category_id
    WHERE r.source_id IS NULL`).all<RuleRow>();
  return new RuleConflictIndex(
    (rows.results ?? []).map((row) => ({
      id: row.id,
      categoryId: row.category_id,
      categoryName: row.category_name ?? '未知分类',
      value: row.value,
      type: row.type,
    })),
  );
}

export async function findRuleConflicts(env: Env, candidate: Pick<DomainRule, 'type' | 'value'>, excludeRuleId?: string): Promise<RuleConflict[]> {
  const index = await createManualRuleConflictIndex(env);
  return index.findConflicts(candidate, excludeRuleId);
}

export async function addRule(env: Env, categoryId: string, input: { value: string; type?: DomainRule['type']; note?: string; replaceConflicts?: boolean }) {
  const category = await env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(categoryId).first();
  if (!category) throw new Error('分类不存在。');
  const rule = parseRuleInput(input.value, input.type, input.note);
  const conflicts = await findRuleConflicts(env, rule);
  if (conflicts.length && !input.replaceConflicts) return { conflicts };
  if (conflicts.length) {
    await env.DB.batch(conflicts.map((conflict) => env.DB.prepare('DELETE FROM rules WHERE id = ? AND source_id IS NULL').bind(conflict.id)));
  }
  await insertRule(env, categoryId, rule, Date.now());
  await touchCategory(env, categoryId);
  return { ...await getRulesOverview(env), replaced: conflicts.length };
}

export async function updateRule(env: Env, categoryId: string, ruleId: string, input: Partial<DomainRule>) {
  const current = await env.DB.prepare('SELECT * FROM rules WHERE id = ? AND category_id = ?').bind(ruleId, categoryId).first<RuleRow>();
  if (!current) throw new Error('规则不存在。');
  if (current.source_id) throw new Error('上游规则为只读，请修改来源或等待下次同步。');
  const timestamp = now();
  await env.DB.prepare(
    'UPDATE rules SET value = ?, type = ?, display_type = ?, note = ?, enabled = ?, sort_order = ?, updated_at = ? WHERE id = ? AND category_id = ?',
  )
    .bind(
      input.value ?? current.value,
      input.type ?? current.type,
      input.displayType ?? current.display_type,
      input.note ?? current.note,
      input.enabled === undefined ? current.enabled ?? 1 : input.enabled ? 1 : 0,
      input.sortOrder ?? current.sort_order ?? 0,
      timestamp,
      ruleId,
      categoryId,
    )
    .run();
  await touchCategory(env, categoryId);
  return getRulesOverview(env);
}

export async function deleteRule(env: Env, categoryId: string, ruleId: string) {
  const current = await env.DB.prepare('SELECT source_id FROM rules WHERE id = ? AND category_id = ?').bind(ruleId, categoryId).first<{ source_id: string | null }>();
  if (!current) throw new Error('规则不存在。');
  if (current.source_id) throw new Error('上游规则为只读，不能单独删除。');
  await env.DB.prepare('DELETE FROM rules WHERE id = ? AND category_id = ?').bind(ruleId, categoryId).run();
  await touchCategory(env, categoryId);
  return getRulesOverview(env);
}

export async function batchUpdateRules(env: Env, categoryId: string, ruleIds: string[], action: 'enable' | 'disable' | 'delete') {
  const ids = [...new Set(ruleIds)].filter(Boolean).slice(0, 1000);
  if (!ids.length) throw new Error('请选择至少一条规则。');
  const placeholders = ids.map(() => '?').join(',');
  if (action === 'delete') {
    await env.DB.prepare(`DELETE FROM rules WHERE category_id = ? AND source_id IS NULL AND id IN (${placeholders})`)
      .bind(categoryId, ...ids).run();
  } else {
    await env.DB.prepare(`UPDATE rules SET enabled = ?, updated_at = ? WHERE category_id = ? AND source_id IS NULL AND id IN (${placeholders})`)
      .bind(action === 'enable' ? 1 : 0, now(), categoryId, ...ids).run();
  }
  await touchCategory(env, categoryId);
  return getRulesOverview(env);
}

function insertRuleStatement(env: Env, categoryId: string, rule: DomainRule, sortOrder = 0, sourceId?: string) {
  return env.DB.prepare(
    'INSERT OR IGNORE INTO rules (id, category_id, value, type, display_type, note, enabled, sort_order, source_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    rule.id,
    categoryId,
    rule.value,
    rule.type,
    rule.displayType ?? '',
    rule.note ?? '',
    rule.enabled ? 1 : 0,
    rule.sortOrder ?? sortOrder,
    sourceId ?? rule.sourceId ?? null,
    rule.createdAt,
    rule.updatedAt,
  );
}

export async function insertRule(env: Env, categoryId: string, rule: DomainRule, sortOrder = 0, sourceId?: string) {
  await insertRuleStatement(env, categoryId, rule, sortOrder, sourceId).run();
}

export class BackupValidationError extends AppError {
  constructor(readonly problems: string[]) {
    super('BACKUP_INVALID', `备份 JSON 格式不正确：${problems.slice(0, 5).join('；')}`, { problems });
  }
}

/**
 * Restores a backup. The payload is validated before anything is touched, and
 * the delete + insert sequence is submitted as a single batch so a failure
 * leaves the existing data untouched (D1 batches and SQLite transactions are
 * both atomic).
 */
export async function importRulesData(env: Env, input: unknown) {
  const parsed = backupSchema.safeParse(input);
  if (!parsed.success) throw new BackupValidationError(describeIssues(parsed.error));
  const data = parsed.data;
  const unsupportedProblems: string[] = [];
  data.categories.forEach((category, categoryIndex) => {
    category.rules.forEach((rule, ruleIndex) => {
      if (!isLegacyRuleType(rule.type)) {
        unsupportedProblems.push(
          `categories.${categoryIndex}.rules.${ruleIndex}.type: 当前运行时暂不支持规则类型 ${rule.type}（${rule.value}）`,
        );
      }
      if (rule.options !== undefined) {
        unsupportedProblems.push(
          `categories.${categoryIndex}.rules.${ruleIndex}.options: 当前运行时暂不支持规则选项（${rule.value}）`,
        );
      }
    });
  });
  if (unsupportedProblems.length) throw new BackupValidationError(unsupportedProblems);
  const timestamp = now();
  const settings = resolveSettings(await getSettings(env), data.settings);
  const statements = [
    ...settingsStatements(env, settings),
    env.DB.prepare('DELETE FROM rules'),
    env.DB.prepare('DELETE FROM category_sources'),
    env.DB.prepare('DELETE FROM categories'),
  ];
  for (const [index, category] of data.categories.entries()) {
    const categoryId = category.id || id('cat');
    statements.push(env.DB.prepare(
      'INSERT INTO categories (id, name, slug, icon, description, note, sort_order, enabled, public_links_enabled, token_links_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      categoryId,
      category.name,
      category.slug || slugify(category.name),
      category.icon ?? category.name.slice(0, 2).toUpperCase(),
      category.description ?? '',
      category.note ?? '',
      category.sortOrder ?? index,
      category.enabled === false ? 0 : 1,
      category.tokenLinksEnabled === false && category.publicLinksEnabled !== false ? 1 : 0,
      category.tokenLinksEnabled === false ? 0 : 1,
      category.createdAt ?? timestamp,
      category.updatedAt ?? timestamp,
    ));
    for (const [sourceIndex, source] of category.sources.entries()) {
      const sourceType = source.sourceType;
      const sourceUrl = source.url || (sourceType === 'geosite' && source.geositeName
        ? `https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/${encodeURIComponent(source.geositeName)}`
        : sourceType === 'geoip' && source.geoipName
          ? `https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(source.geoipName)}.txt`
          : '');
      const sourceName = source.name || (sourceType === 'geosite' && source.geositeName
        ? `GeoSite · ${source.geositeName}`
        : sourceType === 'geoip' && source.geoipName
          ? `GeoIP · ${source.geoipName}`
          : sourceNameFromUrl(sourceUrl, `来源 ${sourceIndex + 1}`));
      statements.push(env.DB.prepare(
        'INSERT INTO category_sources (id, category_id, name, url, enabled, last_synced_at, last_status, last_count, last_original_count, last_error, sync_interval_minutes, user_agent, source_type, geosite_name, geoip_name, rule_optimization, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        source.id || id('src'), categoryId, sourceName, sourceUrl,
        source.enabled === false ? 0 : 1, source.lastSyncedAt ?? null, source.lastStatus ?? 'pending',
        source.lastCount ?? 0, source.lastOriginalCount ?? source.lastCount ?? 0, source.lastError ?? null, source.syncIntervalMinutes ?? category.syncIntervalMinutes ?? 60,
        normalizeUserAgent(source.userAgent), sourceType, source.geositeName ?? null, source.geoipName ?? null, sourceType === 'url' ? source.ruleOptimization ?? 'none' : 'none', category.createdAt ?? timestamp, category.updatedAt ?? timestamp,
      ));
    }
    for (const [ruleIndex, rule] of category.rules.entries()) {
      if (!isLegacyRuleType(rule.type)) continue;
      statements.push(insertRuleStatement(env, categoryId, {
        ...rule,
        type: rule.type,
        id: rule.id || id('rule'),
        createdAt: rule.createdAt ?? timestamp,
        updatedAt: rule.updatedAt ?? timestamp,
      }, rule.sortOrder ?? ruleIndex));
    }
  }
  await env.DB.batch(statements);
  return getRulesOverview(env);
}

async function touchCategory(env: Env, categoryId: string) {
  await env.DB.prepare('UPDATE categories SET updated_at = ? WHERE id = ?').bind(now(), categoryId).run();
}
