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

CREATE INDEX IF NOT EXISTS idx_telegram_message_deletions_due
  ON telegram_message_deletions(delete_after, attempts);
