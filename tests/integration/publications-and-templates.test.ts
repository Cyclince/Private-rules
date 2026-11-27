import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  clearInFlightNodeFetches,
  compilePublicationDelivery,
  resolvePublicationDelivery,
} from '../../src/application/publications';
import { createRepositories } from '../../src/data/repositories';
import { encryptNodeSecret } from '../../src/infrastructure/crypto/node-secrets';
import { SqliteDatabaseAdapter } from '../../src/infrastructure/database/sqlite/adapter';
import { migrateSqliteDatabase } from '../../src/infrastructure/database/sqlite/migrations';
import { addRule, createCategory } from '../../src/lib/db';
import { ensureRuntimeSecrets } from '../../src/lib/runtime-secrets';
import { createApp } from '../../src/server/app';
import type { Env, SubscriptionCacheStore } from '../../src/types';
import { FakeTelegramClient } from '../helpers/fake-telegram-client';

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

function buildTelegramInitData(botToken: string, userId: number, authDate: number): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: `query-m43b-${userId}-${authDate}`,
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

describe('M4.3b publication backend, Class-A node bindings, delivery cache, and Telegram RBAC', () => {
  let directory: string;
  let database: SqliteDatabaseAdapter;
  let cache: InMemoryCacheStore;
  let env: Env;
  let adminCookie = '';
  let rulesetId = '';
  const app = createApp();
  const botToken = '999888:test-bot-token';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'private-rules-m43b-int-'));
    database = new SqliteDatabaseAdapter(join(directory, 'integration.db'));
    await migrateSqliteDatabase(database);
    cache = new InMemoryCacheStore();
    env = {
      DB: database,
      ASSETS: { fetch: async () => new Response('<html></html>') },
      ADMIN_PASSWORD: 'admin-password',
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      EXPLICIT_SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      RULE_TOKEN: 'pub-secret-token',
      BASE_URL: 'https://rules.example.com',
      RUNTIME: 'cloudflare',
      SUBSCRIPTION_CACHE: cache,
      TELEGRAM_CLIENT: new FakeTelegramClient(),
      TELEGRAM: {
        enabled: true,
        botToken,
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

    const createdRuleset = await createCategory(env, {
      name: 'my-ai-rules',
      tokenLinksEnabled: true,
      publicLinksEnabled: false,
    });
    rulesetId = createdRuleset.categories.find((item) => item.name === 'my-ai-rules')!.id;
    await addRule(env, rulesetId, { value: 'custom-ai.example.com', type: 'DOMAIN-SUFFIX' });

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
    adminCookie = login.headers.get('set-cookie')!.split(';')[0];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  const adminRequest = (path: string, init: RequestInit = {}, overrideEnv: Env = env) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const needsCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    return app.request(
      path,
      {
        ...init,
        headers: {
          ...(needsCsrf ? { origin: 'https://rules.example.com', 'content-type': 'application/json' } : {}),
          cookie: adminCookie,
          ...(init.headers ?? {}),
        },
      },
      overrideEnv,
    );
  };

  it('supports catalog, cards fork/edit, templates CRUD/import/rebase/versions/lint/probe/preview', async () => {
    // 1. Catalog
    const catalogRes = await adminRequest('/api/catalog');
    expect(catalogRes.status).toBe(200);
    const catalogJson = (await catalogRes.json()) as {
      items: Array<{ id: string; kind: string }>;
      total: number;
    };
    expect(catalogJson.total).toBeGreaterThan(0);
    expect(catalogJson.items.some((e) => e.id === `ruleset:${rulesetId}`)).toBe(true);

    const catalogDetailRes = await adminRequest(`/api/catalog/${encodeURIComponent(`ruleset:${rulesetId}`)}`);
    expect(catalogDetailRes.status).toBe(200);

    // 2. Cards: list, reject builtin edit, fork builtin, edit forked
    const cardsRes = await adminRequest('/api/cards?origin=builtin');
    expect(cardsRes.status).toBe(200);
    const cardsJson = (await cardsRes.json()) as { cards: Array<{ id: string; name: string }> };
    const builtinId = cardsJson.cards[0].id;

    const editBuiltinRes = await adminRequest(`/api/cards/${encodeURIComponent(builtinId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Blocked Edit' }),
    });
    expect(editBuiltinRes.status).toBe(403);

    const forkRes = await adminRequest(`/api/cards/${encodeURIComponent(builtinId)}/fork`, {
      method: 'POST',
      body: JSON.stringify({ name: 'My Forked Card', slug: 'my-forked-card' }),
    });
    expect(forkRes.status).toBe(201);
    const forkedCard = ((await forkRes.json()) as { card: { id: string; origin: string; forkedFrom: string } }).card;
    expect(forkedCard.origin).toBe('fork');
    expect(forkedCard.forkedFrom).toBe(builtinId);

    // 3. Import template (ACL4SSR ini + Mihomo YAML)
    const iniSample = [
      '[custom]',
      'ruleset=🚀 节点选择,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list',
      'ruleset=🎯 全球直连,[]GEOIP,CN',
      'ruleset=🐟 漏网之鱼,[]FINAL',
      'custom_proxy_group=🚀 节点选择`select`[]♻️ 自动选择`[]DIRECT',
      'custom_proxy_group=♻️ 自动选择`url-test`.*`http://www.gstatic.com/generate_204`300,,50',
      'custom_proxy_group=🎯 全球直连`select`[]DIRECT`[]🚀 节点选择',
      'custom_proxy_group=🐟 漏网之鱼`select`[]🚀 节点选择`[]DIRECT',
    ].join('\n');

    const importIniRes = await adminRequest('/api/templates/import', {
      method: 'POST',
      body: JSON.stringify({
        format: 'acl4ssr-ini',
        content: iniSample,
        name: 'Imported ACL4SSR',
        slug: 'imported-acl4ssr',
        save: true,
      }),
    });
    expect(importIniRes.status).toBe(201);
    const importedIni = (await importIniRes.json()) as {
      saved: boolean;
      template: { id: string; currentVersion: number };
      report: { sourceFormat: string };
    };
    expect(importedIni.saved).toBe(true);
    expect(importedIni.report.sourceFormat).toBe('acl4ssr-ini');

    const yamlSample = [
      'proxy-groups:',
      '  - name: Proxy',
      '    type: select',
      '    proxies: [DIRECT]',
      'rules:',
      '  - DOMAIN-SUFFIX,openai.com,Proxy',
      '  - MATCH,DIRECT',
    ].join('\n');

    const importYamlRes = await adminRequest('/api/templates/import', {
      method: 'POST',
      body: JSON.stringify({
        format: 'mihomo-yaml',
        content: yamlSample,
        save: false,
      }),
    });
    expect(importYamlRes.status).toBe(200);
    expect((await importYamlRes.json()) as { saved: boolean }).toMatchObject({ saved: false });

    // 4. Create starter template -> lint, probe, preview (mihomo OK, surge 404), update, versions, restore, rebase
    const createTplRes = await adminRequest('/api/templates', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Standard Starter',
        slug: 'standard-starter',
        starterTier: 'standard',
      }),
    });
    expect(createTplRes.status).toBe(201);
    const createdTpl = (await createTplRes.json()) as { template: { id: string } };
    const templateId = createdTpl.template.id;

    const lintRes = await adminRequest(`/api/templates/${templateId}/lint`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(lintRes.status).toBe(200);
    expect(await lintRes.json()).toMatchObject({ report: { issues: expect.any(Array) } });

    const probeRes = await adminRequest(`/api/templates/${templateId}/probe`, {
      method: 'POST',
      body: JSON.stringify({ target: 'https://chat.openai.com/' }),
    });
    expect(probeRes.status).toBe(200);
    expect(await probeRes.json()).toMatchObject({ result: { finalPolicy: expect.any(Object) } });

    const previewMihomoRes = await adminRequest(`/api/templates/${templateId}/preview?client=mihomo`, {
      method: 'POST',
      body: JSON.stringify({ output: 'minimal' }),
    });
    expect(previewMihomoRes.status).toBe(200);
    const previewJson = (await previewMihomoRes.json()) as {
      preview: { client: string; content: string };
    };
    expect(previewJson.preview.client).toBe('mihomo');
    expect(previewJson.preview.content).toContain('proxy-groups:');

    const previewStashRes = await adminRequest(`/api/templates/${templateId}/preview?client=stash`, {
      method: 'POST',
      body: JSON.stringify({ output: 'full' }),
    });
    expect(previewStashRes.status).toBe(200);
    const previewStashJson = (await previewStashRes.json()) as {
      preview: { client: string; content: string };
    };
    expect(previewStashJson.preview.client).toBe('stash');
    expect(previewStashJson.preview.content).toContain('proxy-groups:');

    const previewSurgeRes = await adminRequest(`/api/templates/${templateId}/preview?client=surge`, {
      method: 'POST',
      body: JSON.stringify({ output: 'full' }),
    });
    expect(previewSurgeRes.status).toBe(200);
    const previewSurgeJson = (await previewSurgeRes.json()) as {
      preview: { client: string; content: string };
    };
    expect(previewSurgeJson.preview.client).toBe('surge');
    expect(previewSurgeJson.preview.content).toContain('[Proxy Group]');
    expect(previewSurgeJson.preview.content).toContain('[Rule]');

    const previewSingboxRes = await adminRequest(`/api/templates/${templateId}/preview?client=sing-box`, {
      method: 'POST',
      body: JSON.stringify({ output: 'full' }),
    });
    expect(previewSingboxRes.status).toBe(200);
    const previewSingboxJson = (await previewSingboxRes.json()) as {
      preview: { client: string; content: string; contentType: string };
    };
    expect(previewSingboxJson.preview.client).toBe('sing-box');
    expect(previewSingboxJson.preview.contentType).toContain('application/json');
    const parsedSingboxPreview = JSON.parse(previewSingboxJson.preview.content) as {
      outbounds: unknown[];
      route: { rules: unknown[]; final: string };
    };
    expect(parsedSingboxPreview.outbounds.length).toBeGreaterThan(0);
    expect(parsedSingboxPreview.route.final).toBeTruthy();

    // Loon & QX default to safe rules-only resource; experimentalFullConfig=true emits full config + unverified warning
    const previewLoonSafeRes = await adminRequest(`/api/templates/${templateId}/preview?client=loon`, {
      method: 'POST',
      body: JSON.stringify({ output: 'full' }),
    });
    expect(previewLoonSafeRes.status).toBe(200);
    const previewLoonSafe = (await previewLoonSafeRes.json()) as {
      preview: {
        client: string;
        content: string;
        report: { items: Array<{ code: string; message: string }> };
      };
    };
    expect(previewLoonSafe.preview.client).toBe('loon');
    expect(previewLoonSafe.preview.content).not.toContain('[General]');
    expect(previewLoonSafe.preview.report.items.some((i) => i.code === 'RULES_ONLY_SAFE_DEFAULT')).toBe(true);

    const previewLoonExpRes = await adminRequest(`/api/templates/${templateId}/preview?client=loon`, {
      method: 'POST',
      body: JSON.stringify({ output: 'full', experimentalFullConfig: true }),
    });
    expect(previewLoonExpRes.status).toBe(200);
    const previewLoonExp = (await previewLoonExpRes.json()) as {
      preview: { content: string; report: { items: Array<{ code: string; message: string }> } };
    };
    expect(previewLoonExp.preview.content).toContain('[General]');
    expect(previewLoonExp.preview.content).toContain('[Proxy Group]');
    expect(
      previewLoonExp.preview.report.items.some(
        (i) => i.code === 'EXPERIMENTAL_FULL_CONFIG_UNVERIFIED' && i.message.includes('未经真机验证'),
      ),
    ).toBe(true);

    const previewQxSafeRes = await adminRequest(`/api/templates/${templateId}/preview?client=quantumult-x`, {
      method: 'POST',
      body: JSON.stringify({ output: 'full' }),
    });
    expect(previewQxSafeRes.status).toBe(200);
    const previewQxSafe = (await previewQxSafeRes.json()) as {
      preview: { content: string; report: { items: Array<{ code: string }> } };
    };
    expect(previewQxSafe.preview.content).not.toContain('[policy]');
    expect(previewQxSafe.preview.report.items.some((i) => i.code === 'RULES_ONLY_SAFE_DEFAULT')).toBe(true);

    const previewSrRes = await adminRequest(`/api/templates/${templateId}/preview?client=shadowrocket`, {
      method: 'POST',
      body: JSON.stringify({ output: 'full' }),
    });
    expect(previewSrRes.status).toBe(200);
    const previewSr = (await previewSrRes.json()) as { preview: { content: string } };
    expect(previewSr.preview.content).toContain('[General]');
    expect(previewSr.preview.content).toContain('[Proxy Group]');
    expect(previewSr.preview.content).toContain('[Rule]');

    // Update -> check versions -> restore v1 -> rebase
    const patchTplRes = await adminRequest(`/api/templates/${templateId}`, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'updated description', note: 'v2 edit' }),
    });
    expect(patchTplRes.status).toBe(200);

    const versionsRes = await adminRequest(`/api/templates/${templateId}/versions`);
    expect(versionsRes.status).toBe(200);
    const versionsJson = (await versionsRes.json()) as { versions: Array<{ version: number }> };
    expect(versionsJson.versions.map((v) => v.version)).toEqual([2, 1]);

    const v1Res = await adminRequest(`/api/templates/${templateId}/versions/1`);
    expect(v1Res.status).toBe(200);

    const restoreRes = await adminRequest(`/api/templates/${templateId}/versions/1/restore`, {
      method: 'POST',
      body: JSON.stringify({ note: 'rollback to v1' }),
    });
    expect(restoreRes.status).toBe(200);
    expect(await restoreRes.json()).toMatchObject({ restoredFrom: 1, template: { currentVersion: 3 } });

    const rebasePreviewRes = await adminRequest(`/api/templates/${templateId}/rebase`, {
      method: 'POST',
      body: JSON.stringify({ format: 'mihomo-yaml', content: yamlSample, apply: false }),
    });
    expect(rebasePreviewRes.status).toBe(200);
    expect(await rebasePreviewRes.json()).toMatchObject({ applied: false });
  });

  it('protects node slot subscription URLs: requires explicit SESSION_SECRET, masks output, and never leaks to logs, URLs, preview, or backups', async () => {
    const createTplRes = await adminRequest('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ name: 'Node Sec Tpl', slug: 'node-sec-tpl', starterTier: 'standard' }),
    });
    const { template, resolvedBody } = (await createTplRes.json()) as {
      template: { id: string };
      resolvedBody: { slots: Array<{ id: string }> };
    };
    const slotId = resolvedBody.slots[0].id;

    const createPubRes = await adminRequest('/api/publications', {
      method: 'POST',
      body: JSON.stringify({
        slug: 'node-sec-pub',
        templateId: template.id,
        clients: ['mihomo'],
        access: 'token',
      }),
    });
    expect(createPubRes.status).toBe(201);
    const { publication } = (await createPubRes.json()) as { publication: { id: string } };

    // Reject query parameter URL passing
    const queryLeakAttempt = await adminRequest(
      `/api/publications/${publication.id}/slots/${slotId}?subscriptionUrl=https://secret.example/sub`,
      {
        method: 'PUT',
        body: JSON.stringify({ subscriptionUrl: 'https://secret.example/sub' }),
      },
    );
    expect(queryLeakAttempt.status).toBe(400);
    expect(await queryLeakAttempt.json()).toMatchObject({ code: 'VALIDATION_FAILED' });

    // Reject missing explicit SESSION_SECRET even when DB fallback secret is populated
    const noExplicitEnv: Env = {
      ...env,
      SESSION_SECRET: '',
      EXPLICIT_SESSION_SECRET: undefined,
    };
    await ensureRuntimeSecrets(noExplicitEnv);
    const loginNoSecret = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://rules.example.com' },
        body: JSON.stringify({ password: 'admin-password' }),
      },
      noExplicitEnv,
    );
    const noSecretCookie = loginNoSecret.headers.get('set-cookie')!.split(';')[0];

    const missingSecretRes = await app.request(
      `/api/publications/${publication.id}/slots/${slotId}`,
      {
        method: 'PUT',
        headers: {
          cookie: noSecretCookie,
          origin: 'https://rules.example.com',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ subscriptionUrl: 'https://airport.private.example/link/abc123SECRET' }),
      },
      noExplicitEnv,
    );
    expect(missingSecretRes.status).toBe(503);
    expect(await missingSecretRes.json()).toMatchObject({ code: 'SESSION_SECRET_REQUIRED' });

    // Spy on console output to verify plaintext URL never appears in logs
    const logLines: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logLines.push(args.map(String).join(' '));
      });
    }

    const secretToken = 'TOP_SECRET_SUB_TOKEN_987654';
    const secretSubUrl = `https://airport.private.example/api/v1/client/subscribe?token=${secretToken}`;

    const bindRes = await adminRequest(`/api/publications/${publication.id}/slots/${slotId}`, {
      method: 'PUT',
      body: JSON.stringify({ subscriptionUrl: secretSubUrl, userAgent: 'clash-verge/2.0' }),
    });
    expect(bindRes.status).toBe(200);
    const bindText = await bindRes.text();
    expect(bindText).toContain('https://airport.private.example/***');
    expect(bindText).not.toContain(secretToken);

    // GET publication returns masked URL only
    const getPubRes = await adminRequest(`/api/publications/${publication.id}`);
    expect(getPubRes.status).toBe(200);
    const getPubText = await getPubRes.text();
    expect(getPubText).toContain('https://airport.private.example/***');
    expect(getPubText).not.toContain(secretToken);

    // fetch-names parses YAML nodes without logging the subscription URL or leaking credentials
    const originalFetch = globalThis.fetch;
    let shouldFailUpstream = false;
    globalThis.fetch = async (input, init) => {
      if (String(input) === secretSubUrl) {
        if (shouldFailUpstream) {
          throw new Error(`ECONNRESET fetching ${secretSubUrl}`);
        }
        return new Response(
          [
            'proxies:',
            '  - name: "🇭🇰 香港 01"',
            '    type: ss',
            '    server: hk-secret.internal.test',
            '    port: 8388',
            '    cipher: aes-256-gcm',
            '    password: SECRET_SS_PASSWORD_123',
            '  - name: "🇯🇵 日本 02"',
            '    type: vmess',
            '    server: jp-secret.internal.test',
            '    port: 443',
            '    uuid: 11111111-2222-3333-4444-555555555555',
            '    alterId: 0',
          ].join('\n'),
          { status: 200, headers: { 'content-type': 'text/yaml' } },
        );
      }
      return originalFetch(input, init);
    };
    try {
      const fetchNamesRes = await adminRequest(`/api/publications/${publication.id}/slots/${slotId}/fetch-names`, {
        method: 'POST',
      });
      expect(fetchNamesRes.status).toBe(200);
      const fetchNamesText = await fetchNamesRes.text();
      expect(fetchNamesText).not.toContain('hk-secret.internal.test');
      expect(fetchNamesText).not.toContain('jp-secret.internal.test');
      expect(fetchNamesText).not.toContain('SECRET_SS_PASSWORD_123');
      expect(fetchNamesText).not.toContain('11111111-2222-3333-4444-555555555555');
      expect(fetchNamesText).not.toContain('8388');
      expect(fetchNamesText).not.toContain(secretToken);

      const fetched = JSON.parse(fetchNamesText) as {
        slotId: string;
        nodeNames: string[];
        nodes: Array<{ name: string; protocol: string; regions: string[]; isInfo: boolean }>;
        regions: Record<string, string[]>;
        count: number;
        stale: boolean;
        fetchedAt: string;
      };
      expect(fetched.slotId).toBe(slotId);
      expect(fetched.count).toBe(2);
      expect(fetched.stale).toBe(false);
      expect(fetched.nodeNames).toEqual(['🇭🇰 香港 01', '🇯🇵 日本 02']);
      expect(fetched.nodes).toEqual([
        { name: '🇭🇰 香港 01', protocol: 'ss', regions: ['HK'], isInfo: false },
        { name: '🇯🇵 日本 02', protocol: 'vmess', regions: ['JP'], isInfo: false },
      ]);
      expect(fetched.regions).toEqual({
        HK: ['🇭🇰 香港 01'],
        JP: ['🇯🇵 日本 02'],
      });

      // Forced refresh failure degrades to stale cached snapshot with redacted staleReason
      shouldFailUpstream = true;
      const staleRes = await adminRequest(
        `/api/publications/${publication.id}/slots/${slotId}/fetch-names?refresh=true`,
        { method: 'POST' },
      );
      expect(staleRes.status).toBe(200);
      const staleText = await staleRes.text();
      expect(staleText).not.toContain(secretToken);
      const staleBody = JSON.parse(staleText) as {
        stale: boolean;
        staleReason?: string;
        nodeNames: string[];
      };
      expect(staleBody.stale).toBe(true);
      expect(staleBody.staleReason).toContain('https://airport.private.example/***');
      expect(staleBody.nodeNames).toEqual(['🇭🇰 香港 01', '🇯🇵 日本 02']);
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Preview must never contain real subscription URL
    const previewRes = await adminRequest(`/api/templates/${template.id}/preview?client=mihomo`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(previewRes.status).toBe(200);
    expect(await previewRes.text()).not.toContain(secretToken);

    // Backup export must never contain real subscription URL or ciphertext
    const backupRes = await adminRequest('/api/backup');
    expect(backupRes.status).toBe(200);
    const backupText = await backupRes.text();
    expect(backupText).not.toContain(secretToken);
    expect(backupText).not.toContain('airport.private.example');
    expect(backupText).not.toContain('enc:aes-256-gcm:');

    // Logs must never contain the plaintext subscription URL or token
    const allLogs = logLines.join('\n');
    expect(allLogs).not.toContain(secretToken);
    expect(allLogs).not.toContain(secretSubUrl);

    // Rotating SESSION_SECRET degrades publication detail safely to needsRebind: true
    const rotatedEnv: Env = {
      ...env,
      SESSION_SECRET: 'fedcba9876543210fedcba9876543210',
      EXPLICIT_SESSION_SECRET: 'fedcba9876543210fedcba9876543210',
    };
    const rotatedLogin = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost' },
        body: JSON.stringify({ password: 'admin-password' }),
      },
      rotatedEnv,
    );
    const rotatedCookie = rotatedLogin.headers.get('set-cookie')!.split(';')[0];
    const rotatedDetailRes = await app.request(
      `/api/publications/${publication.id}`,
      { headers: { cookie: rotatedCookie } },
      rotatedEnv,
    );
    expect(rotatedDetailRes.status).toBe(200);
    const rotatedDetail = (await rotatedDetailRes.json()) as {
      publication: { bindings: Array<{ maskedUrl: string; needsRebind: boolean }> };
    };
    expect(rotatedDetail.publication.bindings[0]).toMatchObject({
      maskedUrl: '***',
      needsRebind: true,
    });
  });

  it('serves /p and /t subscriptions with token checks, 404 for unsupported clients, ETag 304, and active cache invalidation', async () => {
    // Create a template + two publications (token & public)
    const tplRes = await adminRequest('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ name: 'Delivery Tpl', slug: 'delivery-tpl', starterTier: 'standard' }),
    });
    const { template, resolvedBody } = (await tplRes.json()) as {
      template: { id: string };
      resolvedBody: { slots: Array<{ id: string }> };
    };
    const slotId = resolvedBody.slots[0].id;

    const tokenPubRes = await adminRequest('/api/publications', {
      method: 'POST',
      body: JSON.stringify({
        slug: 'my-mihomo',
        templateId: template.id,
        clients: ['mihomo', 'stash', 'surge'],
        access: 'token',
        output: 'full',
      }),
    });
    const tokenPub = ((await tokenPubRes.json()) as { publication: { id: string } }).publication;

    const publicPubRes = await adminRequest('/api/publications', {
      method: 'POST',
      body: JSON.stringify({
        slug: 'open-mihomo',
        templateId: template.id,
        pinnedVersion: 1,
        clients: ['mihomo', 'stash', 'surge'],
        access: 'public',
        output: 'minimal',
      }),
    });
    expect(publicPubRes.status).toBe(201);

    const subUrlV1 = 'https://provider-v1.example.com/sub?k=alpha-111';
    await adminRequest(`/api/publications/${tokenPub.id}/slots/${slotId}`, {
      method: 'PUT',
      body: JSON.stringify({ subscriptionUrl: subUrlV1, userAgent: 'clash.meta/1.19' }),
    });

    // Wrong token -> 404
    const wrongToken = await app.request('/t/wrong-token/my-mihomo/mihomo.yaml', {}, env);
    expect(wrongToken.status).toBe(404);

    // Token-only publication accessed via /p -> 404
    const wrongMode = await app.request('/p/my-mihomo/mihomo.yaml', {}, env);
    expect(wrongMode.status).toBe(404);

    // Unlisted client on publication returns 404
    for (const file of ['loon.conf', 'qx.conf', 'shadowrocket.conf']) {
      const unlisted = await app.request(`/t/pub-secret-token/my-mihomo/${file}`, {}, env);
      expect(unlisted.status).toBe(404);
    }

    // /t delivers stash.yaml and surge.conf with decrypted slot URL, ETag/304, and proper content-type
    const stashRes = await app.request('/t/pub-secret-token/my-mihomo/stash.yaml', {}, env);
    expect(stashRes.status).toBe(200);
    expect(stashRes.headers.get('content-type')).toContain('yaml');
    const stashEtag = stashRes.headers.get('etag');
    expect(stashEtag).toBeTruthy();
    const parsedStash = parseYaml(await stashRes.text()) as {
      dns?: Record<string, unknown>;
      'proxy-providers'?: Record<string, { url: string; headers?: Record<string, string> }>;
      'proxy-groups'?: Array<Record<string, unknown>>;
    };
    expect(parsedStash.dns).toBeDefined();
    expect(
      Object.values(parsedStash['proxy-providers'] ?? {}).some(
        (p) => p.url === subUrlV1 && p.headers?.['User-Agent'] === 'clash.meta/1.19',
      ),
    ).toBe(true);
    const stash304 = await app.request(
      '/t/pub-secret-token/my-mihomo/stash.yaml',
      { headers: { 'if-none-match': stashEtag! } },
      env,
    );
    expect(stash304.status).toBe(304);

    const surgeRes = await app.request('/t/pub-secret-token/my-mihomo/surge.conf', {}, env);
    expect(surgeRes.status).toBe(200);
    expect(surgeRes.headers.get('content-type')).toContain('text/plain');
    const surgeEtag = surgeRes.headers.get('etag');
    expect(surgeEtag).toBeTruthy();
    const surgeText = await surgeRes.text();
    expect(surgeText).toContain('[General]');
    expect(surgeText).toContain('[Proxy Group]');
    expect(surgeText).toContain(`policy-path=${subUrlV1}`);
    expect(surgeText).toContain('policy-regex-filter=');
    expect(surgeText).toContain('[Rule]');
    expect(surgeText).toContain('RULE-SET,');
    const surge304 = await app.request(
      '/t/pub-secret-token/my-mihomo/surge.conf',
      { headers: { 'if-none-match': surgeEtag! } },
      env,
    );
    expect(surge304.status).toBe(304);

    // /p delivers minimal stash.yaml and surge.conf without [General] / dns skeleton
    const publicStashRes = await app.request('/p/open-mihomo/stash.yaml', {}, env);
    expect(publicStashRes.status).toBe(200);
    const parsedPublicStash = parseYaml(await publicStashRes.text()) as { dns?: unknown };
    expect(parsedPublicStash.dns).toBeUndefined();

    const publicSurgeRes = await app.request('/p/open-mihomo/surge.conf', {}, env);
    expect(publicSurgeRes.status).toBe(200);
    const publicSurgeText = await publicSurgeRes.text();
    expect(publicSurgeText).not.toContain('[General]');
    expect(publicSurgeText).toContain('[Proxy Group]');

    const putsBeforeMihomo = cache.putCalls;

    // Valid /t request compiles Mihomo YAML, sets ETag + 5min Cache-Control + wildcard CORS, and populates cache
    const first = await app.request('/t/pub-secret-token/my-mihomo/mihomo.yaml', {}, env);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('max-age=300');
    expect(first.headers.get('access-control-allow-origin')).toBe('*');
    const etag1 = first.headers.get('etag');
    expect(etag1).toBeTruthy();

    const yaml1 = await first.text();
    const parsed1 = parseYaml(yaml1) as {
      'mixed-port'?: number;
      'proxy-providers'?: Record<string, { url: string; header?: Record<string, string[]> }>;
    };
    expect(parsed1['mixed-port']).toBeDefined(); // full output includes base skeleton
    const providers1 = Object.values(parsed1['proxy-providers'] ?? {});
    expect(providers1.some((p) => p.url === subUrlV1 && p.header?.['User-Agent']?.[0] === 'clash.meta/1.19')).toBe(
      true,
    );
    expect(cache.putCalls).toBe(putsBeforeMihomo + 1);

    // Second request hits cache without re-putting, and If-None-Match returns 304
    const second = await app.request('/t/pub-secret-token/my-mihomo/mihomo.yaml', {}, env);
    expect(second.status).toBe(200);
    expect(cache.putCalls).toBe(putsBeforeMihomo + 1);

    const notModified = await app.request(
      '/t/pub-secret-token/my-mihomo/mihomo.yaml',
      { headers: { 'if-none-match': etag1! } },
      env,
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe('');

    const weakNotModified = await app.request(
      '/t/pub-secret-token/my-mihomo/mihomo.yaml',
      { headers: { 'if-none-match': `W/${etag1!}` } },
      env,
    );
    expect(weakNotModified.status).toBe(304);

    // Public /p route works for public publication
    const publicRes = await app.request('/p/open-mihomo/mihomo.yaml', {}, env);
    expect(publicRes.status).toBe(200);
    const parsedPublic = parseYaml(await publicRes.text()) as { 'mixed-port'?: number };
    expect(parsedPublic['mixed-port']).toBeUndefined(); // minimal output omits skeleton

    // 1) Mutate node binding -> cache actively purged, old ETag returns 200 with new URL & ETag
    const deletesBeforeBinding = cache.deleteCalls;
    const subUrlV2 = 'https://provider-v2.example.com/sub?k=beta-222';
    const rebindRes = await adminRequest(`/api/publications/${tokenPub.id}/slots/${slotId}`, {
      method: 'PUT',
      body: JSON.stringify({ subscriptionUrl: subUrlV2 }),
    });
    expect(rebindRes.status).toBe(200);
    expect(cache.deleteCalls).toBeGreaterThan(deletesBeforeBinding);

    const afterBinding = await app.request(
      '/t/pub-secret-token/my-mihomo/mihomo.yaml',
      { headers: { 'if-none-match': etag1! } },
      env,
    );
    expect(afterBinding.status).toBe(200);
    const etag2 = afterBinding.headers.get('etag');
    expect(etag2).not.toBe(etag1);
    const yaml2 = await afterBinding.text();
    expect(yaml2).toContain(subUrlV2);
    expect(yaml2).not.toContain(subUrlV1);

    // 2) Mutate publication output profile (full -> minimal) -> cache invalidated
    const deletesBeforeOutput = cache.deleteCalls;
    const patchPubRes = await adminRequest(`/api/publications/${tokenPub.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ output: 'minimal' }),
    });
    expect(patchPubRes.status).toBe(200);
    expect(cache.deleteCalls).toBeGreaterThan(deletesBeforeOutput);

    const afterOutput = await app.request(
      '/t/pub-secret-token/my-mihomo/mihomo.yaml',
      { headers: { 'if-none-match': etag2! } },
      env,
    );
    expect(afterOutput.status).toBe(200);
    const etag3 = afterOutput.headers.get('etag');
    expect(etag3).not.toBe(etag2);
    const parsedMinimal = parseYaml(await afterOutput.text()) as { 'mixed-port'?: number };
    expect(parsedMinimal['mixed-port']).toBeUndefined();

    // 3) Mutate template -> cache invalidated for unpinned publication; pinned public publication stays on v1
    const deletesBeforeTpl = cache.deleteCalls;
    const patchTplRes = await adminRequest(`/api/templates/${template.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        baseBody: {
          ...resolvedBody,
          final: { kind: 'builtin', id: 'DIRECT' },
        },
      }),
    });
    expect(patchTplRes.status).toBe(200);
    expect(cache.deleteCalls).toBeGreaterThan(deletesBeforeTpl);

    const afterTpl = await app.request(
      '/t/pub-secret-token/my-mihomo/mihomo.yaml',
      { headers: { 'if-none-match': etag3! } },
      env,
    );
    expect(afterTpl.status).toBe(200);
    expect(afterTpl.headers.get('etag')).not.toBe(etag3);
    expect(await afterTpl.text()).toContain('MATCH,DIRECT');

    // Pinned public publication still compiles v1 (not DIRECT final policy)
    const pinnedAfterTpl = await app.request('/p/open-mihomo/mihomo.yaml', {}, env);
    expect(pinnedAfterTpl.status).toBe(200);
    expect(await pinnedAfterTpl.text()).not.toContain('MATCH,DIRECT');

    // Public/node-binding mutual exclusion rules (design §14):
    // 1) Switching a bound token publication to public -> 400 VALIDATION_FAILED
    const switchBoundToPublic = await adminRequest(`/api/publications/${tokenPub.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ access: 'public' }),
    });
    expect(switchBoundToPublic.status).toBe(400);
    const switchBoundErr = (await switchBoundToPublic.json()) as { code: string; error: string };
    expect(switchBoundErr.code).toBe('VALIDATION_FAILED');
    expect(switchBoundErr.error).toContain('token');

    // 2) Binding a node slot to a public publication -> 400 VALIDATION_FAILED
    const publicPub = ((await publicPubRes.json()) as { publication: { id: string } }).publication;
    const bindToPublic = await adminRequest(`/api/publications/${publicPub.id}/slots/${slotId}`, {
      method: 'PUT',
      body: JSON.stringify({ subscriptionUrl: 'https://should-not-bind.example/sub?token=abc' }),
    });
    expect(bindToPublic.status).toBe(400);
    const bindToPublicErr = (await bindToPublic.json()) as { code: string; error: string };
    expect(bindToPublicErr.code).toBe('VALIDATION_FAILED');
    expect(bindToPublicErr.error).toContain('public');

    // 3) Token publication with node binding continues to deliver proxy-providers normally
    const tokenOk = await app.request('/t/pub-secret-token/my-mihomo/mihomo.yaml', {}, env);
    expect(tokenOk.status).toBe(200);
    const parsedTokenOk = parseYaml(await tokenOk.text()) as {
      'proxy-providers'?: Record<string, { url: string }>;
    };
    expect(Object.values(parsedTokenOk['proxy-providers'] ?? {}).some((p) => p.url === subUrlV2)).toBe(true);

    // 4) Defense-in-depth on /p/:slug/:file: if a public publication ever has a node_bindings row in DB,
    //    delivery must refuse with generic 404 (leaking no reason) and log a warn without any URL
    const leakedSecretToken = 'FORCED_DB_SECRET_TOKEN_XYZ';
    const leakedSecretUrl = `https://forced-db.example.com/sub?token=${leakedSecretToken}`;
    const encryptedUrl = await encryptNodeSecret(
      leakedSecretUrl,
      env.EXPLICIT_SESSION_SECRET!,
      `publication:${publicPub.id}:slot:${slotId}`,
    );
    await createRepositories(database).nodeBindings.upsert(
      {
        publicationId: publicPub.id,
        slotId,
        subscriptionUrlEnc: encryptedUrl,
        userAgent: null,
      },
      new Date().toISOString(),
    );

    const warnLogs: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnLogs.push(args.map(String).join(' '));
    });

    const blockedPublicRes = await app.request('/p/open-mihomo/mihomo.yaml', {}, env);
    expect(blockedPublicRes.status).toBe(404);
    const blockedPublicBody = await blockedPublicRes.text();
    expect(blockedPublicBody).not.toContain('node');
    expect(blockedPublicBody).not.toContain('节点');
    expect(blockedPublicBody).not.toContain(leakedSecretToken);
    expect(blockedPublicBody).not.toContain('forced-db.example.com');

    expect(warnLogs.length).toBeGreaterThan(0);
    const joinedWarnLogs = warnLogs.join('\n');
    expect(joinedWarnLogs).toContain(publicPub.id);
    expect(joinedWarnLogs).not.toContain(leakedSecretToken);
    expect(joinedWarnLogs).not.toContain(leakedSecretUrl);
    expect(joinedWarnLogs).not.toContain('forced-db.example.com');
  });

  it('allows Telegram Mini App sessions to read templates/cards/publications while blocking all writes with 403', async () => {
    // Seed a template & publication as admin
    const tplRes = await adminRequest('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ name: 'TG Read Tpl', slug: 'tg-read-tpl', starterTier: 'standard' }),
    });
    const { template, resolvedBody } = (await tplRes.json()) as {
      template: { id: string };
      resolvedBody: { slots: Array<{ id: string }> };
    };
    const slotId = resolvedBody.slots[0].id;

    const pubRes = await adminRequest('/api/publications', {
      method: 'POST',
      body: JSON.stringify({
        slug: 'tg-read-pub',
        templateId: template.id,
        clients: ['mihomo'],
        access: 'token',
      }),
    });
    const { publication } = (await pubRes.json()) as { publication: { id: string } };

    // Exchange Telegram initData for a Mini App session cookie
    const exchange = await app.request(
      '/api/telegram/session',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://rules.example.com' },
        body: JSON.stringify({
          initData: buildTelegramInitData(botToken, 2026, Math.floor(Date.now() / 1000)),
        }),
      },
      env,
    );
    expect(exchange.status).toBe(201);
    const tgCookie = exchange.headers.get('set-cookie')!.split(';')[0];

    const tgRequest = (path: string, init: RequestInit = {}) => {
      const method = (init.method ?? 'GET').toUpperCase();
      const needsCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      return app.request(
        path,
        {
          ...init,
          headers: {
            ...(needsCsrf ? { origin: 'https://rules.example.com', 'content-type': 'application/json' } : {}),
            cookie: tgCookie,
            ...(init.headers ?? {}),
          },
        },
        env,
      );
    };

    // Read operations succeed (200)
    expect((await tgRequest('/api/catalog')).status).toBe(200);
    expect((await tgRequest('/api/cards')).status).toBe(200);
    expect((await tgRequest('/api/templates')).status).toBe(200);
    expect((await tgRequest(`/api/templates/${template.id}`)).status).toBe(200);
    expect((await tgRequest(`/api/templates/${template.id}/versions`)).status).toBe(200);
    expect((await tgRequest(`/api/templates/${template.id}/versions/1`)).status).toBe(200);
    expect((await tgRequest('/api/publications')).status).toBe(200);
    expect((await tgRequest(`/api/publications/${publication.id}`)).status).toBe(200);
    expect((await tgRequest(`/api/templates/${template.id}/lint`, { method: 'POST', body: '{}' })).status).toBe(200);
    expect(
      (
        await tgRequest(`/api/templates/${template.id}/probe`, {
          method: 'POST',
          body: JSON.stringify({ target: 'openai.com' }),
        })
      ).status,
    ).toBe(200);
    expect(
      (await tgRequest(`/api/templates/${template.id}/preview?client=mihomo`, { method: 'POST', body: '{}' })).status,
    ).toBe(200);

    // All write operations return 403 FORBIDDEN
    const writeRequests: Array<[string, RequestInit]> = [
      [
        '/api/cards',
        {
          method: 'POST',
          body: JSON.stringify({
            name: 'TG Card',
            category: 'other',
            stage: 'app',
            group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
            matchers: [],
          }),
        },
      ],
      ['/api/cards/card-ai', { method: 'PATCH', body: JSON.stringify({ name: 'X' }) }],
      ['/api/cards/card-ai', { method: 'DELETE' }],
      ['/api/cards/card-ai/fork', { method: 'POST', body: '{}' }],
      ['/api/templates', { method: 'POST', body: JSON.stringify({ name: 'TG Tpl', starterTier: 'standard' }) }],
      [
        '/api/templates/import',
        { method: 'POST', body: JSON.stringify({ format: 'mihomo-yaml', content: 'rules: [MATCH,DIRECT]' }) },
      ],
      [`/api/templates/${template.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Mutated' }) }],
      [`/api/templates/${template.id}`, { method: 'DELETE' }],
      [
        `/api/templates/${template.id}/rebase`,
        { method: 'POST', body: JSON.stringify({ format: 'mihomo-yaml', content: 'rules: [MATCH,DIRECT]' }) },
      ],
      [`/api/templates/${template.id}/versions/1/restore`, { method: 'POST', body: '{}' }],
      [
        '/api/publications',
        {
          method: 'POST',
          body: JSON.stringify({ slug: 'tg-pub', templateId: template.id, clients: ['mihomo'], access: 'token' }),
        },
      ],
      [`/api/publications/${publication.id}`, { method: 'PATCH', body: JSON.stringify({ output: 'minimal' }) }],
      [`/api/publications/${publication.id}`, { method: 'DELETE' }],
      [
        `/api/publications/${publication.id}/slots/${slotId}`,
        { method: 'PUT', body: JSON.stringify({ subscriptionUrl: 'https://tg.example/sub' }) },
      ],
      [`/api/publications/${publication.id}/slots/${slotId}`, { method: 'DELETE' }],
      [`/api/publications/${publication.id}/slots/${slotId}/fetch-names`, { method: 'POST' }],
    ];

    for (const [path, init] of writeRequests) {
      const res = await tgRequest(path, init);
      expect(res.status, `Expected 403 for ${init.method} ${path}`).toBe(403);
      expect(await res.json()).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    }
  });

  it('exposes only policy-valid subscription links and client support flags on publication API responses', async () => {
    const tplRes = await adminRequest('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ name: 'Links Tpl', slug: 'links-tpl', starterTier: 'standard' }),
    });
    expect(tplRes.status).toBe(201);
    const { template, resolvedBody } = (await tplRes.json()) as {
      template: { id: string };
      resolvedBody: { slots: Array<{ id: string }> };
    };

    // 1. Token access with all 7 supported clients
    const createRes = await adminRequest('/api/publications', {
      method: 'POST',
      body: JSON.stringify({
        slug: 'links-pub',
        templateId: template.id,
        clients: ['mihomo', 'stash', 'surge', 'sing-box', 'loon', 'quantumult-x', 'shadowrocket'],
        access: 'token',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      ruleTokenConfigured: boolean;
      publication: {
        id: string;
        experimentalFullConfig: boolean;
        links: Array<{ client: string; supported: boolean; url: string | null }>;
      };
    };
    expect(created.ruleTokenConfigured).toBe(true);
    expect(created.publication.experimentalFullConfig).toBe(false);
    expect(created.publication.links).toEqual([
      expect.objectContaining({
        client: 'mihomo',
        supported: true,
        url: 'https://rules.example.com/t/pub-secret-token/links-pub/mihomo.yaml',
      }),
      expect.objectContaining({
        client: 'stash',
        supported: true,
        url: 'https://rules.example.com/t/pub-secret-token/links-pub/stash.yaml',
      }),
      expect.objectContaining({
        client: 'surge',
        supported: true,
        url: 'https://rules.example.com/t/pub-secret-token/links-pub/surge.conf',
      }),
      expect.objectContaining({
        client: 'sing-box',
        supported: true,
        url: 'https://rules.example.com/t/pub-secret-token/links-pub/singbox.json',
      }),
      expect.objectContaining({
        client: 'loon',
        supported: true,
        url: 'https://rules.example.com/t/pub-secret-token/links-pub/loon.conf',
      }),
      expect.objectContaining({
        client: 'quantumult-x',
        supported: true,
        url: 'https://rules.example.com/t/pub-secret-token/links-pub/qx.conf',
      }),
      expect.objectContaining({
        client: 'shadowrocket',
        supported: true,
        url: 'https://rules.example.com/t/pub-secret-token/links-pub/shadowrocket.conf',
      }),
    ]);

    // 2. Public access without bindings -> /p/ links for all 7 supported clients
    const publicRes = await adminRequest(`/api/publications/${created.publication.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ access: 'public' }),
    });
    expect(publicRes.status).toBe(200);
    const publicBody = (await publicRes.json()) as {
      publication: { links: Array<{ client: string; url: string | null }> };
    };
    expect(publicBody.publication.links[0].url).toBe('https://rules.example.com/p/links-pub/mihomo.yaml');
    expect(publicBody.publication.links[1].url).toBe('https://rules.example.com/p/links-pub/stash.yaml');
    expect(publicBody.publication.links[2].url).toBe('https://rules.example.com/p/links-pub/surge.conf');
    expect(publicBody.publication.links[3].url).toBe('https://rules.example.com/p/links-pub/singbox.json');
    expect(publicBody.publication.links[4].url).toBe('https://rules.example.com/p/links-pub/loon.conf');
    expect(publicBody.publication.links[5].url).toBe('https://rules.example.com/p/links-pub/qx.conf');
    expect(publicBody.publication.links[6].url).toBe('https://rules.example.com/p/links-pub/shadowrocket.conf');

    // 3. Disabled access -> no active links
    const disabledRes = await adminRequest(`/api/publications/${created.publication.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ access: 'disabled' }),
    });
    expect(disabledRes.status).toBe(200);
    const disabledBody = (await disabledRes.json()) as {
      publication: { links: Array<{ client: string; url: string | null }> };
    };
    expect(disabledBody.publication.links.every((item) => item.url === null)).toBe(true);

    // 4. Switch back to token and bind a slot; verify GET /api/publications returns masked binding + token link
    await adminRequest(`/api/publications/${created.publication.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ access: 'token' }),
    });
    const bindRes = await adminRequest(
      `/api/publications/${created.publication.id}/slots/${resolvedBody.slots[0].id}`,
      {
        method: 'PUT',
        body: JSON.stringify({ subscriptionUrl: 'https://sub.links-test.example/api?token=RAW_TOKEN_123' }),
      },
    );
    expect(bindRes.status).toBe(200);

    const listRes = await adminRequest('/api/publications');
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      ruleTokenConfigured: boolean;
      publications: Array<{
        id: string;
        links: Array<{ client: string; url: string | null }>;
        bindings: Array<{ maskedUrl: string }>;
      }>;
    };
    expect(listBody.ruleTokenConfigured).toBe(true);
    const listed = listBody.publications.find((item) => item.id === created.publication.id)!;
    expect(listed.links[0].url).toBe('https://rules.example.com/t/pub-secret-token/links-pub/mihomo.yaml');
    expect(listed.bindings[0].maskedUrl).not.toContain('RAW_TOKEN_123');
  });

  it('delivers singbox.json on /p (unbound) and /t (bound B-class snapshots) with stale fallback headers & report', async () => {
    clearInFlightNodeFetches();
    const tplRes = await adminRequest('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ name: 'Singbox Delivery Tpl', starterTier: 'minimal', output: 'full' }),
    });
    expect(tplRes.status).toBe(201);
    const { template, resolvedBody } = (await tplRes.json()) as {
      template: { id: string };
      resolvedBody: { slots: Array<{ id: string }> };
    };
    const slotId = resolvedBody.slots[0]!.id;

    // 1. Public unbound singbox.json works on /p/:slug/singbox.json
    const pubPublicRes = await adminRequest('/api/publications', {
      method: 'POST',
      body: JSON.stringify({
        slug: 'sb-public',
        templateId: template.id,
        clients: ['sing-box'],
        access: 'public',
      }),
    });
    expect(pubPublicRes.status).toBe(201);

    const publicDelivery = await app.request('/p/sb-public/singbox.json', {}, env);
    expect(publicDelivery.status).toBe(200);
    expect(publicDelivery.headers.get('content-type')).toContain('application/json');
    const publicDoc = JSON.parse(await publicDelivery.text()) as {
      outbounds: Array<{ type: string; tag: string }>;
      route: { final: string };
    };
    expect(publicDoc.outbounds.some((o) => o.tag === 'direct')).toBe(true);
    expect(publicDoc.route.final).toBeTruthy();

    // 2. Token-only singbox.json with bound slot resolves encrypted snapshot via nodes.ts
    const pubTokenRes = await adminRequest('/api/publications', {
      method: 'POST',
      body: JSON.stringify({
        slug: 'sb-token',
        templateId: template.id,
        clients: ['sing-box'],
        access: 'token',
      }),
    });
    expect(pubTokenRes.status).toBe(201);
    const { publication: tokenPub } = (await pubTokenRes.json()) as { publication: { id: string } };

    const secretSubUrl = 'https://93.184.216.34/sub?token=SB_SECRET_999';
    const bindRes = await adminRequest(`/api/publications/${tokenPub.id}/slots/${slotId}`, {
      method: 'PUT',
      body: JSON.stringify({ subscriptionUrl: secretSubUrl, userAgent: 'sing-box/1.12' }),
    });
    expect(bindRes.status).toBe(200);

    // Public route must reject bound publication even if requested
    expect((await app.request('/p/sb-token/singbox.json', {}, env)).status).toBe(404);

    const sampleSubYaml = [
      'proxies:',
      '  - name: "🇭🇰 香港 SS-01"',
      '    type: ss',
      '    server: 198.51.100.10',
      '    port: 8388',
      '    cipher: aes-256-gcm',
      '    password: hk-password-1',
      '  - name: "🇺🇸 美国 VLESS-01"',
      '    type: vless',
      '    server: 198.51.100.20',
      '    port: 443',
      '    uuid: 11111111-2222-3333-4444-555555555555',
      '    tls: true',
      '    servername: www.microsoft.com',
      '    reality-opts:',
      '      public-key: cmVhbGl0eS1wdWJsaWMta2V5LWRlbW8tMTIzNDU2',
      '      short-id: abcd1234',
      '  - name: "Legacy SSR"',
      '    type: ssr',
      '    server: 198.51.100.30',
      '    port: 443',
      '    password: ignored',
    ].join('\n');

    let upstreamShouldFail = false;
    let fetchCount = 0;
    const fetchMock = vi.fn(async () => {
      fetchCount += 1;
      if (upstreamShouldFail) {
        return new Response('upstream unavailable', { status: 503 });
      }
      return new Response(sampleSubYaml, {
        status: 200,
        headers: { 'content-type': 'text/yaml; charset=utf-8' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      // Fresh delivery via /t/:token/:slug/singbox.json
      const freshRes = await app.request('/t/pub-secret-token/sb-token/singbox.json', {}, env);
      expect(freshRes.status).toBe(200);
      expect(freshRes.headers.get('content-type')).toContain('application/json');
      expect(freshRes.headers.get('x-node-snapshot-status')).toBe('fresh');
      expect(freshRes.headers.get('x-node-snapshot-stale')).toBeNull();
      expect(fetchCount).toBe(1);

      const freshBodyText = await freshRes.text();
      expect(freshBodyText).not.toContain('SB_SECRET_999');
      expect(freshBodyText).not.toContain('93.184.216.34');
      const freshDoc = JSON.parse(freshBodyText) as {
        outbounds: Array<{ type: string; tag: string; outbounds?: string[] }>;
      };
      expect(freshDoc.outbounds.some((o) => o.type === 'shadowsocks' && o.tag === '🇭🇰 香港 SS-01')).toBe(true);
      expect(freshDoc.outbounds.some((o) => o.type === 'vless' && o.tag === '🇺🇸 美国 VLESS-01')).toBe(true);

      // Expire cached snapshot in DB and simulate upstream failure -> stale fallback
      await database
        .prepare(`UPDATE node_snapshots SET expires_at = ? WHERE publication_id = ? AND slot_id = ?`)
        .bind('2020-01-01T00:00:00.000Z', tokenPub.id, slotId)
        .run();
      upstreamShouldFail = true;

      const staleRes = await app.request('/t/pub-secret-token/sb-token/singbox.json', {}, env);
      expect(staleRes.status).toBe(200);
      expect(staleRes.headers.get('x-node-snapshot-status')).toBe('stale');
      expect(staleRes.headers.get('x-node-snapshot-stale')).toBe('true');
      expect(staleRes.headers.get('x-node-snapshot-stale-slots')).toBe(slotId);
      expect(staleRes.headers.get('warning')).toContain('110');
      expect(staleRes.headers.get('cache-control')).toBe('no-cache');

      const staleDoc = JSON.parse(await staleRes.text()) as {
        outbounds: Array<{ type: string; tag: string }>;
      };
      expect(staleDoc.outbounds.some((o) => o.type === 'shadowsocks' && o.tag === '🇭🇰 香港 SS-01')).toBe(true);

      // Verify compatibility report also records STALE_NODE_SNAPSHOT & SKIPPED_UNSUPPORTED_NODES
      const delivery = await resolvePublicationDelivery(env, {
        slug: 'sb-token',
        file: 'singbox.json',
        access: 'token',
        token: 'pub-secret-token',
        baseUrl: 'https://rules.example.com',
      });
      expect(delivery.status).toBe('ready');
      if (delivery.status === 'ready') {
        expect(delivery.staleSlotIds).toEqual([slotId]);
        const compiled = await compilePublicationDelivery(env, delivery, 'https://rules.example.com');
        const codes = compiled.report.items.map((item) => item.code);
        expect(codes).toContain('STALE_NODE_SNAPSHOT');
        expect(codes).toContain('SKIPPED_UNSUPPORTED_NODES');
      }
    } finally {
      vi.unstubAllGlobals();
      clearInFlightNodeFetches();
    }
  });

  it('delivers loon.conf, qx.conf, and shadowrocket.conf on /p and /t, enforces token-only with node bindings, and toggles experimentalFullConfig with cache invalidation', async () => {
    const tplRes = await adminRequest('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ name: 'Class C Delivery Tpl', starterTier: 'standard', output: 'full' }),
    });
    expect(tplRes.status).toBe(201);
    const { template, resolvedBody } = (await tplRes.json()) as {
      template: { id: string };
      resolvedBody: { slots: Array<{ id: string }> };
    };
    const slotId = resolvedBody.slots[0].id;

    // 1. Public publication without node bindings delivers loon.conf, qx.conf (rules-only default), shadowrocket.conf (full)
    const publicPubRes = await adminRequest('/api/publications', {
      method: 'POST',
      body: JSON.stringify({
        slug: 'class-c-public',
        templateId: template.id,
        clients: ['loon', 'quantumult-x', 'shadowrocket'],
        access: 'public',
        output: 'full',
      }),
    });
    expect(publicPubRes.status).toBe(201);
    const publicPub = (
      (await publicPubRes.json()) as {
        publication: { id: string; experimentalFullConfig: boolean };
      }
    ).publication;
    expect(publicPub.experimentalFullConfig).toBe(false);

    const loonSafeRes = await app.request('/p/class-c-public/loon.conf', {}, env);
    expect(loonSafeRes.status).toBe(200);
    expect(loonSafeRes.headers.get('content-type')).toContain('text/plain');
    const loonSafeText = await loonSafeRes.text();
    expect(loonSafeText).toContain('Rules-Only Remote Resource');
    expect(loonSafeText).not.toContain('[General]');
    expect(loonSafeText).not.toContain('[Proxy Group]');

    const qxSafeRes = await app.request('/p/class-c-public/qx.conf', {}, env);
    expect(qxSafeRes.status).toBe(200);
    const qxSafeText = await qxSafeRes.text();
    expect(qxSafeText).toContain('filter_remote Rules-Only Resource');
    expect(qxSafeText).not.toContain('[general]');
    expect(qxSafeText).not.toContain('[policy]');

    const srRes = await app.request('/p/class-c-public/shadowrocket.conf', {}, env);
    expect(srRes.status).toBe(200);
    const srText = await srRes.text();
    expect(srText).toContain('[General]');
    expect(srText).toContain('[Proxy Group]');
    expect(srText).toContain('[Rule]');

    // Toggle experimentalFullConfig=true -> cache invalidated, Loon & QX now emit experimental full config
    const deletesBeforeToggle = cache.deleteCalls;
    const toggleRes = await adminRequest(`/api/publications/${publicPub.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ experimentalFullConfig: true }),
    });
    expect(toggleRes.status).toBe(200);
    expect(cache.deleteCalls).toBeGreaterThan(deletesBeforeToggle);

    const loonExpRes = await app.request('/p/class-c-public/loon.conf', {}, env);
    expect(loonExpRes.status).toBe(200);
    const loonExpText = await loonExpRes.text();
    expect(loonExpText).toContain('未经真机验证');
    expect(loonExpText).toContain('[General]');
    expect(loonExpText).toContain('[Proxy Group]');
    expect(loonExpText).toContain('[Rule]');

    const qxExpRes = await app.request('/p/class-c-public/qx.conf', {}, env);
    expect(qxExpRes.status).toBe(200);
    const qxExpText = await qxExpRes.text();
    expect(qxExpText).toContain('未经真机验证');
    expect(qxExpText).toContain('[general]');
    expect(qxExpText).toContain('[policy]');
    expect(qxExpText).toContain('[filter_local]');

    // 2. Publication with node bindings MUST remain token-only even for Loon/QX/Shadowrocket, and never leak node URLs
    const boundPubRes = await adminRequest('/api/publications', {
      method: 'POST',
      body: JSON.stringify({
        slug: 'class-c-bound',
        templateId: template.id,
        clients: ['mihomo', 'loon', 'quantumult-x', 'shadowrocket'],
        access: 'token',
        output: 'minimal',
      }),
    });
    expect(boundPubRes.status).toBe(201);
    const boundPub = ((await boundPubRes.json()) as { publication: { id: string } }).publication;

    const secretSubUrl = 'https://secret-c-provider.example/sub?token=CLASS_C_SECRET_777';
    const bindRes = await adminRequest(`/api/publications/${boundPub.id}/slots/${slotId}`, {
      method: 'PUT',
      body: JSON.stringify({ subscriptionUrl: secretSubUrl }),
    });
    expect(bindRes.status).toBe(200);

    // Switching bound publication to public MUST still be rejected
    const forbiddenPublic = await adminRequest(`/api/publications/${boundPub.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ access: 'public' }),
    });
    expect(forbiddenPublic.status).toBe(400);

    for (const file of ['loon.conf', 'qx.conf', 'shadowrocket.conf']) {
      expect((await app.request(`/p/class-c-bound/${file}`, {}, env)).status).toBe(404);
      const tokenRes = await app.request(`/t/pub-secret-token/class-c-bound/${file}`, {}, env);
      expect(tokenRes.status).toBe(200);
      const bodyText = await tokenRes.text();
      expect(bodyText).not.toContain('CLASS_C_SECRET_777');
      expect(bodyText).not.toContain('secret-c-provider.example');
    }

    // 3. Backup export preserves experimentalFullConfig flag
    const backupRes = await adminRequest('/api/backup');
    expect(backupRes.status).toBe(200);
    const backupJson = (await backupRes.json()) as {
      publications: Array<{ slug: string; experimentalFullConfig?: boolean }>;
    };
    const exportedPublic = backupJson.publications.find((p) => p.slug === 'class-c-public');
    const exportedBound = backupJson.publications.find((p) => p.slug === 'class-c-bound');
    expect(exportedPublic?.experimentalFullConfig).toBe(true);
    expect(exportedBound?.experimentalFullConfig).toBeUndefined();
  });
});
