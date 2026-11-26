import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteDatabaseAdapter } from '../../src/infrastructure/database/sqlite/adapter';
import { migrateSqliteDatabase } from '../../src/infrastructure/database/sqlite/migrations';
import { createApiKey } from '../../src/lib/auth';
import { addRule, createCategory } from '../../src/lib/db';
import { createApp } from '../../src/server/app';
import type { ClientLink, Env } from '../../src/types';

const PASSWORD = 'correct-password';
const LOCAL_ORIGIN = 'http://localhost';

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
});
