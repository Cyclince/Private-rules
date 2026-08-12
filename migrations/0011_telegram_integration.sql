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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS sync_leases (
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (resource_type, resource_id)
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

CREATE INDEX IF NOT EXISTS idx_telegram_updates_expires ON telegram_processed_updates(expires_at);
CREATE INDEX IF NOT EXISTS idx_telegram_sessions_user ON telegram_sessions(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_sessions_expires ON telegram_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_telegram_audit_created ON telegram_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_telegram_confirmations_expires ON telegram_confirmations(expires_at);
CREATE INDEX IF NOT EXISTS idx_telegram_conversations_expires ON telegram_conversations(expires_at);
CREATE INDEX IF NOT EXISTS idx_sync_leases_expires ON sync_leases(expires_at);
CREATE INDEX IF NOT EXISTS idx_source_rule_staging_sync ON source_rule_staging(sync_id);
