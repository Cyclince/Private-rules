-- 1.1.0 schema delta: rule options & composite indexes, api_keys.scopes,
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
