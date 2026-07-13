import type { DomainRule, RuleCategory, RuleSettings, RuleSource, RulesData } from '../types/domain-rules';
import type { Env } from '../types';
import { parseRuleInput } from './parser';
import { id, slugify } from './slug';

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
};

type SourceRow = {
  id: string; category_id: string; name: string; url: string; enabled: number | null;
  last_synced_at: string | null; last_status: RuleSource['lastStatus'] | null;
  last_count: number | null; last_error: string | null;
  sync_interval_minutes: number | null;
  source_type: 'url' | 'geosite' | 'geoip' | null;
  geosite_name: string | null;
  geoip_name: string | null;
};

const defaultSettings: RuleSettings = {
  baseUrl: '',
  policyName: '',
  publicLinksEnabled: true,
  tokenLinksEnabled: true,
  customIconPackUrls: [],
  customIconPackNames: {},
};

let databaseReady: Promise<void> | undefined;

/**
 * Allows a newly deployed Worker to start with an empty D1 database. The
 * statements are idempotent and the promise is reused for the lifetime of a
 * Worker isolate, so ordinary requests do not repeatedly initialise schema.
 */
export function ensureDatabase(env: Env) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      icon TEXT, description TEXT, note TEXT, sort_order INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY, category_id TEXT NOT NULL, value TEXT NOT NULL,
      type TEXT NOT NULL, display_type TEXT, note TEXT, enabled INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    )`,
    'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)',
    'CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS idx_rules_category_id ON rules(category_id)',
    'CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug)',
    'CREATE INDEX IF NOT EXISTS idx_rules_enabled ON rules(enabled)',
    `CREATE TABLE IF NOT EXISTS category_sources (
      id TEXT PRIMARY KEY, category_id TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL,
      enabled INTEGER DEFAULT 1, last_synced_at TEXT, last_status TEXT DEFAULT 'pending',
      last_count INTEGER DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      sync_interval_minutes INTEGER DEFAULT 60,
      source_type TEXT DEFAULT 'url', geosite_name TEXT, geoip_name TEXT,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    )`,
    `INSERT OR IGNORE INTO settings (key, value) VALUES
      ('baseUrl', ''), ('policyName', ''), ('publicLinksEnabled', 'true'), ('tokenLinksEnabled', 'true'), ('customIconPackUrls', '[]'), ('customIconPackNames', '{}')`,
  ];

  databaseReady ??= (async () => {
    await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
    const [categoryColumns, ruleColumns, sourceColumns] = await Promise.all([
      env.DB.prepare('PRAGMA table_info(categories)').all<{ name: string }>(),
      env.DB.prepare('PRAGMA table_info(rules)').all<{ name: string }>(),
      env.DB.prepare('PRAGMA table_info(category_sources)').all<{ name: string }>(),
    ]);
    const categoryNames = new Set((categoryColumns.results ?? []).map((column) => column.name));
    const ruleNames = new Set((ruleColumns.results ?? []).map((column) => column.name));
    const sourceNames = new Set((sourceColumns.results ?? []).map((column) => column.name));
    const alters: string[] = [];
    if (!categoryNames.has('public_links_enabled')) alters.push('ALTER TABLE categories ADD COLUMN public_links_enabled INTEGER DEFAULT 0');
    if (!categoryNames.has('token_links_enabled')) alters.push('ALTER TABLE categories ADD COLUMN token_links_enabled INTEGER DEFAULT 1');
    if (!ruleNames.has('source_id')) alters.push('ALTER TABLE rules ADD COLUMN source_id TEXT');
    if (!sourceNames.has('sync_interval_minutes')) alters.push('ALTER TABLE category_sources ADD COLUMN sync_interval_minutes INTEGER DEFAULT 60');
    if (!sourceNames.has('source_type')) alters.push("ALTER TABLE category_sources ADD COLUMN source_type TEXT DEFAULT 'url'");
    if (!sourceNames.has('geosite_name')) alters.push('ALTER TABLE category_sources ADD COLUMN geosite_name TEXT');
    if (!sourceNames.has('geoip_name')) alters.push('ALTER TABLE category_sources ADD COLUMN geoip_name TEXT');
    for (const statement of alters) await env.DB.prepare(statement).run();
    await env.DB.prepare("UPDATE category_sources SET url = 'https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/' || geoip_name || '.txt' WHERE source_type = 'geoip' AND geoip_name IS NOT NULL AND url NOT LIKE '%/text/%.txt'").run();
    await env.DB.batch([
      env.DB.prepare('DROP INDEX IF EXISTS idx_rules_unique_value'),
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_unique_source_value ON rules(category_id, IFNULL(source_id, ''), type, value)"),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_sources_category ON category_sources(category_id)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_rules_source ON rules(source_id)'),
      env.DB.prepare('UPDATE categories SET public_links_enabled = 0 WHERE token_links_enabled = 1 AND public_links_enabled = 1'),
    ]);
  })();
  return databaseReady;
}

export function now() {
  return new Date().toISOString();
}

function sourceFromRow(row: SourceRow): RuleSource {
  return { id: row.id, categoryId: row.category_id, name: row.name, url: row.url, enabled: row.enabled !== 0,
    lastSyncedAt: row.last_synced_at ?? undefined, lastStatus: row.last_status ?? 'pending',
    lastCount: row.last_count ?? 0, lastError: row.last_error ?? undefined, syncIntervalMinutes: row.sync_interval_minutes ?? 60,
    sourceType: row.source_type ?? 'url', geositeName: row.geosite_name ?? undefined, geoipName: row.geoip_name ?? undefined };
}

function categoryFromRow(row: CategoryRow, rules: DomainRule[], sources: RuleSource[]): RuleCategory {
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
    enabled: row.enabled !== 0,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rules: [...uniqueRules.values()],
    publicLinksEnabled: row.public_links_enabled !== 0,
    tokenLinksEnabled: row.token_links_enabled !== 0,
    sources,
    lastSyncedAt: sources.reduce<string | undefined>((latest, source) => !latest || (source.lastSyncedAt ?? '') > latest ? source.lastSyncedAt : latest, undefined),
    syncIntervalMinutes: sources[0]?.syncIntervalMinutes ?? 60,
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
    enabled: row.enabled !== 0,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceId: row.source_id ?? undefined,
  };
}

export async function getSettings(env: Env): Promise<RuleSettings> {
  const rows = await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string | null }>();
  const settings = { ...defaultSettings };
  for (const row of rows.results ?? []) {
    if (row.key === 'baseUrl') settings.baseUrl = row.value ?? '';
    if (row.key === 'policyName') settings.policyName = row.value ?? '';
    if (row.key === 'publicLinksEnabled') settings.publicLinksEnabled = row.value !== 'false';
    if (row.key === 'tokenLinksEnabled') settings.tokenLinksEnabled = row.value !== 'false';
    if (row.key === 'customIconPackUrls') {
      try { settings.customIconPackUrls = JSON.parse(row.value || '[]') as string[]; } catch { settings.customIconPackUrls = []; }
    }
    if (row.key === 'customIconPackNames') {
      try { settings.customIconPackNames = JSON.parse(row.value || '{}') as Record<string, string>; } catch { settings.customIconPackNames = {}; }
    }
  }
  return settings;
}

export async function saveSettings(env: Env, input: Partial<RuleSettings>) {
  const next = { ...(await getSettings(env)), ...input };
  await env.DB.batch(
    Object.entries(next).map(([key, value]) =>
      env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, typeof value === 'object' ? JSON.stringify(value) : String(value)),
    ),
  );
  return next;
}

export async function getRulesData(env: Env): Promise<RulesData> {
  const [categoryRows, ruleRows, sourceRows, settings] = await Promise.all([
    env.DB.prepare('SELECT * FROM categories ORDER BY sort_order ASC, created_at ASC').all<CategoryRow>(),
    env.DB.prepare('SELECT * FROM rules ORDER BY sort_order ASC, created_at ASC').all<RuleRow>(),
    env.DB.prepare('SELECT * FROM category_sources ORDER BY created_at ASC').all<SourceRow>(),
    getSettings(env),
  ]);

  const rulesByCategory = new Map<string, DomainRule[]>();
  for (const row of ruleRows.results ?? []) {
    const list = rulesByCategory.get(row.category_id) ?? [];
    list.push(ruleFromRow(row));
    rulesByCategory.set(row.category_id, list);
  }

  const sources = (sourceRows.results ?? []).map(sourceFromRow);
  const sourceNames = new Map(sources.map((source) => [source.id, source.name]));
  for (const list of rulesByCategory.values()) for (const rule of list) if (rule.sourceId) rule.sourceName = sourceNames.get(rule.sourceId);
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
    },
    categories,
    updatedAt: updatedAt || now(),
    lastSyncedAt: sources.reduce<string | undefined>((latest, source) => !latest || (source.lastSyncedAt ?? '') > latest ? source.lastSyncedAt : latest, undefined),
  };
}

type CategoryInput = Partial<RuleCategory> & { sourceUrls?: string[]; geositeNames?: string[]; geoipNames?: string[]; syncIntervalMinutes?: number };

export async function createCategory(env: Env, input: CategoryInput) {
  const timestamp = now();
  const name = input.name?.trim();
  if (!name) throw new Error('请输入分类名称。');
  const categoryId = id('cat');
  const slug = input.slug?.trim() || slugify(name);
  const sortOrder = input.sortOrder ?? Date.now();
  const tokenAccess = input.tokenLinksEnabled !== false;
  const publicAccess = !tokenAccess && input.publicLinksEnabled === true;

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
  if (input.sourceUrls?.length || input.geositeNames?.length || input.geoipNames?.length) await replaceCategorySources(env, categoryId, input.sourceUrls ?? [], input.syncIntervalMinutes ?? 60, input.geositeNames ?? [], input.geoipNames ?? []);
  return getRulesData(env);
}

export async function updateCategory(env: Env, categoryId: string, input: CategoryInput) {
  const current = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(categoryId).first<CategoryRow>();
  if (!current) throw new Error('分类不存在。');
  const name = input.name?.trim() || current.name;
  const timestamp = now();
  let tokenAccess = input.tokenLinksEnabled === undefined ? current.token_links_enabled !== 0 : input.tokenLinksEnabled;
  let publicAccess = input.publicLinksEnabled === undefined ? current.public_links_enabled !== 0 : input.publicLinksEnabled;
  if (tokenAccess) publicAccess = false;
  await env.DB.prepare(
    'UPDATE categories SET name = ?, slug = ?, icon = ?, description = ?, note = ?, sort_order = ?, enabled = ?, public_links_enabled = ?, token_links_enabled = ?, updated_at = ? WHERE id = ?',
  )
    .bind(
      name,
      input.slug?.trim() || current.slug,
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
  if (input.sourceUrls || input.geositeNames || input.geoipNames) {
    const existingSource = await env.DB.prepare('SELECT sync_interval_minutes FROM category_sources WHERE category_id = ? LIMIT 1').bind(categoryId).first<{ sync_interval_minutes: number | null }>();
    await replaceCategorySources(env, categoryId, input.sourceUrls ?? [], input.syncIntervalMinutes ?? existingSource?.sync_interval_minutes ?? 60, input.geositeNames ?? [], input.geoipNames ?? []);
  }
  return getRulesData(env);
}

export async function replaceCategorySources(env: Env, categoryId: string, sourceUrls: string[], syncIntervalMinutes = 60, geositeNames: string[] = [], geoipNames: string[] = []) {
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
      "INSERT INTO category_sources (id, category_id, name, url, enabled, last_status, sync_interval_minutes, source_type, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, 'url', ?, ?)",
    ).bind(id('src'), categoryId, new URL(url).hostname || `来源 ${index + 1}`, url, 'pending', syncIntervalMinutes, timestamp, timestamp)),
    ...geosites.filter((name) => !existingByUrl.has(`https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/${encodeURIComponent(name)}`)).map((name) => env.DB.prepare(
      "INSERT INTO category_sources (id, category_id, name, url, enabled, last_status, sync_interval_minutes, source_type, geosite_name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, 'geosite', ?, ?, ?)",
    ).bind(id('src'), categoryId, `GeoSite · ${name}`, `https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/${encodeURIComponent(name)}`, 'pending', syncIntervalMinutes, name, timestamp, timestamp)),
    ...geoips.filter((name) => !existingByUrl.has(`https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(name)}.txt`)).map((name) => env.DB.prepare(
      "INSERT INTO category_sources (id, category_id, name, url, enabled, last_status, sync_interval_minutes, source_type, geoip_name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, 'geoip', ?, ?, ?)",
    ).bind(id('src'), categoryId, `GeoIP · ${name}`, `https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(name)}.txt`, 'pending', syncIntervalMinutes, name, timestamp, timestamp)),
    ...desiredUrls.filter((url) => existingByUrl.has(url)).map((url) => env.DB.prepare('UPDATE category_sources SET sync_interval_minutes = ?, updated_at = ? WHERE category_id = ? AND url = ?').bind(syncIntervalMinutes, timestamp, categoryId, url)),
    env.DB.prepare(desiredUrls.length
      ? `DELETE FROM category_sources WHERE category_id = ? AND url NOT IN (${desiredUrls.map(() => '?').join(',')})`
      : 'DELETE FROM category_sources WHERE category_id = ?').bind(categoryId, ...desiredUrls),
  ]);
}

export async function deleteCategory(env: Env, categoryId: string) {
  await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(categoryId).run();
  return getRulesData(env);
}

export async function addRule(env: Env, categoryId: string, input: { value: string; type?: DomainRule['type']; note?: string }) {
  const category = await env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(categoryId).first();
  if (!category) throw new Error('分类不存在。');
  const rule = parseRuleInput(input.value, input.type, input.note);
  await insertRule(env, categoryId, rule, Date.now());
  await touchCategory(env, categoryId);
  return getRulesData(env);
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
  return getRulesData(env);
}

export async function deleteRule(env: Env, categoryId: string, ruleId: string) {
  const current = await env.DB.prepare('SELECT source_id FROM rules WHERE id = ? AND category_id = ?').bind(ruleId, categoryId).first<{ source_id: string | null }>();
  if (!current) throw new Error('规则不存在。');
  if (current.source_id) throw new Error('上游规则为只读，不能单独删除。');
  await env.DB.prepare('DELETE FROM rules WHERE id = ? AND category_id = ?').bind(ruleId, categoryId).run();
  await touchCategory(env, categoryId);
  return getRulesData(env);
}

export async function insertRule(env: Env, categoryId: string, rule: DomainRule, sortOrder = 0, sourceId?: string) {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO rules (id, category_id, value, type, display_type, note, enabled, sort_order, source_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
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
    )
    .run();
}

export async function importRulesData(env: Env, data: RulesData) {
  const timestamp = now();
  await saveSettings(env, data.settings);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rules'),
    env.DB.prepare('DELETE FROM category_sources'),
    env.DB.prepare('DELETE FROM categories'),
  ]);
  for (const [index, category] of data.categories.entries()) {
    const categoryId = category.id || id('cat');
    await env.DB.prepare(
      'INSERT OR REPLACE INTO categories (id, name, slug, icon, description, note, sort_order, enabled, public_links_enabled, token_links_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
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
      )
      .run();
    for (const [sourceIndex, source] of (category.sources ?? []).entries()) {
      await env.DB.prepare(
        'INSERT INTO category_sources (id, category_id, name, url, enabled, last_synced_at, last_status, last_count, last_error, sync_interval_minutes, source_type, geosite_name, geoip_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        source.id || id('src'), categoryId, source.name || `来源 ${sourceIndex + 1}`, source.url,
        source.enabled === false ? 0 : 1, source.lastSyncedAt ?? null, source.lastStatus ?? 'pending',
        source.lastCount ?? 0, source.lastError ?? null, source.syncIntervalMinutes ?? category.syncIntervalMinutes ?? 60,
        source.sourceType ?? 'url', source.geositeName ?? null, source.geoipName ?? null, category.createdAt ?? timestamp, category.updatedAt ?? timestamp,
      ).run();
    }
    for (const [ruleIndex, rule] of category.rules.entries()) {
      await insertRule(env, categoryId, { ...rule, id: rule.id || id('rule') }, rule.sortOrder ?? ruleIndex);
    }
  }
  return getRulesData(env);
}

async function touchCategory(env: Env, categoryId: string) {
  await env.DB.prepare('UPDATE categories SET updated_at = ? WHERE id = ?').bind(now(), categoryId).run();
}
