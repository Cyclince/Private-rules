ALTER TABLE telegram_notifications ADD COLUMN notification_mode TEXT NOT NULL DEFAULT 'digest';
ALTER TABLE telegram_notifications ADD COLUMN digest_time TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE telegram_notifications ADD COLUMN last_digest_date TEXT;

CREATE TABLE IF NOT EXISTS telegram_notification_events (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  failed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_telegram_notification_events_pending
  ON telegram_notification_events(chat_id, delivered_at, created_at);
