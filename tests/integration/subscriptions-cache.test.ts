import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabasePort, DatabaseStatement } from '../../src/application/ports/database';
import { SqliteDatabaseAdapter } from '../../src/infrastructure/database/sqlite/adapter';
import { migrateSqliteDatabase } from '../../src/infrastructure/database/sqlite/migrations';
import { createApiKey } from '../../src/lib/auth';
import { addRule, createCategory } from '../../src/lib/db';
import { createApp, type AppType } from '../../src/server/app';
import type { Env, SubscriptionCacheStore } from '../../src/types';

class InMemoryCacheStore implements SubscriptionCacheStore {
  readonly entries = new Map<string, { status: number; headers: Array<[string, string]>; body: string }>();
  matchCalls = 0;
  putCalls = 0;
  deleteCalls = 0;

  private keyOf(request: Request | string): string {
    return typeof request === 'string' ? request : request.url;
  }

  async match(request: Request | string): Promise<Response | undefined> {
    this.matchCalls += 1;
    const hit = this.entries.get(this.keyOf(request));
    if (!hit) return undefined;
    return new Response(hit.body, { status: hit.status, headers: new Headers(hit.headers) });
  }

  async put(request: Request | string, response: Response): Promise<void> {
    this.putCalls += 1;
    const body = await response.text();
    const headers: Array<[string, string]> = [];
    response.headers.forEach((value, key) => headers.push([key, value]));
    this.entries.set(this.keyOf(request), { status: response.status, headers, body });
  }

  async delete(request: Request | string): Promise<boolean> {
    this.deleteCalls += 1;
    return this.entries.delete(this.keyOf(request));
  }
}

class QuerySpyDatabase implements DatabasePort {
  readonly preparedSql: string[] = [];

  constructor(private readonly inner: DatabasePort) {}

  prepare(sql: string): DatabaseStatement {
    this.preparedSql.push(sql);
    return this.inner.prepare(sql);
  }

  batch<T = unknown>(statements: DatabaseStatement[]) {
    return this.inner.batch<T>(statements);
  }

  ping() {
    return this.inner.ping();
  }
}

describe('M1.4 subscriptions caching, ETag/304, single-category query, and canonical routes', () => {
  let directory: string;
  let database: SqliteDatabaseAdapter;
  let spyDb: QuerySpyDatabase;
  let cache: InMemoryCacheStore;
  let env: Env;
  let cookie = '';
  let apiKey = '';
  let targetCategoryId = '';
  const app = createApp();

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'private-rules-sub-cache-'));
    database = new SqliteDatabaseAdapter(join(directory, 'cache.db'));
    await migrateSqliteDatabase(database);
    spyDb = new QuerySpyDatabase(database);
    cache = new InMemoryCacheStore();
    env = {
      DB: spyDb,
      ASSETS: { fetch: async () => new Response('<html></html>') },
      ADMIN_PASSWORD: 'test-password',
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      RULE_TOKEN: 'cache-token',
      RUNTIME: 'cloudflare',
      SUBSCRIPTION_CACHE: cache,
    };

    const created = await createCategory(env, { name: 'alpha', tokenLinksEnabled: false, publicLinksEnabled: true });
    targetCategoryId = created.categories.find((c) => c.name === 'alpha')!.id;
    await addRule(env, targetCategoryId, { value: 'alpha.example.com' });

    const other = await createCategory(env, { name: 'beta', tokenLinksEnabled: true, publicLinksEnabled: false });
    const otherId = other.categories.find((c) => c.name === 'beta')!.id;
    await addRule(env, otherId, { value: 'beta.example.com' });

    const keyRes = await createApiKey(env, 'test-client');
    apiKey = keyRes.apiKey;

    const login = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost' },
        body: JSON.stringify({ password: 'test-password' }),
      },
      env,
    );
    cookie = login.headers.get('set-cookie')!.split(';')[0];
  });

  afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('queries only the matched category_id, sets ETag + Cache-Control: max-age=300, and returns 304 on If-None-Match', async () => {
    spyDb.preparedSql.length = 0;

    const first = await app.request('/rules/alpha.yaml', {}, env);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('max-age=300');
    expect(first.headers.get('access-control-allow-origin')).toBe('*');
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^"[0-9a-f]{24}"$/);
    expect(await first.text()).toContain('alpha.example.com');

    // Verify rules were queried with a `where` filter on category_id (no full-table rules scan)
    const ruleQueries = spyDb.preparedSql.filter((sql) => sql.toLowerCase().includes('from "rules"'));
    expect(ruleQueries.length).toBe(1);
    expect(ruleQueries[0].toLowerCase()).toContain('"category_id"');
    expect(cache.putCalls).toBe(1);

    // Second request is served from Workers Cache API without touching the DB
    spyDb.preparedSql.length = 0;
    const cachedHit = await app.request('/rules/alpha.yaml', {}, env);
    expect(cachedHit.status).toBe(200);
    expect(cachedHit.headers.get('etag')).toBe(etag);
    expect(cachedHit.headers.get('cache-control')).toBe('max-age=300');
    expect(cachedHit.headers.get('access-control-allow-origin')).toBe('*');
    expect(spyDb.preparedSql).toHaveLength(0);

    // If-None-Match (exact and weak) returns 304 without body and without DB query
    const notModified = await app.request('/rules/alpha.yaml', { headers: { 'if-none-match': etag! } }, env);
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get('etag')).toBe(etag);
    expect(notModified.headers.get('cache-control')).toBe('max-age=300');
    expect(notModified.headers.get('access-control-allow-origin')).toBe('*');
    expect(await notModified.text()).toBe('');
    expect(spyDb.preparedSql).toHaveLength(0);

    const weakNotModified = await app.request('/rules/alpha.yaml', { headers: { 'if-none-match': `W/${etag!}` } }, env);
    expect(weakNotModified.status).toBe(304);
  });

  it('actively purges Workers Cache API entries when the ruleset changes', async () => {
    const before = await app.request('/rules/alpha.yaml', {}, env);
    const oldEtag = before.headers.get('etag');
    expect(await before.text()).not.toContain('fresh.example.com');
    expect(cache.entries.size).toBe(1);

    // Mutate the ruleset via canonical /api/rulesets/:id/rules route
    const addRes = await app.request(
      `/api/rulesets/${targetCategoryId}/rules`,
      {
        method: 'POST',
        headers: { cookie, origin: 'http://localhost', 'content-type': 'application/json' },
        body: JSON.stringify({ value: 'fresh.example.com' }),
      },
      env,
    );
    expect(addRes.status).toBe(201);
    expect(cache.entries.size).toBe(0);

    // Next subscription request serves updated content with a new ETag, and old ETag no longer returns 304
    const after = await app.request('/rules/alpha.yaml', { headers: { 'if-none-match': oldEtag! } }, env);
    expect(after.status).toBe(200);
    expect(after.headers.get('etag')).not.toBe(oldEtag);
    expect(await after.text()).toContain('fresh.example.com');
  });

  it('supports canonical §12.2 /api/rulesets & /api/backup routes with Zod validation and AppType hc client', async () => {
    // Type-check Hono RPC client inference against exported AppType
    const client = hc<AppType>('http://localhost', {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input.toString(), init, env),
    });

    const healthRes = await client.health.$get();
    expect(healthRes.status).toBe(200);
    expect(await healthRes.json()).toMatchObject({ ok: true, database: 'ok' });

    // GET /api/rulesets/:id
    const detailRes = await app.request(
      `/api/rulesets/${targetCategoryId}`,
      { headers: { authorization: `Bearer ${apiKey}` } },
      env,
    );
    expect(detailRes.status).toBe(200);
    expect(await detailRes.json()).toMatchObject({
      ruleset: { id: targetCategoryId, name: 'alpha' },
    });

    // Zod validation rejects malformed create payload with 400 VALIDATION_FAILED
    const badCreate = await app.request(
      '/api/rulesets',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      },
      env,
    );
    expect(badCreate.status).toBe(400);
    expect(await badCreate.json()).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });

    // POST /api/rulesets/:id/rules/import (preview + confirm)
    const previewRes = await app.request(
      `/api/rulesets/${targetCategoryId}/rules/import`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'DOMAIN,imported.example.com', confirm: false }),
      },
      env,
    );
    expect(previewRes.status).toBe(200);
    expect(await previewRes.json()).toMatchObject({
      preview: { rules: [{ type: 'DOMAIN', value: 'imported.example.com' }] },
    });

    // GET /api/backup + POST /api/backup/validate
    const backupRes = await app.request('/api/backup', { headers: { authorization: `Bearer ${apiKey}` } }, env);
    expect(backupRes.status).toBe(200);
    const backup = await backupRes.json();

    const validRes = await app.request(
      '/api/backup/validate',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(backup),
      },
      env,
    );
    expect(validRes.status).toBe(200);
    expect(await validRes.json()).toMatchObject({ valid: true, version: 2 });

    const invalidRes = await app.request(
      '/api/backup/validate',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ version: 2, categories: 'not-an-array' }),
      },
      env,
    );
    expect(invalidRes.status).toBe(400);
    expect(await invalidRes.json()).toMatchObject({ ok: false, code: 'BACKUP_INVALID' });
  });
});
