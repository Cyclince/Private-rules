import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteDatabaseAdapter } from '../../src/infrastructure/database/sqlite/adapter';
import { migrateSqliteDatabase } from '../../src/infrastructure/database/sqlite/migrations';
import { addRule, createCategory, getBackupData } from '../../src/lib/db';
import { createApiKey } from '../../src/lib/auth';
import { createApp } from '../../src/server/app';
import type { Env } from '../../src/types';

const PASSWORD = 'correct-password';

describe('1.0.7 security and data-safety fixes', () => {
  let directory: string; let database: SqliteDatabaseAdapter; let env: Env; let cookie = '';
  const app = createApp();

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'private-rules-fixes-'));
    database = new SqliteDatabaseAdapter(join(directory, 'fixes.db'));
    await migrateSqliteDatabase(database);
    env = {
      DB: database,
      ASSETS: { fetch: async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }) },
      ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: '0123456789abcdef0123456789abcdef', RULE_TOKEN: 'private-token', RUNTIME: 'node',
    };
    const data = await createCategory(env, { name: 'keep-me', tokenLinksEnabled: true, publicLinksEnabled: false });
    await addRule(env, data.categories[0].id, { value: 'keep.example' });
    cookie = '';
  });
  afterEach(async () => { database.close(); await rm(directory, { recursive: true, force: true }); });

  const request = (path: string, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const csrfHeaders =
      cookie && !['GET', 'HEAD', 'OPTIONS'].includes(method)
        ? { origin: 'http://localhost', 'content-type': 'application/json' }
        : {};
    return app.request(
      path,
      { ...init, headers: { ...csrfHeaders, ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) } },
      env,
    );
  };
  const login = async (password = PASSWORD, headers: Record<string, string> = {}) =>
    request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ password }) });
  const signIn = async () => {
    const response = await login();
    expect(response.status).toBe(200);
    cookie = response.headers.get('set-cookie')!.split(';')[0];
  };

  describe('backup import', () => {
    it('rejects a malformed backup without touching existing data', async () => {
      await signIn();
      const response = await request('/api/data', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings: {}, categories: [{ name: 'broken' }] }),
      });
      expect(response.status).toBe(400);
      const backup = await getBackupData(env);
      expect(backup.categories.map((category) => category.name)).toEqual(['keep-me']);
      expect(backup.categories[0].rules.map((rule) => rule.value)).toEqual(['keep.example']);
    });

    it('rejects rules with an invalid type', async () => {
      await signIn();
      const response = await request('/api/data', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings: {}, categories: [{ name: 'x', rules: [{ value: 'a.com', type: 'NOT-A-TYPE' }] }] }),
      });
      expect(response.status).toBe(400);
      expect((await getBackupData(env)).categories.map((category) => category.name)).toEqual(['keep-me']);
    });

    it('imports 1.1.0 rule types and options losslessly and formats them explicitly without silent drops', async () => {
      await signIn();
      const response = await request('/api/data', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          version: 2,
          settings: { policyName: 'PROXY' },
          categories: [{
            name: 'next-rules',
            publicLinksEnabled: true,
            tokenLinksEnabled: false,
            rules: [
              { value: '^ad\\..*\\.example$', type: 'DOMAIN-REGEX' },
              { value: 'curl', type: 'PROCESS-NAME' },
              { value: 'CustomBot/*', type: 'USER-AGENT' },
              { value: '^https://ads\\.example/', type: 'URL-REGEX' },
              { value: '10.0.0.0/8', type: 'IP-CIDR', options: { noResolve: true } },
            ],
          }],
        }),
      });
      expect(response.status).toBe(200);
      const after = await getBackupData(env);
      expect(after.version).toBe(2);
      expect(after.categories[0].rules).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'DOMAIN-REGEX', value: '^ad\\..*\\.example$' }),
        expect.objectContaining({ type: 'IP-CIDR', value: '10.0.0.0/8', options: { noResolve: true } }),
      ]));

      const yamlText = await (await request('/rules/next-rules.yaml')).text();
      expect(yamlText).toContain('DOMAIN-REGEX,^ad\\..*\\.example$');
      expect(yamlText).toContain('PROCESS-NAME,curl');
      expect(yamlText).toContain('IP-CIDR,10.0.0.0/8,no-resolve');

      const qxText = await (await request('/rules/next-rules-qx.list')).text();
      expect(qxText).toContain('USER-AGENT,CustomBot/*,PROXY');
      expect(qxText).toContain('# skipped (Quantumult X does not support DOMAIN-REGEX): DOMAIN-REGEX,^ad\\..*\\.example$');
      // iOS clients cannot match by process: PROCESS-NAME is omitted entirely (no comment line).
      expect(qxText).not.toContain('PROCESS-NAME');
      const loonText = await (await request('/rules/next-rules-loon.list')).text();
      expect(loonText).not.toContain('PROCESS-NAME');
      expect(loonText).toContain('DOMAIN-REGEX');
      expect(qxText).toContain('# skipped (Quantumult X does not support URL-REGEX): URL-REGEX,^https://ads\\.example/');

      const singboxJson = await (await request('/rules/next-rules.json')).json() as { rules: Array<Record<string, unknown>> };
      expect(singboxJson.rules).toEqual(expect.arrayContaining([
        expect.objectContaining({
          domain_regex: ['^ad\\..*\\.example$'],
          process_name: ['curl'],
          ip_cidr: ['10.0.0.0/8'],
        }),
      ]));
    });

    it('still restores a valid backup', async () => {
      await signIn();
      const backup = await getBackupData(env);
      backup.categories[0].name = 'restored';
      const response = await request('/api/data', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(backup) });
      expect(response.status).toBe(200);
      const after = await getBackupData(env);
      expect(after.categories.map((category) => category.name)).toEqual(['restored']);
      expect(after.categories[0].rules.map((rule) => rule.value)).toEqual(['keep.example']);
    });
  });

  describe('links endpoint', () => {
    it('does not reveal RULE_TOKEN to API key callers', async () => {
      const { apiKey } = await createApiKey(env, 'test');
      const response = await request('/api/links', { headers: { authorization: `Bearer ${apiKey}` } });
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain('private-token');
    });

    it('still returns token links to the admin session', async () => {
      await signIn();
      const response = await request('/api/links');
      expect(await response.text()).toContain('private-token');
    });
  });

  describe('login rate limiting', () => {
    it('locks out after repeated failures, even for the right password', async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) expect((await login('wrong')).status).toBe(401);
      expect((await login('wrong')).status).toBe(429);
      expect((await login(PASSWORD)).status).toBe(429);
    });

    it('ignores spoofed x-forwarded-for unless TRUST_PROXY is enabled', async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        expect((await login('wrong', { 'x-forwarded-for': `203.0.113.${attempt}` })).status).toBe(401);
      }
      expect((await login('wrong', { 'x-forwarded-for': '198.51.100.1' })).status).toBe(429);
    });

    it('separates clients by x-forwarded-for when TRUST_PROXY is enabled', async () => {
      env.TRUST_PROXY = true;
      for (let attempt = 0; attempt < 10; attempt += 1) expect((await login('wrong', { 'x-forwarded-for': '203.0.113.7' })).status).toBe(401);
      expect((await login('wrong', { 'x-forwarded-for': '203.0.113.7' })).status).toBe(429);
      expect((await login(PASSWORD, { 'x-forwarded-for': '198.51.100.1' })).status).toBe(200);
    });
  });
});
