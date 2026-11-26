import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepositories } from '../../src/data/repositories';
import { SqliteDatabaseAdapter } from '../../src/infrastructure/database/sqlite/adapter';
import { migrateSqliteDatabase } from '../../src/infrastructure/database/sqlite/migrations';
import { createCategory } from '../../src/lib/db';
import { createApp } from '../../src/server/app';
import type { ClientLink, DomainRule, Env } from '../../src/types';

const PASSWORD = 'pagination-password';
const LOCAL_ORIGIN = 'http://localhost';

describe('M3.1 rulesets summary & cursor pagination API', () => {
  let directory: string;
  let database: SqliteDatabaseAdapter;
  let env: Env;
  let cookie = '';
  const app = createApp();

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'private-rules-pagination-'));
    database = new SqliteDatabaseAdapter(join(directory, 'pagination.db'));
    await migrateSqliteDatabase(database);
    env = {
      DB: database,
      ASSETS: { fetch: async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }) },
      ADMIN_PASSWORD: PASSWORD,
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      RULE_TOKEN: 'secret-token',
      RUNTIME: 'node',
    };
    const login = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: LOCAL_ORIGIN },
        body: JSON.stringify({ password: PASSWORD }),
      },
      env,
    );
    expect(login.status).toBe(200);
    cookie = login.headers.get('set-cookie')!.split(';')[0];
  });

  afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('serves lightweight ?summary=1 and fast cursor pagination + server search across 10,000 rules', async () => {
    const created = await createCategory(env, { name: 'LargeSet', tokenLinksEnabled: true, publicLinksEnabled: false });
    const categoryId = created.categories[0].id;
    const timestamp = new Date().toISOString();
    const bulk: DomainRule[] = Array.from({ length: 10_000 }, (_, index) => ({
      id: `rule-${String(index).padStart(5, '0')}`,
      value: `item-${String(index).padStart(5, '0')}.scale.test`,
      type: 'DOMAIN-SUFFIX',
      enabled: true,
      sortOrder: index + 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    await createRepositories(database).rules.insertManyInBatches(categoryId, bulk, 1);

    // Lightweight summary skips returning 10,000 rule rows
    const summaryStart = performance.now();
    const summaryRes = await app.request('/api/rulesets?summary=1', { headers: { cookie } }, env);
    const summaryMs = performance.now() - summaryStart;
    expect(summaryRes.status).toBe(200);
    const summaryPayload = (await summaryRes.json()) as {
      data: { categories: Array<{ id: string; enabled: boolean; ruleCount: number; rules: unknown[] }> };
      links: Record<string, ClientLink[]>;
    };
    const cat = summaryPayload.data.categories.find((c) => c.id === categoryId)!;
    expect(cat.rules).toEqual([]);
    expect(cat.ruleCount).toBe(10_000);
    expect(cat.enabled).toBe(true);
    expect(summaryMs).toBeLessThan(200);

    // First page via cursor pagination
    const page1Start = performance.now();
    const page1Res = await app.request(
      `/api/rulesets/${categoryId}/rules?limit=50&source=manual`,
      { headers: { cookie } },
      env,
    );
    const page1Ms = performance.now() - page1Start;
    expect(page1Res.status).toBe(200);
    const page1 = (await page1Res.json()) as {
      rules: DomainRule[];
      total: number;
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(page1.rules).toHaveLength(50);
    expect(page1.total).toBe(10_000);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeTruthy();
    expect(page1.rules[0].value).toBe('item-00000.scale.test');
    expect(page1Ms).toBeLessThan(200);

    // Second page via nextCursor
    const page2Res = await app.request(
      `/api/rulesets/${categoryId}/rules?limit=50&source=manual&cursor=${encodeURIComponent(page1.nextCursor!)}`,
      { headers: { cookie } },
      env,
    );
    expect(page2Res.status).toBe(200);
    const page2 = (await page2Res.json()) as { rules: DomainRule[]; total: number; hasMore: boolean };
    expect(page2.rules).toHaveLength(50);
    expect(page2.total).toBe(10_000);
    expect(page2.rules[0].value).toBe('item-00050.scale.test');

    // Server-side search finds tail record directly
    const searchRes = await app.request(
      `/api/rulesets/${categoryId}/rules?limit=50&q=item-09999`,
      { headers: { cookie } },
      env,
    );
    expect(searchRes.status).toBe(200);
    const searched = (await searchRes.json()) as { rules: DomainRule[]; total: number; hasMore: boolean };
    expect(searched.total).toBe(1);
    expect(searched.rules).toHaveLength(1);
    expect(searched.rules[0].value).toBe('item-09999.scale.test');
    expect(searched.hasMore).toBe(false);

    // Invalid cursor returns 400 VALIDATION_FAILED
    const badCursorRes = await app.request(
      `/api/rulesets/${categoryId}/rules?limit=50&cursor=%%%invalid`,
      { headers: { cookie } },
      env,
    );
    expect(badCursorRes.status).toBe(400);
    expect(await badCursorRes.json()).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });

    // Disabling a ruleset hides its subscription URLs in /api/links
    const disableRes = await app.request(
      `/api/rulesets/${categoryId}`,
      {
        method: 'PATCH',
        headers: { cookie, origin: LOCAL_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      },
      env,
    );
    expect(disableRes.status).toBe(200);
    const linksRes = await app.request('/api/links', { headers: { cookie } }, env);
    const linksPayload = (await linksRes.json()) as { links: Record<string, ClientLink[]> };
    for (const link of linksPayload.links[categoryId]) {
      expect(link.publicUrl).toBe('');
      expect(link.tokenUrl).toBe('');
      expect(link.recommendedUrl).toBe('');
    }
  });
});
