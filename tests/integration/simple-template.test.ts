import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  quickCreateTemplate,
  type QuickCreateTemplateResult,
  type SimpleTemplateView,
} from '../../src/application/templates';
import { bindingAad, snapshotAad } from '../../src/application/publications/nodes';
import { migrateDatabase } from '../../src/data/migrate';
import { createRepositories } from '../../src/data/repositories';
import { encryptNodeSecret } from '../../src/infrastructure/crypto/node-secrets';
import { D1DatabaseAdapter } from '../../src/infrastructure/database/d1/adapter';
import { SqliteDatabaseAdapter } from '../../src/infrastructure/database/sqlite/adapter';
import { migrateSqliteDatabase } from '../../src/infrastructure/database/sqlite/migrations';
import { addRule, createCategory } from '../../src/lib/db';
import { resolveSessionSecret } from '../../src/lib/runtime-secrets';
import { createApp } from '../../src/server/app';
import type { TemplateBody } from '../../src/shared/schemas/template';
import type { Env } from '../../src/types';
import { FakeTelegramClient } from '../helpers/fake-telegram-client';

const BOT_TOKEN = '999888:simple-view-bot';

function buildTelegramInitData(botToken: string, userId: number, authDate: number): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: `query-m2b-${userId}-${authDate}`,
    user: JSON.stringify({ id: userId, first_name: 'Telegram', username: `tg_${userId}` }),
  });
  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  return params.toString();
}

type BackendHarness = {
  name: 'SQLite' | 'D1';
  env: Env;
  app: ReturnType<typeof createApp>;
  adminCookie: string;
  rulesetDirectId: string;
  rulesetRejectId: string;
  adminRequest: (path: string, init?: RequestInit) => Promise<Response>;
  cleanup: () => Promise<void>;
};

async function createBackendHarness(kind: 'SQLite' | 'D1'): Promise<BackendHarness> {
  const app = createApp();
  let cleanupFn: () => Promise<void>;
  let dbPort: Env['DB'];

  if (kind === 'SQLite') {
    const dir = await mkdtemp(join(tmpdir(), 'private-rules-m2b-sqlite-'));
    const adapter = new SqliteDatabaseAdapter(join(dir, 'test.db'));
    await migrateSqliteDatabase(adapter);
    dbPort = adapter;
    cleanupFn = async () => {
      adapter.close();
      await rm(dir, { recursive: true, force: true });
    };
  } else {
    const miniflare = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      d1Databases: ['DB'],
    });
    const d1 = await miniflare.getD1Database('DB');
    const adapter = new D1DatabaseAdapter(d1);
    await migrateDatabase(adapter);
    dbPort = adapter;
    cleanupFn = async () => {
      await miniflare.dispose();
    };
  }

  const env: Env = {
    DB: dbPort,
    ASSETS: { fetch: async () => new Response('<html></html>') },
    ADMIN_PASSWORD: 'admin-password',
    SESSION_SECRET: '0123456789abcdef0123456789abcdef',
    RULE_TOKEN: 'm2b-secret-token',
    BASE_URL: 'https://rules.example.com',
    RUNTIME: kind === 'D1' ? 'cloudflare' : 'node',
    TELEGRAM_CLIENT: new FakeTelegramClient(),
    TELEGRAM: {
      enabled: true,
      botToken: BOT_TOKEN,
      webhookSecret: 'tg-webhook-secret',
      webhookUrl: 'https://rules.example.com/api/telegram/webhook',
      miniAppUrl: 'https://rules.example.com',
      userId: '2026',
      notificationChatId: '2026',
      updateMaxAgeSeconds: 300,
      sessionTtlSeconds: 1800,
      sessionMaxLifetimeSeconds: 604800,
      rateLimitPerMinute: 30,
      syncNotificationEnabled: false,
      production: false,
    },
  };

  const createdDirect = await createCategory(env, {
    name: 'Emby_Direct',
    tokenLinksEnabled: true,
    publicLinksEnabled: false,
  });
  const rulesetDirectId = createdDirect.categories.find((c) => c.name === 'Emby_Direct')!.id;
  await addRule(env, rulesetDirectId, { value: 'emby.example.com', type: 'DOMAIN-SUFFIX' });

  const createdReject = await createCategory(env, {
    name: 'Custom_Reject',
    tokenLinksEnabled: true,
    publicLinksEnabled: false,
  });
  const rulesetRejectId = createdReject.categories.find((c) => c.name === 'Custom_Reject')!.id;
  await addRule(env, rulesetRejectId, { value: 'tracker.example.com', type: 'DOMAIN-SUFFIX' });

  const login = await app.request(
    '/api/auth/login',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://rules.example.com' },
      body: JSON.stringify({ password: 'admin-password' }),
    },
    env,
  );
  expect(login.status).toBe(200);
  const setCookie = login.headers.get('set-cookie') ?? '';
  const adminCookie = setCookie.split(';')[0] ?? '';

  const adminRequest = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('cookie', adminCookie);
    if (init.method && init.method !== 'GET' && init.method !== 'HEAD') {
      headers.set('origin', 'https://rules.example.com');
    }
    return app.request(path, { ...init, headers }, env);
  };

  return {
    name: kind,
    env,
    app,
    adminCookie,
    rulesetDirectId,
    rulesetRejectId,
    adminRequest,
    cleanup: cleanupFn,
  };
}

describe.each(['SQLite', 'D1'] as const)('B3 Simple Template View & Patch API (%s)', (backendKind) => {
  const harnesses: BackendHarness[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (harnesses.length > 0) {
      await harnesses.pop()!.cleanup();
    }
  });

  it('reads existing snapshots without outbound fetch, patches scenarios/My Rules/groupMode, preserves URL and updates compiled YAML', async () => {
    const h = await createBackendHarness(backendKind);
    harnesses.push(h);

    const secretUrl = 'https://provider-a.example.test/sub?token=SUPER_SECRET_A';
    const created: QuickCreateTemplateResult = await quickCreateTemplate(
      h.env,
      {
        name: '我的主模板',
        clients: ['mihomo'],
        scenarios: [
          { id: 'domestic-direct', enabled: true },
          { id: 'ad-block', enabled: true },
          { id: 'ai', enabled: true, route: 'proxy' },
          { id: 'telegram', enabled: true, route: 'proxy' },
          { id: 'streaming', enabled: true, route: 'proxy' },
        ],
        rulesets: [
          { rulesetId: h.rulesetDirectId, route: 'direct' },
          { rulesetId: h.rulesetRejectId, route: 'reject' },
        ],
        groupMode: 'region',
        subscriptionUrl: secretUrl,
        detectedRegions: ['HK', 'JP', 'US'],
      },
      { baseUrl: 'https://rules.example.com', ruleToken: 'm2b-secret-token' },
    );

    const templateId = created.template.id;
    const pubId = created.publications[0].id;
    const mihomoPath = new URL(created.publications[0].url!).pathname;

    // Seed an encrypted node snapshot in DB so GET /simple reads it directly
    const repos = createRepositories(h.env.DB);
    const secret = await resolveSessionSecret(h.env);
    const snapPayload = JSON.stringify({
      v: 1,
      kind: 'preview',
      nodes: [
        { name: '🇭🇰 香港 01', protocol: 'ss', regions: ['HK'], isInfo: false },
        { name: '🇭🇰 香港 02', protocol: 'ss', regions: ['HK'], isInfo: false },
        { name: '🇯🇵 日本 01', protocol: 'trojan', regions: ['JP'], isInfo: false },
        { name: '🇺🇸 美国 01', protocol: 'trojan', regions: ['US'], isInfo: false },
        { name: '剩余流量：99 GB', protocol: 'ss', regions: [], isInfo: true },
      ],
    });
    await repos.nodeBindings.upsertNodeSnapshot({
      publicationId: pubId,
      slotId: 'slot-main',
      nodesEnc: await encryptNodeSecret(snapPayload, secret, snapshotAad(pubId, 'slot-main')),
      nodeCount: 4,
      fetchedAt: '2026-11-27T10:00:00.000Z',
      expiresAt: '2026-11-28T10:00:00.000Z',
    });

    // Spy on global fetch: GET /simple MUST NEVER perform any outbound fetch!
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const getRes = await h.adminRequest(`/api/templates/${templateId}/simple`);
    expect(getRes.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();

    const view = (await getRes.json()) as SimpleTemplateView;
    expect(JSON.stringify(view)).not.toContain('SUPER_SECRET_A');
    expect(view.template.name).toBe('我的主模板');
    expect(view.nodes.bound).toBe(true);
    expect(view.nodes.nodeCount).toBe(4);
    expect(view.nodes.regions.map((r) => `${r.code}:${r.count}`)).toEqual(['HK:2', 'JP:1', 'US:1']);
    expect(view.nodes.groupMode).toBe('region');
    expect(view.routing.scenarios.find((s) => s.id === 'ai')).toMatchObject({
      enabled: true,
      route: 'proxy',
      custom: false,
    });
    expect(view.routing.rulesets.map((r) => r.rulesetId)).toEqual([h.rulesetDirectId, h.rulesetRejectId]);
    expect(view.outputs).toHaveLength(1);
    expect(view.outputs[0].links[0].url).toBe(`https://rules.example.com${mihomoPath}`);

    // Compile before PATCH
    const beforeSubRes = await h.app.request(mihomoPath, { method: 'GET' }, h.env);
    expect(beforeSubRes.status).toBe(200);
    const beforeDoc = parseYaml(await beforeSubRes.text()) as {
      rules: string[];
      'proxy-groups': Array<{ name: string; proxies?: string[] }>;
    };
    const beforeAiGroup = beforeDoc['proxy-groups'].find((g) => g.name.includes('OpenAI'));
    expect(beforeAiGroup?.proxies?.[0]).not.toBe('DIRECT');
    expect(beforeDoc.rules[0]).toContain('Emby_Direct');

    // PATCH /api/templates/:id/simple: AI -> direct, enable github -> proxy, reverse My Rules order, switch groupMode -> select
    const patchRes = await h.adminRequest(`/api/templates/${templateId}/simple`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenarios: [
          { id: 'domestic-direct', enabled: true },
          { id: 'ad-block', enabled: true },
          { id: 'ai', enabled: true, route: 'direct' },
          { id: 'telegram', enabled: true, route: 'proxy' },
          { id: 'streaming', enabled: true, route: 'proxy' },
          { id: 'github', enabled: true, route: 'proxy' },
        ],
        rulesets: [
          { rulesetId: h.rulesetRejectId, route: 'reject' },
          { rulesetId: h.rulesetDirectId, route: 'direct' },
        ],
        groupMode: 'select',
      }),
    });
    expect(patchRes.status).toBe(200);
    const patchJson = (await patchRes.json()) as { view: SimpleTemplateView; version: number };
    expect(patchJson.version).toBe(2);
    expect(patchJson.view.outputs[0].links[0].url).toBe(`https://rules.example.com${mihomoPath}`);
    expect(patchJson.view.nodes.groupMode).toBe('select');
    expect(patchJson.view.routing.scenarios.find((s) => s.id === 'ai')?.route).toBe('direct');
    expect(patchJson.view.routing.scenarios.find((s) => s.id === 'github')?.enabled).toBe(true);
    expect(patchJson.view.routing.rulesets.map((r) => r.rulesetId)).toEqual([h.rulesetRejectId, h.rulesetDirectId]);

    // Compile after PATCH using the EXACT SAME subscription URL
    const afterSubRes = await h.app.request(mihomoPath, { method: 'GET' }, h.env);
    expect(afterSubRes.status).toBe(200);
    const afterDoc = parseYaml(await afterSubRes.text()) as {
      rules: string[];
      'proxy-groups': Array<{ name: string; proxies?: string[] }>;
    };
    const afterAiGroup = afterDoc['proxy-groups'].find((g) => g.name.includes('OpenAI'));
    expect(afterAiGroup?.proxies?.[0]).toBe('DIRECT');
    expect(afterDoc['proxy-groups'].some((g) => g.name.includes('GitHub'))).toBe(true);
    // Custom_Reject must now appear before Emby_Direct
    const rejectRuleIdx = afterDoc.rules.findIndex((r) => r.includes('Custom_Reject'));
    const embyRuleIdx = afterDoc.rules.findIndex((r) => r.includes('Emby_Direct'));
    expect(rejectRuleIdx).toBeGreaterThanOrEqual(0);
    expect(embyRuleIdx).toBeGreaterThan(rejectRuleIdx);
  });

  it('preserves custom cards, custom scenario overrides, DNS, modules, and clientPatches on non-wizard templates', async () => {
    const h = await createBackendHarness(backendKind);
    harnesses.push(h);

    // Create a custom app card
    const cardRes = await h.adminRequest('/api/cards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '公司内网',
        slug: 'corp-intranet',
        category: 'other',
        stage: 'app',
        group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
        matchers: [{ kind: 'geosite', name: 'private' }],
      }),
    });
    expect(cardRes.status).toBe(201);
    const customCardId = ((await cardRes.json()) as { card: { id: string } }).card.id;

    // Create a standard starter template (non-wizard)
    const tplRes = await h.adminRequest('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Starter Custom', starterTier: 'standard' }),
    });
    expect(tplRes.status).toBe(201);
    const tplPayload = (await tplRes.json()) as { template: { id: string }; resolvedBody: TemplateBody };
    const templateId = tplPayload.template.id;

    // Customize via advanced PATCH: add custom card, override openai name, set custom DNS + clientPatch
    const customBody: TemplateBody = structuredClone(tplPayload.resolvedBody);
    customBody.cards.unshift({ cardId: customCardId, enabled: true });
    customBody.cards = customBody.cards.map((ref) =>
      ref.cardId === 'openai' ? { ...ref, overrides: { name: '专属 AI 组' } } : ref,
    );
    customBody.dns = { ...customBody.dns, nameserver: ['https://1.1.1.1/dns-query'], respectRules: true };
    customBody.clientPatches = { mihomo: 'allow-lan: false\n' };

    const advPatchRes = await h.adminRequest(`/api/templates/${templateId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseBody: customBody, overlay: [], note: 'advanced tweaks' }),
    });
    expect(advPatchRes.status).toBe(200);

    // GET /simple must mark AI as custom and list 公司内网 in customItems
    const simpleRes = await h.adminRequest(`/api/templates/${templateId}/simple`);
    expect(simpleRes.status).toBe(200);
    const simpleView = (await simpleRes.json()) as SimpleTemplateView;
    expect(simpleView.routing.hasCustomizations).toBe(true);
    expect(simpleView.routing.scenarios.find((s) => s.id === 'ai')?.custom).toBe(true);
    expect(simpleView.routing.customItems).toEqual([expect.objectContaining({ id: customCardId, name: '公司内网' })]);

    // PATCH /simple: toggle telegram -> direct, and attempt to disable custom AI (must be ignored)
    const patchRes = await h.adminRequest(`/api/templates/${templateId}/simple`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenarios: [
          { id: 'ai', enabled: false, route: 'direct' },
          { id: 'telegram', enabled: true, route: 'direct' },
        ],
      }),
    });
    expect(patchRes.status).toBe(200);

    // Verify full template body still has custom card, openai override, DNS, clientPatches verbatim
    const detailRes = await h.adminRequest(`/api/templates/${templateId}`);
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as { resolvedBody: TemplateBody };
    expect(detail.resolvedBody.cards.some((c) => c.cardId === customCardId && c.enabled)).toBe(true);
    expect(detail.resolvedBody.cards.find((c) => c.cardId === 'openai')).toMatchObject({
      enabled: true,
      overrides: { name: '专属 AI 组' },
    });
    expect(detail.resolvedBody.dns.nameserver).toEqual(['https://1.1.1.1/dns-query']);
    expect(detail.resolvedBody.dns.respectRules).toBe(true);
    expect(detail.resolvedBody.clientPatches).toEqual({
      mihomo: 'allow-lan: false\n',
    });

    // Blank template also works via GET /simple
    const blankRes = await h.adminRequest('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Blank Template', blank: true }),
    });
    expect(blankRes.status).toBe(201);
    const blankId = ((await blankRes.json()) as { template: { id: string } }).template.id;
    const blankSimple = await h.adminRequest(`/api/templates/${blankId}/simple`);
    expect(blankSimple.status).toBe(200);
  });

  it('inherits encrypted slot bindings and snapshots when adding a client publication, and enforces Telegram read-only 403', async () => {
    const h = await createBackendHarness(backendKind);
    harnesses.push(h);

    const secretUrl = 'https://provider-inherit.example.test/sub?key=INHERIT_ME';
    const created = await quickCreateTemplate(
      h.env,
      {
        name: 'Inherit Test',
        clients: ['mihomo'],
        scenarios: [
          { id: 'domestic-direct', enabled: true },
          { id: 'ai', enabled: true, route: 'proxy' },
        ],
        rulesets: [],
        groupMode: 'auto',
        subscriptionUrl: secretUrl,
      },
      { baseUrl: 'https://rules.example.com', ruleToken: 'm2b-secret-token' },
    );

    const templateId = created.template.id;

    // Add a Shadowrocket publication with inheritSlotBindings: true
    const addPubRes = await h.adminRequest('/api/publications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'inherit-shadowrocket',
        templateId,
        clients: ['shadowrocket'],
        access: 'token',
        experimentalFullConfig: false,
        inheritSlotBindings: true,
      }),
    });
    expect(addPubRes.status).toBe(201);
    const addPubJson = (await addPubRes.json()) as {
      publication: { id: string; bindings: Array<{ slotId: string; maskedUrl?: string }> };
    };
    const srPubId = addPubJson.publication.id;
    expect(addPubJson.publication.bindings).toHaveLength(1);
    expect(addPubJson.publication.bindings[0].slotId).toBe('slot-main');

    // Verify encrypted binding actually decrypts under the new publication's AAD
    const repos = createRepositories(h.env.DB);
    const srBindings = await repos.nodeBindings.listByPublication(srPubId);
    expect(srBindings).toHaveLength(1);
    expect(bindingAad(srPubId, 'slot-main')).not.toBe(bindingAad(created.publications[0].id, 'slot-main'));

    // Switching the inherited bound publication to public MUST fail with 400
    const publicPatch = await h.adminRequest(`/api/publications/${srPubId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ access: 'public' }),
    });
    expect(publicPatch.status).toBe(400);

    // Shadowrocket subscription URL returns valid 200 config
    const srConfigRes = await h.app.request('/t/m2b-secret-token/inherit-shadowrocket/shadowrocket.conf', {}, h.env);
    expect(srConfigRes.status).toBe(200);
    const srConfigText = await srConfigRes.text();
    expect(srConfigText).toContain('[Proxy Group]');
    expect(srConfigText).toContain('[Rule]');

    // Unauthenticated request gets 401
    const unauthGet = await h.app.request(`/api/templates/${templateId}/simple`, { method: 'GET' }, h.env);
    expect(unauthGet.status).toBe(401);

    // Telegram Mini App session: GET -> 200, PATCH -> 403
    const initData = buildTelegramInitData(BOT_TOKEN, 2026, Math.floor(Date.now() / 1000));
    const tgLogin = await h.app.request(
      '/api/telegram/session',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://rules.example.com' },
        body: JSON.stringify({ initData }),
      },
      h.env,
    );
    expect(tgLogin.status).toBe(201);
    const tgCookie = (tgLogin.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    const tgGet = await h.app.request(
      `/api/templates/${templateId}/simple`,
      { method: 'GET', headers: { cookie: tgCookie } },
      h.env,
    );
    expect(tgGet.status).toBe(200);

    const tgPatch = await h.app.request(
      `/api/templates/${templateId}/simple`,
      {
        method: 'PATCH',
        headers: {
          cookie: tgCookie,
          origin: 'https://rules.example.com',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Should Fail' }),
      },
      h.env,
    );
    expect(tgPatch.status).toBe(403);
  });
});
