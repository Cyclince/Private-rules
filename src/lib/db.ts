import type { BackupRuleSource, DomainRule, ManualRuleOptimizationPreview, RuleCategory, RuleConflict, RuleOptimizationMode, RuleSettings, RuleSource, RulesBackupData, RulesData } from '../types/domain-rules';
import { UPSTREAM_RULE_PREVIEW_LIMIT } from '../types/domain-rules';
import type { Env } from '../types';
import { normalizeGithubMirrorUrl, sourceNameFromSubscriptionUrl } from './github-mirror';
import { parseRuleInput } from './parser';
import { id, slugify, validateCategoryName } from './slug';

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

const readyDatabases = new WeakMap<object, Promise<void>>();

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
    `CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '', key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT
    )`,
    'CREATE INDEX IF NOT EXISTS idx_rules_category_id ON rules(category_id)',
    'CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug)',
    'CREATE INDEX IF NOT EXISTS idx_rules_enabled ON rules(enabled)',
    'CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)',
    `CREATE TABLE IF NOT EXISTS category_sources (
      id TEXT PRIMARY KEY, category_id TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL,
      enabled INTEGER DEFAULT 1, last_synced_at TEXT, last_status TEXT DEFAULT 'pending',
      last_count INTEGER DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      sync_interval_minutes INTEGER DEFAULT 60,
      user_agent TEXT DEFAULT 'clash-verge/v2.5.1',
      source_type TEXT DEFAULT 'url', geosite_name TEXT, geoip_name TEXT,
      rule_optimization TEXT DEFAULT 'none', last_original_count INTEGER DEFAULT 0,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS telegram_users (
      id TEXT PRIMARY KEY, telegram_user_id TEXT NOT NULL UNIQUE, username TEXT, display_name TEXT,
      role TEXT NOT NULL DEFAULT 'admin' CHECK (role = 'admin'),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled = 1),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_seen_at TEXT
    )`,
    'CREATE TABLE IF NOT EXISTS telegram_processed_updates (update_id TEXT PRIMARY KEY, processed_at TEXT NOT NULL, expires_at TEXT NOT NULL)',
    `CREATE TABLE IF NOT EXISTS telegram_sessions (
      id TEXT PRIMARY KEY, telegram_user_id TEXT NOT NULL, session_token_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'admin' CHECK (role = 'admin'), scope TEXT NOT NULL DEFAULT '["admin"]',
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT,
      FOREIGN KEY (telegram_user_id) REFERENCES telegram_users(telegram_user_id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS telegram_audit_logs (
      id TEXT PRIMARY KEY, telegram_user_id TEXT NOT NULL, chat_id TEXT, action TEXT NOT NULL,
      target_type TEXT, target_id TEXT, summary TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL CHECK (result IN ('success', 'failure', 'denied', 'started')), created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS telegram_notifications (
      id TEXT PRIMARY KEY, chat_id TEXT NOT NULL UNIQUE, sync_failed INTEGER NOT NULL DEFAULT 1,
      sync_completed INTEGER NOT NULL DEFAULT 1, security_alerts INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1, notification_mode TEXT NOT NULL DEFAULT 'digest',
      digest_time TEXT NOT NULL DEFAULT '09:00', last_digest_date TEXT, muted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS telegram_notification_events (
      id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, summary TEXT NOT NULL, failed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, delivered_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS telegram_message_deletions (
      id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, message_id INTEGER NOT NULL,
      delete_after TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
      created_at TEXT NOT NULL, UNIQUE(chat_id, message_id)
    )`,
    `CREATE TABLE IF NOT EXISTS icon_pack_cache (
      url TEXT PRIMARY KEY, payload TEXT, icon_count INTEGER NOT NULL DEFAULT 0,
      last_status TEXT NOT NULL DEFAULT 'pending', last_error TEXT, updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS telegram_conversations (
      telegram_user_id TEXT NOT NULL, chat_id TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY (telegram_user_id, chat_id)
    )`,
    `CREATE TABLE IF NOT EXISTS telegram_confirmations (
      nonce TEXT PRIMARY KEY, telegram_user_id TEXT NOT NULL, chat_id TEXT NOT NULL, action TEXT NOT NULL,
      target_id TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS telegram_rate_limits (
      identity TEXT NOT NULL, operation TEXT NOT NULL, window_started_at TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (identity, operation)
    )`,
    'CREATE TABLE IF NOT EXISTS telegram_init_data_replays (replay_hash TEXT PRIMARY KEY, telegram_user_id TEXT NOT NULL, expires_at TEXT NOT NULL)',
    `CREATE TABLE IF NOT EXISTS sync_leases (
      resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, owner_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY (resource_type, resource_id)
    )`,
    `CREATE TABLE IF NOT EXISTS source_rule_staging (
      sync_id TEXT NOT NULL, id TEXT NOT NULL, source_id TEXT NOT NULL, category_id TEXT NOT NULL,
      value TEXT NOT NULL, type TEXT NOT NULL, display_type TEXT, note TEXT, sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (sync_id, id)
    )`,
    `INSERT OR IGNORE INTO settings (key, value) VALUES
      ('baseUrl', ''), ('policyName', ''), ('githubMirrorUrl', ''), ('publicLinksEnabled', 'true'), ('tokenLinksEnabled', 'true'), ('customIconPackUrls', '[]'), ('customIconPackNames', '{}'),
      ('iconPackAutoUpdate', 'true'), ('iconPackUpdateIntervalHours', '24'), ('iconPackLastUpdatedAt', '')`,
  ];

  let databaseReady = readyDatabases.get(env.DB as object);
  if (!databaseReady) {
    databaseReady = (async () => {
    await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
    await env.DB.prepare(`INSERT OR IGNORE INTO api_keys (id, note, key_hash, key_prefix, created_at)
      SELECT 'key_legacy', '迁移的 API Key', value, 'prk_legacy…', COALESCE((SELECT value FROM settings WHERE key = 'apiKeyCreatedAt'), ?)
      FROM settings WHERE key = 'apiKeyHash' AND value <> ''`).bind(now()).run();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM settings WHERE key = 'apiKeyHash'"),
      env.DB.prepare("DELETE FROM settings WHERE key = 'apiKeyCreatedAt'"),
    ]);
    const [categoryColumns, ruleColumns, sourceColumns, notificationColumns] = await Promise.all([
      env.DB.prepare('PRAGMA table_info(categories)').all<{ name: string }>(),
      env.DB.prepare('PRAGMA table_info(rules)').all<{ name: string }>(),
      env.DB.prepare('PRAGMA table_info(category_sources)').all<{ name: string }>(),
      env.DB.prepare('PRAGMA table_info(telegram_notifications)').all<{ name: string }>(),
    ]);
    const categoryNames = new Set((categoryColumns.results ?? []).map((column) => column.name));
    const ruleNames = new Set((ruleColumns.results ?? []).map((column) => column.name));
    const sourceNames = new Set((sourceColumns.results ?? []).map((column) => column.name));
    const notificationNames = new Set((notificationColumns.results ?? []).map((column) => column.name));
    const alters: string[] = [];
    if (!categoryNames.has('public_links_enabled')) alters.push('ALTER TABLE categories ADD COLUMN public_links_enabled INTEGER DEFAULT 0');
    if (!categoryNames.has('token_links_enabled')) alters.push('ALTER TABLE categories ADD COLUMN token_links_enabled INTEGER DEFAULT 1');
    if (!ruleNames.has('source_id')) alters.push('ALTER TABLE rules ADD COLUMN source_id TEXT');
    if (!sourceNames.has('sync_interval_minutes')) alters.push('ALTER TABLE category_sources ADD COLUMN sync_interval_minutes INTEGER DEFAULT 60');
    if (!sourceNames.has('user_agent')) alters.push("ALTER TABLE category_sources ADD COLUMN user_agent TEXT DEFAULT 'clash-verge/v2.5.1'");
    if (!sourceNames.has('source_type')) alters.push("ALTER TABLE category_sources ADD COLUMN source_type TEXT DEFAULT 'url'");
    if (!sourceNames.has('geosite_name')) alters.push('ALTER TABLE category_sources ADD COLUMN geosite_name TEXT');
    if (!sourceNames.has('geoip_name')) alters.push('ALTER TABLE category_sources ADD COLUMN geoip_name TEXT');
    if (!sourceNames.has('rule_optimization')) alters.push("ALTER TABLE category_sources ADD COLUMN rule_optimization TEXT DEFAULT 'none'");
    if (!sourceNames.has('last_original_count')) alters.push('ALTER TABLE category_sources ADD COLUMN last_original_count INTEGER DEFAULT 0');
    if (!notificationNames.has('notification_mode')) alters.push("ALTER TABLE telegram_notifications ADD COLUMN notification_mode TEXT NOT NULL DEFAULT 'digest'");
    if (!notificationNames.has('digest_time')) alters.push("ALTER TABLE telegram_notifications ADD COLUMN digest_time TEXT NOT NULL DEFAULT '09:00'");
    if (!notificationNames.has('last_digest_date')) alters.push('ALTER TABLE telegram_notifications ADD COLUMN last_digest_date TEXT');
    if (!notificationNames.has('muted')) alters.push('ALTER TABLE telegram_notifications ADD COLUMN muted INTEGER NOT NULL DEFAULT 0');
    for (const statement of alters) await env.DB.prepare(statement).run();
    await env.DB.prepare("UPDATE category_sources SET url = 'https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/' || geoip_name || '.txt' WHERE source_type = 'geoip' AND geoip_name IS NOT NULL AND url NOT LIKE '%/text/%.txt'").run();
    await env.DB.batch([
      env.DB.prepare('DROP INDEX IF EXISTS idx_rules_unique_value'),
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_unique_source_value ON rules(category_id, IFNULL(source_id, ''), type, value)"),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_sources_category ON category_sources(category_id)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_rules_source ON rules(source_id)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_telegram_updates_expires ON telegram_processed_updates(expires_at)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_telegram_sessions_user ON telegram_sessions(telegram_user_id)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_telegram_sessions_expires ON telegram_sessions(expires_at)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_telegram_audit_created ON telegram_audit_logs(created_at)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_source_rule_staging_sync ON source_rule_staging(sync_id)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_telegram_notification_events_pending ON telegram_notification_events(chat_id, delivered_at, created_at)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_telegram_message_deletions_due ON telegram_message_deletions(delete_after, attempts)'),
      env.DB.prepare('UPDATE categories SET public_links_enabled = 0 WHERE token_links_enabled = 1 AND public_links_enabled = 1'),
    ]);
    })();
    readyDatabases.set(env.DB as object, databaseReady);
  }
  return databaseReady;
}

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

export async function saveSettings(env: Env, input: Partial<RuleSettings>) {
  const current = await getSettings(env);
  const next: RuleSettings = {
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
  await env.DB.batch(
    Object.entries(next).map(([key, value]) =>
      env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, typeof value === 'object' ? JSON.stringify(value) : String(value)),
    ),
  );
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

type ComparableRule = Pick<DomainRule, 'type' | 'value'>;

function domainRulesOverlap(left: ComparableRule, right: ComparableRule) {
  const domainTypes = new Set<DomainRule['type']>(['DOMAIN', 'DOMAIN-SUFFIX']);
  if (!domainTypes.has(left.type) || !domainTypes.has(right.type)) return false;
  if (left.value === right.value) return true;
  if (left.type === 'DOMAIN-SUFFIX' && right.value.endsWith(`.${left.value}`)) return true;
  if (right.type === 'DOMAIN-SUFFIX' && left.value.endsWith(`.${right.value}`)) return true;
  return false;
}

function keywordRulesOverlap(left: ComparableRule, right: ComparableRule) {
  const searchableTypes = new Set<DomainRule['type']>(['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD']);
  if (!searchableTypes.has(left.type) || !searchableTypes.has(right.type)) return false;
  if (left.type === 'DOMAIN-KEYWORD' && right.value.includes(left.value)) return true;
  if (right.type === 'DOMAIN-KEYWORD' && left.value.includes(right.value)) return true;
  return false;
}

function ipv4Value(value: string) {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((result, part) => (result << 8n) | BigInt(part), 0n);
}

function ipv6Value(value: string) {
  if (!value.includes(':') || (value.match(/::/g)?.length ?? 0) > 1) return null;
  const [left = '', right = ''] = value.split('::');
  const leftParts = left ? left.split(':') : [];
  const rightParts = right ? right.split(':') : [];
  const missing = 8 - leftParts.length - rightParts.length;
  if (missing < (value.includes('::') ? 1 : 0)) return null;
  const parts = value.includes('::') ? [...leftParts, ...Array(missing).fill('0'), ...rightParts] : leftParts;
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  return parts.reduce((result, part) => (result << 16n) | BigInt(`0x${part}`), 0n);
}

function cidrRange(value: string) {
  const [address, prefixText] = value.split('/');
  const ipv6 = address.includes(':');
  const bits = ipv6 ? 128 : 32;
  const prefix = Number(prefixText);
  const numeric = ipv6 ? ipv6Value(address) : ipv4Value(address);
  if (numeric === null || !Number.isInteger(prefix) || prefix < 0 || prefix > bits) return null;
  const hostBits = BigInt(bits - prefix);
  const start = hostBits === BigInt(bits) ? 0n : (numeric >> hostBits) << hostBits;
  const end = start + (1n << hostBits) - 1n;
  return { ipv6, start, end };
}

function networkRulesOverlap(left: ComparableRule, right: ComparableRule) {
  if (left.type !== right.type || !['IP-CIDR', 'SRC-IP-CIDR'].includes(left.type)) return false;
  const leftRange = cidrRange(left.value);
  const rightRange = cidrRange(right.value);
  return Boolean(leftRange && rightRange && leftRange.ipv6 === rightRange.ipv6 && leftRange.start <= rightRange.end && rightRange.start <= leftRange.end);
}

function portRulesOverlap(left: ComparableRule, right: ComparableRule) {
  if (left.type !== 'DST-PORT' || right.type !== 'DST-PORT') return false;
  const range = (value: string) => { const [start, end = start] = value.split('-').map(Number); return { start, end }; };
  const leftRange = range(left.value);
  const rightRange = range(right.value);
  return leftRange.start <= rightRange.end && rightRange.start <= leftRange.end;
}

function overlapReason(left: ComparableRule, right: ComparableRule) {
  if (keywordRulesOverlap(left, right)) return '关键词规则会覆盖另一条规则的匹配范围';
  if (domainRulesOverlap(left, right)) return '域名或后缀的匹配范围互相包含';
  if (networkRulesOverlap(left, right)) return 'IP 网段的匹配范围互相包含或重叠';
  if (portRulesOverlap(left, right)) return '目标端口的匹配范围互相包含或重叠';
  return null;
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

export async function findRuleConflicts(env: Env, candidate: Pick<DomainRule, 'type' | 'value'>, excludeRuleId?: string): Promise<RuleConflict[]> {
  const rows = await env.DB.prepare(`SELECT r.id, r.category_id, r.value, r.type, c.name AS category_name
    FROM rules r JOIN categories c ON c.id = r.category_id
    WHERE r.source_id IS NULL`).all<RuleRow>();
  return (rows.results ?? []).filter((row) => row.id !== excludeRuleId).flatMap((row) => {
    const existing = { type: row.type, value: row.value.toLowerCase() };
    const next = { type: candidate.type, value: candidate.value.toLowerCase() };
    const duplicate = existing.type === next.type && existing.value === next.value;
    const reason = duplicate ? '规则类型和值完全相同' : overlapReason(existing, next);
    if (!reason) return [];
    return [{
      id: row.id,
      categoryId: row.category_id,
      categoryName: row.category_name ?? '未知分类',
      value: row.value,
      type: row.type,
      kind: duplicate ? 'duplicate' as const : 'conflict' as const,
      reason,
    }];
  });
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

export async function importRulesData(env: Env, data: RulesData | RulesBackupData) {
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
      const sourceType = source.sourceType ?? 'url';
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
      await env.DB.prepare(
        'INSERT INTO category_sources (id, category_id, name, url, enabled, last_synced_at, last_status, last_count, last_original_count, last_error, sync_interval_minutes, user_agent, source_type, geosite_name, geoip_name, rule_optimization, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        source.id || id('src'), categoryId, sourceName, sourceUrl,
        source.enabled === false ? 0 : 1, source.lastSyncedAt ?? null, source.lastStatus ?? 'pending',
        source.lastCount ?? 0, source.lastOriginalCount ?? source.lastCount ?? 0, source.lastError ?? null, source.syncIntervalMinutes ?? category.syncIntervalMinutes ?? 60,
        normalizeUserAgent(source.userAgent), sourceType, source.geositeName ?? null, source.geoipName ?? null, sourceType === 'url' ? source.ruleOptimization ?? 'none' : 'none', category.createdAt ?? timestamp, category.updatedAt ?? timestamp,
      ).run();
    }
    for (const [ruleIndex, rule] of category.rules.entries()) {
      await insertRule(env, categoryId, { ...rule, id: rule.id || id('rule') }, rule.sortOrder ?? ruleIndex);
    }
  }
  return getRulesOverview(env);
}

async function touchCategory(env: Env, categoryId: string) {
  await env.DB.prepare('UPDATE categories SET updated_at = ? WHERE id = ?').bind(now(), categoryId).run();
}
