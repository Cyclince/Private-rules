import type { GroupHealthCheck, GroupType } from '../shared/schemas/card';
import type { NodePool, NodeSlot } from '../shared/schemas/template';
import { getRegionDefinition } from '../domain/nodes/regions';
import { extractEmojiFromName } from '../domain/templates/icons';
import { DEFAULT_HEALTH_CHECK } from '../domain/templates/model';

/** Supported built-in region pool codes matching T1's 12 regions (design §3.2). */
export const BUILTIN_REGION_POOL_CODES = [
  'HK',
  'TW',
  'JP',
  'SG',
  'US',
  'KR',
  'GB',
  'DE',
  'FR',
  'NL',
  'CA',
  'AU',
] as const;

export const ALL_AUTO_POOL: NodePool = {
  id: 'pool-all-auto',
  name: '⚡ 全部节点（自动）',
  icon: '⚡',
  sources: 'all',
  kind: 'all',
  type: 'url-test',
  test: { ...DEFAULT_HEALTH_CHECK },
  hidden: true,
};

export const ALL_MANUAL_POOL: NodePool = {
  id: 'pool-all-manual',
  name: '🖐 全部节点（手动）',
  icon: '🖐',
  sources: 'all',
  kind: 'all',
  type: 'select',
  hidden: true,
};

/** Built-in all-node pool presets (`url-test` & `select`, design §3.2). */
export const ALL_BUILTIN_POOLS: readonly NodePool[] = [ALL_AUTO_POOL, ALL_MANUAL_POOL];

/** Built-in 12 region pools aligned with T1's built-in region dictionary (design §3.2). */
export const REGION_POOLS: readonly NodePool[] = BUILTIN_REGION_POOL_CODES.map((code): NodePool => {
  const def = getRegionDefinition(code);
  const flag = def?.flag ?? '🌐';
  const zhName = def?.nameZh ?? code;
  return {
    id: `region-${code.toLowerCase()}`,
    name: `${flag} ${zhName}节点`,
    icon: flag,
    sources: 'all',
    region: code,
    kind: 'region',
    type: 'url-test',
    test: { ...DEFAULT_HEALTH_CHECK },
    hidden: true,
  };
});

export type BuildProviderPoolsOptions = {
  type?: GroupType;
  test?: GroupHealthCheck;
  hidden?: boolean;
};

/**
 * Dynamically generates per-airport (`kind: 'provider'`) pools from template slots
 * at runtime instead of keeping static airport entries (design §3.2).
 */
export function buildProviderPools(slots: readonly NodeSlot[], options?: BuildProviderPoolsOptions): NodePool[] {
  return slots.map((slot): NodePool => {
    const emoji = extractEmojiFromName(slot.name);
    const name = emoji ? slot.name : `🛫 ${slot.name}`;
    const test = options?.test ?? slot.healthCheck ?? DEFAULT_HEALTH_CHECK;
    return {
      id: `pool-provider-${slot.id}`,
      name,
      icon: emoji ?? '🛫',
      sources: [slot.id],
      kind: 'provider',
      type: options?.type ?? 'url-test',
      test: { ...test },
      hidden: options?.hidden ?? true,
    };
  });
}

/**
 * Built-in trait pools (design §3.2).
 * Regular expressions are authored independently using RE2/ICU/JS-safe syntax
 * without lookarounds or inline flags so they work identically across all 7 clients.
 */
export const LOW_RATE_POOL: NodePool = {
  id: 'pool-trait-low-rate',
  name: '🏷️ 低倍率',
  icon: '🏷️',
  sources: 'all',
  include:
    '(?:^|[^0-9.])0?\\.\\d+\\s*[xX×倍]|(?:^|[^A-Za-z0-9])[xX×]\\s*0?\\.\\d+|低倍率|低倍|免费|免費|公益|福利|试用|試用|low[ _-]?rate|discount',
  kind: 'trait',
  type: 'url-test',
  test: { ...DEFAULT_HEALTH_CHECK },
  hidden: true,
};

export const RESIDENTIAL_POOL: NodePool = {
  id: 'pool-trait-residential',
  name: '🏠 家宽 / 原生',
  icon: '🏠',
  sources: 'all',
  include:
    '家宽|家寬|住宅|商宽|商寬|原生|双ISP|雙ISP|(?:^|[^A-Za-z])(?:ISP|Residential|Home[ _-]?Broadband|Comcast|Verizon|Spectrum|AT&T|Hinet|So-net)(?:$|[^A-Za-z])',
  kind: 'trait',
  type: 'url-test',
  test: { ...DEFAULT_HEALTH_CHECK },
  hidden: true,
};

export const DEDICATED_POOL: NodePool = {
  id: 'pool-trait-dedicated',
  name: '🚄 专线 (IPLC / IEPL)',
  icon: '🚄',
  sources: 'all',
  include:
    '专线|專線|深港|沪港|滬港|沪日|滬日|京德|粤港|粵港|广港|廣港|莞港|过境|過境|CN2\\s*GIA|(?:^|[^A-Za-z])(?:IPLC|IEPL|EPL|AIA|Dedicated)(?:$|[^A-Za-z])',
  kind: 'trait',
  type: 'url-test',
  test: { ...DEFAULT_HEALTH_CHECK },
  hidden: true,
};

export const GAMING_POOL: NodePool = {
  id: 'pool-trait-gaming',
  name: '🎮 游戏',
  icon: '🎮',
  sources: 'all',
  include:
    '游戏|遊戲|低延迟|低延遲|全锥形|加速器|(?:^|[^A-Za-z])(?:Gaming|Game|Low[ _-]?Latency|Full[ _-]?Cone|UDP|Steam|PSN|Xbox|Switch|NAT1)(?:$|[^A-Za-z])',
  kind: 'trait',
  type: 'url-test',
  test: { ...DEFAULT_HEALTH_CHECK },
  hidden: true,
};

export const TRAIT_POOLS: readonly NodePool[] = [LOW_RATE_POOL, RESIDENTIAL_POOL, DEDICATED_POOL, GAMING_POOL];

export const STABILITY_FALLBACK_POOL: NodePool = {
  id: 'pool-stability-fallback',
  name: '🔁 故障转移',
  icon: '🔁',
  sources: 'all',
  kind: 'stability',
  type: 'fallback',
  members: ['pool-trait-dedicated', 'region-hk', 'region-sg', 'region-jp', 'pool-all-auto'],
  test: { ...DEFAULT_HEALTH_CHECK },
  hidden: true,
};

export const STABILITY_LOAD_BALANCE_POOL: NodePool = {
  id: 'pool-stability-load-balance',
  name: '⚖️ 负载均衡',
  icon: '⚖️',
  sources: 'all',
  kind: 'stability',
  type: 'load-balance',
  members: ['region-hk', 'region-tw', 'region-jp', 'region-sg'],
  test: { ...DEFAULT_HEALTH_CHECK },
  hidden: true,
};

/** Built-in stability pools combining other pools via ordered `members[]` (design §3.2). */
export const STABILITY_POOLS: readonly NodePool[] = [STABILITY_FALLBACK_POOL, STABILITY_LOAD_BALANCE_POOL];

/** Static built-in pool presets (all + 12 regions + traits + stability). */
export const BUILTIN_STATIC_POOLS: readonly NodePool[] = [
  ...ALL_BUILTIN_POOLS,
  ...REGION_POOLS,
  ...TRAIT_POOLS,
  ...STABILITY_POOLS,
];

/**
 * Lists all built-in pool presets, dynamically prepending per-slot `provider`
 * pools right after region pools when `slots` are supplied (design §3.2).
 */
export function listBuiltinPools(slots?: readonly NodeSlot[]): NodePool[] {
  const providerPools = slots && slots.length > 0 ? buildProviderPools(slots) : [];
  return structuredClone([...ALL_BUILTIN_POOLS, ...REGION_POOLS, ...providerPools, ...TRAIT_POOLS, ...STABILITY_POOLS]);
}

/** Finds a single built-in pool preset by ID (including dynamic provider pools when `slots` are passed). */
export function getBuiltinPool(id: string, slots?: readonly NodeSlot[]): NodePool | undefined {
  return listBuiltinPools(slots).find((pool) => pool.id === id);
}
