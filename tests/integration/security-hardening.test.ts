import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TelegramRepository } from '../../src/application/telegram/repository';
import { SqliteDatabaseAdapter } from '../../src/infrastructure/database/sqlite/adapter';
import { migrateSqliteDatabase } from '../../src/infrastructure/database/sqlite/migrations';
import { createApiKey } from '../../src/lib/auth';
import { addRule, createCategory } from '../../src/lib/db';
import { createApp } from '../../src/server/app';
import type { ClientLink, Env } from '../../src/types';

const PASSWORD = 'correct-password';
const LOCAL_ORIGIN = 'http://localhost';

function createTelegramInitData(botToken: string, userId: number, suffix = '') {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `sec-query-${userId}${suffix}`,
    user: JSON.stringify({ id: userId, first_name: 'MiniApp', username: `user${userId}` }),
  });
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}

describe('M1.4 security hardening (CSRF, CORS, rate-limit identity, /api/links)', () => {
  let directory: string;
  let database: SqliteDatabaseAdapter;
  let env: Env;
  let cookie = '';
  let publicCategoryId = '';
  let privateCategoryId = '';
  let disabledCategoryId = '';
  const app = createApp();

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'private-rules-security-'));
    database = new SqliteDatabaseAdapter(join(directory, 'security.db'));
    await migrateSqliteDatabase(database);
    env = {
      DB: database,
      ASSETS: { fetch: async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }) },
      ADMIN_PASSWORD: PASSWORD,
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      RULE_TOKEN: 'secret-rule-token',
      RUNTIME: 'node',
      TELEGRAM: {
        enabled: true,
        botToken: '123456:test-token',
        webhookSecret: 'webhook-secret',
        webhookUrl: 'https://rules.example.com/api/telegram/webhook',
        miniAppUrl: 'https://rules.example.com',
        userId: '1001',
        notificationChatId: '1001',
        updateMaxAgeSeconds: 300,
        sessionTtlSeconds: 1800,
        sessionMaxLifetimeSeconds: 604800,
        rateLimitPerMinute: 30,
        syncNotificationEnabled: true,
        production: false,
      },
    };
    const pub = await createCategory(env, { name: 'public-cat', tokenLinksEnabled: false, publicLinksEnabled: true });
    publicCategoryId = pub.categories.find((c) => c.name === 'public-cat')!.id;
    await addRule(env, publicCategoryId, { value: 'public.example' });

    const priv = await createCategory(env, { name: 'private-cat', tokenLinksEnabled: true, publicLinksEnabled: false });
    privateCategoryId = priv.categories.find((c) => c.name === 'private-cat')!.id;
    await addRule(env, privateCategoryId, { value: 'private.example' });

    const dis = await createCategory(env, {
      name: 'disabled-cat',
      tokenLinksEnabled: false,
      publicLinksEnabled: false,
    });
    disabledCategoryId = dis.categories.find((c) => c.name === 'disabled-cat')!.id;
    await addRule(env, disabledCategoryId, { value: 'disabled.example' });

    cookie = '';
  });

  afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  const signIn = async () => {
    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: LOCAL_ORIGIN },
        body: JSON.stringify({ password: PASSWORD }),
      },
      env,
    );
    expect(res.status).toBe(200);
    cookie = res.headers.get('set-cookie')!.split(';')[0];
  };

  describe('CSRF enforcement on Cookie session writes', () => {
    it('rejects Cookie session writes missing Origin with 403 CSRF_REJECTED', async () => {
      await signIn();
      const res = await app.request(
        '/api/settings',
        {
          method: 'PATCH',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ policyName: 'PROXY' }),
        },
        env,
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ ok: false, code: 'CSRF_REJECTED' });
    });

    it('rejects Cookie session writes with cross-origin Origin header', async () => {
      await signIn();
      const res = await app.request(
        '/api/settings',
        {
          method: 'PATCH',
          headers: { cookie, 'content-type': 'application/json', origin: 'https://evil.example' },
          body: JSON.stringify({ policyName: 'PROXY' }),
        },
        env,
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ ok: false, code: 'CSRF_REJECTED' });
    });

    it('rejects Cookie session writes with non-JSON Content-Type', async () => {
      await signIn();
      const res = await app.request(
        '/api/settings',
        {
          method: 'PATCH',
          headers: { cookie, 'content-type': 'text/plain', origin: LOCAL_ORIGIN },
          body: JSON.stringify({ policyName: 'PROXY' }),
        },
        env,
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ ok: false, code: 'CSRF_REJECTED' });
    });

    it('accepts Cookie session writes with matching Origin and application/json Content-Type', async () => {
      await signIn();
      const res = await app.request(
        '/api/settings',
        {
          method: 'PATCH',
          headers: { cookie, 'content-type': 'application/json; charset=utf-8', origin: LOCAL_ORIGIN },
          body: JSON.stringify({ policyName: 'PROXY' }),
        },
        env,
      );
      expect(res.status).toBe(200);
    });

    it('matches BASE_URL origin when configured', async () => {
      env.BASE_URL = 'https://rules.example.com';
      await signIn();
      const bad = await app.request(
        '/api/settings',
        {
          method: 'PATCH',
          headers: { cookie, 'content-type': 'application/json', origin: LOCAL_ORIGIN },
          body: JSON.stringify({ policyName: 'PROXY' }),
        },
        env,
      );
      expect(bad.status).toBe(403);
      expect(await bad.json()).toMatchObject({ ok: false, code: 'CSRF_REJECTED' });

      const good = await app.request(
        '/api/settings',
        {
          method: 'PATCH',
          headers: { cookie, 'content-type': 'application/json', origin: 'https://rules.example.com' },
          body: JSON.stringify({ policyName: 'PROXY' }),
        },
        env,
      );
      expect(good.status).toBe(200);
    });

    it('exempts Bearer API Key writes from Origin check', async () => {
      const { apiKey } = await createApiKey(env, 'ci-bot');
      const res = await app.request(
        '/api/settings',
        {
          method: 'PATCH',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ policyName: 'DIRECT' }),
        },
        env,
      );
      expect(res.status).toBe(200);
    });
  });

  describe('CORS policy tightening', () => {
    it('does not emit Access-Control-Allow-Origin: * on /api/* responses or preflights', async () => {
      await signIn();
      const getRes = await app.request('/api/categories', { headers: { cookie } }, env);
      expect(getRes.status).toBe(200);
      expect(getRes.headers.get('access-control-allow-origin')).toBeNull();

      const optRes = await app.request(
        '/api/categories',
        { method: 'OPTIONS', headers: { origin: 'https://evil.example' } },
        env,
      );
      expect(optRes.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('preserves Access-Control-Allow-Origin: * on public subscription routes', async () => {
      const pubRes = await app.request('/rules/public-cat.yaml', {}, env);
      expect(pubRes.status).toBe(200);
      expect(pubRes.headers.get('access-control-allow-origin')).toBe('*');

      const subRes = await app.request('/sub/secret-rule-token/private-cat.yaml', {}, env);
      expect(subRes.status).toBe(200);
      expect(subRes.headers.get('access-control-allow-origin')).toBe('*');
    });
  });

  describe('/api/telegram/session rate-limit identity', () => {
    it('ignores spoofed x-forwarded-for when TRUST_PROXY is false', async () => {
      for (let i = 0; i < 10; i += 1) {
        const res = await app.request(
          '/api/telegram/session',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${i + 1}` },
            body: JSON.stringify({ initData: 'invalid' }),
          },
          env,
        );
        expect(res.status).toBe(401);
      }
      const blocked = await app.request(
        '/api/telegram/session',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.99' },
          body: JSON.stringify({ initData: 'invalid' }),
        },
        env,
      );
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    });

    it('separates clients by x-forwarded-for when TRUST_PROXY is true', async () => {
      env.TRUST_PROXY = true;
      for (let i = 0; i < 10; i += 1) {
        const res = await app.request(
          '/api/telegram/session',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
            body: JSON.stringify({ initData: 'invalid' }),
          },
          env,
        );
        expect(res.status).toBe(401);
      }
      const blocked = await app.request(
        '/api/telegram/session',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
          body: JSON.stringify({ initData: 'invalid' }),
        },
        env,
      );
      expect(blocked.status).toBe(429);

      const otherClient = await app.request(
        '/api/telegram/session',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.42' },
          body: JSON.stringify({ initData: 'invalid' }),
        },
        env,
      );
      expect(otherClient.status).toBe(401);
    });
  });

  describe('/api/links access-policy filtering', () => {
    it('returns only URLs that are actually accessible under each category policy', async () => {
      await signIn();
      const res = await app.request('/api/links', { headers: { cookie } }, env);
      expect(res.status).toBe(200);
      const { links } = (await res.json()) as { links: Record<string, ClientLink[]> };

      // Public-only category: publicUrl valid, tokenUrl empty
      for (const link of links[publicCategoryId]) {
        expect(link.publicUrl).toContain('/rules/');
        expect(link.tokenUrl).toBe('');
        expect(link.recommendedUrl).toBe(link.publicUrl);
      }

      // Token-only category: publicUrl empty, tokenUrl valid
      for (const link of links[privateCategoryId]) {
        expect(link.publicUrl).toBe('');
        expect(link.tokenUrl).toContain('/sub/secret-rule-token/');
        expect(link.recommendedUrl).toBe(link.tokenUrl);
      }

      // Disabled category: both empty
      for (const link of links[disabledCategoryId]) {
        expect(link.publicUrl).toBe('');
        expect(link.tokenUrl).toBe('');
        expect(link.recommendedUrl).toBe('');
      }
    });

    it('returns no tokenUrl and no invalid publicUrl for API key callers on private categories', async () => {
      const { apiKey } = await createApiKey(env, 'reader');
      const res = await app.request('/api/links', { headers: { authorization: `Bearer ${apiKey}` } }, env);
      expect(res.status).toBe(200);
      const { links } = (await res.json()) as { links: Record<string, ClientLink[]> };

      for (const link of links[privateCategoryId]) {
        expect(link.publicUrl).toBe('');
        expect(link.tokenUrl).toBe('');
        expect(link.recommendedUrl).toBe('');
      }
      for (const link of links[publicCategoryId]) {
        expect(link.publicUrl).toContain('/rules/');
        expect(link.tokenUrl).toBe('');
        expect(link.recommendedUrl).toBe(link.publicUrl);
      }
    });
  });

  describe('Telegram Mini App server-side restrictions on backup and high-risk settings', () => {
    const signInTelegram = async (suffix = '') => {
      const initData = createTelegramInitData(env.TELEGRAM!.botToken, 1001, suffix);
      const res = await app.request(
        '/api/telegram/session',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: LOCAL_ORIGIN },
          body: JSON.stringify({ initData }),
        },
        env,
      );
      expect(res.status).toBe(201);
      return res.headers.get('set-cookie')!.split(';')[0];
    };

    const minimalBackupPayload = {
      version: 2,
      categories: [],
      settings: {
        baseUrl: 'https://overwritten.example',
      },
    };

    it('rejects Telegram session access to backup endpoints and 1.0.x /api/data aliases with 403 and audit logs', async () => {
      const tgCookie = await signInTelegram('-backup');

      const getBackup = await app.request('/api/backup', { headers: { cookie: tgCookie } }, env);
      expect(getBackup.status).toBe(403);
      expect(await getBackup.json()).toMatchObject({ ok: false, code: 'FORBIDDEN' });

      const validateBackup = await app.request(
        '/api/backup/validate',
        {
          method: 'POST',
          headers: { cookie: tgCookie, origin: LOCAL_ORIGIN, 'content-type': 'application/json' },
          body: JSON.stringify(minimalBackupPayload),
        },
        env,
      );
      expect(validateBackup.status).toBe(403);
      expect(await validateBackup.json()).toMatchObject({ ok: false, code: 'FORBIDDEN' });

      const putBackup = await app.request(
        '/api/backup',
        {
          method: 'PUT',
          headers: { cookie: tgCookie, origin: LOCAL_ORIGIN, 'content-type': 'application/json' },
          body: JSON.stringify(minimalBackupPayload),
        },
        env,
      );
      expect(putBackup.status).toBe(403);
      expect(await putBackup.json()).toMatchObject({ ok: false, code: 'FORBIDDEN' });

      const getLegacyData = await app.request('/api/data', { headers: { cookie: tgCookie } }, env);
      expect(getLegacyData.status).toBe(403);
      expect(await getLegacyData.json()).toMatchObject({ ok: false, code: 'FORBIDDEN' });

      const putLegacyData = await app.request(
        '/api/data',
        {
          method: 'PUT',
          headers: { cookie: tgCookie, origin: LOCAL_ORIGIN, 'content-type': 'application/json' },
          body: JSON.stringify(minimalBackupPayload),
        },
        env,
      );
      expect(putLegacyData.status).toBe(403);
      expect(await putLegacyData.json()).toMatchObject({ ok: false, code: 'FORBIDDEN' });

      // Existing rulesets must remain untouched after denied imports
      await signIn();
      const after = await app.request('/api/rulesets', { headers: { cookie } }, env);
      expect(after.status).toBe(200);
      const overview = (await after.json()) as { data: { categories: Array<{ id: string }> } };
      expect(overview.data.categories.map((item) => item.id)).toContain(publicCategoryId);

      // All 5 denied requests (including GET /api/backup and GET /api/data) must be audited
      const logs = await new TelegramRepository(database).listAuditLogs(20);
      const deniedActions = logs
        .filter((log) => log.telegram_user_id === '1001' && log.result === 'denied' && log.summary === 'status=403')
        .map((log) => log.action);
      expect(deniedActions).toEqual(
        expect.arrayContaining([
          'GET /api/backup',
          'POST /api/backup/validate',
          'PUT /api/backup',
          'GET /api/data',
          'PUT /api/data',
        ]),
      );
    });

    it('rejects Telegram session writes to high-risk /api/settings fields with 403 and audit logs, while allowing safe preferences', async () => {
      const tgCookie = await signInTelegram('-settings');
      const highRiskPatches: Array<Record<string, unknown>> = [
        { baseUrl: 'https://evil.example' },
        { githubMirrorUrl: 'https://mirror.evil.example' },
        { publicLinksEnabled: false },
        { tokenLinksEnabled: false },
        { customIconPackUrls: ['https://evil.example/icons.json'] },
        { customIconPackNames: { 'https://evil.example/icons.json': 'Evil' } },
        { iconPackLastUpdatedAt: '2099-01-01T00:00:00.000Z' },
        { policyName: 'PROXY', baseUrl: 'https://evil.example' },
      ];

      for (const patch of highRiskPatches) {
        const res = await app.request(
          '/api/settings',
          {
            method: 'PATCH',
            headers: { cookie: tgCookie, origin: LOCAL_ORIGIN, 'content-type': 'application/json' },
            body: JSON.stringify(patch),
          },
          env,
        );
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ ok: false, code: 'FORBIDDEN' });
      }

      // Safe preference update still succeeds under Telegram session
      const safeRes = await app.request(
        '/api/settings',
        {
          method: 'PATCH',
          headers: { cookie: tgCookie, origin: LOCAL_ORIGIN, 'content-type': 'application/json' },
          body: JSON.stringify({
            policyName: 'MATCH',
            iconPackAutoUpdate: false,
            iconPackUpdateIntervalHours: 48,
          }),
        },
        env,
      );
      expect(safeRes.status).toBe(200);
      const updated = (await safeRes.json()) as {
        data: {
          settings: {
            baseUrl: string;
            githubMirrorUrl: string;
            publicLinksEnabled: boolean;
            tokenLinksEnabled: boolean;
            customIconPackUrls: string[];
            policyName: string;
            iconPackAutoUpdate: boolean;
            iconPackUpdateIntervalHours: number;
          };
        };
      };
      expect(updated.data.settings.baseUrl).toBe('');
      expect(updated.data.settings.githubMirrorUrl).toBe('');
      expect(updated.data.settings.publicLinksEnabled).toBe(true);
      expect(updated.data.settings.tokenLinksEnabled).toBe(true);
      expect(updated.data.settings.customIconPackUrls).toEqual([]);
      expect(updated.data.settings.policyName).toBe('MATCH');
      expect(updated.data.settings.iconPackAutoUpdate).toBe(false);
      expect(updated.data.settings.iconPackUpdateIntervalHours).toBe(48);

      const logs = await new TelegramRepository(database).listAuditLogs(30);
      const deniedSettings = logs.filter(
        (log) =>
          log.telegram_user_id === '1001' &&
          log.action === 'PATCH /api/settings' &&
          log.result === 'denied' &&
          log.summary === 'status=403',
      );
      expect(deniedSettings).toHaveLength(highRiskPatches.length);
      expect(
        logs.some(
          (log) =>
            log.telegram_user_id === '1001' &&
            log.action === 'PATCH /api/settings' &&
            log.result === 'success' &&
            log.summary === 'status=200',
        ),
      ).toBe(true);
    });

    it('keeps admin Cookie sessions unaffected for backup endpoints and high-risk settings', async () => {
      await signIn();

      const exportedRes = await app.request('/api/backup', { headers: { cookie } }, env);
      expect(exportedRes.status).toBe(200);
      const backupPayload = await exportedRes.json();

      const legacyExportRes = await app.request('/api/data', { headers: { cookie } }, env);
      expect(legacyExportRes.status).toBe(200);

      const validateRes = await app.request(
        '/api/backup/validate',
        {
          method: 'POST',
          headers: { cookie, origin: LOCAL_ORIGIN, 'content-type': 'application/json' },
          body: JSON.stringify(backupPayload),
        },
        env,
      );
      expect(validateRes.status).toBe(200);

      const importRes = await app.request(
        '/api/backup',
        {
          method: 'PUT',
          headers: { cookie, origin: LOCAL_ORIGIN, 'content-type': 'application/json' },
          body: JSON.stringify(backupPayload),
        },
        env,
      );
      expect(importRes.status).toBe(200);

      const legacyImportRes = await app.request(
        '/api/data',
        {
          method: 'PUT',
          headers: { cookie, origin: LOCAL_ORIGIN, 'content-type': 'application/json' },
          body: JSON.stringify(backupPayload),
        },
        env,
      );
      expect(legacyImportRes.status).toBe(200);

      const settingsRes = await app.request(
        '/api/settings',
        {
          method: 'PATCH',
          headers: { cookie, origin: LOCAL_ORIGIN, 'content-type': 'application/json' },
          body: JSON.stringify({
            baseUrl: 'https://rules.example.com',
            githubMirrorUrl: 'https://mirror.example.com',
            publicLinksEnabled: false,
            tokenLinksEnabled: true,
            customIconPackUrls: ['https://cdn.example.com/icons.json'],
            customIconPackNames: { 'https://cdn.example.com/icons.json': 'Custom' },
          }),
        },
        env,
      );
      expect(settingsRes.status).toBe(200);
      const {
        data: { settings },
      } = (await settingsRes.json()) as {
        data: {
          settings: {
            baseUrl: string;
            githubMirrorUrl: string;
            publicLinksEnabled: boolean;
            customIconPackUrls: string[];
          };
        };
      };
      expect(settings.baseUrl).toBe('https://rules.example.com');
      expect(settings.githubMirrorUrl).toBe('https://mirror.example.com');
      expect(settings.publicLinksEnabled).toBe(false);
      expect(settings.customIconPackUrls).toEqual(['https://cdn.example.com/icons.json']);
    });

    it('keeps Bearer API Key callers unaffected for backup endpoints and high-risk settings', async () => {
      const { apiKey } = await createApiKey(env, 'backup-automation');
      const authHeaders = { authorization: `Bearer ${apiKey}` };
      const jsonHeaders = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };

      const exportedRes = await app.request('/api/backup', { headers: authHeaders }, env);
      expect(exportedRes.status).toBe(200);
      const backupPayload = await exportedRes.json();

      const legacyExportRes = await app.request('/api/data', { headers: authHeaders }, env);
      expect(legacyExportRes.status).toBe(200);

      const validateRes = await app.request(
        '/api/backup/validate',
        { method: 'POST', headers: jsonHeaders, body: JSON.stringify(backupPayload) },
        env,
      );
      expect(validateRes.status).toBe(200);

      const importRes = await app.request(
        '/api/backup',
        { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(backupPayload) },
        env,
      );
      expect(importRes.status).toBe(200);

      const legacyImportRes = await app.request(
        '/api/data',
        { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(backupPayload) },
        env,
      );
      expect(legacyImportRes.status).toBe(200);

      const settingsRes = await app.request(
        '/api/settings',
        {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify({
            baseUrl: 'https://api.example.com',
            githubMirrorUrl: 'https://gh.example.com',
            publicLinksEnabled: true,
            tokenLinksEnabled: false,
          }),
        },
        env,
      );
      expect(settingsRes.status).toBe(200);
      const {
        data: { settings },
      } = (await settingsRes.json()) as {
        data: { settings: { baseUrl: string; githubMirrorUrl: string; tokenLinksEnabled: boolean } };
      };
      expect(settings.baseUrl).toBe('https://api.example.com');
      expect(settings.githubMirrorUrl).toBe('https://gh.example.com');
      expect(settings.tokenLinksEnabled).toBe(false);
    });
  });
});
