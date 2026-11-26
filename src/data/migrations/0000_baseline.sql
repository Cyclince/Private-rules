-- Idempotent 1.0.x baseline migration (matches 1.0.7 schema).
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
