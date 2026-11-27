/**
 * Generates deterministic 1.0.x legacy SQLite database fixtures in
 * `tests/fixtures/legacy-db/` representing real-world 1.0.x history states
 * (design §17.2):
 *   1. `legacy-migrations-1.0.7.db`: built via `migrations/0001..0014` with
 *      both `_migrations` and `d1_migrations` tracking tables.
 *   2. `legacy-runtime-1.0.7.db`: built via 1.0.7 `ensureDatabase` runtime DDL
 *      and `ALTER TABLE` statements (no `_migrations` or `d1_migrations`, and
 *      with distinct physical column order on `category_sources` and
 *      `telegram_notifications`).
 *   3. `legacy-runtime-1.0.3.db`: built via `9975ca2` (pre-1.0.4) `ensureDatabase`
 *      runtime DDL (only 6 tables: categories, rules, settings, sessions,
 *      api_keys, category_sources — no `telegram_*`, `icon_pack_cache`,
 *      `sync_leases`, or `source_rule_staging`).
 */
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';

const ROOT = resolve(process.cwd());
const LEGACY_MIGRATIONS_DIR = join(ROOT, 'migrations');
const OUTPUT_DIR = join(ROOT, 'tests', 'fixtures', 'legacy-db');
const EXPECTED_DIR = join(OUTPUT_DIR, 'expected');
const LEGACY_REFERENCE_COMMIT = '5cb9012';
const LEGACY_RULE_TOKEN = 'legacy-token';

const ALL_FORMAT_SUFFIXES = [
  '.yaml',
  '.yml',
  '_Classical.yaml',
  '_Domain.yaml',
  '_Domian.yaml',
  '_IPCIDR.yaml',
  '.list',
  '.conf',
  '.txt',
  '-loon.list',
  '-qx.list',
  '-surge.list',
  '-shadowrocket.list',
  '-egern.list',
  '-surfboard.list',
  '-sing-box.json',
  '-v2ray.list',
  '.json',
] as const;

const GOLDEN_ENDPOINTS = [
  ...ALL_FORMAT_SUFFIXES.map((suffix) => `/rules/public-direct${suffix}`),
  ...ALL_FORMAT_SUFFIXES.map((suffix) => `/sub/${LEGACY_RULE_TOKEN}/private-proxy${suffix}`),
  // Access-control boundaries (must remain 404 after upgrade)
  '/rules/private-proxy.yaml',
  '/rules/internal-only.yaml',
  `/sub/${LEGACY_RULE_TOKEN}/internal-only.yaml`,
  '/sub/wrong-token/private-proxy.yaml',
  // Mixed-case slug ("Google Services" -> "Google-Services", token-protected)
  ...ALL_FORMAT_SUFFIXES.map((suffix) => `/sub/${LEGACY_RULE_TOKEN}/Google-Services${suffix}`),
  `/sub/${LEGACY_RULE_TOKEN}/google-services.list`,
  `/sub/${LEGACY_RULE_TOKEN}/GOOGLE-SERVICES_CLASSICAL.YAML`,
  '/rules/Google-Services.yaml',
  // Pure CJK name ("流媒体" -> 1.0.7 slugify fallback "rule", public)
  ...ALL_FORMAT_SUFFIXES.map((suffix) => `/rules/rule${suffix}`),
  '/rules/RULE.list',
  `/sub/${LEGACY_RULE_TOKEN}/rule.yaml`,
] as const;

const FIXED_CREATED_AT = '2026-10-01T08:00:00.000Z';
const FIXED_UPDATED_AT = '2026-11-15T12:30:00.000Z';
const FIXED_EXPIRES_AT = '2026-12-31T23:59:59.000Z';

function buildMigrationsSchema(db: Database.Database, files: Array<{ name: string; sql: string }>) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`);
  for (const file of files) {
    db.exec(file.sql);
    db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(file.name, FIXED_CREATED_AT);
    db.prepare('INSERT INTO d1_migrations (name, applied_at) VALUES (?, ?)').run(file.name, FIXED_CREATED_AT);
  }
}

/**
 * Reproduces 1.0.7 `ensureDatabase` DDL + runtime ALTER statements verbatim,
 * including the physical column-order differences compared to `migrations/`.
 */
function buildRuntimeEnsureSchema(db: Database.Database) {
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
    'ALTER TABLE categories ADD COLUMN public_links_enabled INTEGER DEFAULT 0',
    'ALTER TABLE categories ADD COLUMN token_links_enabled INTEGER DEFAULT 1',
    'ALTER TABLE rules ADD COLUMN source_id TEXT',
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_unique_source_value ON rules(category_id, IFNULL(source_id, ''), type, value)",
    'CREATE INDEX IF NOT EXISTS idx_sources_category ON category_sources(category_id)',
    'CREATE INDEX IF NOT EXISTS idx_rules_source ON rules(source_id)',
    'CREATE INDEX IF NOT EXISTS idx_telegram_updates_expires ON telegram_processed_updates(expires_at)',
    'CREATE INDEX IF NOT EXISTS idx_telegram_sessions_user ON telegram_sessions(telegram_user_id)',
    'CREATE INDEX IF NOT EXISTS idx_telegram_sessions_expires ON telegram_sessions(expires_at)',
    'CREATE INDEX IF NOT EXISTS idx_telegram_audit_created ON telegram_audit_logs(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_source_rule_staging_sync ON source_rule_staging(sync_id)',
    'CREATE INDEX IF NOT EXISTS idx_telegram_notification_events_pending ON telegram_notification_events(chat_id, delivered_at, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_telegram_message_deletions_due ON telegram_message_deletions(delete_after, attempts)',
  ];
  for (const statement of statements) db.exec(statement);
}

/**
 * Reproduces `9975ca2` (1.0.3 era, pre-Telegram) `ensureDatabase` DDL + runtime
 * ALTER statements verbatim.
 */
function buildRuntime103Schema(db: Database.Database) {
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
    `INSERT OR IGNORE INTO settings (key, value) VALUES
      ('baseUrl', ''), ('policyName', ''), ('githubMirrorUrl', ''), ('publicLinksEnabled', 'true'), ('tokenLinksEnabled', 'true'), ('customIconPackUrls', '[]'), ('customIconPackNames', '{}')`,
    'ALTER TABLE categories ADD COLUMN public_links_enabled INTEGER DEFAULT 0',
    'ALTER TABLE categories ADD COLUMN token_links_enabled INTEGER DEFAULT 1',
    'ALTER TABLE rules ADD COLUMN source_id TEXT',
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_unique_source_value ON rules(category_id, IFNULL(source_id, ''), type, value)",
    'CREATE INDEX IF NOT EXISTS idx_sources_category ON category_sources(category_id)',
    'CREATE INDEX IF NOT EXISTS idx_rules_source ON rules(source_id)',
  ];
  for (const statement of statements) db.exec(statement);
}

function seedCoreData(db: Database.Database, includeIconPackSettings: boolean) {
  const settingsData: Array<[string, string]> = [
    ['baseUrl', 'https://rules.example.com'],
    ['policyName', 'PROXY'],
    ['githubMirrorUrl', 'https://fastly.jsdelivr.net'],
    ['publicLinksEnabled', 'true'],
    ['tokenLinksEnabled', 'true'],
    ['customIconPackUrls', '["https://icons.example/pack.json"]'],
    ['customIconPackNames', '{"https://icons.example/pack.json":"Custom Pack"}'],
    ...(includeIconPackSettings
      ? ([
          ['iconPackAutoUpdate', 'true'],
          ['iconPackUpdateIntervalHours', '24'],
          ['iconPackLastUpdatedAt', FIXED_UPDATED_AT],
        ] as Array<[string, string]>)
      : []),
  ];
  const upsertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of settingsData) upsertSetting.run(key, value);

  const insertCategory = db.prepare(`INSERT INTO categories
    (id, name, slug, icon, description, note, sort_order, enabled, public_links_enabled, token_links_enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertCategory.run('cat_public', 'Public Direct', 'public-direct', 'PD', 'Public direct rules', 'Direct note', 1, 1, 1, 0, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertCategory.run('cat_private', 'Private Proxy', 'private-proxy', 'PP', 'Token protected rules', 'Proxy note', 2, 1, 0, 1, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertCategory.run('cat_disabled', 'Internal Only', 'internal-only', 'IO', 'Disabled links', '', 3, 1, 0, 0, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  // Mixed-case name with space ("Google Services" -> 1.0.7 slugify -> "Google-Services", token-protected)
  insertCategory.run('cat_google', 'Google Services', 'Google-Services', 'GS', 'Google services rules', 'Google note', 4, 1, 0, 1, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  // Pure CJK name ("流媒体" -> 1.0.7 slugify -> "rule", public links enabled)
  insertCategory.run('cat_streaming', '流媒体', 'rule', '流媒', '中文分类规则', 'Streaming note', 5, 1, 1, 0, FIXED_CREATED_AT, FIXED_UPDATED_AT);

  const insertSource = db.prepare(`INSERT INTO category_sources
    (id, category_id, name, url, enabled, last_synced_at, last_status, last_count, last_original_count, last_error,
     sync_interval_minutes, user_agent, source_type, geosite_name, geoip_name, rule_optimization, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertSource.run(
    'src_url', 'cat_public', 'Upstream List', 'https://rules.example/upstream.list', 1, FIXED_UPDATED_AT, 'success', 2, 3, null,
    60, 'clash-verge/v2.5.1', 'url', null, null, 'conservative', FIXED_CREATED_AT, FIXED_UPDATED_AT,
  );
  insertSource.run(
    'src_geosite', 'cat_private', 'GeoSite · openai', 'https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/openai', 1, FIXED_UPDATED_AT, 'success', 1, 1, null,
    360, 'clash-verge/v2.5.1', 'geosite', 'openai', null, 'none', FIXED_CREATED_AT, FIXED_UPDATED_AT,
  );
  insertSource.run(
    'src_geoip', 'cat_private', 'GeoIP · telegram', 'https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/telegram.txt', 1, FIXED_UPDATED_AT, 'success', 1, 1, null,
    360, 'clash-verge/v2.5.1', 'geoip', null, 'telegram', 'none', FIXED_CREATED_AT, FIXED_UPDATED_AT,
  );

  const insertRule = db.prepare(`INSERT INTO rules
    (id, category_id, value, type, display_type, note, enabled, sort_order, source_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  // Public category rules across all key 1.0.x types (including IPv6 CIDR, ports, disabled rule, and upstream rules)
  insertRule.run('rule_pub_1', 'cat_public', 'direct.example.com', 'DOMAIN', '完整域名', 'Exact domain', 1, 1, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_pub_2', 'cat_public', 'cn.example.org', 'DOMAIN-SUFFIX', '域名后缀', '', 1, 2, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_pub_3', 'cat_public', 'localcorp', 'DOMAIN-KEYWORD', '关键词', '', 1, 3, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_pub_4', 'cat_public', '10.0.0.0/8', 'IP-CIDR', 'IP 段', 'LAN v4', 1, 4, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_pub_5', 'cat_public', 'fd00::/8', 'IP-CIDR', 'IP 段', 'ULA v6', 1, 5, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_pub_6', 'cat_public', '192.168.1.0/24', 'SRC-IP-CIDR', '源 IP 段', '', 1, 6, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_pub_7', 'cat_public', '443', 'DST-PORT', '目标端口', '', 1, 7, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_pub_8', 'cat_public', '41641', 'SRC-PORT', '来源端口', 'WireGuard', 1, 8, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_pub_9', 'cat_public', 'disabled.example.com', 'DOMAIN', '完整域名', 'Disabled', 0, 9, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_pub_up_1', 'cat_public', 'mirror.example.net', 'DOMAIN-SUFFIX', '域名后缀', '', 1, 10, 'src_url', FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_pub_up_2', 'cat_public', '203.0.113.0/24', 'IP-CIDR', 'IP 段', '', 1, 11, 'src_url', FIXED_CREATED_AT, FIXED_UPDATED_AT);

  // Private token-protected category rules
  insertRule.run('rule_prv_1', 'cat_private', 'chatgpt.com', 'DOMAIN-SUFFIX', '域名后缀', 'AI', 1, 1, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_prv_2', 'cat_private', '80-90', 'DST-PORT', '目标端口', '', 1, 2, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_prv_up_1', 'cat_private', 'openai.com', 'DOMAIN-SUFFIX', '域名后缀', '', 1, 3, 'src_geosite', FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_prv_up_2', 'cat_private', '91.108.56.0/22', 'IP-CIDR', 'IP 段', '', 1, 4, 'src_geoip', FIXED_CREATED_AT, FIXED_UPDATED_AT);

  // Disabled-links category rule
  insertRule.run('rule_dis_1', 'cat_disabled', 'internal.example.com', 'DOMAIN', '完整域名', '', 1, 1, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);

  // Mixed-case slug ("Google Services") rules across multiple types
  insertRule.run('rule_goo_1', 'cat_google', 'mail.google.com', 'DOMAIN', '完整域名', 'Gmail', 1, 1, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_goo_2', 'cat_google', 'googleapis.com', 'DOMAIN-SUFFIX', '域名后缀', '', 1, 2, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_goo_3', 'cat_google', 'gstatic', 'DOMAIN-KEYWORD', '关键词', '', 1, 3, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_goo_4', 'cat_google', '142.250.0.0/15', 'IP-CIDR', 'IP 段', 'Google ASN', 1, 4, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);

  // Pure CJK name ("流媒体" -> slug "rule") rules across multiple types
  insertRule.run('rule_str_1', 'cat_streaming', 'api.netflix.com', 'DOMAIN', '完整域名', 'Netflix API', 1, 1, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_str_2', 'cat_streaming', 'nflxvideo.net', 'DOMAIN-SUFFIX', '域名后缀', '', 1, 2, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_str_3', 'cat_streaming', '23.246.0.0/18', 'IP-CIDR', 'IP 段', '', 1, 3, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  insertRule.run('rule_str_4', 'cat_streaming', '8443', 'DST-PORT', '目标端口', '', 1, 4, null, FIXED_CREATED_AT, FIXED_UPDATED_AT);

  // Auth & API key rows
  db.prepare('INSERT INTO sessions (id, expires_at, created_at) VALUES (?, ?, ?)').run('sess_legacy_1', FIXED_EXPIRES_AT, FIXED_CREATED_AT);
  db.prepare('INSERT INTO api_keys (id, note, key_hash, key_prefix, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('key_legacy_1', 'Automation Key', 'a'.repeat(64), 'prk_legacy12…', FIXED_CREATED_AT, FIXED_UPDATED_AT);
}

function seedRepresentativeData(db: Database.Database) {
  seedCoreData(db, true);

  db.prepare('INSERT INTO icon_pack_cache (url, payload, icon_count, last_status, last_error, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('https://icons.example/pack.json', '[{"name":"AI","url":"https://icons.example/ai.png"}]', 1, 'success', null, FIXED_UPDATED_AT);

  db.prepare('INSERT INTO telegram_users (id, telegram_user_id, username, display_name, role, enabled, created_at, updated_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('tg_user_1', '10001', 'admin_user', 'Admin', 'admin', 1, FIXED_CREATED_AT, FIXED_UPDATED_AT, FIXED_UPDATED_AT);
  db.prepare('INSERT INTO telegram_sessions (id, telegram_user_id, session_token_hash, role, scope, created_at, expires_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('tg_sess_1', '10001', 'b'.repeat(64), 'admin', '["admin"]', FIXED_CREATED_AT, FIXED_EXPIRES_AT, FIXED_UPDATED_AT, null);
  db.prepare('INSERT INTO telegram_notifications (id, chat_id, sync_failed, sync_completed, security_alerts, enabled, notification_mode, digest_time, last_digest_date, muted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('tg_notif_1', '10001', 1, 1, 1, 1, 'digest', '09:00', '2026-11-15', 0, FIXED_CREATED_AT, FIXED_UPDATED_AT);
  db.prepare('INSERT INTO telegram_notification_events (id, chat_id, summary, failed, created_at, delivered_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('tg_evt_1', '10001', '3 sources synced', 0, FIXED_UPDATED_AT, null);
  db.prepare('INSERT INTO telegram_audit_logs (id, telegram_user_id, chat_id, action, target_type, target_id, summary, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('tg_audit_1', '10001', '10001', 'POST /api/sync', 'api', null, 'status=200', 'success', FIXED_UPDATED_AT);
  db.prepare('INSERT INTO telegram_processed_updates (update_id, processed_at, expires_at) VALUES (?, ?, ?)')
    .run('upd_1', FIXED_UPDATED_AT, FIXED_EXPIRES_AT);
  db.prepare('INSERT INTO telegram_message_deletions (id, chat_id, message_id, delete_after, attempts, last_error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('tg_del_1', '10001', 42, FIXED_EXPIRES_AT, 0, null, FIXED_UPDATED_AT);
  db.prepare('INSERT INTO telegram_conversations (telegram_user_id, chat_id, kind, state, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('10001', '10001', 'add-rule', '{"step":1}', FIXED_UPDATED_AT, FIXED_EXPIRES_AT);
  db.prepare('INSERT INTO telegram_confirmations (nonce, telegram_user_id, chat_id, action, target_id, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('nonce_1', '10001', '10001', 'delete-source', 'src_url', FIXED_EXPIRES_AT, null);
  db.prepare('INSERT INTO telegram_init_data_replays (replay_hash, telegram_user_id, expires_at) VALUES (?, ?, ?)')
    .run('c'.repeat(64), '10001', FIXED_EXPIRES_AT);
  // Seed two rate limit rows to verify migration from telegram_rate_limits -> rate_limits
  db.prepare('INSERT INTO telegram_rate_limits (identity, operation, window_started_at, hits) VALUES (?, ?, ?, ?)')
    .run('198.51.100.10', 'login-failure', FIXED_UPDATED_AT, 3);
  db.prepare('INSERT INTO telegram_rate_limits (identity, operation, window_started_at, hits) VALUES (?, ?, ?, ?)')
    .run('10001', 'sync-all', FIXED_UPDATED_AT, 1);
  db.prepare('INSERT INTO sync_leases (resource_type, resource_id, owner_id, acquired_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run('source', 'src_url', 'sync_old', FIXED_CREATED_AT, FIXED_CREATED_AT);
  db.prepare('INSERT INTO source_rule_staging (sync_id, id, source_id, category_id, value, type, display_type, note, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('stage_old', 'stg_1', 'src_url', 'cat_public', 'staging.example.com', 'DOMAIN', '完整域名', '', 1, FIXED_CREATED_AT, FIXED_UPDATED_AT);
}

async function generateFixture(
  fileName: string,
  setup: (db: Database.Database) => void,
  seed: (db: Database.Database) => void = seedRepresentativeData,
) {
  const filePath = join(OUTPUT_DIR, fileName);
  await rm(filePath, { force: true });
  await rm(`${filePath}-wal`, { force: true });
  await rm(`${filePath}-shm`, { force: true });
  const db = new Database(filePath);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = DELETE');
    setup(db);
    seed(db);
  } finally {
    db.close();
  }
  console.info(`[fixtures] generated ${filePath}`);
}

const GENERATED_FIXTURES = [
  'legacy-migrations-1.0.7.db',
  'legacy-runtime-1.0.7.db',
  'legacy-runtime-1.0.3.db',
] as const;

type GoldenEntry = {
  path: string;
  status: number;
  contentType: string | null;
  file: string;
};

type GoldenManifest = {
  sourceCommit: string;
  fixture: string;
  endpoints: GoldenEntry[];
};

function bodyFileForEndpoint(endpoint: string, seenLowerPaths: Set<string>): string {
  const base = endpoint.replace(/^\/+/, '');
  const lower = base.toLowerCase();
  if (!seenLowerPaths.has(lower)) {
    seenLowerPaths.add(lower);
    return base;
  }
  let candidate = `case-variants/${base}`;
  let counter = 2;
  while (seenLowerPaths.has(candidate.toLowerCase())) {
    candidate = `case-variants-${counter}/${base}`;
    counter += 1;
  }
  seenLowerPaths.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Checks out the genuine 1.0.7 reference commit (`5cb9012`) in a temporary git
 * worktree and requests every subscription endpoint through 1.0.7's original
 * Hono app + SQLite adapter against temporary copies of all three fixtures.
 * Writes status codes and verbatim response bodies under
 * `tests/fixtures/legacy-db/expected/<fixture-name>/`.
 */
async function generateGoldenExpectations() {
  const scratchRoot = await mkdtemp(join(tmpdir(), 'private-rules-107-golden-'));
  const worktreeDir = join(scratchRoot, 'worktree');
  const worktreeNodeModules = join(worktreeDir, 'node_modules');
  const captureScriptPath = join(scratchRoot, 'capture-107.mts');
  const rawOutputPath = join(scratchRoot, 'captured.json');
  const tsxBin = join(ROOT, 'node_modules', '.bin', 'tsx');

  let worktreeAdded = false;
  try {
    execFileSync('git', ['worktree', 'add', '--detach', worktreeDir, LEGACY_REFERENCE_COMMIT], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    worktreeAdded = true;

    await symlink(join(ROOT, 'node_modules'), worktreeNodeModules, 'dir');

    const captureScript = `
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [worktreeDir, fixturesDir, outputPath, fixturesJson, endpointsJson, ruleToken] = process.argv.slice(2);
const fixtures = JSON.parse(fixturesJson) as string[];
const endpoints = JSON.parse(endpointsJson) as string[];

const { createApp } = await import(pathToFileURL(join(worktreeDir, 'src/server/app.ts')).href);
const { SqliteDatabaseAdapter } = await import(
  pathToFileURL(join(worktreeDir, 'src/infrastructure/database/sqlite/adapter.ts')).href
);

const results: Record<string, Array<{ path: string; status: number; contentType: string | null; body: string }>> = {};

for (const fixtureName of fixtures) {
  const workDir = await mkdtemp(join(tmpdir(), 'private-rules-107-db-'));
  const dbPath = join(workDir, fixtureName);
  await copyFile(join(fixturesDir, fixtureName), dbPath);
  const database = new SqliteDatabaseAdapter(dbPath);
  try {
    const app = createApp();
    const env = {
      DB: database,
      ASSETS: { fetch: async () => new Response('<html></html>') },
      ADMIN_PASSWORD: 'test-password',
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      RULE_TOKEN: ruleToken,
      RUNTIME: 'node' as const,
    };
    const entries: Array<{ path: string; status: number; contentType: string | null; body: string }> = [];
    for (const endpoint of endpoints) {
      const response = await app.request(endpoint, {}, env);
      entries.push({
        path: endpoint,
        status: response.status,
        contentType: response.headers.get('content-type'),
        body: await response.text(),
      });
    }
    results[fixtureName] = entries;
  } finally {
    database.close();
    await rm(workDir, { recursive: true, force: true });
  }
}

await writeFile(outputPath, JSON.stringify(results), 'utf8');
`;
    await writeFile(captureScriptPath, captureScript, 'utf8');

    execFileSync(
      tsxBin,
      [
        captureScriptPath,
        worktreeDir,
        OUTPUT_DIR,
        rawOutputPath,
        JSON.stringify(GENERATED_FIXTURES),
        JSON.stringify(GOLDEN_ENDPOINTS),
        LEGACY_RULE_TOKEN,
      ],
      { cwd: ROOT, stdio: 'inherit' },
    );

    const captured = JSON.parse(await readFile(rawOutputPath, 'utf8')) as Record<
      string,
      Array<{ path: string; status: number; contentType: string | null; body: string }>
    >;

    await rm(EXPECTED_DIR, { recursive: true, force: true });
    for (const fixtureName of GENERATED_FIXTURES) {
      const fixtureStem = fixtureName.replace(/\.db$/, '');
      const fixtureOutDir = join(EXPECTED_DIR, fixtureStem);
      await mkdir(fixtureOutDir, { recursive: true });
      const entries = captured[fixtureName];
      if (!entries || entries.length !== GOLDEN_ENDPOINTS.length) {
        throw new Error(`Failed to capture all golden endpoints for ${fixtureName}`);
      }
      const manifestEntries: GoldenEntry[] = [];
      const seenLowerPaths = new Set<string>();
      for (const entry of entries) {
        const relativeFile = bodyFileForEndpoint(entry.path, seenLowerPaths);
        const targetPath = join(fixtureOutDir, relativeFile);
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, entry.body, 'utf8');
        manifestEntries.push({
          path: entry.path,
          status: entry.status,
          contentType: entry.contentType,
          file: relativeFile,
        });
      }
      const manifest: GoldenManifest = {
        sourceCommit: LEGACY_REFERENCE_COMMIT,
        fixture: fixtureName,
        endpoints: manifestEntries,
      };
      await writeFile(join(fixtureOutDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      console.info(`[fixtures] generated ${manifestEntries.length} golden expectations in ${fixtureOutDir}`);
    }
  } finally {
    await unlink(worktreeNodeModules).catch(() => undefined);
    if (worktreeAdded) {
      execFileSync('git', ['worktree', 'remove', '--force', worktreeDir], {
        cwd: ROOT,
        stdio: 'pipe',
      });
    }
    await rm(scratchRoot, { recursive: true, force: true });
  }
}

await mkdir(OUTPUT_DIR, { recursive: true });
const migrationFileNames = (await readdir(LEGACY_MIGRATIONS_DIR))
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort();
const migrationFiles = await Promise.all(
  migrationFileNames.map(async (name) => ({ name, sql: await readFile(join(LEGACY_MIGRATIONS_DIR, name), 'utf8') })),
);

await generateFixture('legacy-migrations-1.0.7.db', (db) => buildMigrationsSchema(db, migrationFiles));
await generateFixture('legacy-runtime-1.0.7.db', (db) => buildRuntimeEnsureSchema(db));
await generateFixture(
  'legacy-runtime-1.0.3.db',
  (db) => buildRuntime103Schema(db),
  (db) => seedCoreData(db, false),
);
await generateGoldenExpectations();
