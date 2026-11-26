import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearInFlightNodeFetches,
  createPublication,
  fetchNodeSlotNames,
  NODE_SNAPSHOT_TTL_MS,
  resolvePublicationSlotNodes,
  resolveSlotNodes,
  sanitizeNodeFetchErrorMessage,
  upsertNodeSlotBinding,
} from '../../src/application/publications';
import { createTemplate } from '../../src/application/templates';
import { createRepositories } from '../../src/data/repositories';
import { SqliteDatabaseAdapter } from '../../src/infrastructure/database/sqlite/adapter';
import { migrateSqliteDatabase } from '../../src/infrastructure/database/sqlite/migrations';
import type { Env } from '../../src/types';

const SECRET = '0123456789abcdef0123456789abcdef';
const VALID_UUID = '11111111-2222-3333-4444-555555555555';
const REALITY_PBK = 'cmVhbGl0eS1wdWJsaWMta2V5LXNlY3JldC0xMjM0NTY';

const SAMPLE_SUB_YAML = [
  'proxies:',
  '  - name: "🇭🇰 香港 SS 01"',
  '    type: ss',
  '    server: hk-secret.airport.internal.test',
  '    port: 8388',
  '    cipher: aes-256-gcm',
  '    password: SS_SECRET_PASSWORD_999',
  '  - name: "🇺🇸 美国 VLESS Reality"',
  '    type: vless',
  '    server: us-secret.airport.internal.test',
  '    port: 443',
  `    uuid: ${VALID_UUID}`,
  '    flow: xtls-rprx-vision',
  '    tls: true',
  '    servername: www.microsoft.com',
  '    reality-opts:',
  `      public-key: ${REALITY_PBK}`,
  '      short-id: 0123abcd',
  '  - name: "Legacy SSR"',
  '    type: ssr',
  '    server: ssr.example.test',
  '    port: 443',
  '    password: SSR_SECRET_PASSWORD',
].join('\n');

const SAMPLE_SUB_YAML_V2 = [
  'proxies:',
  '  - name: "🇯🇵 日本 Trojan 02"',
  '    type: trojan',
  '    server: jp-secret.airport.internal.test',
  '    port: 443',
  '    password: TROJAN_SECRET_PASSWORD_888',
  '    sni: jp-secret.airport.internal.test',
].join('\n');

describe('M5.2a node snapshot caching, stale fallback, dedup, and redaction', () => {
  let directory: string;
  let database: SqliteDatabaseAdapter;
  let env: Env;
  let publicationId: string;
  let slotId: string;

  const secretToken = 'ULTRA_SECRET_AIRPORT_TOKEN_XYZ';
  const secretSubUrl = `https://airport.private.example/api/v1/subscribe/${secretToken}?flag=meta&secret=topsecret`;

  beforeEach(async () => {
    clearInFlightNodeFetches();
    directory = await mkdtemp(join(tmpdir(), 'private-rules-m52a-'));
    database = new SqliteDatabaseAdapter(join(directory, 'test.db'));
    await migrateSqliteDatabase(database);
    env = {
      DB: database,
      ASSETS: { fetch: async () => new Response() },
      ADMIN_PASSWORD: 'test-password',
      SESSION_SECRET: SECRET,
      EXPLICIT_SESSION_SECRET: SECRET,
      RULE_TOKEN: 'test-rule-token',
    };

    const tpl = await createTemplate(env, {
      name: 'Node Snapshot Tpl',
      slug: 'node-snapshot-tpl',
      starterTier: 'standard',
    });
    slotId = tpl.resolvedBody.slots[0]?.id ?? 'slot-main';

    const pub = await createPublication(env, {
      slug: 'pub-singbox',
      templateId: tpl.template.id,
      clients: ['sing-box', 'mihomo'],
      access: 'token',
    });
    publicationId = pub.publication.id;

    await upsertNodeSlotBinding(env, publicationId, slotId, {
      subscriptionUrl: secretSubUrl,
      userAgent: 'sing-box/1.12.0',
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    clearInFlightNodeFetches();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('encrypts parsed nodes in node_snapshots, sends bound User-Agent, and enforces 30-minute TTL', async () => {
    let nowMs = Date.parse('2026-11-27T00:00:00.000Z');
    const seenHeaders: Array<Record<string, string>> = [];
    let fetchCount = 0;

    const mockFetch: typeof fetch = async (input, init) => {
      fetchCount += 1;
      expect(String(input)).toBe(secretSubUrl);
      const headers = new Headers(init?.headers);
      seenHeaders.push({ 'user-agent': headers.get('user-agent') ?? '' });
      return new Response(fetchCount === 1 ? SAMPLE_SUB_YAML : SAMPLE_SUB_YAML_V2, {
        status: 200,
        headers: { 'content-type': 'text/yaml' },
      });
    };

    // 1. Cold fetch -> fetches upstream, encrypts snapshot in DB
    const first = await resolveSlotNodes(env, publicationId, slotId, {
      now: () => nowMs,
      fetchImpl: mockFetch,
      resolveDns: async () => ['93.184.216.34'],
    });
    expect(fetchCount).toBe(1);
    expect(seenHeaders[0]['user-agent']).toBe('sing-box/1.12.0');
    expect(first.fromCache).toBe(false);
    expect(first.stale).toBe(false);
    expect(first.nodes).toHaveLength(2);
    expect(first.report.unsupportedProtocols).toEqual({ ssr: 1 });
    expect(first.fetchedAt).toBe('2026-11-27T00:00:00.000Z');
    expect(first.expiresAt).toBe(new Date(nowMs + NODE_SNAPSHOT_TTL_MS).toISOString());

    // Raw DB row must be encrypted and contain zero plaintext credentials or URLs
    const repos = createRepositories(env.DB);
    const rawSnapshot = await repos.nodeSnapshots.findBySlot(publicationId, slotId);
    expect(rawSnapshot).not.toBeNull();
    expect(rawSnapshot!.nodesEnc).toMatch(/^enc:aes-256-gcm:/);
    expect(rawSnapshot!.nodesEnc).not.toContain('SS_SECRET_PASSWORD_999');
    expect(rawSnapshot!.nodesEnc).not.toContain(VALID_UUID);
    expect(rawSnapshot!.nodesEnc).not.toContain(REALITY_PBK);
    expect(rawSnapshot!.nodesEnc).not.toContain('hk-secret.airport.internal.test');
    expect(rawSnapshot!.nodesEnc).not.toContain(secretToken);

    // 2. Within 30 minutes (+29m59s) -> cache hit, NO upstream fetch
    nowMs += NODE_SNAPSHOT_TTL_MS - 1000;
    const cached = await resolveSlotNodes(env, publicationId, slotId, {
      now: () => nowMs,
      fetchImpl: mockFetch,
      resolveDns: async () => ['93.184.216.34'],
    });
    expect(fetchCount).toBe(1);
    expect(cached.fromCache).toBe(true);
    expect(cached.stale).toBe(false);
    expect(cached.nodes.map((n) => n.name)).toEqual(['🇭🇰 香港 SS 01', '🇺🇸 美国 VLESS Reality']);

    // 3. At exactly 30 minutes (+1s -> +30m00s) -> expired, fetches fresh V2
    nowMs += 1000;
    const refreshed = await resolveSlotNodes(env, publicationId, slotId, {
      now: () => nowMs,
      fetchImpl: mockFetch,
      resolveDns: async () => ['93.184.216.34'],
    });
    expect(fetchCount).toBe(2);
    expect(refreshed.fromCache).toBe(false);
    expect(refreshed.stale).toBe(false);
    expect(refreshed.nodes.map((n) => n.name)).toEqual(['🇯🇵 日本 Trojan 02']);

    // 4. resolvePublicationSlotNodes returns map keyed by slotId
    const bySlot = await resolvePublicationSlotNodes(env, publicationId, {
      now: () => nowMs + 1000,
      fetchImpl: mockFetch,
      resolveDns: async () => ['93.184.216.34'],
    });
    expect(fetchCount).toBe(2);
    expect(bySlot.get(slotId)?.nodes[0].name).toBe('🇯🇵 日本 Trojan 02');
  });

  it('falls back to previous encrypted snapshot with stale=true on upstream failure and redacts URLs in errors/logs', async () => {
    const logLines: string[] = [];
    for (const level of ['info', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logLines.push(args.map(String).join(' '));
      });
    }

    let nowMs = Date.parse('2026-11-27T01:00:00.000Z');
    let failMode: 'ok' | 'http502' | 'network' = 'ok';

    const mockFetch: typeof fetch = async () => {
      if (failMode === 'ok') {
        return new Response(SAMPLE_SUB_YAML, { status: 200 });
      }
      if (failMode === 'http502') {
        return new Response('Bad Gateway', { status: 502 });
      }
      throw new Error(`ECONNREFUSED connecting to ${secretSubUrl} with password=LEAKED_PW`);
    };

    // Seed initial snapshot
    const initial = await resolveSlotNodes(env, publicationId, slotId, {
      now: () => nowMs,
      fetchImpl: mockFetch,
      resolveDns: async () => ['93.184.216.34'],
    });
    expect(initial.stale).toBe(false);

    // Expire snapshot & trigger network error containing secret URL
    nowMs += NODE_SNAPSHOT_TTL_MS + 5_000;
    failMode = 'network';
    const degraded = await resolveSlotNodes(env, publicationId, slotId, {
      now: () => nowMs,
      fetchImpl: mockFetch,
      resolveDns: async () => ['93.184.216.34'],
    });

    expect(degraded.stale).toBe(true);
    expect(degraded.fromCache).toBe(true);
    expect(degraded.nodes).toHaveLength(2);
    expect(degraded.staleReason).toBeTruthy();
    expect(degraded.staleReason).toContain('https://airport.private.example/***');
    expect(degraded.staleReason).not.toContain(secretToken);
    expect(degraded.staleReason).not.toContain('topsecret');
    expect(degraded.staleReason).not.toContain('LEAKED_PW');

    const binding = await createRepositories(env.DB).nodeBindings.findBySlot(publicationId, slotId);
    expect(binding?.lastStatus).toBe('stale');

    // Also verify HTTP 502 fallback
    failMode = 'http502';
    const degradedHttp = await resolveSlotNodes(env, publicationId, slotId, {
      now: () => nowMs + 10_000,
      fetchImpl: mockFetch,
      resolveDns: async () => ['93.184.216.34'],
    });
    expect(degradedHttp.stale).toBe(true);
    expect(degradedHttp.staleReason).toContain('502');

    // No logs may ever contain the raw subscription URL, token, or node credentials
    const allLogs = logLines.join('\n');
    expect(allLogs).not.toContain(secretToken);
    expect(allLogs).not.toContain('topsecret');
    expect(allLogs).not.toContain('SS_SECRET_PASSWORD_999');
    expect(allLogs).not.toContain(VALID_UUID);
    expect(allLogs).not.toContain(REALITY_PBK);
  });

  it('throws sanitized error without leaking subscription URL when upstream fails with no prior snapshot', async () => {
    const mockFetch: typeof fetch = async () => {
      throw new Error(`fetch failed for ${secretSubUrl}`);
    };

    let caught: unknown;
    try {
      await resolveSlotNodes(env, publicationId, slotId, {
        fetchImpl: mockFetch,
        resolveDns: async () => ['93.184.216.34'],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('https://airport.private.example/***');
    expect(message).not.toContain(secretToken);
    expect(message).not.toContain('topsecret');
  });

  it('deduplicates concurrent requests for the same binding so upstream is fetched only once', async () => {
    let fetchCalls = 0;
    let releaseFetch!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });

    const slowFetch: typeof fetch = async () => {
      fetchCalls += 1;
      await gate;
      return new Response(SAMPLE_SUB_YAML, { status: 200 });
    };

    const requests = [
      resolveSlotNodes(env, publicationId, slotId, {
        fetchImpl: slowFetch,
        resolveDns: async () => ['93.184.216.34'],
      }),
      resolveSlotNodes(env, publicationId, slotId, {
        fetchImpl: slowFetch,
        resolveDns: async () => ['93.184.216.34'],
      }),
      resolveSlotNodes(env, publicationId, slotId, {
        fetchImpl: slowFetch,
        resolveDns: async () => ['93.184.216.34'],
      }),
      // Even a concurrent preview request coalesces onto the in-flight full fetch
      fetchNodeSlotNames(env, publicationId, slotId, {
        fetchImpl: slowFetch,
        resolveDns: async () => ['93.184.216.34'],
      }),
    ] as const;

    // Allow microtasks to queue all callers before releasing fetch
    await Promise.resolve();
    releaseFetch();

    const [r1, r2, r3, preview] = await Promise.all(requests);
    expect(fetchCalls).toBe(1);
    expect(r1.nodes).toHaveLength(2);
    expect(r2.nodes).toHaveLength(2);
    expect(r3.nodes).toHaveLength(2);
    expect(preview.nodeNames).toEqual(['🇭🇰 香港 SS 01', '🇺🇸 美国 VLESS Reality']);
    expect(JSON.stringify(preview)).not.toContain('SS_SECRET_PASSWORD_999');
  });

  it('preview interface returns only name, protocol, and regions — never credentials — and stores preview-only snapshot for A/C publications', async () => {
    const tpl = await createTemplate(env, {
      name: 'Class A Only Tpl',
      slug: 'class-a-only-tpl',
      starterTier: 'standard',
    });
    const pubA = await createPublication(env, {
      slug: 'pub-mihomo-only',
      templateId: tpl.template.id,
      clients: ['mihomo'],
      access: 'token',
    });
    const slotA = tpl.resolvedBody.slots[0]?.id ?? 'slot-main';
    await upsertNodeSlotBinding(env, pubA.publication.id, slotA, {
      subscriptionUrl: secretSubUrl,
      userAgent: 'mihomo/1.19',
    });

    let fetchCalls = 0;
    const mockFetch: typeof fetch = async () => {
      fetchCalls += 1;
      return new Response(SAMPLE_SUB_YAML, { status: 200 });
    };

    const preview = await fetchNodeSlotNames(env, pubA.publication.id, slotA, {
      fetchImpl: mockFetch,
      resolveDns: async () => ['93.184.216.34'],
    });
    expect(fetchCalls).toBe(1);
    expect(preview.slotId).toBe(slotA);
    expect(preview.count).toBe(2);
    expect(preview.nodeNames).toEqual(['🇭🇰 香港 SS 01', '🇺🇸 美国 VLESS Reality']);
    expect(preview.nodes).toEqual([
      { name: '🇭🇰 香港 SS 01', protocol: 'ss', regions: ['HK'], isInfo: false },
      { name: '🇺🇸 美国 VLESS Reality', protocol: 'vless', regions: ['US'], isInfo: false },
    ]);
    expect(preview.regions).toEqual({
      HK: ['🇭🇰 香港 SS 01'],
      US: ['🇺🇸 美国 VLESS Reality'],
    });
    expect(preview.stale).toBe(false);
    expect(preview.report.unsupportedProtocols).toEqual({ ssr: 1 });

    // Strict credential non-leakage check on preview response
    const previewJson = JSON.stringify(preview);
    expect(previewJson).not.toContain('hk-secret.airport.internal.test');
    expect(previewJson).not.toContain('us-secret.airport.internal.test');
    expect(previewJson).not.toContain('8388');
    expect(previewJson).not.toContain('SS_SECRET_PASSWORD_999');
    expect(previewJson).not.toContain(VALID_UUID);
    expect(previewJson).not.toContain(REALITY_PBK);
    expect(previewJson).not.toContain(secretToken);

    // Verify encrypted snapshot in DB for A/C-only pub is encrypted and has no credentials
    const repos = createRepositories(env.DB);
    const snap = await repos.nodeSnapshots.findBySlot(pubA.publication.id, slotA);
    expect(snap?.nodesEnc).toMatch(/^enc:aes-256-gcm:/);

    // Calling resolveSlotNodes on an A/C-only pub upgrades preview snapshot to full snapshot
    const full = await resolveSlotNodes(env, pubA.publication.id, slotA, {
      fetchImpl: mockFetch,
      resolveDns: async () => ['93.184.216.34'],
    });
    expect(fetchCalls).toBe(2);
    expect(full.nodes).toHaveLength(2);
    expect(full.nodes[0].server).toBe('hk-secret.airport.internal.test');
  });

  it('rejects missing explicit SESSION_SECRET and sanitizes arbitrary URLs/proxy URIs in error helper', async () => {
    const noSecretEnv: Env = { ...env, SESSION_SECRET: undefined, EXPLICIT_SESSION_SECRET: undefined };
    await expect(resolveSlotNodes(noSecretEnv, publicationId, slotId)).rejects.toMatchObject({
      code: 'SESSION_SECRET_REQUIRED',
      status: 503,
    });

    const sanitized = sanitizeNodeFetchErrorMessage(
      `Failed fetching https://sub.example.com/secret/path?token=abc123 and vless://${VALID_UUID}@host:443?pbk=${REALITY_PBK}`,
      'https://sub.example.com/secret/path?token=abc123',
    );
    expect(sanitized).toContain('https://sub.example.com/***');
    expect(sanitized).not.toContain('secret/path');
    expect(sanitized).not.toContain('abc123');
    expect(sanitized).not.toContain(VALID_UUID);
    expect(sanitized).not.toContain(REALITY_PBK);
  });

  it('supports NodeSnapshotsRepository CRUD and expiration pruning', async () => {
    const repos = createRepositories(env.DB);
    await repos.nodeSnapshots.upsert({
      publicationId,
      slotId,
      nodesEnc: 'enc:aes-256-gcm:aaa:bbb',
      fetchedAt: '2026-11-27T00:00:00.000Z',
      expiresAt: '2026-11-27T00:30:00.000Z',
    });

    const listed = await repos.nodeSnapshots.listByPublication(publicationId);
    expect(listed).toHaveLength(1);
    expect(listed[0].slotId).toBe(slotId);

    await repos.nodeSnapshots.deleteExpiredBefore('2026-11-27T00:29:00.000Z');
    expect(await repos.nodeSnapshots.findBySlot(publicationId, slotId)).not.toBeNull();

    await repos.nodeSnapshots.deleteExpiredBefore('2026-11-27T00:31:00.000Z');
    expect(await repos.nodeSnapshots.findBySlot(publicationId, slotId)).toBeNull();
  });
});
