import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { BUILTIN_CARDS } from '../../../src/builtin/cards';
import { BUILTIN_CATALOG } from '../../../src/builtin/catalog';
import {
  ALL_AUTO_POOL,
  LOW_RATE_POOL,
  REGION_POOLS,
  STABILITY_FALLBACK_POOL,
  buildProviderPools,
} from '../../../src/builtin/pools';
import { buildComplexityStarterTemplate } from '../../../src/builtin/templates';
import { compileTemplate } from '../../../src/domain/templates/compilers';
import { TEMPLATE_CLIENT_IDS, type TemplateClientId } from '../../../src/shared/clients';
import type { CompiledNodeSlotBinding } from '../../../src/domain/templates/compilers/types';
import type { NodePool, TemplateBody } from '../../../src/shared/schemas/template';

const FIXED_GENERATED_AT = '2026-01-01T00:00:00.000Z';
const FIXED_BASE_URL = 'https://rules.example.com';

const SAMPLE_PROXIES = [
  {
    name: '🇭🇰 香港 IEPL 01',
    type: 'ss',
    server: 'hk1.example.com',
    port: 443,
    cipher: 'aes-128-gcm',
    password: 'pw',
  },
  {
    name: '🇺🇸 美国 0.5x 02',
    type: 'ss',
    server: 'us2.example.com',
    port: 443,
    cipher: 'aes-128-gcm',
    password: 'pw',
  },
];

function buildPoolsTemplateBody(pools: NodePool[]): TemplateBody {
  const slots = [{ id: 'slot-main', name: '主力机场', excludeInfo: true, udp: true }];
  return {
    slots,
    pools,
    complexity: 'pro',
    cards: [
      { cardId: 'auto-select', enabled: true },
      {
        cardId: 'proxy-select',
        enabled: true,
        overrides: {
          group: {
            candidates: [
              { kind: 'pool', poolId: 'pool-stability-fallback' },
              { kind: 'pool', poolId: 'pool-trait-low-rate' },
              { kind: 'pool', poolId: 'region-hk' },
              { kind: 'pool', poolId: 'pool-all-auto' },
              { kind: 'builtin', id: 'DIRECT' },
            ],
          },
        },
      },
      { cardId: 'domestic-direct', enabled: true },
      { cardId: 'final-fallback', enabled: true },
    ],
    groupMode: 'select',
    final: { kind: 'card', cardId: 'final-fallback' },
    output: 'minimal',
    dns: { mode: 'fake-ip' },
    modules: [],
  };
}

describe('compilers pools[] adaptation and §3.3 empty-pool protection', () => {
  it.each(TEMPLATE_CLIENT_IDS)('compiles explicit pools[] cleanly for %s', (client: TemplateClientId) => {
    const slots = [{ id: 'slot-main', name: '主力机场', excludeInfo: true, udp: true }];
    const hkPool = REGION_POOLS.find((p) => p.region === 'HK')!;
    const providerPool = buildProviderPools(slots)[0];
    const body = buildPoolsTemplateBody([
      structuredClone(ALL_AUTO_POOL),
      structuredClone(hkPool),
      providerPool,
      structuredClone(LOW_RATE_POOL),
      {
        ...structuredClone(STABILITY_FALLBACK_POOL),
        members: ['pool-trait-low-rate', 'region-hk', 'pool-all-auto'],
      },
    ]);

    const compiled = compileTemplate(client, {
      body,
      cards: BUILTIN_CARDS,
      templateName: 'Pools Test',
      generatedAt: FIXED_GENERATED_AT,
      catalogIndex: BUILTIN_CATALOG,
      baseUrl: FIXED_BASE_URL,
      experimentalFullConfig: true,
      slotBindings: {
        'slot-main': {
          kind: 'inline',
          proxies: SAMPLE_PROXIES,
        },
      },
    });

    expect(compiled.client).toBe(client);
    expect(compiled.content.length).toBeGreaterThan(0);
    expect(compiled.report.items.some((item) => item.code === 'EMPTY_POOL_FALLBACK_ALL')).toBe(false);

    if (client === 'mihomo') {
      const doc = parseYaml(compiled.content) as Record<string, unknown>;
      const groups = doc['proxy-groups'] as Array<Record<string, unknown>>;
      const hkGroup = groups.find((g) => g.name === hkPool.name);
      const lowRateGroup = groups.find((g) => g.name === LOW_RATE_POOL.name);
      const stabilityGroup = groups.find((g) => g.name === STABILITY_FALLBACK_POOL.name);
      expect(hkGroup).toMatchObject({ use: ['slot-main'], hidden: true });
      expect(lowRateGroup).toMatchObject({ use: ['slot-main'], hidden: true });
      expect(stabilityGroup).toMatchObject({
        type: 'fallback',
        proxies: [LOW_RATE_POOL.name, hkPool.name, ALL_AUTO_POOL.name],
      });
    } else if (client === 'stash') {
      const doc = parseYaml(compiled.content) as Record<string, unknown>;
      const groups = doc['proxy-groups'] as Array<Record<string, unknown>>;
      const hkGroup = groups.find((g) => g.name === hkPool.name);
      const lowRateGroup = groups.find((g) => g.name === LOW_RATE_POOL.name);
      const stabilityGroup = groups.find((g) => g.name === STABILITY_FALLBACK_POOL.name);
      expect(hkGroup?.proxies).toEqual(['🇭🇰 香港 IEPL 01']);
      expect(lowRateGroup?.proxies).toEqual(['🇺🇸 美国 0.5x 02']);
      expect(stabilityGroup).toMatchObject({
        type: 'fallback',
        proxies: [LOW_RATE_POOL.name, hkPool.name, ALL_AUTO_POOL.name],
      });
    } else if (client === 'sing-box') {
      const doc = JSON.parse(compiled.content) as { outbounds: Array<Record<string, unknown>> };
      const lowRateGroup = doc.outbounds.find((o) => o.tag === LOW_RATE_POOL.name);
      expect(lowRateGroup?.outbounds).toEqual(['🇺🇸 美国 0.5x 02']);
    }
  });

  it.each(TEMPLATE_CLIENT_IDS)(
    'degrades empty Class-B (snapshot/inline) pool and unmatchable regex to all nodes on %s (§3.3)',
    (client: TemplateClientId) => {
      const jpPool = REGION_POOLS.find((p) => p.region === 'JP')!;
      const badRegexPool: NodePool = {
        id: 'pool-bad-regex',
        name: '🏷️ 无效正则池',
        sources: 'all',
        include: '[unclosed-regex',
        kind: 'trait',
        type: 'url-test',
        hidden: true,
      };
      const body = buildPoolsTemplateBody([structuredClone(jpPool), badRegexPool]);

      // Snapshot contains HK & US only — JP matches 0 nodes; badRegexPool has invalid regex
      const snapshotBinding: CompiledNodeSlotBinding = {
        kind: 'snapshot',
        nodes: SAMPLE_PROXIES.map((p) => ({
          type: 'ss',
          name: p.name,
          server: p.server,
          port: p.port,
          cipher: p.cipher,
          password: p.password,
        })),
      };
      const compiled = compileTemplate(client, {
        body,
        cards: BUILTIN_CARDS,
        templateName: 'Empty Pool Protection Test',
        generatedAt: FIXED_GENERATED_AT,
        catalogIndex: BUILTIN_CATALOG,
        baseUrl: FIXED_BASE_URL,
        experimentalFullConfig: true,
        slotBindings: {
          'slot-main': snapshotBinding,
        },
      });

      const fallbackItems = compiled.report.items.filter((item) => item.code === 'EMPTY_POOL_FALLBACK_ALL');
      expect(fallbackItems.length).toBeGreaterThanOrEqual(2);
      expect(fallbackItems.some((item) => item.location?.poolId === jpPool.id)).toBe(true);
      expect(fallbackItems.some((item) => item.location?.poolId === badRegexPool.id)).toBe(true);

      if (client === 'mihomo' || client === 'stash') {
        const doc = parseYaml(compiled.content) as Record<string, unknown>;
        const groups = doc['proxy-groups'] as Array<Record<string, unknown>>;
        const jpGroup = groups.find((g) => g.name === jpPool.name);
        const badGroup = groups.find((g) => g.name === badRegexPool.name);
        expect(jpGroup?.filter).toBeUndefined();
        expect(badGroup?.filter).toBeUndefined();
        expect(jpGroup?.use).toEqual(['slot-main']);
      } else if (client === 'sing-box') {
        const doc = JSON.parse(compiled.content) as { outbounds: Array<Record<string, unknown>> };
        const jpGroup = doc.outbounds.find((o) => o.tag === jpPool.name);
        expect(jpGroup?.outbounds).toEqual(['🇭🇰 香港 IEPL 01', '🇺🇸 美国 0.5x 02']);
      }
    },
  );

  it.each(TEMPLATE_CLIENT_IDS)(
    'does NOT trigger empty-node fallback for Class-A (http/file/unbound) slots on %s (§3.3)',
    (client: TemplateClientId) => {
      const jpPool = REGION_POOLS.find((p) => p.region === 'JP')!;
      const body = buildPoolsTemplateBody([structuredClone(jpPool)]);

      for (const binding of [
        { kind: 'http' as const, url: 'https://airport.example.com/sub' },
        { kind: 'file' as const, path: 'providers/main.yaml' },
        undefined,
      ]) {
        const compiled = compileTemplate(client, {
          body,
          cards: BUILTIN_CARDS,
          templateName: 'Class-A Provider Pool Test',
          generatedAt: FIXED_GENERATED_AT,
          catalogIndex: BUILTIN_CATALOG,
          baseUrl: FIXED_BASE_URL,
          experimentalFullConfig: true,
          slotBindings: binding ? { 'slot-main': binding } : undefined,
        });

        expect(compiled.report.items.some((item) => item.code === 'EMPTY_POOL_FALLBACK_ALL')).toBe(false);

        if (client === 'mihomo') {
          const doc = parseYaml(compiled.content) as Record<string, unknown>;
          const groups = doc['proxy-groups'] as Array<Record<string, unknown>>;
          const jpGroup = groups.find((g) => g.name === jpPool.name);
          expect(jpGroup?.filter).toBeTypeOf('string');
          expect(jpGroup?.use).toEqual(['slot-main']);
          expect(jpGroup?.proxies).toBeUndefined();
          expect(jpGroup?.['empty-fallback']).toBeUndefined();
        }
      }
    },
  );

  it.each(TEMPLATE_CLIENT_IDS)(
    'never places DIRECT or REJECT inside speed-tested pools on %s (including pro & slotless edge cases)',
    (client: TemplateClientId) => {
      const forbiddenMembers = new Set(['DIRECT', 'direct', 'REJECT', 'REJECT-DROP', 'reject', 'block']);
      const speedTestTypes = new Set(['url-test', 'fallback', 'load-balance', 'urltest', 'url-latency-benchmark']);

      const proTpl = buildComplexityStarterTemplate('pro');
      const slotlessProBody: TemplateBody = {
        ...structuredClone(proTpl.baseBody),
        slots: [],
        cards: proTpl.baseBody.cards.filter((c) => c.cardId !== 'auto-select'),
      };

      const checkScenario = (body: TemplateBody, binding?: CompiledNodeSlotBinding) => {
        const compiled = compileTemplate(client, {
          body,
          cards: BUILTIN_CARDS,
          templateName: 'No Direct In Speed Test Pools',
          generatedAt: FIXED_GENERATED_AT,
          catalogIndex: BUILTIN_CATALOG,
          baseUrl: FIXED_BASE_URL,
          experimentalFullConfig: true,
          slotBindings: binding ? { 'slot-main': binding } : undefined,
        });

        if (client === 'mihomo' || client === 'stash') {
          const doc = parseYaml(compiled.content) as Record<string, unknown>;
          const groups = (doc['proxy-groups'] ?? []) as Array<Record<string, unknown>>;
          for (const g of groups) {
            if (speedTestTypes.has(String(g.type))) {
              const members = Array.isArray(g.proxies) ? g.proxies.map(String) : [];
              for (const m of members) {
                expect(forbiddenMembers.has(m), `${client} speed-test group ${g.name} contains ${m}`).toBe(false);
              }
            }
          }
        } else if (client === 'sing-box') {
          const doc = JSON.parse(compiled.content) as { outbounds: Array<Record<string, unknown>> };
          for (const ob of doc.outbounds) {
            if (ob.type === 'urltest') {
              const members = Array.isArray(ob.outbounds) ? ob.outbounds.map(String) : [];
              for (const m of members) {
                expect(forbiddenMembers.has(m), `sing-box urltest ${ob.tag} contains ${m}`).toBe(false);
              }
            }
          }
        } else if (client === 'surge' || client === 'shadowrocket' || client === 'loon') {
          const inGroupSection = compiled.content.split('[Proxy Group]')[1]?.split(/^\[/m)[0] ?? '';
          for (const line of inGroupSection.split('\n').filter((l) => l.includes('='))) {
            const rhs = line.split('=').slice(1).join('=');
            const tokens = rhs.split(',').map((t) => t.trim());
            const gType = tokens[0] ?? '';
            if (speedTestTypes.has(gType)) {
              for (const token of tokens.slice(1)) {
                expect(forbiddenMembers.has(token), `${client} line "${line}" contains ${token}`).toBe(false);
              }
            }
          }
        } else if (client === 'quantumult-x') {
          const inPolicySection = compiled.content.split('[policy]')[1]?.split(/^\[/m)[0] ?? '';
          for (const line of inPolicySection.split('\n').filter((l) => l.includes('='))) {
            const [lhs, rhs = ''] = line.split('=');
            if (lhs === 'url-latency-benchmark') {
              for (const token of rhs.split(',').map((t) => t.trim())) {
                expect(forbiddenMembers.has(token), `quanx line "${line}" contains ${token}`).toBe(false);
              }
            }
          }
        }
      };

      checkScenario(proTpl.baseBody, { kind: 'http', url: 'https://airport.example.com/sub' });
      checkScenario(proTpl.baseBody, { kind: 'inline', proxies: SAMPLE_PROXIES });
      checkScenario(slotlessProBody);
    },
  );
});
