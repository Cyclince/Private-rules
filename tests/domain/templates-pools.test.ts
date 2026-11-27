import { describe, expect, it } from 'vitest';
import {
  ALL_AUTO_POOL,
  ALL_BUILTIN_POOLS,
  ALL_MANUAL_POOL,
  ALL_STARTER_TEMPLATE_TIERS,
  BUILTIN_REGION_POOL_CODES,
  DEDICATED_POOL,
  GAMING_POOL,
  LOW_RATE_POOL,
  REGION_POOLS,
  RESIDENTIAL_POOL,
  STABILITY_FALLBACK_POOL,
  STABILITY_LOAD_BALANCE_POOL,
  STABILITY_POOLS,
  STARTER_TIER_COMPLEXITY_MAP,
  buildProviderPools,
  buildStarterTemplate,
  getBuiltinPool,
  listBuiltinPools,
  resolveStarterTierBySlug,
  starterTierToComplexity,
} from '../../src/builtin';
import { detectRegexDialectIssues, filterNodes, matchNodeFilter } from '../../src/domain/nodes';
import {
  applyOverlay,
  getNormalizedBodyPools,
  inferTemplateComplexity,
  migrateTemplateBody,
  nodePoolToRegionGroup,
  prepareTemplateBodyForStorage,
  regionGroupToNodePool,
  resolvePoolIcon,
  serializeTemplateBodyForStorage,
} from '../../src/domain/templates';
import { TEMPLATE_CLIENT_IDS } from '../../src/shared/clients';
import type { NodePool, RegionGroup, TemplateBody } from '../../src/shared/schemas/template';

function createLegacyBody(overrides?: Partial<TemplateBody>): TemplateBody {
  return {
    slots: [{ id: 'slot-main', name: '主力机场', excludeInfo: true, udp: true }],
    regionGroups: [
      {
        id: 'region-hk',
        name: '香港专线',
        region: 'hk',
        type: 'url-test',
        extraInclude: 'IEPL|IPLC',
        extraExclude: '高倍|实验',
        slotId: 'slot-main',
        test: { url: 'https://www.gstatic.com/generate_204', intervalSec: 300, toleranceMs: 50 },
      },
      {
        id: 'region-jp',
        name: '🇯🇵 日本节点',
        region: 'JP',
        type: 'fallback',
        hidden: false,
      },
    ],
    cards: [{ cardId: 'proxy-select', enabled: true }],
    groupMode: 'select',
    final: { kind: 'card', cardId: 'proxy-select' },
    output: 'full',
    dns: { mode: 'fake-ip' },
    modules: [],
    ...overrides,
  };
}

describe('node pool migration, icon resolution, and overlay ops', () => {
  it('auto-resolves pool icons when omitted and preserves explicit custom icons', () => {
    expect(
      resolvePoolIcon({
        name: '香港高速',
        region: 'HK',
        type: 'url-test',
        kind: 'region',
      }),
    ).toBe('🇭🇰');

    expect(
      resolvePoolIcon({
        name: '低倍率专线',
        icon: '💎',
        type: 'url-test',
        kind: 'trait',
      }),
    ).toBe('💎');

    expect(
      resolvePoolIcon({
        name: '未命名特性组',
        type: 'select',
        kind: 'trait',
      }),
    ).toBe('🏷️');
  });

  it('round-trips RegionGroup <-> NodePool cleanly without losing fields', () => {
    const legacyGroup: RegionGroup = {
      id: 'region-tw',
      name: '台湾原生',
      region: 'tw',
      type: 'url-test',
      extraInclude: 'Hinet',
      extraExclude: '0.1x',
      slotId: 'slot-main',
      test: { url: 'https://www.gstatic.com/generate_204', intervalSec: 240, toleranceMs: 60 },
      hidden: false,
    };

    const migrated = regionGroupToNodePool(legacyGroup);
    expect(migrated).toEqual({
      id: 'region-tw',
      name: '台湾原生',
      icon: '🇹🇼',
      sources: ['slot-main'],
      include: 'Hinet',
      exclude: '0.1x',
      region: 'TW',
      kind: 'region',
      type: 'url-test',
      test: { url: 'https://www.gstatic.com/generate_204', intervalSec: 240, toleranceMs: 60 },
      hidden: false,
    });

    const roundTripped = nodePoolToRegionGroup(migrated);
    expect(roundTripped).toEqual({
      ...legacyGroup,
      region: 'TW',
    });

    // Stability pools are non-region and return null on reverse conversion
    expect(nodePoolToRegionGroup(STABILITY_FALLBACK_POOL)).toBeNull();
  });

  it('migrates legacy bodies on read without mutating input and writes back only pools', () => {
    const legacy = createLegacyBody();
    const beforeSnapshot = structuredClone(legacy);

    const migrated = migrateTemplateBody(legacy);
    expect(legacy).toEqual(beforeSnapshot);
    expect(migrated.regionGroups).toBeUndefined();
    expect(migrated.complexity).toBe('advanced');
    expect(migrated.pools).toHaveLength(2);
    expect(migrated.pools?.[0]).toMatchObject({
      id: 'region-hk',
      icon: '🇭🇰',
      sources: ['slot-main'],
      include: 'IEPL|IPLC',
      exclude: '高倍|实验',
      region: 'HK',
      kind: 'region',
      type: 'url-test',
      hidden: true,
    });
    expect(migrated.pools?.[1]).toMatchObject({
      id: 'region-jp',
      icon: '🇯🇵',
      sources: 'all',
      region: 'JP',
      kind: 'region',
      type: 'fallback',
      hidden: false,
    });

    const forStorage = prepareTemplateBodyForStorage(legacy, { starterTier: 'all' });
    expect(forStorage.regionGroups).toBeUndefined();
    expect(forStorage.complexity).toBe('pro');
    expect(forStorage.pools).toHaveLength(2);

    const json = serializeTemplateBodyForStorage(legacy);
    const parsedJson = JSON.parse(json) as Record<string, unknown>;
    expect(Array.isArray(parsedJson.pools)).toBe(true);
    expect('regionGroups' in parsedJson).toBe(false);
    expect(parsedJson.complexity).toBe('advanced');
  });

  it('replays pool, complexity, and legacy regionGroup overlay ops consistently', () => {
    const base = migrateTemplateBody(createLegacyBody());
    const rebasedResult = applyOverlay(base, [
      { op: 'setComplexity', complexity: 'pro' },
      {
        op: 'addPool',
        pool: {
          id: 'pool-trait-low-rate',
          name: '低倍率',
          sources: 'all',
          include: '0\\.5x',
          kind: 'trait',
          type: 'url-test',
          hidden: true,
        },
      },
      {
        op: 'updatePool',
        poolId: 'region-hk',
        patch: { name: '🇭🇰 香港精选', include: 'IEPL', hidden: false },
      },
      { op: 'removePool', poolId: 'region-jp' },
      // Legacy regionGroup ops also operate smoothly on migrated pools[] bodies
      {
        op: 'addRegionGroup',
        regionGroup: { id: 'region-sg', name: '新加坡', region: 'SG', type: 'url-test' },
      },
    ]);
    expect(rebasedResult.conflicts).toEqual([]);
    const rebased = rebasedResult.resolved;

    expect(rebased.complexity).toBe('pro');
    expect(rebased.regionGroups).toBeUndefined();
    expect(rebased.pools?.map((p) => p.id)).toEqual(['region-hk', 'pool-trait-low-rate', 'region-sg']);
    expect(rebased.pools?.[0]).toMatchObject({ name: '🇭🇰 香港精选', include: 'IEPL', hidden: false });
    expect(rebased.pools?.[1]?.icon).toBe('🏷️');
    expect(rebased.pools?.[2]).toMatchObject({ region: 'SG', icon: '🇸🇬', kind: 'region' });
    expect(getNormalizedBodyPools(rebased)).toHaveLength(3);
  });
});

describe('complexity tier inference and starter slug mapping (§2, D12)', () => {
  it('infers complexity from explicit field, hints, slugs, and wizardMeta with advanced fallback', () => {
    const emptyBody: Pick<TemplateBody, 'complexity' | 'wizardMeta' | 'regionGroups' | 'pools' | 'cards'> = {
      cards: [],
    };

    expect(inferTemplateComplexity({ ...emptyBody, complexity: 'pro' })).toBe('pro');
    expect(inferTemplateComplexity(emptyBody, { starterTier: 'less' })).toBe('simple');
    expect(inferTemplateComplexity(emptyBody, { starterTier: 'recommended' })).toBe('advanced');
    expect(inferTemplateComplexity(emptyBody, { starterTier: 'all' })).toBe('pro');
    expect(inferTemplateComplexity(emptyBody, { starterTier: 'minimal' })).toBe('simple');
    expect(inferTemplateComplexity(emptyBody, { starterTier: 'light' })).toBe('simple');
    expect(inferTemplateComplexity(emptyBody, { starterTier: 'standard' })).toBe('advanced');
    expect(inferTemplateComplexity(emptyBody, { starterTier: 'heavy' })).toBe('pro');

    expect(inferTemplateComplexity(emptyBody, { slug: 'starter-less' })).toBe('simple');
    expect(inferTemplateComplexity(emptyBody, { slug: 'starter-minimal' })).toBe('simple');
    expect(inferTemplateComplexity(emptyBody, { slug: 'starter-light' })).toBe('simple');
    expect(inferTemplateComplexity(emptyBody, { slug: 'starter-recommended' })).toBe('advanced');
    expect(inferTemplateComplexity(emptyBody, { slug: 'starter-standard' })).toBe('advanced');
    expect(inferTemplateComplexity(emptyBody, { slug: 'starter-all' })).toBe('pro');
    expect(inferTemplateComplexity(emptyBody, { slug: 'starter-heavy' })).toBe('pro');

    expect(
      inferTemplateComplexity({
        cards: [],
        wizardMeta: { combineMode: 'perProvider', groupMode: 'region', scenarios: [], rulesets: [] },
      }),
    ).toBe('pro');
    expect(
      inferTemplateComplexity({
        cards: [],
        wizardMeta: { combineMode: 'merge', groupMode: 'region', scenarios: [], rulesets: [] },
      }),
    ).toBe('advanced');
    expect(
      inferTemplateComplexity({
        cards: [],
        wizardMeta: {
          combineMode: 'merge',
          groupMode: 'none',
          scenarios: [{ id: 'domestic-direct', enabled: true }],
          rulesets: [],
        },
      }),
    ).toBe('simple');

    // Unknown legacy template defaults to advanced
    expect(inferTemplateComplexity(emptyBody)).toBe('advanced');
  });

  it('keeps T1 3-tier and legacy 4-tier slugs usable and mapped onto simple/advanced/pro', () => {
    expect(STARTER_TIER_COMPLEXITY_MAP).toEqual({
      less: 'simple',
      minimal: 'simple',
      light: 'simple',
      recommended: 'advanced',
      standard: 'advanced',
      all: 'pro',
      heavy: 'pro',
    });

    expect(starterTierToComplexity('less')).toBe('simple');
    expect(starterTierToComplexity('recommended')).toBe('advanced');
    expect(starterTierToComplexity('all')).toBe('pro');

    expect(resolveStarterTierBySlug('starter-less')).toBe('less');
    expect(resolveStarterTierBySlug('starter-minimal')).toBe('less');
    expect(resolveStarterTierBySlug('starter-recommended')).toBe('recommended');
    expect(resolveStarterTierBySlug('starter-heavy')).toBe('all');

    for (const tier of ALL_STARTER_TEMPLATE_TIERS) {
      const tpl = buildStarterTemplate(tier);
      expect(tpl.baseBody.complexity).toBe(STARTER_TIER_COMPLEXITY_MAP[tier]);
    }
  });
});

describe('built-in node pool library (§3.2) and trait regex samples', () => {
  it('provides all/region/runtime-provider/trait/stability pools with safe client regexes', () => {
    expect(ALL_BUILTIN_POOLS).toEqual([ALL_AUTO_POOL, ALL_MANUAL_POOL]);
    expect(REGION_POOLS).toHaveLength(12);
    expect(REGION_POOLS.map((p) => p.region)).toEqual([...BUILTIN_REGION_POOL_CODES]);
    expect(STABILITY_POOLS).toEqual([STABILITY_FALLBACK_POOL, STABILITY_LOAD_BALANCE_POOL]);

    const slots = [
      { id: 'slot-a', name: '云翼机场', excludeInfo: true, udp: true },
      { id: 'slot-b', name: '✈️ 极光专线', excludeInfo: true, udp: true },
    ];
    const providerPools = buildProviderPools(slots);
    expect(providerPools).toHaveLength(2);
    expect(providerPools[0]).toMatchObject({
      id: 'pool-provider-slot-a',
      name: '🛫 云翼机场',
      icon: '🛫',
      sources: ['slot-a'],
      kind: 'provider',
      hidden: true,
    });
    expect(providerPools[1]).toMatchObject({
      id: 'pool-provider-slot-b',
      name: '✈️ 极光专线',
      icon: '✈️',
      sources: ['slot-b'],
      kind: 'provider',
      hidden: true,
    });

    const combined = listBuiltinPools(slots);
    expect(combined.length).toBe(2 + 12 + 2 + 4 + 2);
    expect(getBuiltinPool('pool-provider-slot-a', slots)?.sources).toEqual(['slot-a']);
    expect(getBuiltinPool('pool-provider-slot-a')).toBeUndefined();

    // Every built-in trait regex must be dialect-safe across all 7 clients
    const allBuiltins: NodePool[] = [...combined];
    for (const pool of allBuiltins) {
      if (!pool.include) continue;
      for (const client of TEMPLATE_CLIENT_IDS) {
        const issues = detectRegexDialectIssues(pool.include, client);
        expect(issues, `pool ${pool.id} dialect issue on ${client}`).toEqual([]);
      }
    }
  });

  const TRAIT_SAMPLE_SUITES: ReadonlyArray<{
    name: string;
    pool: NodePool;
    positives: readonly string[];
    negatives: readonly string[];
  }> = [
    {
      name: 'LOW_RATE_POOL (低倍率)',
      pool: LOW_RATE_POOL,
      positives: [
        '🇭🇰 香港 01 | 0.5x',
        '🇯🇵 东京 BGP | 0.1倍',
        '🇸🇬 新加坡 x0.2 节点',
        '🇺🇸 洛杉矶 0.3× 特惠',
        '🇹🇼 台北 0.8X 晚高峰',
        '🇰🇷 首尔 ×0.5 下载专用',
        '🇭🇰 香港 低倍率 02',
        '🇯🇵 大阪 免费公益节点',
        '🇸🇬 新加坡 Low-Rate 01',
      ],
      negatives: [
        '🇭🇰 香港 01 | 1.0x',
        '🇯🇵 东京 2x 标准',
        '🇺🇸 洛杉矶 1.5倍',
        '🇸🇬 新加坡 3.0X IPLC',
        '🇹🇼 台北 BGP 10x',
        '🇰🇷 首尔 ×2 高速',
        '🇬🇧 伦敦 标准线路 01',
        '🇩🇪 法兰克福 普通节点',
      ],
    },
    {
      name: 'RESIDENTIAL_POOL (家宽 / 原生)',
      pool: RESIDENTIAL_POOL,
      positives: [
        '🇺🇸 洛杉矶 家庭宽带 家宽 01',
        '🇹🇼 台北 Hinet 家寬 02',
        '🇯🇵 东京 双ISP 原生IP',
        '🇬🇧 伦敦 静态住宅 ISP',
        '🇺🇸 纽约 Comcast Residential',
        '🇭🇰 香港 商宽 原生解锁',
        '🇺🇸 西雅图 Home Broadband 01',
        '🇯🇵 大阪 So-net 原生',
      ],
      negatives: [
        '🇭🇰 香港 BGP 01',
        '🇯🇵 东京 Linode 02',
        '🇸🇬 新加坡 AWS EC2',
        '🇺🇸 圣何塞 CN2 GIA 01',
        '🇩🇪 法兰克福 Hetzner 01',
        '🇫🇷 巴黎 OVH 机房',
        '🇳🇱 阿姆斯特丹 DigitalOcean',
        '🇰🇷 首尔 KT 专线 01',
      ],
    },
    {
      name: 'DEDICATED_POOL (专线 IPLC / IEPL)',
      pool: DEDICATED_POOL,
      positives: [
        '🇭🇰 香港 IEPL 专线 01',
        '🇭🇰 深港 IPLC 极速 02',
        '🇯🇵 沪日 過境 专線',
        '🇺🇸 美西 CN2 GIA 精品',
        '🇸🇬 粤港广港 BGP 专线',
        '🇭🇰 香港 AIA 专属通道',
        '🇯🇵 东京 Dedicated 01',
        '🇹🇼 莞港 EPL 03',
      ],
      negatives: [
        '🇭🇰 香港 公网中转 01',
        '🇯🇵 东京 普通直连 02',
        '🇺🇸 洛杉矶 便宜节点 01',
        '🇸🇬 新加坡 0.5x 公益',
        '🇬🇧 伦敦 Cloudflare 节点',
        '🇩🇪 法兰克福 标准线路',
        '🇫🇷 巴黎 普通 BGP',
        '🇦🇺 悉尼 家宽 01',
      ],
    },
    {
      name: 'GAMING_POOL (游戏)',
      pool: GAMING_POOL,
      positives: [
        '🇭🇰 香港 游戏专线 01',
        '🇯🇵 东京 低延迟 聯機',
        '🇸🇬 新加坡 遊戲 加速器',
        '🇰🇷 首尔 Low-Latency 01',
        '🇹🇼 台北 全锥形 NAT1',
        '🇭🇰 香港 UDP 转发 Gaming',
        '🇯🇵 大阪 Steam / PSN',
        '🇺🇸 西海岸 Xbox Switch 联机',
      ],
      negatives: [
        '🇭🇰 香港 流媒体 Netflix 01',
        '🇺🇸 洛杉矶 ChatGPT 解锁',
        '🇬🇧 伦敦 下载专用 0.2x',
        '🇩🇪 法兰克福 Web 浏览',
        '🇸🇬 新加坡 日常办公 02',
        '🇹🇼 台北 影音专线 03',
        '🇫🇷 巴黎 通用线路',
        '🇨🇦 多伦多 普通节点',
      ],
    },
  ];

  for (const suite of TRAIT_SAMPLE_SUITES) {
    it(`matches >=8 positives and rejects >=8 negatives for ${suite.name}`, () => {
      expect(suite.positives.length).toBeGreaterThanOrEqual(8);
      expect(suite.negatives.length).toBeGreaterThanOrEqual(8);

      for (const nodeName of suite.positives) {
        expect(
          matchNodeFilter(
            nodeName,
            { include: suite.pool.include, exclude: suite.pool.exclude },
            { excludeInfo: true },
          ),
          `${suite.name} expected MATCH for "${nodeName}"`,
        ).toBe(true);
      }

      for (const nodeName of suite.negatives) {
        expect(
          matchNodeFilter(
            nodeName,
            { include: suite.pool.include, exclude: suite.pool.exclude },
            { excludeInfo: true },
          ),
          `${suite.name} expected REJECT for "${nodeName}"`,
        ).toBe(false);
      }

      const mixed = [...suite.positives, ...suite.negatives, '剩余流量：50 GB'];
      expect(
        filterNodes(mixed, { include: suite.pool.include, exclude: suite.pool.exclude }, { excludeInfo: true }),
      ).toEqual([...suite.positives]);
    });
  }
});
