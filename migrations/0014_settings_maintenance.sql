ALTER TABLE telegram_notifications ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;
UPDATE telegram_notifications SET muted = 1, notification_mode = 'digest' WHERE notification_mode = 'muted';

CREATE TABLE IF NOT EXISTS icon_pack_cache (
  url TEXT PRIMARY KEY,
  payload TEXT,
  icon_count INTEGER NOT NULL DEFAULT 0,
  last_status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('iconPackAutoUpdate', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('iconPackUpdateIntervalHours', '24');
INSERT OR IGNORE INTO settings (key, value) VALUES ('iconPackLastUpdatedAt', '');
