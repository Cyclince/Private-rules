import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { migrateDatabase } from '../../src/data/migrate';
import { D1DatabaseAdapter } from '../../src/infrastructure/database/d1/adapter';
import { SqliteDatabaseAdapter } from '../../src/infrastructure/database/sqlite/adapter';
import { migrateSqliteDatabase } from '../../src/infrastructure/database/sqlite/migrations';
import { addRule, createCategory } from '../../src/lib/db';
import { createApp } from '../../src/server/app';
import type { Env } from '../../src/types';

function normalize(body: string) {
  return body.replace(/^# UPDATED:.*$/m, '# UPDATED: <clock>').replace(/"updatedAt":\s*"[^"]+"/, '"updatedAt": "<clock>"');
}

describe('cross-runtime subscription parity', () => {
  it('returns equivalent subscription responses for D1 and SQLite', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'private-rules-parity-'));
    const sqlite = new SqliteDatabaseAdapter(join(directory, 'parity.db'));
    await migrateSqliteDatabase(sqlite);
    const miniflare = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: ['DB'] });
    const d1Binding = await miniflare.getD1Database('DB');
    const d1 = new D1DatabaseAdapter(d1Binding);
    await migrateDatabase(d1);
    const environments: Env[] = [sqlite, d1].map((DB, index) => ({ DB, ASSETS: { fetch: async () => new Response() }, RUNTIME: index ? 'cloudflare' : 'node' }));
    try {
      for (const env of environments) {
        const data = await createCategory(env, { name: 'parity', tokenLinksEnabled: false, publicLinksEnabled: true });
        await addRule(env, data.categories[0].id, { value: 'parity.example' });
      }
      for (const extension of ['yaml', 'list', 'txt', 'json']) {
        const responses = await Promise.all(environments.map((env) => createApp().request(`/rules/parity.${extension}`, {}, env)));
        expect(responses.map((response) => response.status)).toEqual([200, 200]);
        expect(responses[0].headers.get('content-type')).toBe(responses[1].headers.get('content-type'));
        expect(responses[0].headers.get('cache-control')).toBe(responses[1].headers.get('cache-control'));
        expect(normalize(await responses[0].text())).toBe(normalize(await responses[1].text()));
      }
    } finally {
      sqlite.close();
      await miniflare.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
