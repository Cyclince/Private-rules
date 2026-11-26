export type MigrationEntry = {
  name: string;
  sql: string;
};

export const BASELINE_MIGRATION_NAME = '0000_baseline.sql';
export const INITIAL_1_1_0_MIGRATION_NAME = '0001_1_1_0_schema.sql';
export const SOURCE_COVERAGE_DEDUP_MIGRATION_NAME = '0002_source_coverage_dedup.sql';
export const PUBLICATION_EXPERIMENTAL_FULL_CONFIG_MIGRATION_NAME = '0003_publication_experimental_full_config.sql';

/**
 * Core tables present since 1.0.0 (`0001_init.sql`). A 1.0.x database missing
 * any of these tables is considered corrupted and rejected before backup or
 * catch-up.
 */
export const LEGACY_CORE_TABLES: readonly string[] = ['categories', 'rules', 'settings', 'sessions'];

/**
 * Post-1.0.0 tables created by 1.0.7 `ensureDatabase` (`CREATE TABLE IF NOT EXISTS`).
 * Missing tables in this list are created during the 1.0.x catch-up step after
 * `.bak-1.0.x` backup and before baseline validation.
 */
export const LEGACY_CATCHUP_TABLES: Readonly<Record<string, string>> = {
  category_sources: `CREATE TABLE IF NOT EXISTS category_sources (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    last_synced_at TEXT,
    last_status TEXT DEFAULT 'pending',
    last_count INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sync_interval_minutes INTEGER DEFAULT 60,
    user_agent TEXT DEFAULT 'clash-verge/v2.5.1',
    source_type TEXT DEFAULT 'url',
    geosite_name TEXT,
    geoip_name TEXT,
    rule_optimization TEXT DEFAULT 'none',
    last_original_count INTEGER DEFAULT 0,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
  )`,
  api_keys: `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    note TEXT NOT NULL DEFAULT '',
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  )`,
  telegram_users: `CREATE TABLE IF NOT EXISTS telegram_users (
    id TEXT PRIMARY KEY,
    telegram_user_id TEXT NOT NULL UNIQUE,
    username TEXT,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role = 'admin'),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled = 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_seen_at TEXT
  )`,
  telegram_processed_updates: `CREATE TABLE IF NOT EXISTS telegram_processed_updates (
    update_id TEXT PRIMARY KEY,
    processed_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  telegram_sessions: `CREATE TABLE IF NOT EXISTS telegram_sessions (
    id TEXT PRIMARY KEY,
    telegram_user_id TEXT NOT NULL,
    session_token_hash TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role = 'admin'),
    scope TEXT NOT NULL DEFAULT '["admin"]',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT,
    FOREIGN KEY (telegram_user_id) REFERENCES telegram_users(telegram_user_id) ON DELETE CASCADE
  )`,
  telegram_audit_logs: `CREATE TABLE IF NOT EXISTS telegram_audit_logs (
    id TEXT PRIMARY KEY,
    telegram_user_id TEXT NOT NULL,
    chat_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    summary TEXT NOT NULL DEFAULT '',
    result TEXT NOT NULL CHECK (result IN ('success', 'failure', 'denied', 'started')),
    created_at TEXT NOT NULL
  )`,
  telegram_notifications: `CREATE TABLE IF NOT EXISTS telegram_notifications (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL UNIQUE,
    sync_failed INTEGER NOT NULL DEFAULT 1,
    sync_completed INTEGER NOT NULL DEFAULT 1,
    security_alerts INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    notification_mode TEXT NOT NULL DEFAULT 'digest',
    digest_time TEXT NOT NULL DEFAULT '09:00',
    last_digest_date TEXT,
    muted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  telegram_notification_events: `CREATE TABLE IF NOT EXISTS telegram_notification_events (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    failed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    delivered_at TEXT
  )`,
  telegram_message_deletions: `CREATE TABLE IF NOT EXISTS telegram_message_deletions (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    delete_after TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(chat_id, message_id)
  )`,
  icon_pack_cache: `CREATE TABLE IF NOT EXISTS icon_pack_cache (
    url TEXT PRIMARY KEY,
    payload TEXT,
    icon_count INTEGER NOT NULL DEFAULT 0,
    last_status TEXT NOT NULL DEFAULT 'pending',
    last_error TEXT,
    updated_at TEXT NOT NULL
  )`,
  telegram_conversations: `CREATE TABLE IF NOT EXISTS telegram_conversations (
    telegram_user_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    PRIMARY KEY (telegram_user_id, chat_id)
  )`,
  telegram_confirmations: `CREATE TABLE IF NOT EXISTS telegram_confirmations (
    nonce TEXT PRIMARY KEY,
    telegram_user_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  )`,
  telegram_rate_limits: `CREATE TABLE IF NOT EXISTS telegram_rate_limits (
    identity TEXT NOT NULL,
    operation TEXT NOT NULL,
    window_started_at TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (identity, operation)
  )`,
  telegram_init_data_replays: `CREATE TABLE IF NOT EXISTS telegram_init_data_replays (
    replay_hash TEXT PRIMARY KEY,
    telegram_user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  sync_leases: `CREATE TABLE IF NOT EXISTS sync_leases (
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    PRIMARY KEY (resource_type, resource_id)
  )`,
  source_rule_staging: `CREATE TABLE IF NOT EXISTS source_rule_staging (
    sync_id TEXT NOT NULL,
    id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    value TEXT NOT NULL,
    type TEXT NOT NULL,
    display_type TEXT,
    note TEXT,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (sync_id, id)
  )`,
};

export type LegacyAlterColumn = {
  table: string;
  column: string;
  sql: string;
};

/**
 * Exact `ALTER TABLE ADD COLUMN` definitions that 1.0.7 `ensureDatabase`
 * applied to catch up earlier 1.0.x databases. Anything outside this list and
 * `LEGACY_CATCHUP_TABLES` is rejected during baseline validation.
 */
export const LEGACY_CATCHUP_ALTER_COLUMNS: readonly LegacyAlterColumn[] = [
  {
    table: 'categories',
    column: 'public_links_enabled',
    sql: 'ALTER TABLE categories ADD COLUMN public_links_enabled INTEGER DEFAULT 0',
  },
  {
    table: 'categories',
    column: 'token_links_enabled',
    sql: 'ALTER TABLE categories ADD COLUMN token_links_enabled INTEGER DEFAULT 1',
  },
  {
    table: 'rules',
    column: 'source_id',
    sql: 'ALTER TABLE rules ADD COLUMN source_id TEXT',
  },
  {
    table: 'category_sources',
    column: 'sync_interval_minutes',
    sql: 'ALTER TABLE category_sources ADD COLUMN sync_interval_minutes INTEGER DEFAULT 60',
  },
  {
    table: 'category_sources',
    column: 'user_agent',
    sql: "ALTER TABLE category_sources ADD COLUMN user_agent TEXT DEFAULT 'clash-verge/v2.5.1'",
  },
  {
    table: 'category_sources',
    column: 'source_type',
    sql: "ALTER TABLE category_sources ADD COLUMN source_type TEXT DEFAULT 'url'",
  },
  {
    table: 'category_sources',
    column: 'geosite_name',
    sql: 'ALTER TABLE category_sources ADD COLUMN geosite_name TEXT',
  },
  {
    table: 'category_sources',
    column: 'geoip_name',
    sql: 'ALTER TABLE category_sources ADD COLUMN geoip_name TEXT',
  },
  {
    table: 'category_sources',
    column: 'rule_optimization',
    sql: "ALTER TABLE category_sources ADD COLUMN rule_optimization TEXT DEFAULT 'none'",
  },
  {
    table: 'category_sources',
    column: 'last_original_count',
    sql: 'ALTER TABLE category_sources ADD COLUMN last_original_count INTEGER DEFAULT 0',
  },
  {
    table: 'telegram_notifications',
    column: 'notification_mode',
    sql: "ALTER TABLE telegram_notifications ADD COLUMN notification_mode TEXT NOT NULL DEFAULT 'digest'",
  },
  {
    table: 'telegram_notifications',
    column: 'digest_time',
    sql: "ALTER TABLE telegram_notifications ADD COLUMN digest_time TEXT NOT NULL DEFAULT '09:00'",
  },
  {
    table: 'telegram_notifications',
    column: 'last_digest_date',
    sql: 'ALTER TABLE telegram_notifications ADD COLUMN last_digest_date TEXT',
  },
  {
    table: 'telegram_notifications',
    column: 'muted',
    sql: 'ALTER TABLE telegram_notifications ADD COLUMN muted INTEGER NOT NULL DEFAULT 0',
  },
];

/**
 * Expected 1.0.x baseline tables and column names (order-independent) used to
 * verify an existing 1.0.x database before marking the baseline migration as
 * applied and running 1.1.0 deltas (design §17.2).
 */
export const LEGACY_BASELINE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  categories: [
    'id',
    'name',
    'slug',
    'icon',
    'description',
    'note',
    'sort_order',
    'enabled',
    'public_links_enabled',
    'token_links_enabled',
    'created_at',
    'updated_at',
  ],
  rules: [
    'id',
    'category_id',
    'value',
    'type',
    'display_type',
    'note',
    'enabled',
    'sort_order',
    'source_id',
    'created_at',
    'updated_at',
  ],
  category_sources: [
    'id',
    'category_id',
    'name',
    'url',
    'enabled',
    'last_synced_at',
    'last_status',
    'last_count',
    'last_original_count',
    'last_error',
    'sync_interval_minutes',
    'user_agent',
    'source_type',
    'geosite_name',
    'geoip_name',
    'rule_optimization',
    'created_at',
    'updated_at',
  ],
  source_rule_staging: [
    'sync_id',
    'id',
    'source_id',
    'category_id',
    'value',
    'type',
    'display_type',
    'note',
    'sort_order',
    'created_at',
    'updated_at',
  ],
  sync_leases: ['resource_type', 'resource_id', 'owner_id', 'acquired_at', 'expires_at'],
  settings: ['key', 'value'],
  sessions: ['id', 'expires_at', 'created_at'],
  api_keys: ['id', 'note', 'key_hash', 'key_prefix', 'created_at', 'last_used_at'],
  icon_pack_cache: ['url', 'payload', 'icon_count', 'last_status', 'last_error', 'updated_at'],
  telegram_users: [
    'id',
    'telegram_user_id',
    'username',
    'display_name',
    'role',
    'enabled',
    'created_at',
    'updated_at',
    'last_seen_at',
  ],
  telegram_processed_updates: ['update_id', 'processed_at', 'expires_at'],
  telegram_sessions: [
    'id',
    'telegram_user_id',
    'session_token_hash',
    'role',
    'scope',
    'created_at',
    'expires_at',
    'last_used_at',
    'revoked_at',
  ],
  telegram_audit_logs: [
    'id',
    'telegram_user_id',
    'chat_id',
    'action',
    'target_type',
    'target_id',
    'summary',
    'result',
    'created_at',
  ],
  telegram_notifications: [
    'id',
    'chat_id',
    'sync_failed',
    'sync_completed',
    'security_alerts',
    'enabled',
    'notification_mode',
    'digest_time',
    'last_digest_date',
    'muted',
    'created_at',
    'updated_at',
  ],
  telegram_notification_events: ['id', 'chat_id', 'summary', 'failed', 'created_at', 'delivered_at'],
  telegram_message_deletions: ['id', 'chat_id', 'message_id', 'delete_after', 'attempts', 'last_error', 'created_at'],
  telegram_conversations: ['telegram_user_id', 'chat_id', 'kind', 'state', 'created_at', 'expires_at'],
  telegram_confirmations: ['nonce', 'telegram_user_id', 'chat_id', 'action', 'target_id', 'expires_at', 'used_at'],
  telegram_rate_limits: ['identity', 'operation', 'window_started_at', 'hits'],
  telegram_init_data_replays: ['replay_hash', 'telegram_user_id', 'expires_at'],
};

const BASELINE_SQL = `-- Idempotent 1.0.x baseline migration (matches 1.0.7 schema).
-- Safe to run on both fresh databases and existing 1.0.x databases.

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT,
  description TEXT,
  note TEXT,
  sort_order INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  public_links_enabled INTEGER DEFAULT 0,
  token_links_enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  value TEXT NOT NULL,
  type TEXT NOT NULL,
  display_type TEXT,
  note TEXT,
  enabled INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  source_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS category_sources (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  last_synced_at TEXT,
  last_status TEXT DEFAULT 'pending',
  last_count INTEGER DEFAULT 0,
  last_original_count INTEGER DEFAULT 0,
  last_error TEXT,
  sync_interval_minutes INTEGER DEFAULT 60,
  user_agent TEXT DEFAULT 'clash-verge/v2.5.1',
  source_type TEXT DEFAULT 'url',
  geosite_name TEXT,
  geoip_name TEXT,
  rule_optimization TEXT DEFAULT 'none',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_rule_staging (
  sync_id TEXT NOT NULL,
  id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  value TEXT NOT NULL,
  type TEXT NOT NULL,
  display_type TEXT,
  note TEXT,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (sync_id, id)
);

CREATE TABLE IF NOT EXISTS sync_leases (
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (resource_type, resource_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  note TEXT NOT NULL DEFAULT '',
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS icon_pack_cache (
  url TEXT PRIMARY KEY,
  payload TEXT,
  icon_count INTEGER NOT NULL DEFAULT 0,
  last_status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_users (
  id TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL UNIQUE,
  username TEXT,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role = 'admin'),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled = 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS telegram_processed_updates (
  update_id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_sessions (
  id TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  session_token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role = 'admin'),
  scope TEXT NOT NULL DEFAULT '["admin"]',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (telegram_user_id) REFERENCES telegram_users(telegram_user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS telegram_audit_logs (
  id TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  chat_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  summary TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL CHECK (result IN ('success', 'failure', 'denied', 'started')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_notifications (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL UNIQUE,
  sync_failed INTEGER NOT NULL DEFAULT 1,
  sync_completed INTEGER NOT NULL DEFAULT 1,
  security_alerts INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  notification_mode TEXT NOT NULL DEFAULT 'digest',
  digest_time TEXT NOT NULL DEFAULT '09:00',
  last_digest_date TEXT,
  muted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_notification_events (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  failed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE TABLE IF NOT EXISTS telegram_message_deletions (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  delete_after TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(chat_id, message_id)
);

CREATE TABLE IF NOT EXISTS telegram_conversations (
  telegram_user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (telegram_user_id, chat_id)
);

CREATE TABLE IF NOT EXISTS telegram_confirmations (
  nonce TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS telegram_rate_limits (
  identity TEXT NOT NULL,
  operation TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (identity, operation)
);

CREATE TABLE IF NOT EXISTS telegram_init_data_replays (
  replay_hash TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rules_category_id ON rules(category_id);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_rules_enabled ON rules(enabled);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_unique_source_value ON rules(category_id, IFNULL(source_id, ''), type, value);
CREATE INDEX IF NOT EXISTS idx_sources_category ON category_sources(category_id);
CREATE INDEX IF NOT EXISTS idx_rules_source ON rules(source_id);
CREATE INDEX IF NOT EXISTS idx_telegram_updates_expires ON telegram_processed_updates(expires_at);
CREATE INDEX IF NOT EXISTS idx_telegram_sessions_user ON telegram_sessions(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_sessions_expires ON telegram_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_telegram_audit_created ON telegram_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_telegram_confirmations_expires ON telegram_confirmations(expires_at);
CREATE INDEX IF NOT EXISTS idx_telegram_conversations_expires ON telegram_conversations(expires_at);
CREATE INDEX IF NOT EXISTS idx_sync_leases_expires ON sync_leases(expires_at);
CREATE INDEX IF NOT EXISTS idx_source_rule_staging_sync ON source_rule_staging(sync_id);
CREATE INDEX IF NOT EXISTS idx_telegram_notification_events_pending ON telegram_notification_events(chat_id, delivered_at, created_at);
CREATE INDEX IF NOT EXISTS idx_telegram_message_deletions_due ON telegram_message_deletions(delete_after, attempts);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('baseUrl', ''),
  ('policyName', ''),
  ('githubMirrorUrl', ''),
  ('publicLinksEnabled', 'true'),
  ('tokenLinksEnabled', 'true'),
  ('customIconPackUrls', '[]'),
  ('customIconPackNames', '{}'),
  ('iconPackAutoUpdate', 'true'),
  ('iconPackUpdateIntervalHours', '24'),
  ('iconPackLastUpdatedAt', '');
`;

const SCHEMA_1_1_0_SQL = `-- 1.1.0 schema delta: rule options & composite indexes, api_keys.scopes,
-- generic rate_limits table, and 7 new template/publication tables (design §8).

ALTER TABLE rules ADD COLUMN options TEXT;

CREATE INDEX IF NOT EXISTS idx_rules_category_source ON rules(category_id, source_id);
CREATE INDEX IF NOT EXISTS idx_rules_type_value ON rules(type, value);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

ALTER TABLE api_keys ADD COLUMN scopes TEXT NOT NULL DEFAULT 'full';

CREATE TABLE IF NOT EXISTS rate_limits (
  identity TEXT NOT NULL,
  operation TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (identity, operation)
);

INSERT OR IGNORE INTO rate_limits (identity, operation, window_started_at, hits)
SELECT identity, operation, window_started_at, hits FROM telegram_rate_limits;

DROP TABLE IF EXISTS telegram_rate_limits;

CREATE TABLE IF NOT EXISTS catalog_entries (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL,
  default_route TEXT NOT NULL,
  source_url TEXT NOT NULL,
  rule_count INTEGER
);

CREATE INDEX IF NOT EXISTS idx_catalog_entries_provider ON catalog_entries(provider);
CREATE INDEX IF NOT EXISTS idx_catalog_entries_category ON catalog_entries(category);
CREATE INDEX IF NOT EXISTS idx_catalog_entries_parent ON catalog_entries(parent_id);

CREATE TABLE IF NOT EXISTS app_cards (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  icon TEXT,
  category TEXT NOT NULL,
  body TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'user',
  forked_from TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_cards_category ON app_cards(category);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  base_kind TEXT NOT NULL,
  base_source_url TEXT,
  base_body TEXT NOT NULL,
  overlay TEXT NOT NULL DEFAULT '[]',
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS template_versions (
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  resolved_body TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (template_id, version),
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  template_id TEXT NOT NULL,
  pinned_version INTEGER,
  clients TEXT NOT NULL,
  access TEXT NOT NULL DEFAULT 'token',
  output TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (template_id) REFERENCES templates(id)
);

CREATE INDEX IF NOT EXISTS idx_publications_template ON publications(template_id);

CREATE TABLE IF NOT EXISTS node_bindings (
  publication_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  subscription_url_enc TEXT NOT NULL,
  user_agent TEXT,
  last_fetched_at TEXT,
  last_status TEXT,
  last_node_count INTEGER,
  PRIMARY KEY (publication_id, slot_id),
  FOREIGN KEY (publication_id) REFERENCES publications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS node_snapshots (
  publication_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  nodes_enc TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (publication_id, slot_id),
  FOREIGN KEY (publication_id) REFERENCES publications(id) ON DELETE CASCADE
);
`;

const SOURCE_COVERAGE_DEDUP_SQL = `-- Per-source coverage deduplication toggle (design §9.3.1).
-- Defaults to 0 so existing 1.0.x / pre-M4.3a sources keep byte-identical output;
-- newly created 1.1.0 sources explicitly store 1 (opt-out with 0).

ALTER TABLE category_sources ADD COLUMN coverage_dedup INTEGER NOT NULL DEFAULT 0;
`;

const PUBLICATION_EXPERIMENTAL_FULL_CONFIG_SQL = `-- Experimental full-config toggle on publications for Loon / Quantumult X (design §20).
-- Defaults to 0 (safe rules-only resource mode) so existing and newly created publications
-- never overwrite client node subscriptions unless explicitly opted in.

ALTER TABLE publications ADD COLUMN experimental_full_config INTEGER NOT NULL DEFAULT 0;
`;

/**
 * Bundled SQL migrations kept in sync with `src/data/migrations/*.sql` (verified
 * byte-for-byte by `tests/integration/migration.test.ts`). Bundling avoids any
 * filesystem dependency in Cloudflare Workers and tsup Node builds while
 * preserving standalone SQL files for `wrangler d1 migrations apply`.
 */
export const MIGRATIONS: readonly MigrationEntry[] = [
  { name: BASELINE_MIGRATION_NAME, sql: BASELINE_SQL },
  { name: INITIAL_1_1_0_MIGRATION_NAME, sql: SCHEMA_1_1_0_SQL },
  { name: SOURCE_COVERAGE_DEDUP_MIGRATION_NAME, sql: SOURCE_COVERAGE_DEDUP_SQL },
  {
    name: PUBLICATION_EXPERIMENTAL_FULL_CONFIG_MIGRATION_NAME,
    sql: PUBLICATION_EXPERIMENTAL_FULL_CONFIG_SQL,
  },
];
