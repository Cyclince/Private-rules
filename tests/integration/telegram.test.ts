import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqliteDatabaseAdapter } from '../../src/infrastructure/database/sqlite/adapter';
import { applySqliteMigrations } from '../../src/infrastructure/database/sqlite/migrations';
import { createCategory } from '../../src/lib/db';
import { createApp } from '../../src/server/app';
import type { Env } from '../../src/types';
import { FakeTelegramClient } from '../helpers/fake-telegram-client';
import { notifyScheduledSync } from '../../src/integrations/telegram/services/notifications';
import { ensureTelegramRegistration } from '../../src/integrations/telegram/registration';
import { TelegramRepository } from '../../src/application/telegram/repository';
import { cleanupTelegramMessages, TELEGRAM_EPHEMERAL_TTL_SECONDS } from '../../src/integrations/telegram/services/message-cleanup';

function initData(token: string, userId: number, authDate: number, suffix = '') {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: `query-${userId}${suffix}`,
    user: JSON.stringify({ id: userId, first_name: 'Test', username: `user${userId}` }),
  });
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}

describe('private Telegram webhook, commands, and Mini App sessions', () => {
  let directory: string;
  let database: SqliteDatabaseAdapter;
  let env: Env;
  let fake: FakeTelegramClient;
  let categoryId: string;
  const tasks: Promise<unknown>[] = [];
  const app = createApp();
  const botToken = '123456:test-token';

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'private-rules-telegram-'));
    database = new SqliteDatabaseAdapter(join(directory, 'telegram.db'));
    await applySqliteMigrations(database, resolve(process.cwd(), 'migrations'));
    fake = new FakeTelegramClient();
    env = {
      DB: database,
      ASSETS: { fetch: async () => new Response('<html>admin</html>') },
      ADMIN_PASSWORD: 'password',
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      RULE_TOKEN: 'rule-token',
      BASE_URL: 'https://rules.example.com',
      RUNTIME: 'node',
      TELEGRAM_CLIENT: fake,
      TELEGRAM: {
        enabled: true, botToken, webhookSecret: 'webhook-secret', webhookUrl: 'https://rules.example.com/api/telegram/webhook',
        miniAppUrl: 'https://rules.example.com', userId: '1001', notificationChatId: '1001',
        updateMaxAgeSeconds: 300, sessionTtlSeconds: 1800, rateLimitPerMinute: 30,
        syncNotificationEnabled: true, production: false,
      },
      BACKGROUND_TASKS: { schedule(task) { tasks.push(task); } },
    };
    const created = await createCategory(env, { name: 'AI', tokenLinksEnabled: true, publicLinksEnabled: false });
    categoryId = created.categories.find((item) => item.name === 'AI')!.id;
  });

  afterAll(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  const webhook = (body: string, secret = 'webhook-secret', contentType = 'application/json') => app.request('/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': contentType, 'x-telegram-bot-api-secret-token': secret },
    body,
  }, env);

  it('registers commands, Mini App, and webhook automatically', async () => {
    await ensureTelegramRegistration(env.TELEGRAM!, fake);
    expect(fake.commands.map((item) => item.command)).toEqual(['start', 'help', 'status', 'rules', 'sources', 'sync']);
    expect(fake.menuButton?.text).toBe('面板');
    expect(fake.menuButton?.webAppUrl).toBe('https://rules.example.com/admin?view=dashboard');
    expect(fake.webhook).toEqual({
      url: 'https://rules.example.com/api/telegram/webhook',
      secretToken: 'webhook-secret',
      allowedUpdates: ['message', 'callback_query'],
    });
    await ensureTelegramRegistration(env.TELEGRAM!, fake);
  });

  it('rejects missing/wrong secrets, invalid content and malformed JSON', async () => {
    expect((await webhook('{}', '')).status).toBe(401);
    expect((await webhook('{}', 'wrong')).status).toBe(401);
    expect((await webhook('{}', 'webhook-secret', 'text/plain')).status).toBe(415);
    expect((await webhook('{')).status).toBe(400);
  });

  it('ignores expired and unknown updates without calling Telegram', async () => {
    const sent = fake.sent.length;
    const expired = await webhook(JSON.stringify({
      update_id: 4998,
      message: { message_id: 1, date: Math.floor(Date.now() / 1000) - 301, text: '/start', chat: { id: 1001 }, from: { id: 1001, first_name: 'Viewer' } },
    }));
    expect(await expired.json()).toMatchObject({ ok: true, ignored: 'expired' });
    expect((await webhook(JSON.stringify({ update_id: 4999 }))).status).toBe(200);
    await Promise.all(tasks.splice(0));
    expect(fake.sent).toHaveLength(sent);
  });

  it('accepts /start once, schedules background handling, and deduplicates update_id', async () => {
    const update = {
      update_id: 5001,
      message: { message_id: 1, date: Math.floor(Date.now() / 1000), text: '/start', chat: { id: 1001 }, from: { id: 1001, first_name: 'Viewer' } },
    };
    expect((await webhook(JSON.stringify(update))).status).toBe(200);
    await Promise.all(tasks.splice(0));
    expect(fake.photos.at(-1)).toMatchObject({
      photo: 'https://rules.example.com/tgbot-hero.png',
    });
    expect(fake.photos.at(-1)?.caption).toContain('Private Rules Bot');
    const homeRows = fake.photos.at(-1)?.replyMarkup?.inlineKeyboard ?? [];
    expect(homeRows.map((row) => row.map((button) => button.text))).toEqual([
      ['📊 规则汇总'],
      ['🔗 订阅信息', '🧩 上游状态'],
      ['🔍 搜索规则', '🔄 同步信息'],
    ]);
    expect(fake.photos.at(-1)?.caption).toContain('所有规则');
    expect(fake.photos.at(-1)?.caption).toContain('启用规则');
    expect(fake.photos.at(-1)?.caption).toContain('GeoSite');
    const sent = fake.sent.length;
    const duplicate = await webhook(JSON.stringify(update));
    expect(await duplicate.json()).toMatchObject({ ok: true, duplicate: true });
    await Promise.all(tasks.splice(0));
    expect(fake.sent).toHaveLength(sent);
  });

  it('allows the configured user to open the sync menu', async () => {
    const callback = {
      update_id: 5002,
      callback_query: {
        id: 'callback-1', data: 'sync:m', from: { id: 1001, first_name: 'Admin' },
        message: { message_id: 2, date: Math.floor(Date.now() / 1000), chat: { id: 1001 } },
      },
    };
    await webhook(JSON.stringify(callback));
    await Promise.all(tasks.splice(0));
    expect(fake.answered.some((item) => item.callbackQueryId === 'callback-1')).toBe(true);
    expect(fake.edited.at(-1)?.text).toContain('同步信息');
    expect(fake.edited.at(-1)?.text).toContain('可直接在 Bot 中执行手动同步');
    expect(fake.edited.at(-1)?.replyMarkup?.inlineKeyboard.flat().map((button) => button.text)).toContain('立即同步全部');
  });

  it('accepts fresh callback clicks from an old keyboard message', async () => {
    const editedBefore = fake.edited.length;
    const response = await webhook(JSON.stringify({
      update_id: 50020,
      callback_query: {
        id: 'callback-old-keyboard', data: 'cat:l:0', from: { id: 1001, first_name: 'Admin' },
        message: { message_id: 20, date: Math.floor(Date.now() / 1000) - 86_400, chat: { id: 1001 } },
      },
    }));
    expect(await response.json()).not.toMatchObject({ ignored: 'expired' });
    await Promise.all(tasks.splice(0));
    expect(fake.edited).toHaveLength(editedBefore + 1);
    expect(fake.edited.at(-1)?.text).toContain('规则分类');
  });

  it('edits the photo home message caption instead of creating a new message', async () => {
    const sentBefore = fake.sent.length;
    const captionsBefore = fake.editedCaptions.length;
    await webhook(JSON.stringify({
      update_id: 500201,
      callback_query: {
        id: 'callback-photo-home', data: 'cat:l:0', from: { id: 1001, first_name: 'Admin' },
        message: { message_id: 1, date: Math.floor(Date.now() / 1000), caption: 'Private Rules Bot', photo: [{}], chat: { id: 1001 } },
      },
    }));
    await Promise.all(tasks.splice(0));
    expect(fake.editedCaptions).toHaveLength(captionsBefore + 1);
    expect(fake.editedCaptions.at(-1)).toMatchObject({ messageId: 1, caption: expect.stringContaining('规则分类') });
    expect(fake.sent).toHaveLength(sentBefore);
  });

  it('deletes queued command and result messages after the retention period', async () => {
    const repository = new TelegramRepository(database);
    const timestamp = Date.now();
    await repository.enqueueMessageDeletion('1001', 9001, TELEGRAM_EPHEMERAL_TTL_SECONDS, timestamp);
    expect(await cleanupTelegramMessages(env, timestamp + (TELEGRAM_EPHEMERAL_TTL_SECONDS - 1) * 1000)).toEqual({ deleted: 0, failed: 0 });
    const cleanup = await cleanupTelegramMessages(env, timestamp + TELEGRAM_EPHEMERAL_TTL_SECONDS * 1000);
    expect(cleanup.failed).toBe(0);
    expect(cleanup.deleted).toBeGreaterThanOrEqual(1);
    expect(fake.deleted).toContainEqual({ chatId: '1001', messageId: 9001 });
  });

  it('edits the existing message when returning home and reports manual sync completion', async () => {
    const editedBefore = fake.edited.length;
    await webhook(JSON.stringify({
      update_id: 50021,
      callback_query: { id: 'callback-home', data: 'home', from: { id: 1001, first_name: 'Admin' }, message: { message_id: 21, date: Math.floor(Date.now() / 1000), chat: { id: 1001 } } },
    }));
    await Promise.all(tasks.splice(0));
    expect(fake.edited).toHaveLength(editedBefore + 1);
    expect(fake.edited.at(-1)?.messageId).toBe(21);
    expect(fake.edited.at(-1)?.text).toContain('Private Rules Bot');

    await webhook(JSON.stringify({
      update_id: 50022,
      callback_query: { id: 'callback-sync-all', data: 'sync:a', from: { id: 1001, first_name: 'Admin' }, message: { message_id: 22, date: Math.floor(Date.now() / 1000), chat: { id: 1001 } } },
    }));
    await Promise.all(tasks.splice(0));
    expect(fake.sent.some((item) => item.text.includes('同步任务已启动'))).toBe(true);
    expect(fake.sent.at(-1)?.text).toContain('同步完成');
    expect(fake.sent.at(-1)?.text).toContain('没有需要同步的来源');
  });

  it('uses Telegram copy buttons for subscription URLs', async () => {
    await webhook(JSON.stringify({
      update_id: 50023,
      callback_query: { id: 'callback-subscription', data: `sub:v:${categoryId}`, from: { id: 1001, first_name: 'Admin' }, message: { message_id: 23, date: Math.floor(Date.now() / 1000), chat: { id: 1001 } } },
    }));
    await Promise.all(tasks.splice(0));
    const buttons = fake.edited.at(-1)?.replyMarkup?.inlineKeyboard.flat() ?? [];
    expect(buttons.some((button) => 'copyText' in button && button.copyText.startsWith('https://'))).toBe(true);
    expect(buttons.some((button) => 'url' in button)).toBe(false);
  });

  it('handles every documented command with persistent search/cancel behavior', async () => {
    const cases = [
      ['/help', '仅限配置用户'],
      ['/status', '服务状态'],
      ['/categories', '规则分类'],
      ['/rules', '请输入域名'],
      ['/cancel', '已取消'],
      ['/subscriptions', '订阅管理'],
      ['/sources', '上游来源'],
      ['/panel', '打开私有规则面板'],
    ] as const;
    let updateId = 5100;
    for (const [command, expected] of cases) {
      await webhook(JSON.stringify({
        update_id: updateId++,
        message: { message_id: updateId, date: Math.floor(Date.now() / 1000), text: command, chat: { id: 1001 }, from: { id: 1001, first_name: 'Admin' } },
      }));
      await Promise.all(tasks.splice(0));
      expect(fake.sent.at(-1)?.text).toContain(expected);
    }
    for (const command of ['/addsource', '/addrule']) {
      await webhook(JSON.stringify({
        update_id: updateId++,
        message: { message_id: updateId, date: Math.floor(Date.now() / 1000), text: command, chat: { id: 1001 }, from: { id: 1001, first_name: 'Admin' } },
      }));
      await Promise.all(tasks.splice(0));
      expect(fake.sent.at(-1)?.text).toContain('未知命令');
    }
  });

  it('rejects invalid callback data and always answers callback queries', async () => {
    await webhook(JSON.stringify({
      update_id: 5200,
      callback_query: {
        id: 'callback-invalid', data: '{"secret":"value"}', from: { id: 1001, first_name: 'Viewer' },
        message: { message_id: 22, date: Math.floor(Date.now() / 1000), chat: { id: 1001 } },
      },
    }));
    await Promise.all(tasks.splice(0));
    expect(fake.answered.filter((item) => item.callbackQueryId === 'callback-invalid').length).toBeGreaterThan(0);
    expect(fake.answered.at(-1)).toMatchObject({ showAlert: true });
  });

  it('sends sanitized scheduled sync notifications through the injected client', async () => {
    env.TELEGRAM!.notificationChatId = '1002';
    await new TelegramRepository(database).saveNotificationPreferences('1002', { mode: 'immediate' });
    await notifyScheduledSync(env, [{
      sourceId: 'source', categoryId: 'category', name: 'Remote', ok: false, count: 0,
      error: 'HTTP 403', syncedAt: '2026-08-11T01:00:02.500Z',
    }, {
      sourceId: 'source-ok', categoryId: 'category', name: 'GeoSite', ok: true, count: 12,
      syncedAt: '2026-08-11T01:00:02.500Z',
    }], { startedAt: Date.parse('2026-08-11T01:00:00Z'), completedAt: Date.parse('2026-08-11T01:00:02.500Z') });
    expect(fake.sent.at(-1)).toMatchObject({ chatId: '1002' });
    expect(fake.sent.at(-1)?.text).toContain('HTTP 403');
    expect(fake.sent.at(-1)?.text).toContain('累计耗时：2.5 秒');
    expect(fake.sent.at(-1)?.text).toContain('来源统计：2 个（✅ 1 / ❌ 1）');
    expect(fake.sent.at(-1)?.text).toContain('规则结果：12 条');
    env.TELEGRAM!.notificationChatId = '';
  });

  it('separates delivery mode from mute state and checks the live Bot service', async () => {
    const login = await app.request('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'password' }),
    }, env);
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    const saved = await app.request('/api/telegram/notifications', {
      method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'digest', muted: true, digestTime: '09:00' }),
    }, env);
    expect(await saved.json()).toMatchObject({ preferences: { mode: 'digest', muted: true } });
    await new TelegramRepository(database).saveNotificationPreferences('1001', { mode: 'immediate', muted: true });
    await notifyScheduledSync(env, [{ sourceId: 'silent', categoryId: 'category', name: 'Silent source', ok: true, count: 3, syncedAt: new Date().toISOString() }]);
    expect(fake.sent.filter((item) => item.chatId === '1001').at(-1)).toMatchObject({ chatId: '1001', disableNotification: true });
    const checked = await app.request('/api/service-status', { headers: { cookie } }, env);
    expect(await checked.json()).toMatchObject({ services: { telegram: { status: 'online', username: 'private_rules_bot' } } });
    expect(fake.getMeCalls).toBeGreaterThan(0);
  });

  it('flushes a queued daily digest even when no source is due in that scheduler run', async () => {
    const repository = new TelegramRepository(database);
    await repository.saveNotificationPreferences('1003', { mode: 'digest', digestTime: '00:00' });
    await repository.enqueueNotification('1003', '✅ Remote：12 条', false);
    await notifyScheduledSync(env, []);
    expect(fake.sent.at(-1)).toMatchObject({ chatId: '1003' });
    expect(fake.sent.at(-1)?.text).toContain('同步摘要');
    expect(await repository.pendingNotifications('1003')).toHaveLength(0);
  });

  it('rejects every other user and rejects group chats', async () => {
    for (const [updateId, userId, chatId] of [[5003, 9999, 9999], [5004, 1001, -100123]]) {
      await webhook(JSON.stringify({
        update_id: updateId,
        message: { message_id: updateId, date: Math.floor(Date.now() / 1000), text: '/help', chat: { id: chatId }, from: { id: userId, first_name: 'Nope' } },
      }));
      await Promise.all(tasks.splice(0));
      expect(fake.sent.at(-1)?.text).toContain(`Telegram User ID：<code>${userId}</code>`);
      if (userId !== 1001) expect(fake.sent.at(-1)?.text).not.toContain('1001');
    }
  });

  it('validates initData, creates/revokes a private session, and rejects replay', async () => {
    const valid = initData(botToken, 1001, Math.floor(Date.now() / 1000));
    const login = await app.request('/api/telegram/session', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData: valid }),
    }, env);
    expect(login.status).toBe(201);
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(cookie).toContain('private_rules_telegram_session=');
    const me = await app.request('/api/telegram/session/me', { headers: { cookie } }, env);
    expect(await me.json()).toMatchObject({ telegramUserId: '1001' });
    expect((await app.request('/api/sync', { method: 'POST', headers: { cookie } }, env)).status).toBe(200);
    expect((await app.request('/api/telegram/session/logout', { method: 'POST', headers: { cookie } }, env)).status).toBe(200);
    expect((await app.request('/api/telegram/session/me', { headers: { cookie } }, env)).status).toBe(401);
    expect((await app.request('/api/telegram/session', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData: valid }),
    }, env)).status).toBe(401);
  });

  it('rejects bad signatures, expired auth_date, and missing users', async () => {
    const valid = initData(botToken, 1001, Math.floor(Date.now() / 1000), '-bad');
    const invalid = new URLSearchParams(valid);
    invalid.set('hash', '0'.repeat(64));
    for (const value of [
      invalid.toString(),
      initData(botToken, 1001, Math.floor(Date.now() / 1000) - 1000, '-expired'),
      new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), hash: '0'.repeat(64) }).toString(),
    ]) {
      const response = await app.request('/api/telegram/session', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData: value }),
      }, env);
      expect(response.status).toBe(401);
    }
  });
});
