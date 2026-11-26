import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getBackupData, importRulesData } from '../../src/application/backup';
import { createCard, deleteCard, forkCard, getCardById, listCards, updateCard } from '../../src/application/cards';
import { getCatalogEntry, listCatalog } from '../../src/application/catalog';
import type { DatabasePort } from '../../src/application/ports/database';
import {
  createPublication,
  deleteNodeSlotBinding,
  deletePublication,
  getPublicationById,
  updatePublication,
  upsertNodeSlotBinding,
} from '../../src/application/publications';
import {
  createTemplate,
  deleteTemplate,
  getTemplateById,
  getTemplateVersion,
  listTemplateVersions,
  rebaseTemplate,
  restoreTemplateVersion,
  updateTemplate,
} from '../../src/application/templates';
import { migrateDatabase } from '../../src/data/migrate';
import { createRepositories, TEMPLATE_VERSION_RETENTION } from '../../src/data/repositories';
import { D1DatabaseAdapter } from '../../src/infrastructure/database/d1/adapter';
import { SqliteDatabaseAdapter } from '../../src/infrastructure/database/sqlite/adapter';
import { migrateSqliteDatabase } from '../../src/infrastructure/database/sqlite/migrations';
import { addRule, createCategory } from '../../src/lib/db';
import { ensureRuntimeSecrets } from '../../src/lib/runtime-secrets';
import type { Env } from '../../src/types';

function templatesAndPublicationsContract(
  name: string,
  setup: () => Promise<{ database: DatabasePort; close: () => Promise<void> }>,
) {
  describe(`${name} (M4.3b templates, cards, publications & node bindings)`, () => {
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
        ADMIN_PASSWORD: 'contract-password',
        SESSION_SECRET: '0123456789abcdef0123456789abcdef',
        EXPLICIT_SESSION_SECRET: '0123456789abcdef0123456789abcdef',
        RULE_TOKEN: 'contract-rule-token',
      };
    });

    afterAll(async () => {
      await close();
    });

    it('lists and resolves catalog entries across builtin catalog, user rulesets, and geo data', async () => {
      const created = await createCategory(env, {
        name: `${name}-custom-ruleset`,
        tokenLinksEnabled: true,
        publicLinksEnabled: false,
      });
      const ruleset = created.categories.find((item) => item.name === `${name}-custom-ruleset`)!;
      await addRule(env, ruleset.id, { value: 'internal.contract.test', type: 'DOMAIN-SUFFIX' });

      const catalog = await listCatalog(env, { limit: 200 });
      expect(catalog.items.some((entry) => entry.kind === 'builtin')).toBe(true);
      expect(catalog.items.some((entry) => entry.kind === 'ruleset' && entry.id === `ruleset:${ruleset.id}`)).toBe(
        true,
      );
      expect(catalog.items.some((entry) => entry.kind === 'geosite' || entry.kind === 'geoip')).toBe(true);

      const resolvedRuleset = await getCatalogEntry(env, `ruleset:${ruleset.id}`);
      expect(resolvedRuleset.ruleCount).toBe(1);
    });

    it('enforces immutable builtin cards while supporting fork, create, edit, and delete', async () => {
      const listed = await listCards(env, { origin: 'builtin', limit: 20 });
      expect(listed.cards.length).toBeGreaterThan(0);
      const builtinCard = listed.cards[0];

      await expect(updateCard(env, builtinCard.id, { name: 'Should Fail' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      });
      await expect(deleteCard(env, builtinCard.id)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      });

      const forked = await forkCard(env, builtinCard.id, {
        name: `${name}-forked-card`,
        slug: `${name}-forked-card`,
      });
      expect(forked.origin).toBe('fork');
      expect(forked.forkedFrom).toBe(builtinCard.id);

      const custom = await createCard(env, {
        name: `${name}-custom-card`,
        slug: `${name}-custom-card`,
        category: 'other',
        stage: 'app',
        group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
        matchers: [
          {
            kind: 'inline',
            conditions: [{ op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'custom-card.test' } }],
          },
        ],
      });
      expect(custom.origin).toBe('user');

      const updated = await updateCard(env, custom.id, { name: `${name}-custom-card-v2` });
      expect(updated.name).toBe(`${name}-custom-card-v2`);
      expect((await getCardById(env, custom.id)).name).toBe(`${name}-custom-card-v2`);

      await deleteCard(env, custom.id);
      await expect(getCardById(env, custom.id)).rejects.toMatchObject({ code: 'CARD_NOT_FOUND', status: 404 });
    });

    it('retains only the latest 50 template versions, supports restore and rebase, and blocks deleting referenced templates', async () => {
      const created = await createTemplate(env, {
        name: `${name}-versioned-template`,
        slug: `${name}-versioned-template`,
        starterTier: 'standard',
        note: 'initial v1',
      });
      const templateId = created.template.id;
      expect(created.template.currentVersion).toBe(1);

      const totalUpdates = TEMPLATE_VERSION_RETENTION + 4; // 54 updates => v1..v55 (55 total saves)
      for (let i = 2; i <= totalUpdates + 1; i += 1) {
        const next = await updateTemplate(env, templateId, {
          description: `rev-${i}`,
          note: `save-${i}`,
        });
        expect(next.template.currentVersion).toBe(i);
      }

      const versionsAfterSave = await listTemplateVersions(env, templateId);
      expect(versionsAfterSave).toHaveLength(TEMPLATE_VERSION_RETENTION);
      expect(versionsAfterSave[0].version).toBe(55);
      expect(versionsAfterSave[versionsAfterSave.length - 1].version).toBe(6);

      // Older versions (v1..v5) were pruned from template_versions
      await expect(getTemplateVersion(env, templateId, 1)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      await expect(getTemplateVersion(env, templateId, 5)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      const v6 = await getTemplateVersion(env, templateId, 6);
      expect(v6.note).toBe('save-6');

      // Restore v6 -> creates v56 and prunes v6, keeping 50 versions (v7..v56)
      const restored = await restoreTemplateVersion(env, templateId, 6, 'restore-from-v6');
      expect(restored.template.currentVersion).toBe(56);
      expect(restored.restoredFrom).toBe(6);

      const versionsAfterRestore = await listTemplateVersions(env, templateId);
      expect(versionsAfterRestore).toHaveLength(TEMPLATE_VERSION_RETENTION);
      expect(versionsAfterRestore[0].version).toBe(56);
      expect(versionsAfterRestore[versionsAfterRestore.length - 1].version).toBe(7);

      // Rebase template with a modified baseBody
      const current = await getTemplateById(env, templateId);
      const nextBase = {
        ...current.template.baseBody,
        final: { kind: 'builtin' as const, id: 'DIRECT' as const },
      };
      const rebased = await rebaseTemplate(env, templateId, { baseBody: nextBase, apply: true, note: 'rebased' });
      expect(rebased.applied).toBe(true);
      expect(rebased.template?.currentVersion).toBe(57);
      expect(rebased.resolvedBody.final).toEqual({ kind: 'builtin', id: 'DIRECT' });

      // Publication FK prevents deleting a referenced template
      const pub = await createPublication(env, {
        slug: `${name}-ref-pub`,
        templateId,
        clients: ['mihomo'],
        access: 'token',
      });
      await expect(deleteTemplate(env, templateId)).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

      await deletePublication(env, pub.publication.id);
      await deleteTemplate(env, templateId);
      await expect(getTemplateById(env, templateId)).rejects.toMatchObject({
        code: 'TEMPLATE_NOT_FOUND',
        status: 404,
      });
    });

    it('encrypts node bindings strictly with explicit SESSION_SECRET, masks reads, and excludes secrets from backups', async () => {
      const tpl = await createTemplate(env, {
        name: `${name}-pub-tpl`,
        slug: `${name}-pub-tpl`,
        starterTier: 'standard',
      });
      const pub = await createPublication(env, {
        slug: `${name}-pub-secret`,
        templateId: tpl.template.id,
        clients: ['mihomo'],
        access: 'token',
        output: 'full',
      });
      const slotId = tpl.resolvedBody.slots[0].id;

      // Without explicit SESSION_SECRET (even after ensureRuntimeSecrets populates DB fallback), binding must fail with 503
      const fallbackEnv: Env = {
        ...env,
        SESSION_SECRET: '',
        EXPLICIT_SESSION_SECRET: undefined,
      };
      await ensureRuntimeSecrets(fallbackEnv);
      expect(fallbackEnv.SESSION_SECRET).toMatch(/^[a-f0-9]{64}$/);
      expect(fallbackEnv.EXPLICIT_SESSION_SECRET).toBe('');

      await expect(
        upsertNodeSlotBinding(fallbackEnv, pub.publication.id, slotId, {
          subscriptionUrl: 'https://airport.secret.example/sub?token=super-secret-xyz',
        }),
      ).rejects.toMatchObject({ code: 'SESSION_SECRET_REQUIRED', status: 503 });

      // With explicit SESSION_SECRET, binding succeeds and stores AES-256-GCM ciphertext
      const secretUrl = 'https://airport.secret.example/api/v1/subscribe?token=super-secret-xyz&flag=clash';
      const bound = await upsertNodeSlotBinding(env, pub.publication.id, slotId, {
        subscriptionUrl: secretUrl,
        userAgent: 'clash.meta/1.19',
      });
      expect(bound.binding.maskedUrl).toBe('https://airport.secret.example/***');
      expect(bound.binding.maskedUrl).not.toContain('super-secret-xyz');
      expect(bound.binding.userAgent).toBe('clash.meta/1.19');

      // Inspect raw DB row directly to verify encryption
      const repos = createRepositories(database);
      const rawRow = await repos.nodeBindings.findBySlot(pub.publication.id, slotId);
      expect(rawRow?.subscriptionUrlEnc).toMatch(/^enc:aes-256-gcm:/);
      expect(rawRow?.subscriptionUrlEnc).not.toContain('airport.secret.example');
      expect(rawRow?.subscriptionUrlEnc).not.toContain('super-secret-xyz');

      // NodeSnapshotsRepository works identically across SQLite and D1
      await repos.nodeSnapshots.upsert({
        publicationId: pub.publication.id,
        slotId,
        nodesEnc: 'enc:aes-256-gcm:contractiv:contractpayload',
        fetchedAt: '2026-11-27T00:00:00.000Z',
        expiresAt: '2026-11-27T00:30:00.000Z',
      });
      expect((await repos.nodeSnapshots.findBySlot(pub.publication.id, slotId))?.nodesEnc).toBe(
        'enc:aes-256-gcm:contractiv:contractpayload',
      );
      expect(await repos.nodeSnapshots.listByPublication(pub.publication.id)).toHaveLength(1);
      await repos.nodeSnapshots.deleteExpiredBefore('2026-11-27T00:31:00.000Z');
      expect(await repos.nodeSnapshots.findBySlot(pub.publication.id, slotId)).toBeNull();

      // Reading publication detail only ever returns masked URL
      const detail = await getPublicationById(env, pub.publication.id);
      expect(detail.bindings).toHaveLength(1);
      expect(detail.bindings[0].maskedUrl).toBe('https://airport.secret.example/***');
      expect(JSON.stringify(detail)).not.toContain('super-secret-xyz');

      // Bound publication cannot switch to public access (only token or disabled allowed)
      await expect(updatePublication(env, pub.publication.id, { access: 'public' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        status: 400,
      });
      const disabledPub = await updatePublication(env, pub.publication.id, { access: 'disabled' });
      expect(disabledPub.publication.access).toBe('disabled');
      await updatePublication(env, pub.publication.id, { access: 'token' });

      // Public publication cannot accept node slot bindings
      const publicPub = await createPublication(env, {
        slug: `${name}-pub-open`,
        templateId: tpl.template.id,
        clients: ['mihomo'],
        access: 'public',
      });
      await expect(
        upsertNodeSlotBinding(env, publicPub.publication.id, slotId, {
          subscriptionUrl: secretUrl,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
      await deletePublication(env, publicPub.publication.id);

      // Backup v2 exports cards, templates (current version), publications — NEVER node_bindings
      const backupV2 = await getBackupData(env);
      const backupText = JSON.stringify(backupV2);
      expect(backupV2.version).toBe(2);
      expect(backupV2.templates.some((item) => item.id === tpl.template.id)).toBe(true);
      expect(backupV2.publications.some((item) => item.id === pub.publication.id)).toBe(true);
      expect(backupText).not.toContain('super-secret-xyz');
      expect(backupText).not.toContain('airport.secret.example');
      expect(backupText).not.toContain('enc:aes-256-gcm:');

      // Delete binding -> switching to public is allowed again, then clean up and restore from backup v2
      await deleteNodeSlotBinding(env, pub.publication.id, slotId);
      const unlockedPublic = await updatePublication(env, pub.publication.id, { access: 'public' });
      expect(unlockedPublic.publication.access).toBe('public');
      await deletePublication(env, pub.publication.id);
      await deleteTemplate(env, tpl.template.id);

      await importRulesData(env, backupV2);
      const restoredTpl = await getTemplateById(env, tpl.template.id);
      expect(restoredTpl.template.currentVersion).toBe(1);
      const restoredVersions = await listTemplateVersions(env, tpl.template.id);
      expect(restoredVersions).toHaveLength(1);
      expect(restoredVersions[0].version).toBe(1);

      const restoredPub = await getPublicationById(env, pub.publication.id);
      expect(restoredPub.slug).toBe(`${name}-pub-secret`);
      expect(restoredPub.bindings).toEqual([]);

      // Importing a v1 backup preserves existing templates/cards/publications
      await importRulesData(env, {
        version: 1,
        categories: [],
        settings: backupV2.settings,
      });
      const stillPresentPub = await getPublicationById(env, pub.publication.id);
      expect(stillPresentPub.id).toBe(pub.publication.id);
    });
  });
}

templatesAndPublicationsContract('sqlite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'private-rules-m43b-sqlite-'));
  const database = new SqliteDatabaseAdapter(join(directory, 'test.db'));
  await migrateSqliteDatabase(database);
  return {
    database,
    close: async () => {
      database.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
});

templatesAndPublicationsContract('d1', async () => {
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
