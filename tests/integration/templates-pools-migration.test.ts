import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabasePort } from '../../src/application/ports/database';
import { getTemplateById, updateTemplate } from '../../src/application/templates';
import { BUILTIN_CARDS } from '../../src/builtin/cards';
import { BUILTIN_CATALOG } from '../../src/builtin/catalog';
import { migrateDatabase } from '../../src/data/migrate';
import { createRepositories } from '../../src/data/repositories';
import { compileMihomo } from '../../src/domain/templates/compilers';
import { D1DatabaseAdapter } from '../../src/infrastructure/database/d1/adapter';
import { SqliteDatabaseAdapter } from '../../src/infrastructure/database/sqlite/adapter';
import { migrateSqliteDatabase } from '../../src/infrastructure/database/sqlite/migrations';
import type { Env } from '../../src/types';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const LEGACY_BODY_WITHOUT_POOLS_OR_COMPLEXITY = {
  slots: [{ id: 'slot-main', name: '主力机场', excludeInfo: true, udp: true }],
  regionGroups: [
    {
      id: 'region-hk',
      name: '香港节点',
      region: 'HK',
      type: 'url-test',
      extraInclude: 'IEPL',
      slotId: 'slot-main',
    },
    {
      id: 'region-us',
      name: '🇺🇸 美国节点',
      region: 'US',
      type: 'fallback',
    },
  ],
  cards: [
    { cardId: 'auto-select', enabled: true },
    { cardId: 'proxy-select', enabled: true },
    { cardId: 'domestic-direct', enabled: true },
    { cardId: 'final-fallback', enabled: true },
  ],
  groupMode: 'select',
  final: { kind: 'card', cardId: 'final-fallback' },
  output: 'full',
  dns: { mode: 'fake-ip' },
  modules: [],
};

function runLegacyPoolMigrationSuite(
  name: string,
  setup: () => Promise<{ database: DatabasePort; close: () => Promise<void> }>,
) {
  describe(`${name} (N1 legacy regionGroups -> pools migration on read/write)`, () => {
    let database: DatabasePort;
    let env: Env;
    let close: () => Promise<void> = async () => {};

    beforeAll(async () => {
      const ready = await setup();
      database = ready.database;
      close = ready.close;
      env = {
        DB: database,
        ASSETS: { fetch: async () => new Response() },
        ADMIN_PASSWORD: 'test-password',
        SESSION_SECRET: '0123456789abcdef0123456789abcdef',
        RULE_TOKEN: 'test-token',
      };
    });

    afterAll(async () => {
      await close();
    });

    it('reads legacy regionGroups templates as migrated pools without altering DB rows until written back', async () => {
      const repos = createRepositories(database);
      const templateId = `tpl-legacy-${name}`;
      const slug = 'starter-less';
      const now = '2026-01-01T00:00:00.000Z';
      const rawLegacyJson = JSON.stringify(LEGACY_BODY_WITHOUT_POOLS_OR_COMPLEXITY);

      await database
        .prepare(
          `INSERT INTO templates
            (id, slug, name, description, base_kind, base_source_url, base_body, overlay, current_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          templateId,
          slug,
          'Legacy Starter',
          'Legacy body with regionGroups',
          'builtin',
          null,
          rawLegacyJson,
          '[]',
          1,
          now,
          now,
        )
        .run();
      await database
        .prepare(
          `INSERT INTO template_versions (template_id, version, resolved_body, note, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(templateId, 1, rawLegacyJson, 'legacy v1', now)
        .run();

      // 1. Read paths auto-migrate regionGroups -> pools and infer complexity
      const byRepo = await repos.templates.findById(templateId);
      expect(byRepo).not.toBeNull();
      expect(byRepo!.baseBody.complexity).toBe('simple');
      expect(byRepo!.baseBody.regionGroups).toBeUndefined();
      expect(byRepo!.baseBody.pools).toHaveLength(2);
      expect(byRepo!.baseBody.pools?.[0]).toMatchObject({
        id: 'region-hk',
        icon: '🇭🇰',
        kind: 'region',
        region: 'HK',
        include: 'IEPL',
        sources: ['slot-main'],
        hidden: true,
      });

      const listed = await repos.templates.listAll();
      const fromList = listed.find((item) => item.id === templateId)!;
      expect(fromList.baseBody.pools).toHaveLength(2);
      expect(fromList.baseBody.regionGroups).toBeUndefined();

      const fromService = await getTemplateById(env, templateId);
      expect(fromService.template.baseBody.complexity).toBe('simple');
      expect(fromService.template.baseBody.regionGroups).toBeUndefined();
      expect(fromService.resolvedBody.pools).toHaveLength(2);
      expect(fromService.resolvedBody.regionGroups).toBeUndefined();

      // Compile migrated legacy template cleanly
      const compiled = compileMihomo({
        body: fromService.resolvedBody,
        cards: BUILTIN_CARDS,
        templateName: fromService.template.name,
        generatedAt: now,
        catalogIndex: BUILTIN_CATALOG,
        baseUrl: 'https://rules.example.com',
        slotBindings: {
          'slot-main': { kind: 'http', url: 'https://sub.example.com/airport' },
        },
      });
      expect(compiled.content).toContain('香港节点');
      expect(compiled.content).toContain('🇺🇸 美国节点');

      // 2. Existing DB records remain untouched during pure reads
      const rawRowBeforeWrite = await database
        .prepare('SELECT base_body FROM templates WHERE id = ?')
        .bind(templateId)
        .first<{ base_body: string }>();
      expect(rawRowBeforeWrite).not.toBeNull();
      const parsedBeforeWrite = JSON.parse(rawRowBeforeWrite!.base_body) as Record<string, unknown>;
      expect('regionGroups' in parsedBeforeWrite).toBe(true);
      expect('pools' in parsedBeforeWrite).toBe(false);

      // 3. Updating/writing back persists ONLY pools + complexity (never regionGroups)
      const updated = await updateTemplate(env, templateId, {
        name: 'Migrated Template v2',
        overlay: [{ op: 'setComplexity', complexity: 'pro' }],
      });
      expect(updated.template.currentVersion).toBe(2);
      expect(updated.resolvedBody.complexity).toBe('pro');

      const rawRowAfterWrite = await database
        .prepare('SELECT base_body FROM templates WHERE id = ?')
        .bind(templateId)
        .first<{ base_body: string }>();
      const parsedBaseAfterWrite = JSON.parse(rawRowAfterWrite!.base_body) as Record<string, unknown>;
      expect(Array.isArray(parsedBaseAfterWrite.pools)).toBe(true);
      expect('regionGroups' in parsedBaseAfterWrite).toBe(false);
      expect(parsedBaseAfterWrite.complexity).toBe('simple');

      const rawV2Row = await database
        .prepare('SELECT resolved_body FROM template_versions WHERE template_id = ? AND version = 2')
        .bind(templateId)
        .first<{ resolved_body: string }>();
      const parsedV2 = JSON.parse(rawV2Row!.resolved_body) as Record<string, unknown>;
      expect(Array.isArray(parsedV2.pools)).toBe(true);
      expect('regionGroups' in parsedV2).toBe(false);
      expect(parsedV2.complexity).toBe('pro');
    });
  });
}

runLegacyPoolMigrationSuite('sqlite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'private-rules-n1-sqlite-'));
  const database = new SqliteDatabaseAdapter(join(dir, 'test.db'));
  await migrateSqliteDatabase(database);
  return {
    database,
    close: async () => {
      database.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
});

runLegacyPoolMigrationSuite('d1', async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ['DB'],
  });
  const binding = await miniflare.getD1Database('DB');
  const database = new D1DatabaseAdapter(binding);
  await migrateDatabase(database);
  return {
    database,
    close: async () => miniflare.dispose(),
  };
});
