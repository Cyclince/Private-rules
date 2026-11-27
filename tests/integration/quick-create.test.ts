import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  lintTemplateById,
  previewTemplateById,
  probeTemplateById,
  quickCreateTemplate,
  type PreviewSubscriptionBatchResult,
  type PreviewSubscriptionResult,
  type QuickCreateTemplateResult,
} from '../../src/application/templates';
import { migrateDatabase } from '../../src/data/migrate';
import { createRepositories } from '../../src/data/repositories';
import { D1DatabaseAdapter } from '../../src/infrastructure/database/d1/adapter';
import { SqliteDatabaseAdapter } from '../../src/infrastructure/database/sqlite/adapter';
import { migrateSqliteDatabase } from '../../src/infrastructure/database/sqlite/migrations';
import { addRule, createCategory } from '../../src/lib/db';
import { createApp } from '../../src/server/app';
import type { Env } from '../../src/types';
import { FakeTelegramClient } from '../helpers/fake-telegram-client';

const SAMPLE_CLASH_SUBSCRIPTION_YAML = `
proxies:
  - name: "🇭🇰 香港 01"
    type: ss
    server: hk1.example.net
    port: 443
    cipher: aes-128-gcm
    password: secret
  - name: "🇭🇰 香港 02"
    type: ss
    server: hk2.example.net
    port: 443
    cipher: aes-128-gcm
    password: secret
  - name: "🇯🇵 日本 Tokyo 01"
    type: trojan
    server: jp1.example.net
    port: 443
    password: secret
  - name: "🇺🇸 美国 LA 01"
    type: trojan
    server: us1.example.net
    port: 443
    password: secret
  - name: "剩余流量：88.5 GB"
    type: ss
    server: info.example.net
    port: 443
    cipher: aes-128-gcm
    password: secret
`.trim();

const BOT_TOKEN = '999888:quick-create-bot';

function buildTelegramInitData(botToken: string, userId: number, authDate: number): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: `query-m2a-${userId}-${authDate}`,
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
    const dir = await mkdtemp(join(tmpdir(), 'private-rules-m2a-sqlite-'));
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
    RULE_TOKEN: 'm2a-secret-token',
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
  const adminCookie = login.headers.get('set-cookie')!.split(';')[0];

  const adminRequest = (path: string, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const needsCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    return app.request(
      path,
      {
        ...init,
        headers: {
          cookie: adminCookie,
          ...(needsCsrf ? { origin: 'https://rules.example.com' } : {}),
          ...(init.body && !(init.headers && 'content-type' in (init.headers as Record<string, string>))
            ? { 'content-type': 'application/json' }
            : {}),
          ...((init.headers as Record<string, string> | undefined) ?? {}),
        },
      },
      env,
    );
  };

  return {
    name: kind,
    env,
    adminCookie,
    rulesetDirectId,
    rulesetRejectId,
    adminRequest,
    cleanup: cleanupFn,
  };
}

describe('M2a quick-create & preview-subscription integration tests', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const backendKind of ['SQLite', 'D1'] as const) {
    describe(`[${backendKind}] POST /api/templates/quick-create`, () => {
      it('creates template + ruleset cards (ordered first) + per-client publications + encrypted bindings and compiles cleanly for mihomo & sing-box', async () => {
        const harness = await createBackendHarness(backendKind);
        try {
          const res = await harness.adminRequest('/api/templates/quick-create', {
            method: 'POST',
            body: JSON.stringify({
              name: '我的多端配置',
              clients: ['mihomo', 'sing-box', 'loon', 'quantumult-x', 'mihomo'],
              clientDisplayNames: ['Clash Verge', 'sing-box', 'Loon', '圈X'],
              clientLabels: { mihomo: 'Clash Verge Rev', loon: 'Loon', 'quantumult-x': 'Quantumult X' },
              scenarios: [
                { id: 'domestic-direct', enabled: true },
                { id: 'ad-block', enabled: true },
                { id: 'ai', enabled: true, route: 'region:JP' },
                { id: 'telegram', enabled: true, route: 'proxy' },
                { id: 'streaming', enabled: false },
              ],
              rulesets: [
                { rulesetId: harness.rulesetDirectId, route: 'direct' },
                { rulesetId: harness.rulesetRejectId, route: 'reject' },
              ],
              groupMode: 'region',
              subscriptionUrl: 'https://sub.airport.example/api/v1/client/subscribe?token=topsecret123',
              detectedRegions: ['HK', 'JP', 'US'],
              previewSummary: {
                nodeCount: 4,
                regions: { HK: 2, JP: 1, US: 1 },
                status: 'ok',
              },
            }),
          });

          expect(res.status).toBe(201);
          const payload = (await res.json()) as QuickCreateTemplateResult;

          expect(payload.template.name).toBe('我的多端配置');
          expect(payload.template.baseBody.wizardMeta?.createdByWizard).toBe(true);
          expect(payload.template.baseBody.wizardMeta?.groupMode).toBe('region');
          expect(payload.hasSubscription).toBe(true);

          // Deduplicated 4 clients: mihomo, sing-box, loon, quantumult-x
          expect(payload.publications.map((p) => p.client)).toEqual(['mihomo', 'sing-box', 'loon', 'quantumult-x']);
          for (const pub of payload.publications) {
            expect(pub.access).toBe('token');
            expect(pub.experimentalFullConfig).toBe(false);
            expect(pub.url).toContain('/t/m2a-secret-token/');
          }

          // Only detected regions (HK, JP, US) generated in region mode
          expect(payload.resolvedBody.regionGroups.map((g) => g.region)).toEqual(['HK', 'JP', 'US']);

          // Verify encrypted slot-main bindings persisted for every publication without plaintext URL
          const repos = createRepositories(harness.env.DB);
          for (const pub of payload.publications) {
            const bindings = await repos.nodeBindings.listByPublication(pub.id);
            expect(bindings).toHaveLength(1);
            expect(bindings[0].slotId).toBe('slot-main');
            expect(bindings[0].subscriptionUrlEnc).not.toContain('topsecret123');
            expect(bindings[0].lastStatus).toBe('ok');
            expect(bindings[0].lastNodeCount).toBe(4);
          }

          // Lint passes with zero errors
          const lintResult = await lintTemplateById(harness.env, payload.template.id, {
            clients: ['mihomo', 'sing-box'],
          });
          expect(lintResult.report.errorCount).toBe(0);

          // Compile for mihomo: referenced rulesets appear FIRST in exact order & Emby_Direct resolves to DIRECT
          const mihomoCompiled = await previewTemplateById(harness.env, payload.template.id, {
            client: 'mihomo',
            baseUrl: 'https://rules.example.com',
          });
          const mihomoDoc = parseYaml(mihomoCompiled.content) as {
            rules: string[];
            'proxy-groups': Array<{ name: string; proxies?: string[] }>;
          };
          expect(mihomoDoc.rules[0]).toMatch(/^RULE-SET,[^,]+,Emby_Direct$/);
          expect(mihomoDoc.rules[1]).toMatch(/^RULE-SET,[^,]+,Custom_Reject$/);
          const embyGroup = mihomoDoc['proxy-groups'].find((g) => g.name === 'Emby_Direct');
          expect(embyGroup?.proxies?.[0]).toBe('DIRECT');
          const rejectGroup = mihomoDoc['proxy-groups'].find((g) => g.name === 'Custom_Reject');
          expect(rejectGroup?.proxies?.[0]).toBe('REJECT');

          // Probe confirms emby.example.com resolves to DIRECT via the first rule
          const probe = await probeTemplateById(harness.env, payload.template.id, {
            target: 'emby.example.com',
          });
          expect(probe.result.policyChain.at(-1)?.label).toBe('DIRECT');

          // Compile for sing-box: valid JSON & ruleset rules appear first
          const singboxCompiled = await previewTemplateById(harness.env, payload.template.id, {
            client: 'sing-box',
            baseUrl: 'https://rules.example.com',
          });
          const singboxDoc = JSON.parse(singboxCompiled.content) as {
            route: { rules: Array<{ rule_set?: string[]; outbound?: string }> };
            outbounds: Array<{ tag: string; outbounds?: string[] }>;
          };
          const firstRuleSetRule = singboxDoc.route.rules.find((r) => Array.isArray(r.rule_set));
          expect(firstRuleSetRule?.outbound).toBe('Emby_Direct');
        } finally {
          await harness.cleanup();
        }
      });

      it('creates template cleanly without subscriptionUrl and uses CORE_REGION_GROUPS when groupMode=region', async () => {
        const harness = await createBackendHarness(backendKind);
        try {
          const res = await harness.adminRequest('/api/templates/quick-create', {
            method: 'POST',
            body: JSON.stringify({
              name: '无机场配置',
              clients: ['mihomo'],
              groupMode: 'region',
            }),
          });
          expect(res.status).toBe(201);
          const payload = (await res.json()) as QuickCreateTemplateResult;
          expect(payload.hasSubscription).toBe(false);
          expect(payload.resolvedBody.regionGroups.map((g) => g.region)).toEqual(['HK', 'TW', 'JP', 'SG', 'US', 'KR']);

          const repos = createRepositories(harness.env.DB);
          const bindings = await repos.nodeBindings.listByPublication(payload.publications[0].id);
          expect(bindings).toHaveLength(0);

          const mihomoCompiled = await previewTemplateById(harness.env, payload.template.id, {
            client: 'mihomo',
            baseUrl: 'https://rules.example.com',
          });
          expect(mihomoCompiled.content).toContain('proxy-groups:');
        } finally {
          await harness.cleanup();
        }
      });

      it('rolls back all inserts atomically when any statement in the transaction fails', async () => {
        const harness = await createBackendHarness(backendKind);
        try {
          await expect(
            quickCreateTemplate(
              harness.env,
              {
                name: '回滚测试',
                clients: ['mihomo', 'sing-box'],
                scenarios: [{ id: 'domestic-direct', enabled: true }],
                rulesets: [{ rulesetId: harness.rulesetDirectId, route: 'direct' }],
                groupMode: 'auto',
                subscriptionUrl: 'https://sub.airport.example/sub?token=rollback',
              },
              {
                baseUrl: 'https://rules.example.com',
                ruleToken: harness.env.RULE_TOKEN,
                extraBatchStatements: [
                  harness.env.DB.prepare(
                    'INSERT INTO publications (id, slug, template_id, clients, access, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                  ).bind(
                    'bad-pub',
                    'bad-pub',
                    'non-existent-template-fk',
                    '["mihomo"]',
                    'token',
                    '2026-01-01',
                    '2026-01-01',
                  ),
                ],
              },
            ),
          ).rejects.toThrow();

          const repos = createRepositories(harness.env.DB);
          expect(await repos.templates.listAll()).toHaveLength(0);
          expect(await repos.publications.listAll()).toHaveLength(0);
          expect(await repos.cards.listAll()).toHaveLength(0);
          const bindingsCount = await harness.env.DB.prepare('SELECT COUNT(*) AS cnt FROM node_bindings').first<{
            cnt: number;
          }>();
          expect(Number(bindingsCount?.cnt ?? 0)).toBe(0);
        } finally {
          await harness.cleanup();
        }
      });

      it('creates multi-airport subscriptions with default/deduped names, perProvider combineMode, encrypted bindings per publication, and rejects >10', async () => {
        const harness = await createBackendHarness(backendKind);
        try {
          const urlA = 'https://provider-a.example.test/sub?token=SECRET_ALPHA_111';
          const urlB = 'https://provider-b.example.test/sub?token=SECRET_BETA_222';
          const urlC = 'https://provider-c.example.test/sub?token=SECRET_GAMMA_333';

          const res = await harness.adminRequest('/api/templates/quick-create', {
            method: 'POST',
            body: JSON.stringify({
              name: '多机场全家桶',
              clients: ['mihomo', 'sing-box'],
              groupMode: 'region',
              combineMode: 'perProvider',
              subscriptions: [
                { name: '主力', url: urlA, userAgent: 'clash.meta/1.19' },
                { name: '主力', url: urlB },
                { url: urlC },
              ],
              detectedRegions: ['HK', 'JP'],
            }),
          });
          expect(res.status).toBe(201);
          const rawText = await res.text();
          // Security: never leak plaintext URLs or ciphertext
          expect(rawText).not.toContain('SECRET_ALPHA_111');
          expect(rawText).not.toContain('SECRET_BETA_222');
          expect(rawText).not.toContain('SECRET_GAMMA_333');
          expect(rawText).not.toContain('subscriptionUrlEnc');

          const body = JSON.parse(rawText) as QuickCreateTemplateResult;
          expect(body.combineMode).toBe('perProvider');
          expect(body.hasSubscription).toBe(true);
          expect(body.subscriptions.map((s) => ({ slotId: s.slotId, name: s.name }))).toEqual([
            { slotId: 'slot-main', name: '主力' },
            { slotId: 'slot-2', name: '主力 (2)' },
            { slotId: 'slot-3', name: '机场 3' },
          ]);
          expect(body.resolvedBody.combineMode).toBe('perProvider');
          expect(body.resolvedBody.slots.map((s) => s.id)).toEqual(['slot-main', 'slot-2', 'slot-3']);

          // Every publication must have all 3 slots encrypted & bound
          const repos = createRepositories(harness.env.DB);
          expect(body.publications).toHaveLength(2);
          for (const pub of body.publications) {
            const bindings = await repos.nodeBindings.listByPublication(pub.id);
            expect(bindings.map((b) => b.slotId).sort()).toEqual(['slot-2', 'slot-3', 'slot-main']);
            const mainBinding = bindings.find((b) => b.slotId === 'slot-main');
            expect(mainBinding?.userAgent).toBe('clash.meta/1.19');
          }

          // Mihomo preview compiles with visible per-airport groups
          const compiled = await previewTemplateById(harness.env, body.template.id, {
            client: 'mihomo',
            baseUrl: 'https://rules.example.com',
          });
          const doc = parseYaml(compiled.content) as Record<string, unknown>;
          const groups = doc['proxy-groups'] as Array<Record<string, unknown>>;
          expect(groups.find((g) => g.name === '主力')?.hidden).toBeUndefined();
          expect(groups.find((g) => g.name === '主力 (2)')?.hidden).toBeUndefined();
          expect(groups.find((g) => g.name === '机场 3')?.hidden).toBeUndefined();
          expect(groups.find((g) => g.name === '🌐 全部节点')?.hidden).toBeUndefined();

          // >10 subscriptions must be rejected with 400
          const tooManyRes = await harness.adminRequest('/api/templates/quick-create', {
            method: 'POST',
            body: JSON.stringify({
              name: '超限机场',
              clients: ['mihomo'],
              subscriptions: Array.from({ length: 11 }, (_, idx) => ({
                name: `机场 ${idx + 1}`,
                url: `https://sub-${idx + 1}.example.test/link`,
              })),
            }),
          });
          expect(tooManyRes.status).toBe(400);

          // Query param `subscriptions` rejected with 400
          const queryParamRes = await harness.adminRequest(
            '/api/templates/quick-create?subscriptions=https://leak.example.test/sub',
            {
              method: 'POST',
              body: JSON.stringify({ name: 'QueryLeak', clients: ['mihomo'] }),
            },
          );
          expect(queryParamRes.status).toBe(400);
        } finally {
          await harness.cleanup();
        }
      });
    });
  }

  describe('POST /api/templates/preview-subscription & Telegram RBAC', () => {
    it('parses mock subscription into node count and region stats without DB persistence or URL logging', async () => {
      const harness = await createBackendHarness('SQLite');
      try {
        const secretUrl = 'https://mock-airport.example/sub?token=super-secret-do-not-log-9876';
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(SAMPLE_CLASH_SUBSCRIPTION_YAML, {
            status: 200,
            headers: { 'content-type': 'text/yaml; charset=utf-8' },
          }),
        );

        const res = await harness.adminRequest('/api/templates/preview-subscription', {
          method: 'POST',
          body: JSON.stringify({ subscriptionUrl: secretUrl }),
        });

        expect(res.status).toBe(200);
        const payload = (await res.json()) as PreviewSubscriptionResult;
        expect(payload.nodeCount).toBe(4);
        expect(payload.infoNodeCount).toBe(1);
        expect(payload.regionCounts).toEqual({ HK: 2, JP: 1, US: 1 });
        expect(payload.regions[0]).toMatchObject({ code: 'HK', count: 2 });

        // Zero DB persistence
        const repos = createRepositories(harness.env.DB);
        expect(await repos.templates.listAll()).toHaveLength(0);
        expect(await repos.publications.listAll()).toHaveLength(0);
        const bindingsCount = await harness.env.DB.prepare('SELECT COUNT(*) AS cnt FROM node_bindings').first<{
          cnt: number;
        }>();
        expect(Number(bindingsCount?.cnt ?? 0)).toBe(0);

        // Secret URL never appeared in any console log
        for (const spy of [logSpy, infoSpy, warnSpy, errSpy]) {
          const allLogged = spy.mock.calls.flat().map(String).join('\n');
          expect(allLogged).not.toContain('super-secret-do-not-log-9876');
        }
      } finally {
        await harness.cleanup();
      }
    });

    it('returns plain-language error codes (LINK_INVALID, NEEDS_USER_AGENT, NOT_SUBSCRIPTION, TIMEOUT) and blocks SSRF', async () => {
      const harness = await createBackendHarness('SQLite');
      try {
        // SSRF loopback blocked
        const ssrfRes = await harness.adminRequest('/api/templates/preview-subscription', {
          method: 'POST',
          body: JSON.stringify({ subscriptionUrl: 'http://127.0.0.1:8080/sub' }),
        });
        expect(ssrfRes.status).toBe(400);
        const ssrfBody = (await ssrfRes.json()) as { details?: { previewErrorCode?: string } };
        expect(ssrfBody.details?.previewErrorCode).toBe('LINK_INVALID');

        // 403 -> NEEDS_USER_AGENT
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
        const uaRes = await harness.adminRequest('/api/templates/preview-subscription', {
          method: 'POST',
          body: JSON.stringify({ subscriptionUrl: 'https://mock-airport.example/sub-ua' }),
        });
        expect(uaRes.status).toBe(502);
        const uaBody = (await uaRes.json()) as { details?: { previewErrorCode?: string } };
        expect(uaBody.details?.previewErrorCode).toBe('NEEDS_USER_AGENT');

        // 404 -> LINK_INVALID
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('Not found', { status: 404 }));
        const notFoundRes = await harness.adminRequest('/api/templates/preview-subscription', {
          method: 'POST',
          body: JSON.stringify({ subscriptionUrl: 'https://mock-airport.example/expired' }),
        });
        expect(notFoundRes.status).toBe(502);
        const notFoundBody = (await notFoundRes.json()) as { details?: { previewErrorCode?: string } };
        expect(notFoundBody.details?.previewErrorCode).toBe('LINK_INVALID');

        // 200 HTML -> NOT_SUBSCRIPTION
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response('<html><body>Please login first</body></html>', { status: 200 }),
        );
        const htmlRes = await harness.adminRequest('/api/templates/preview-subscription', {
          method: 'POST',
          body: JSON.stringify({ subscriptionUrl: 'https://mock-airport.example/login-page' }),
        });
        expect(htmlRes.status).toBe(400);
        const htmlBody = (await htmlRes.json()) as { details?: { previewErrorCode?: string } };
        expect(htmlBody.details?.previewErrorCode).toBe('NOT_SUBSCRIPTION');

        // AbortError -> TIMEOUT
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(abortErr);
        const timeoutRes = await harness.adminRequest('/api/templates/preview-subscription', {
          method: 'POST',
          body: JSON.stringify({ subscriptionUrl: 'https://mock-airport.example/slow' }),
        });
        expect(timeoutRes.status).toBe(502);
        const timeoutBody = (await timeoutRes.json()) as { details?: { previewErrorCode?: string } };
        expect(timeoutBody.details?.previewErrorCode).toBe('TIMEOUT');

        // Query param subscriptionUrl rejected
        const queryRes = await harness.adminRequest(
          '/api/templates/preview-subscription?subscriptionUrl=https://mock-airport.example/leak',
          {
            method: 'POST',
            body: JSON.stringify({ subscriptionUrl: 'https://mock-airport.example/ok' }),
          },
        );
        expect(queryRes.status).toBe(400);
      } finally {
        await harness.cleanup();
      }
    });

    it('supports batch preview-subscription (up to 10 items) with partial failures isolated and no URL logging', async () => {
      const harness = await createBackendHarness('SQLite');
      try {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const okUrl = 'https://ok-airport.example/sub?token=BATCH_SECRET_OK_1';
        const uaUrl = 'https://ua-airport.example/sub?token=BATCH_SECRET_UA_2';
        const timeoutUrl = 'https://slow-airport.example/sub?token=BATCH_SECRET_TO_3';

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
          const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
          if (target === okUrl) {
            return new Response(SAMPLE_CLASH_SUBSCRIPTION_YAML, {
              status: 200,
              headers: { 'content-type': 'text/yaml; charset=utf-8' },
            });
          }
          if (target === uaUrl) {
            return new Response('Forbidden', { status: 403 });
          }
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        });

        const res = await harness.adminRequest('/api/templates/preview-subscription', {
          method: 'POST',
          body: JSON.stringify({
            subscriptions: [
              { name: '主力', url: okUrl },
              { name: '主力', url: uaUrl },
              { url: 'http://127.0.0.1:8080/ssrf-blocked' },
              { name: '慢速机场', url: timeoutUrl },
            ],
          }),
        });
        expect(res.status).toBe(200);
        const rawText = await res.text();
        expect(rawText).not.toContain('BATCH_SECRET_OK_1');
        expect(rawText).not.toContain('BATCH_SECRET_UA_2');
        expect(rawText).not.toContain('BATCH_SECRET_TO_3');

        const payload = JSON.parse(rawText) as PreviewSubscriptionBatchResult;
        expect(payload.items).toHaveLength(4);
        expect(payload.items[0]).toMatchObject({
          name: '主力',
          ok: true,
          nodeCount: 4,
        });
        expect(payload.items[0].regions[0]).toMatchObject({ code: 'HK', count: 2 });
        expect(payload.items[1]).toMatchObject({
          name: '主力 (2)',
          ok: false,
          nodeCount: 0,
          regions: [],
          errorCode: 'NEEDS_USER_AGENT',
        });
        expect(payload.items[2]).toMatchObject({
          name: '机场 3',
          ok: false,
          nodeCount: 0,
          regions: [],
          errorCode: 'LINK_INVALID',
        });
        expect(payload.items[3]).toMatchObject({
          name: '慢速机场',
          ok: false,
          nodeCount: 0,
          regions: [],
          errorCode: 'TIMEOUT',
        });
        expect(payload.totalNodeCount).toBe(4);
        expect(payload.regionCounts).toEqual({ HK: 2, JP: 1, US: 1 });

        // >10 items rejected with 400
        const tooMany = await harness.adminRequest('/api/templates/preview-subscription', {
          method: 'POST',
          body: JSON.stringify({
            subscriptions: Array.from({ length: 11 }, (_, i) => ({
              url: `https://sub-${i}.example/sub`,
            })),
          }),
        });
        expect(tooMany.status).toBe(400);

        // Query param `subscriptions` rejected with 400
        const queryLeak = await harness.adminRequest(
          '/api/templates/preview-subscription?subscriptions=https://leak.example/sub',
          {
            method: 'POST',
            body: JSON.stringify({ subscriptions: [{ url: okUrl }] }),
          },
        );
        expect(queryLeak.status).toBe(400);

        for (const spy of [logSpy, warnSpy, errSpy]) {
          const logged = spy.mock.calls.flat().map(String).join('\n');
          expect(logged).not.toContain('BATCH_SECRET_OK_1');
          expect(logged).not.toContain('BATCH_SECRET_UA_2');
          expect(logged).not.toContain('BATCH_SECRET_TO_3');
        }
      } finally {
        await harness.cleanup();
      }
    });

    it('rejects Telegram Mini App session writes with 403', async () => {
      const harness = await createBackendHarness('SQLite');
      const app = createApp();
      try {
        const initData = buildTelegramInitData(BOT_TOKEN, 2026, Math.floor(Date.now() / 1000));
        const tgLogin = await app.request(
          '/api/telegram/session',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: 'https://rules.example.com' },
            body: JSON.stringify({ initData }),
          },
          harness.env,
        );
        expect(tgLogin.status).toBe(201);
        const tgCookie = tgLogin.headers.get('set-cookie')!.split(';')[0];

        const quickRes = await app.request(
          '/api/templates/quick-create',
          {
            method: 'POST',
            headers: {
              cookie: tgCookie,
              origin: 'https://rules.example.com',
              'content-type': 'application/json',
            },
            body: JSON.stringify({ name: 'TG Attempt', clients: ['mihomo'] }),
          },
          harness.env,
        );
        expect(quickRes.status).toBe(403);

        const previewRes = await app.request(
          '/api/templates/preview-subscription',
          {
            method: 'POST',
            headers: {
              cookie: tgCookie,
              origin: 'https://rules.example.com',
              'content-type': 'application/json',
            },
            body: JSON.stringify({ subscriptionUrl: 'https://mock-airport.example/sub' }),
          },
          harness.env,
        );
        expect(previewRes.status).toBe(403);
      } finally {
        await harness.cleanup();
      }
    });
  });
});
