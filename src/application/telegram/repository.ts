import type { DatabasePort } from '../ports/database';
import type { TelegramConfig } from '../../integrations/telegram/config';
import { id } from '../../lib/slug';

export type TelegramUser = {
  id: string;
  telegramUserId: string;
  username?: string;
  displayName?: string;
};

export type TelegramNotificationMode = 'immediate' | 'digest' | 'off';
export type TelegramNotificationPreferences = {
  chatId: string;
  syncFailed: boolean;
  syncCompleted: boolean;
  securityAlerts: boolean;
  mode: TelegramNotificationMode;
  muted: boolean;
  digestTime: string;
  lastDigestDate?: string;
};

type TelegramUserRow = {
  id: string; telegram_user_id: string; username: string | null; display_name: string | null;
};

function userFromRow(row: TelegramUserRow): TelegramUser {
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    username: row.username ?? undefined,
    displayName: row.display_name ?? undefined,
  };
}

function now() {
  return new Date().toISOString();
}

export class TelegramRepository {
  constructor(private readonly database: DatabasePort) {}

  async findUser(telegramUserId: string) {
    const row = await this.database.prepare('SELECT id, telegram_user_id, username, display_name FROM telegram_users WHERE telegram_user_id = ?')
      .bind(telegramUserId).first<TelegramUserRow>();
    return row ? userFromRow(row) : null;
  }

  async listNotificationChats(failure: boolean) {
    const rows = await this.database.prepare('SELECT chat_id FROM telegram_notifications WHERE enabled <> 0').all<{ chat_id: string }>();
    return (rows.results ?? []).map((row) => row.chat_id);
  }

  async listPendingNotificationChats() {
    const rows = await this.database.prepare('SELECT DISTINCT chat_id FROM telegram_notification_events WHERE delivered_at IS NULL').all<{ chat_id: string }>();
    return (rows.results ?? []).map((row) => row.chat_id);
  }

  async getNotificationPreferences(chatId: string): Promise<TelegramNotificationPreferences> {
    const row = await this.database.prepare(`SELECT chat_id, sync_failed, sync_completed, security_alerts, enabled,
      notification_mode, digest_time, last_digest_date, muted FROM telegram_notifications WHERE chat_id = ?`)
      .bind(chatId).first<{ chat_id: string; sync_failed: number; sync_completed: number; security_alerts: number; enabled: number; notification_mode: string; digest_time: string; last_digest_date: string | null; muted: number }>();
    if (!row) return { chatId, syncFailed: true, syncCompleted: true, securityAlerts: true, mode: 'digest', muted: false, digestTime: '09:00' };
    const legacyMuted = row.notification_mode === 'muted';
    const mode = row.enabled === 0 ? 'off' : ['immediate', 'digest'].includes(row.notification_mode) ? row.notification_mode as TelegramNotificationMode : 'digest';
    return { chatId, syncFailed: row.sync_failed !== 0, syncCompleted: row.sync_completed !== 0, securityAlerts: row.security_alerts !== 0, mode, muted: row.muted !== 0 || legacyMuted, digestTime: row.digest_time || '09:00', lastDigestDate: row.last_digest_date ?? undefined };
  }

  async saveNotificationPreferences(chatId: string, input: { syncFailed?: boolean; syncCompleted?: boolean; securityAlerts?: boolean; enabled?: boolean; mode?: TelegramNotificationMode; muted?: boolean; digestTime?: string }) {
    const timestamp = now();
    const current = await this.getNotificationPreferences(chatId);
    const mode = input.mode ?? (input.enabled === false ? 'off' : current.mode);
    const digestTime = input.digestTime ?? current.digestTime;
    await this.database.prepare(`INSERT INTO telegram_notifications
      (id, chat_id, sync_failed, sync_completed, security_alerts, enabled, notification_mode, muted, digest_time, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET sync_failed = excluded.sync_failed, sync_completed = excluded.sync_completed,
      security_alerts = excluded.security_alerts, enabled = excluded.enabled, notification_mode = excluded.notification_mode,
      muted = excluded.muted, digest_time = excluded.digest_time, updated_at = excluded.updated_at`)
      .bind(id('tg-notify'), chatId, (input.syncFailed ?? current.syncFailed) ? 1 : 0, (input.syncCompleted ?? current.syncCompleted) ? 1 : 0,
        (input.securityAlerts ?? current.securityAlerts) ? 1 : 0, mode === 'off' ? 0 : 1, mode, (input.muted ?? current.muted) ? 1 : 0, digestTime, timestamp, timestamp).run();
    return this.getNotificationPreferences(chatId);
  }

  async enqueueNotification(chatId: string, summary: string, failed: boolean) {
    await this.database.prepare(`INSERT INTO telegram_notification_events (id, chat_id, summary, failed, created_at, delivered_at)
      VALUES (?, ?, ?, ?, ?, NULL)`).bind(id('tg-event'), chatId, summary.slice(0, 3500), failed ? 1 : 0, now()).run();
  }

  async enqueueMessageDeletion(chatId: string, messageId: number, ttlSeconds = 60, currentTime = Date.now()) {
    if (!Number.isSafeInteger(messageId) || messageId <= 0) return;
    const createdAt = new Date(currentTime).toISOString();
    const deleteAfter = new Date(currentTime + ttlSeconds * 1000).toISOString();
    await this.database.prepare(`INSERT INTO telegram_message_deletions
      (id, chat_id, message_id, delete_after, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)
      ON CONFLICT(chat_id, message_id) DO UPDATE SET delete_after = excluded.delete_after, attempts = 0, last_error = NULL`)
      .bind(id('tg-delete'), chatId, messageId, deleteAfter, createdAt).run();
  }

  async dueMessageDeletions(currentTime = Date.now(), limit = 100) {
    const rows = await this.database.prepare(`SELECT id, chat_id, message_id, attempts FROM telegram_message_deletions
      WHERE delete_after <= ? ORDER BY delete_after ASC LIMIT ?`)
      .bind(new Date(currentTime).toISOString(), Math.max(1, Math.min(limit, 500)))
      .all<{ id: string; chat_id: string; message_id: number; attempts: number }>();
    return rows.results ?? [];
  }

  async completeMessageDeletion(idValue: string) {
    await this.database.prepare('DELETE FROM telegram_message_deletions WHERE id = ?').bind(idValue).run();
  }

  async failMessageDeletion(idValue: string, attempts: number, cause: unknown, currentTime = Date.now()) {
    if (attempts >= 3) return this.completeMessageDeletion(idValue);
    const message = (cause instanceof Error ? cause.message : 'delete failed').slice(0, 240);
    await this.database.prepare('UPDATE telegram_message_deletions SET attempts = ?, last_error = ?, delete_after = ? WHERE id = ?')
      .bind(attempts, message, new Date(currentTime + 300_000).toISOString(), idValue).run();
  }

  async pendingNotifications(chatId: string, limit = 50) {
    const rows = await this.database.prepare(`SELECT id, summary, failed, created_at FROM telegram_notification_events
      WHERE chat_id = ? AND delivered_at IS NULL ORDER BY created_at ASC LIMIT ?`).bind(chatId, limit).all<{ id: string; summary: string; failed: number; created_at: string }>();
    return rows.results ?? [];
  }

  async markNotificationsDelivered(chatId: string, ids: string[], digestDate: string) {
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(',');
    await this.database.batch([
      this.database.prepare(`UPDATE telegram_notification_events SET delivered_at = ? WHERE chat_id = ? AND id IN (${placeholders})`).bind(now(), chatId, ...ids),
      this.database.prepare('UPDATE telegram_notifications SET last_digest_date = ?, updated_at = ? WHERE chat_id = ?').bind(digestDate, now(), chatId),
    ]);
  }

  async authorizeUser(config: TelegramConfig, input: { telegramUserId: string; chatId: string; username?: string; displayName?: string }) {
    if (input.telegramUserId !== config.userId || input.chatId !== config.userId) return null;
    let user = await this.findUser(input.telegramUserId);
    if (!user) {
      const timestamp = now();
      await this.database.prepare(`INSERT OR IGNORE INTO telegram_users
        (id, telegram_user_id, username, display_name, role, enabled, created_at, updated_at, last_seen_at)
        VALUES (?, ?, ?, ?, 'admin', 1, ?, ?, ?)`)
        .bind(id('tg-user'), input.telegramUserId, input.username ?? null, input.displayName ?? null, timestamp, timestamp, timestamp).run();
      user = await this.findUser(input.telegramUserId);
    }
    if (!user) return null;
    await this.database.prepare('UPDATE telegram_users SET username = ?, display_name = ?, last_seen_at = ?, updated_at = ? WHERE telegram_user_id = ?')
      .bind(input.username ?? null, input.displayName ?? null, now(), now(), input.telegramUserId).run();
    return user;
  }

  async claimUpdate(updateId: string, ttlSeconds: number) {
    const timestamp = new Date();
    await this.database.prepare('DELETE FROM telegram_processed_updates WHERE expires_at <= ?').bind(timestamp.toISOString()).run();
    const result = await this.database.prepare('INSERT OR IGNORE INTO telegram_processed_updates (update_id, processed_at, expires_at) VALUES (?, ?, ?)')
      .bind(updateId, timestamp.toISOString(), new Date(timestamp.getTime() + ttlSeconds * 1000).toISOString()).run();
    return (result.changes ?? 0) > 0;
  }

  async consumeRateLimit(identity: string, operation: string, limit: number, windowSeconds = 60) {
    const timestamp = new Date();
    const current = await this.database.prepare('SELECT window_started_at, hits FROM telegram_rate_limits WHERE identity = ? AND operation = ?')
      .bind(identity, operation).first<{ window_started_at: string; hits: number }>();
    const expired = !current || Date.parse(current.window_started_at) + windowSeconds * 1000 <= timestamp.getTime();
    const hits = expired ? 1 : current.hits + 1;
    await this.database.prepare(`INSERT INTO telegram_rate_limits (identity, operation, window_started_at, hits)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(identity, operation) DO UPDATE SET window_started_at = excluded.window_started_at, hits = excluded.hits`)
      .bind(identity, operation, expired ? timestamp.toISOString() : current!.window_started_at, hits).run();
    return { allowed: hits <= limit, remaining: Math.max(0, limit - hits) };
  }

  async audit(input: {
    telegramUserId: string; chatId?: string; action: string; targetType?: string; targetId?: string;
    summary?: string; result: 'success' | 'failure' | 'denied' | 'started';
  }) {
    const safeSummary = (input.summary ?? '')
      .replace(/(token|authorization|cookie|secret)=?[^&\s]*/gi, '$1=[redacted]')
      .slice(0, 500);
    await this.database.prepare(`INSERT INTO telegram_audit_logs
      (id, telegram_user_id, chat_id, action, target_type, target_id, summary, result, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id('tg-audit'), input.telegramUserId, input.chatId ?? null, input.action, input.targetType ?? null, input.targetId ?? null, safeSummary, input.result, now()).run();
  }

  async listAuditLogs(limit = 100) {
    const rows = await this.database.prepare(`SELECT id, telegram_user_id, chat_id, action, target_type, target_id, summary, result, created_at
      FROM telegram_audit_logs ORDER BY created_at DESC LIMIT ?`).bind(Math.max(1, Math.min(limit, 500))).all();
    return rows.results ?? [];
  }

  async createConfirmation(input: { telegramUserId: string; chatId: string; action: string; targetId: string }, ttlSeconds = 300) {
    const nonce = id('cfm').slice(-20);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    await this.database.prepare(`INSERT INTO telegram_confirmations
      (nonce, telegram_user_id, chat_id, action, target_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(nonce, input.telegramUserId, input.chatId, input.action, input.targetId, expiresAt).run();
    return nonce;
  }

  async consumeConfirmation(nonce: string, telegramUserId: string, chatId: string, action: string) {
    const row = await this.database.prepare(`SELECT target_id FROM telegram_confirmations
      WHERE nonce = ? AND telegram_user_id = ? AND chat_id = ? AND action = ? AND used_at IS NULL AND expires_at > ?`)
      .bind(nonce, telegramUserId, chatId, action, now()).first<{ target_id: string }>();
    if (!row) return null;
    const result = await this.database.prepare('UPDATE telegram_confirmations SET used_at = ? WHERE nonce = ? AND used_at IS NULL')
      .bind(now(), nonce).run();
    return (result.changes ?? 0) > 0 ? row.target_id : null;
  }

  async saveConversation(telegramUserId: string, chatId: string, kind: string, state: unknown, ttlSeconds: number) {
    const timestamp = new Date();
    await this.database.prepare(`INSERT INTO telegram_conversations
      (telegram_user_id, chat_id, kind, state, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(telegram_user_id, chat_id) DO UPDATE SET kind = excluded.kind, state = excluded.state, created_at = excluded.created_at, expires_at = excluded.expires_at`)
      .bind(telegramUserId, chatId, kind, JSON.stringify(state), timestamp.toISOString(), new Date(timestamp.getTime() + ttlSeconds * 1000).toISOString()).run();
  }

  async getConversation<T>(telegramUserId: string, chatId: string) {
    const row = await this.database.prepare('SELECT kind, state FROM telegram_conversations WHERE telegram_user_id = ? AND chat_id = ? AND expires_at > ?')
      .bind(telegramUserId, chatId, now()).first<{ kind: string; state: string }>();
    if (!row) return null;
    try { return { kind: row.kind, state: JSON.parse(row.state) as T }; } catch { return null; }
  }

  async clearConversation(telegramUserId: string, chatId: string) {
    await this.database.prepare('DELETE FROM telegram_conversations WHERE telegram_user_id = ? AND chat_id = ?').bind(telegramUserId, chatId).run();
  }

  async createSession(telegramUserId: string, tokenHash: string, ttlSeconds: number) {
    const timestamp = new Date();
    const sessionId = id('tg-session');
    await this.database.prepare(`INSERT INTO telegram_sessions
      (id, telegram_user_id, session_token_hash, role, scope, created_at, expires_at)
      VALUES (?, ?, ?, 'admin', '["admin"]', ?, ?)`)
      .bind(sessionId, telegramUserId, tokenHash, timestamp.toISOString(), new Date(timestamp.getTime() + ttlSeconds * 1000).toISOString()).run();
    return sessionId;
  }

  async getSession(tokenHash: string) {
    return this.database.prepare(`SELECT s.id, s.telegram_user_id, s.expires_at
      FROM telegram_sessions s JOIN telegram_users u ON u.telegram_user_id = s.telegram_user_id
      WHERE s.session_token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`)
      .bind(tokenHash, now()).first<{ id: string; telegram_user_id: string; expires_at: string }>();
  }

  async touchSession(idValue: string) {
    await this.database.prepare('UPDATE telegram_sessions SET last_used_at = ? WHERE id = ?').bind(now(), idValue).run();
  }

  async revokeSession(tokenHash: string) {
    await this.database.prepare('UPDATE telegram_sessions SET revoked_at = ? WHERE session_token_hash = ?').bind(now(), tokenHash).run();
  }

  async claimInitData(replayHash: string, telegramUserId: string, expiresAt: string) {
    await this.database.prepare('DELETE FROM telegram_init_data_replays WHERE expires_at <= ?').bind(now()).run();
    const result = await this.database.prepare('INSERT OR IGNORE INTO telegram_init_data_replays (replay_hash, telegram_user_id, expires_at) VALUES (?, ?, ?)')
      .bind(replayHash, telegramUserId, expiresAt).run();
    return (result.changes ?? 0) > 0;
  }

  async acquireLease(resourceType: string, resourceId: string, ownerId: string, ttlSeconds: number) {
    const timestamp = new Date();
    await this.database.prepare('DELETE FROM sync_leases WHERE expires_at <= ?').bind(timestamp.toISOString()).run();
    const result = await this.database.prepare('INSERT OR IGNORE INTO sync_leases (resource_type, resource_id, owner_id, acquired_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(resourceType, resourceId, ownerId, timestamp.toISOString(), new Date(timestamp.getTime() + ttlSeconds * 1000).toISOString()).run();
    return (result.changes ?? 0) > 0;
  }

  async releaseLease(resourceType: string, resourceId: string, ownerId: string) {
    await this.database.prepare('DELETE FROM sync_leases WHERE resource_type = ? AND resource_id = ? AND owner_id = ?')
      .bind(resourceType, resourceId, ownerId).run();
  }
}
