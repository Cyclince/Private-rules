import { TelegramRepository } from '../../../application/telegram/repository';
import type { SyncResult } from '../../../lib/sync';
import type { Env } from '../../../types';

const DIGEST_TIME_ZONE = 'Asia/Shanghai';

type SyncNotificationTiming = { startedAt?: number; completedAt?: number };
type StoredSyncEvent = {
  v: 1;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  sources: number;
  succeeded: number;
  failed: number;
  rules: number;
  failures: Array<{ name: string; error: string }>;
};

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeText(value: string, limit: number) {
  return value.replace(/([?&](?:token|key|auth|signature)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(authorization|cookie):\s*[^\s]+/gi, '$1: [redacted]').slice(0, limit);
}

function eventFromResults(results: SyncResult[], timing: SyncNotificationTiming = {}): StoredSyncEvent {
  const resultCompletedAt = Math.max(0, ...results.map((result) => Date.parse(result.syncedAt)).filter(Number.isFinite));
  const completedAtMs = timing.completedAt ?? (resultCompletedAt || Date.now());
  const startedAtMs = Math.min(timing.startedAt ?? completedAtMs, completedAtMs);
  const succeeded = results.filter((result) => result.ok);
  const failures = results.filter((result) => !result.ok);
  return {
    v: 1,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: Math.max(0, completedAtMs - startedAtMs),
    sources: results.length,
    succeeded: succeeded.length,
    failed: failures.length,
    rules: succeeded.reduce((total, result) => total + result.count, 0),
    failures: failures.slice(0, 8).map((result) => ({
      name: safeText(result.name, 80),
      error: safeText(result.error ?? '同步失败', 180),
    })),
  };
}

function parseStoredEvent(value: string): StoredSyncEvent | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredSyncEvent>;
    if (parsed.v !== 1 || !Number.isFinite(parsed.sources) || !Array.isArray(parsed.failures)) return null;
    return parsed as StoredSyncEvent;
  } catch {
    return null;
  }
}

function localDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: DIGEST_TIME_ZONE, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
}

function durationLabel(milliseconds: number) {
  if (milliseconds < 1000) return `${Math.max(0, Math.round(milliseconds))} 毫秒`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)} 秒`;
  const minutes = Math.floor(milliseconds / 60_000);
  return `${minutes} 分 ${Math.round((milliseconds % 60_000) / 1000)} 秒`;
}

function formatDigest(events: StoredSyncEvent[], title: string, legacyCount = 0) {
  const startedAt = events.map((event) => event.startedAt).sort()[0];
  const completedAt = events.map((event) => event.completedAt).sort().at(-1);
  const sources = events.reduce((total, event) => total + event.sources, 0);
  const succeeded = events.reduce((total, event) => total + event.succeeded, 0);
  const failed = events.reduce((total, event) => total + event.failed, 0);
  const rules = events.reduce((total, event) => total + event.rules, 0);
  const durationMs = events.reduce((total, event) => total + event.durationMs, 0);
  const failures = events.flatMap((event) => event.failures).slice(0, 8);
  const lines = [
    `<b>${escapeHtml(title)}${failed ? '（存在失败）' : ''}</b>`,
    '',
    `🕘 同步时间：${startedAt && completedAt ? `${localDateTime(startedAt)} – ${localDateTime(completedAt)}` : '暂无'}`,
    `⏱ 累计耗时：${durationLabel(durationMs)}`,
    `🔄 同步任务：${events.length} 次`,
    `📦 来源统计：${sources} 个（✅ ${succeeded} / ❌ ${failed}）`,
    `📚 规则结果：${rules.toLocaleString('zh-CN')} 条`,
  ];
  if (failures.length) {
    lines.push('', '<b>需要关注</b>', ...failures.map((failure) => `• ${escapeHtml(failure.name)}：${escapeHtml(failure.error)}`));
  }
  if (legacyCount) lines.push('', `另有 ${legacyCount} 条旧版摘要记录已归档。`);
  return lines.join('\n').slice(0, 3900);
}

function currentDigestClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DIGEST_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

export async function notifyScheduledSync(env: Env, results: SyncResult[], timing: SyncNotificationTiming = {}) {
  if (!env.TELEGRAM?.enabled || !env.TELEGRAM.syncNotificationEnabled || !env.TELEGRAM_CLIENT) return;
  const event = results.length ? eventFromResults(results, timing) : null;
  const failed = event ? event.failed > 0 : false;
  const repository = new TelegramRepository(env.DB);
  const configured = env.TELEGRAM.notificationChatId ? [env.TELEGRAM.notificationChatId] : [];
  const chats = [...new Set([...configured, ...await repository.listNotificationChats(failed), ...await repository.listPendingNotificationChats()])];
  await Promise.allSettled(chats.map(async (chatId) => {
    const preferences = await repository.getNotificationPreferences(chatId);
    if (preferences.mode === 'off') return;
    if (preferences.mode === 'immediate' && event) {
      await env.TELEGRAM_CLIENT!.sendMessage(chatId, formatDigest([event], '定时同步完成'), { parseMode: 'HTML', disableNotification: preferences.muted });
      return;
    }
    if (preferences.mode !== 'digest') return;
    if (event) await repository.enqueueNotification(chatId, JSON.stringify(event), failed);
    const { date, time } = currentDigestClock();
    if (time < preferences.digestTime || preferences.lastDigestDate === date) return;
    const pending = await repository.pendingNotifications(chatId);
    if (!pending.length) return;
    const events = pending.map((item) => parseStoredEvent(item.summary)).filter((item): item is StoredSyncEvent => item !== null);
    const legacyCount = pending.length - events.length;
    const digest = events.length
      ? formatDigest(events, `同步摘要 · ${date}`, legacyCount)
      : `<b>同步摘要 · ${date}</b>\n\n已归档 ${legacyCount} 条旧版同步记录。`;
    await env.TELEGRAM_CLIENT!.sendMessage(chatId, digest, { parseMode: 'HTML', disableNotification: preferences.muted });
    await repository.markNotificationsDelivered(chatId, pending.map((item) => item.id), date);
  }));
}
