import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCategory } from '../../src/application/rulesets';
import { MAX_CONCURRENT_HOSTS, runHostScheduled, syncRuleSources, syncSourceById } from '../../src/application/sync';
import { SqliteDatabaseAdapter } from '../../src/infrastructure/database/sqlite/adapter';
import { migrateSqliteDatabase } from '../../src/infrastructure/database/sqlite/migrations';
import type { Env } from '../../src/types';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('host-aware sync scheduler and lease protection', () => {
  it('runs same-host sources strictly serially and cross-host sources concurrently up to 4', async () => {
    expect(MAX_CONCURRENT_HOSTS).toBe(4);

    const items = [
      { id: 'a1', host: 'host-a.example' },
      { id: 'a2', host: 'host-a.example' },
      { id: 'a3', host: 'host-a.example' },
      { id: 'b1', host: 'host-b.example' },
      { id: 'c1', host: 'host-c.example' },
      { id: 'd1', host: 'host-d.example' },
      { id: 'e1', host: 'host-e.example' },
      { id: 'f1', host: 'host-f.example' },
    ];

    let activeTotal = 0;
    let peakTotal = 0;
    const activeByHost = new Map<string, number>();
    let sameHostOverlapDetected = false;

    const results = await runHostScheduled(
      items,
      (item) => item.host,
      async (item) => {
        activeTotal += 1;
        peakTotal = Math.max(peakTotal, activeTotal);
        const hostCount = (activeByHost.get(item.host) ?? 0) + 1;
        if (hostCount > 1) sameHostOverlapDetected = true;
        activeByHost.set(item.host, hostCount);

        await delay(25);

        activeByHost.set(item.host, (activeByHost.get(item.host) ?? 1) - 1);
        activeTotal -= 1;
        return item.id;
      },
      MAX_CONCURRENT_HOSTS,
    );

    expect(results).toEqual(items.map((item) => item.id));
    expect(sameHostOverlapDetected).toBe(false);
    expect(peakTotal).toBeGreaterThan(1);
    expect(peakTotal).toBeLessThanOrEqual(4);
  });

  it('prevents concurrent duplicate sync of the same source via sync_leases', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'private-rules-sync-lease-'));
    const database = new SqliteDatabaseAdapter(join(dir, 'lease.db'));
    await migrateSqliteDatabase(database);
    const env: Env = {
      DB: database,
      ASSETS: { fetch: async () => new Response() },
      RUNTIME: 'node',
    };

    const data = await createCategory(env, {
      name: 'lease-test',
      sourceUrls: ['https://host-a.example/rules.list', 'https://host-b.example/rules.list'],
    });
    const sources = data.categories[0].sources!;

    const originalFetch = globalThis.fetch;
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let signalFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve;
    });

    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('host-a.example')) {
        signalFirstStarted();
        await firstBlocked;
      }
      return new Response('DOMAIN-SUFFIX,synced.example', { status: 200 });
    };

    try {
      const firstRun = syncSourceById(env, sources[0].id);
      await firstStarted;

      // Second concurrent sync on the same source must be refused by the lease
      const duplicateRun = await syncSourceById(env, sources[0].id);
      expect(duplicateRun.ok).toBe(false);
      expect(duplicateRun.error).toBe('任务正在执行');

      releaseFirst();
      const firstResult = await firstRun;
      expect(firstResult.ok).toBe(true);
      expect(firstResult.count).toBe(1);

      // Subsequent sync across all hosts succeeds once lease is released
      const allResults = await syncRuleSources(env, data.categories[0].id);
      expect(allResults).toHaveLength(2);
      expect(allResults.every((item) => item.ok)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      database.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
