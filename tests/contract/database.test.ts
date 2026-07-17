import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { D1DatabaseAdapter } from '../../src/infrastructure/database/d1/adapter';
import { SqliteDatabaseAdapter } from '../../src/infrastructure/database/sqlite/adapter';
import { applySqliteMigrations } from '../../src/infrastructure/database/sqlite/migrations';
import { addRule, createCategory, deleteCategory, getBackupData, getRulesData, getRulesOverview, importRulesData, insertRule, listRules, saveSettings, updateCategory } from '../../src/lib/db';
import { syncRuleSources } from '../../src/lib/sync';
import type { Env } from '../../src/types';
import type { DatabasePort } from '../../src/application/ports/database';

const migrations = resolve(process.cwd(), 'migrations');
function contract(name: string, setup: () => Promise<{ database: DatabasePort; close: () => Promise<void> }>) {
  describe(name, () => {
    let env: Env; let database: DatabasePort; let close: () => Promise<void> = async () => {};
    beforeAll(async () => { const ready = await setup(); database = ready.database; env = { DB: ready.database, ASSETS: { fetch: async () => new Response() }, ADMIN_PASSWORD: 'pw', SESSION_SECRET: '0123456789abcdef0123456789abcdef', RULE_TOKEN: 'token' }; close = ready.close; });
    afterAll(async () => close());
    it('supports CRUD, uniqueness, access fields, sync metadata, backup and restore', async () => {
      let data = await createCategory(env, { name: `${name}-rules`, tokenLinksEnabled: true, publicLinksEnabled: false });
      const category = data.categories[0];
      data = await addRule(env, category.id, { value: 'example.com' });
      expect(data.categories[0].rules[0].value).toBe('example.com');
      data = await updateCategory(env, category.id, { tokenLinksEnabled: false, publicLinksEnabled: true });
      expect(data.categories[0]).toMatchObject({ tokenLinksEnabled: false, publicLinksEnabled: true });
      await expect(createCategory(env, { name: `${name}-rules` })).rejects.toThrow();
      const backup = await getRulesData(env);
      await deleteCategory(env, category.id);
      expect((await getRulesData(env)).categories).toHaveLength(0);
      const restored = await importRulesData(env, backup);
      expect(restored.categories[0].rules[0].value).toBe('example.com');
      expect(restored.meta?.ruleTokenConfigured).toBe(true);
    });
    it('keeps custom rules and source configuration in compact backups', async () => {
      let data = await createCategory(env, { name: `${name}-compact-backup`, sourceUrls: ['https://example.com/rules.list'], geositeNames: ['telegram'], geoipNames: ['telegram'], syncIntervalMinutes: 360, userAgent: 'Clash', ruleOptimization: 'conservative' });
      const category = data.categories.find((item) => item.name === `${name}-compact-backup`)!;
      data = await addRule(env, category.id, { value: 'custom.example' });
      const source = data.categories.find((item) => item.id === category.id)!.sources!.find((item) => item.sourceType === 'url')!;
      const timestamp = new Date().toISOString();
      await insertRule(env, category.id, { id: `${name}-mirrored-rule`, categoryId: category.id, value: 'upstream.example', type: 'DOMAIN-SUFFIX', enabled: true, sourceId: source.id, createdAt: timestamp, updatedAt: timestamp }, 1, source.id);

      const full = await getRulesData(env);
      const backup = await getBackupData(env);
      const backedUpCategory = backup.categories.find((item) => item.id === category.id)!;
      expect(backedUpCategory.rules.map((rule) => rule.value)).toEqual(['custom.example']);
      expect(backedUpCategory.sources?.find((item) => item.sourceType === 'url')).toEqual({ url: 'https://example.com/rules.list', enabled: true, syncIntervalMinutes: 360, userAgent: 'Clash', ruleOptimization: 'conservative', sourceType: 'url' });
      expect(backedUpCategory.sources?.find((item) => item.sourceType === 'geosite')).toEqual({ geositeName: 'telegram', enabled: true, syncIntervalMinutes: 360, sourceType: 'geosite' });
      expect(backedUpCategory.sources?.find((item) => item.sourceType === 'geoip')).toEqual({ geoipName: 'telegram', enabled: true, syncIntervalMinutes: 360, sourceType: 'geoip' });
      expect(JSON.stringify(backup).length).toBeLessThan(JSON.stringify(full).length);

      const restored = await importRulesData(env, backup);
      const restoredCategory = restored.categories.find((item) => item.id === category.id)!;
      expect(restoredCategory.rules.map((rule) => rule.value)).toEqual(['custom.example']);
      expect(restoredCategory.sources?.find((item) => item.sourceType === 'url')).toMatchObject({ url: 'https://example.com/rules.list', lastStatus: 'pending', lastCount: 0, ruleOptimization: 'conservative' });
      expect(restoredCategory.sources?.find((item) => item.sourceType === 'geosite')).toMatchObject({ geositeName: 'telegram', url: 'https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/telegram' });
      expect(restoredCategory.sources?.find((item) => item.sourceType === 'geoip')).toMatchObject({ geoipName: 'telegram', url: 'https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/telegram.txt' });
    });
    it('keeps the admin overview to 1000 mirrored rules and loads larger sets on demand', async () => {
      const data = await createCategory(env, { name: `${name}-large-preview`, sourceUrls: ['https://example.com/large.list'] });
      const category = data.categories.find((item) => item.name === `${name}-large-preview`)!;
      const source = category.sources![0];
      const timestamp = new Date().toISOString();
      const insertSql = 'INSERT INTO rules (id, category_id, value, type, display_type, note, enabled, sort_order, source_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
      const statements = Array.from({ length: 1005 }, (_, index) => env.DB.prepare(insertSql).bind(
        `${name}-large-${index}`, category.id, `speed-${index}.example`, 'DOMAIN-SUFFIX', '', '', 1, index, source.id, timestamp, timestamp,
      ));
      for (let offset = 0; offset < statements.length; offset += 100) await env.DB.batch(statements.slice(offset, offset + 100));

      const overviewCategory = (await getRulesOverview(env)).categories.find((item) => item.id === category.id)!;
      expect(overviewCategory.ruleCount).toBe(1005);
      expect(overviewCategory.enabledRuleCount).toBe(1005);
      expect(overviewCategory.rules).toHaveLength(1000);
      expect(await listRules(env, { categoryId: category.id, source: 'upstream' })).toHaveLength(1000);
      expect(await listRules(env, { query: 'speed', limit: 0 })).toHaveLength(1005);
    });
    it('persists and applies the GitHub rewrite setting during sync', async () => {
      await saveSettings(env, { githubMirrorUrl: 'https://fastly.jsdelivr.net/' });
      expect((await getRulesData(env)).settings.githubMirrorUrl).toBe('https://fastly.jsdelivr.net');
      const rawUrl = 'https://raw.githubusercontent.com/ddgksf2013/Filter/refs/heads/master/AppleIntelligence.list';
      const data = await createCategory(env, { name: `${name}-github-mirror`, sourceUrls: [rawUrl] });
      const category = data.categories.find((item) => item.name === `${name}-github-mirror`)!;
      const originalFetch = globalThis.fetch;
      let requestedUrl = '';
      globalThis.fetch = async (input) => {
        requestedUrl = String(input);
        return new Response('DOMAIN-SUFFIX,example.com', { status: 200 });
      };
      try {
        await expect(syncRuleSources(env, category.id)).resolves.toEqual([expect.objectContaining({ ok: true, count: 1 })]);
      } finally {
        globalThis.fetch = originalFetch;
        await saveSettings(env, { githubMirrorUrl: '' });
      }
      expect(requestedUrl).toBe('https://fastly.jsdelivr.net/gh/ddgksf2013/Filter@master/AppleIntelligence.list');
    });
    it('cancels a stale source sync when its category is deleted during download', async () => {
      const data = await createCategory(env, { name: `${name}-stale-sync`, sourceUrls: ['https://example.com/rules.list'] });
      const category = data.categories.find((item) => item.name === `${name}-stale-sync`)!;
      const originalFetch = globalThis.fetch;
      let signalRequestStarted!: () => void;
      let releaseResponse!: (response: Response) => void;
      const requestStarted = new Promise<void>((resolve) => { signalRequestStarted = resolve; });
      const responsePending = new Promise<Response>((resolve) => { releaseResponse = resolve; });
      globalThis.fetch = async () => {
        signalRequestStarted();
        return responsePending;
      };

      try {
        const syncing = syncRuleSources(env, category.id);
        await requestStarted;
        await deleteCategory(env, category.id);
        releaseResponse(new Response('DOMAIN-SUFFIX,example.com', { status: 200 }));
        await expect(syncing).resolves.toEqual([
          expect.objectContaining({
            sourceId: category.sources![0].id,
            categoryId: category.id,
            ok: false,
            count: 0,
            error: '来源已删除或所属分类已变更，已取消同步',
          }),
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }

      expect(await database.prepare('SELECT id FROM rules WHERE category_id = ?').bind(category.id).all()).toMatchObject({ results: [] });
    });
    it('rolls back a failed batch atomically', async () => {
      const timestamp = new Date().toISOString();
      await expect(database.batch([
        database.prepare('INSERT INTO categories (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind('tx-first', 'Tx first', 'tx-slug', timestamp, timestamp),
        database.prepare('INSERT INTO categories (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind('tx-second', 'Tx second', 'tx-slug', timestamp, timestamp),
      ])).rejects.toThrow();
      expect(await database.prepare('SELECT id FROM categories WHERE id = ?').bind('tx-first').first()).toBeNull();
    });
  });
}

contract('sqlite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'private-rules-'));
  const database = new SqliteDatabaseAdapter(join(directory, 'test.db'));
  await applySqliteMigrations(database, migrations);
  return { database, close: async () => { database.close(); await rm(directory, { recursive: true, force: true }); } };
});

contract('d1', async () => {
  const miniflare = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: ['DB'] });
  const binding = await miniflare.getD1Database('DB');
  for (const file of (await readdir(migrations)).filter((value) => /^\d+.*\.sql$/.test(value)).sort()) {
    const sql = await readFile(join(migrations, file), 'utf8');
    for (const statement of sql.split(';').map((value) => value.trim()).filter(Boolean)) await binding.prepare(statement).run();
  }
  return { database: new D1DatabaseAdapter(binding), close: async () => miniflare.dispose() };
});
