import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateCategory } from '../../src/application/rulesets';
import { migrateDatabase } from '../../src/data/migrate';
import { D1DatabaseAdapter } from '../../src/infrastructure/database/d1/adapter';
import { SqliteDatabaseAdapter } from '../../src/infrastructure/database/sqlite/adapter';
import { migrateSqliteDatabase } from '../../src/infrastructure/database/sqlite/migrations';
import { createApp } from '../../src/server/app';
import { createRulesetBodySchema, updateRulesetBodySchema } from '../../src/server/routes/schemas';
import type { Env } from '../../src/types';

// 5cb9012:src/lib/slug.ts rejects non-ASCII names before slug generation.
// Keep the historical message and ASCII slug literal; do not derive expectations from new code.
const NAME_ERROR = '分类名称仅支持英文字母、数字、空格和英文标点，且至少包含一个字母或数字。';

it('validates new names at the API boundary but defers update format validation to the application', () => {
  for (const name of ['流媒体测试', '中文 Netflix', '!!!']) {
    expect(createRulesetBodySchema.safeParse({ name }).success).toBe(false);
    expect(updateRulesetBodySchema.safeParse({ name }).success).toBe(true);
  }
});

for (const runtime of ['cloudflare', 'node'] as const) {
  describe(`${runtime}: rule set name validation through the HTTP API`, () => {
    const app = createApp();
    let env: Env;
    let cookie: string;
    let directory: string;
    let miniflare: Miniflare | undefined;
    let sqlite: SqliteDatabaseAdapter | undefined;
    let categoryId: string;

    beforeAll(async () => {
      const dataDirectory = resolve('data');
      await mkdir(dataDirectory, { recursive: true });
      directory = await mkdtemp(join(dataDirectory, 'ruleset-names-'));
      if (runtime === 'cloudflare') {
        miniflare = new Miniflare({
          modules: true,
          script: 'export default { fetch() { return new Response("ok") } }',
          d1Databases: ['DB'],
        });
        const adapter = new D1DatabaseAdapter(await miniflare.getD1Database('DB'));
        await migrateDatabase(adapter);
        env = { DB: adapter, RUNTIME: runtime };
      } else {
        sqlite = new SqliteDatabaseAdapter(join(directory, 'names.db'));
        await migrateSqliteDatabase(sqlite);
        env = { DB: sqlite, RUNTIME: runtime };
      }
      env.ADMIN_PASSWORD = 'names-test-password';
      env.SESSION_SECRET = '0123456789abcdef0123456789abcdef';
      const login = await app.request(
        '/api/auth/login',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
        },
        env,
      );
      expect(login.status).toBe(200);
      cookie = login.headers.get('set-cookie')!.split(';')[0];

      // Seed the legacy fallback slug to ensure invalid names cannot cause a uniqueness error.
      const seeded = await request('/api/rulesets', 'POST', 'rule');
      expect(seeded.status).toBe(201);
      const body = (await seeded.json()) as { data: { categories: Array<{ id: string; name: string }> } };
      categoryId = body.data.categories.find((category) => category.name === 'rule')!.id;
    });

    afterAll(async () => {
      sqlite?.close();
      await miniflare?.dispose();
      if (directory) await rm(directory, { recursive: true, force: true });
    });

    function request(path: string, method: string, name?: string, fields: Record<string, unknown> = {}) {
      return app.request(
        path,
        {
          method,
          headers: { cookie, origin: 'http://localhost', 'content-type': 'application/json' },
          body: JSON.stringify({ name, ...fields }),
        },
        env,
      );
    }

    it.each(['/api/rulesets', '/api/categories'])(
      '%s returns 400, not 500, for Chinese names without writing rows',
      async (path) => {
        for (const name of ['流媒体测试', '流媒体测试', '中文 Netflix', '!!!']) {
          const response = await request(path, 'POST', name);
          expect(response.status).toBe(400);
          expect(await response.json()).toMatchObject({
            ok: false,
            code: 'VALIDATION_FAILED',
            error: expect.stringContaining(NAME_ERROR),
            details: { issues: [{ path: 'name', message: NAME_ERROR }] },
          });
        }
        const row = await env.DB.prepare('SELECT count(*) AS count FROM categories').first<{ count: number }>();
        expect(row?.count).toBe(1);
      },
    );

    it('keeps valid ASCII names and slugs identical to 1.0.7', async () => {
      const response = await request('/api/rulesets', 'POST', 'Google Services');
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        data: {
          categories: expect.arrayContaining([
            expect.objectContaining({ name: 'Google Services', slug: 'Google-Services' }),
          ]),
        },
      });
    });

    async function seedLegacyCategory() {
      const response = await request('/api/rulesets', 'POST', 'LegacyStreaming');
      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        data: { categories: Array<{ id: string; name: string; slug: string }> };
      };
      const category = body.data.categories.find((row) => row.name === 'LegacyStreaming')!;
      // Imported 1.0.x data can contain a Chinese name even though creation rejects it.
      await env.DB.prepare('UPDATE categories SET name = ? WHERE id = ?').bind('流媒体', category.id).run();
      return category;
    }

    it.each(['/api/rulesets', '/api/categories'])(
      '%s saves metadata with the unchanged legacy Chinese name',
      async (path) => {
        const legacy = await seedLegacyCategory();
        try {
          const response = await request(path + '/' + legacy.id, 'PATCH', '流媒体', {
            description: '更新说明',
            icon: '🎬',
          });
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({
            data: {
              categories: expect.arrayContaining([
                expect.objectContaining({
                  id: legacy.id,
                  name: '流媒体',
                  slug: legacy.slug,
                  description: '更新说明',
                  icon: '🎬',
                }),
              ]),
            },
          });
          // Direct callers must also work, with either an unchanged name or no name at all.
          await updateCategory(env, legacy.id, { name: '流媒体', description: '直接更新' });
          await updateCategory(env, legacy.id, { icon: '📺' });
          expect(
            await env.DB.prepare('SELECT name, slug, description, icon FROM categories WHERE id = ?')
              .bind(legacy.id)
              .first(),
          ).toEqual({
            name: '流媒体',
            slug: legacy.slug,
            description: '直接更新',
            icon: '📺',
          });
        } finally {
          await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(legacy.id).run();
        }
      },
    );

    it.each(['/api/rulesets', '/api/categories'])(
      '%s rejects renaming a legacy Chinese category to another Chinese name',
      async (path) => {
        const legacy = await seedLegacyCategory();
        try {
          const response = await request(path + '/' + legacy.id, 'PATCH', '流媒体测试', { description: '不能写入' });
          expect(response.status).toBe(400);
          expect(await response.json()).toMatchObject({ ok: false, code: 'VALIDATION_FAILED', error: NAME_ERROR });
          await expect(updateCategory(env, legacy.id, { name: '流媒体测试' })).rejects.toMatchObject({
            code: 'VALIDATION_FAILED',
            status: 400,
          });
          expect(
            await env.DB.prepare('SELECT name, slug, description FROM categories WHERE id = ?').bind(legacy.id).first(),
          ).toEqual({
            name: '流媒体',
            slug: legacy.slug,
            description: '',
          });
        } finally {
          await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(legacy.id).run();
        }
      },
    );

    it('rejects a Chinese rename without changing the stored name or slug', async () => {
      const response = await request(`/api/rulesets/${categoryId}`, 'PATCH', '流媒体测试');
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        ok: false,
        code: 'VALIDATION_FAILED',
        error: expect.stringContaining(NAME_ERROR),
      });
      expect(await env.DB.prepare('SELECT name, slug FROM categories WHERE id = ?').bind(categoryId).first()).toEqual({
        name: 'rule',
        slug: 'rule',
      });
    });
  });
}
