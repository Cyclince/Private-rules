import type { OutputProfile } from '../shared/clients';
import type { PolicyRef } from '../shared/schemas/card';
import type {
  ComplexityTier,
  DnsProfile,
  NodeSlot,
  RegionGroup,
  TemplateBody,
  TemplateCardRef,
  TemplateGroupMode,
  TemplateModuleBinding,
  TemplateRecord,
} from '../shared/schemas/template';
import { DEFAULT_HEALTH_CHECK } from '../domain/templates/model';
import { starterTierToComplexity as mapStarterTierToComplexity } from '../domain/templates/pools';

/** Canonical 3 beginner-friendly starter tiers (D4, §5.2): 少一点 / 推荐组合 / 全都要. */
export const CANONICAL_STARTER_TIERS = ['less', 'recommended', 'all'] as const;
export type CanonicalStarterTemplateTier = (typeof CANONICAL_STARTER_TIERS)[number];

/** Built-in starter tiers exposed to users. */
export const STARTER_TEMPLATE_TIERS = CANONICAL_STARTER_TIERS;

/** Legacy 4 tier identifiers retained for API & existing template compatibility. */
export const LEGACY_STARTER_TIERS = ['minimal', 'light', 'standard', 'heavy'] as const;
export type LegacyStarterTemplateTier = (typeof LEGACY_STARTER_TIERS)[number];

/** All accepted starter tier values (canonical 3 + legacy 4 aliases). */
export const ALL_STARTER_TEMPLATE_TIERS = [...CANONICAL_STARTER_TIERS, ...LEGACY_STARTER_TIERS] as const;
export type StarterTemplateTier = (typeof ALL_STARTER_TEMPLATE_TIERS)[number];

const LEGACY_TIER_TO_CANONICAL: Readonly<Record<LegacyStarterTemplateTier, CanonicalStarterTemplateTier>> = {
  minimal: 'less',
  light: 'less',
  standard: 'recommended',
  heavy: 'all',
};

const LEGACY_TIER_SLUGS: Readonly<Record<LegacyStarterTemplateTier, string>> = {
  minimal: 'starter-minimal',
  light: 'starter-light',
  standard: 'starter-standard',
  heavy: 'starter-heavy',
};

/** Legacy starter slugs mapped to canonical 3-tier keys. */
export const LEGACY_STARTER_SLUG_MAP: Readonly<Record<string, CanonicalStarterTemplateTier>> = {
  'starter-minimal': 'less',
  'starter-light': 'less',
  'starter-standard': 'recommended',
  'starter-heavy': 'all',
  'starter-less': 'less',
  'starter-recommended': 'recommended',
  'starter-all': 'all',
};

/** Canonical and legacy starter tiers mapped to 3 complexity tiers (design §2, D12). */
export const STARTER_TIER_COMPLEXITY_MAP: Readonly<Record<StarterTemplateTier, ComplexityTier>> = {
  less: 'simple',
  minimal: 'simple',
  light: 'simple',
  recommended: 'advanced',
  standard: 'advanced',
  all: 'pro',
  heavy: 'pro',
};

/** Maps any canonical or legacy starter tier into one of the 3 complexity tiers. */
export function starterTierToComplexity(tier: StarterTemplateTier | string): ComplexityTier {
  return mapStarterTierToComplexity(tier);
}

/** Maps any canonical or legacy starter tier into one of the 3 canonical tiers. */
export function normalizeStarterTier(tier: StarterTemplateTier): CanonicalStarterTemplateTier {
  if (tier === 'less' || tier === 'recommended' || tier === 'all') return tier;
  return LEGACY_TIER_TO_CANONICAL[tier];
}

/** Resolves a canonical or legacy starter slug into its canonical tier, if known. */
export function resolveStarterTierBySlug(slug: string): CanonicalStarterTemplateTier | undefined {
  return LEGACY_STARTER_SLUG_MAP[slug.trim().toLowerCase()];
}

const DEFAULT_SLOT: NodeSlot = {
  id: 'slot-main',
  name: '主力订阅',
  excludeInfo: true,
  udp: true,
  healthCheck: {
    url: DEFAULT_HEALTH_CHECK.url,
    intervalSec: DEFAULT_HEALTH_CHECK.intervalSec,
  },
};

const DEFAULT_DNS_PROFILE: DnsProfile = {
  mode: 'fake-ip',
  enable: true,
  ipv6: false,
  defaultNameserver: ['223.5.5.5', '119.29.29.29'],
  nameserver: ['https://dns.alidns.com/dns-query', 'https://doh.pub/dns-query'],
  fallback: ['https://1.1.1.1/dns-query', 'https://dns.google/dns-query'],
  fakeIpFilter: ['*.lan', '*.local', 'time.*.com', 'ntp.*.com', '+.msftconnecttest.com'],
};

const CORE_REGION_GROUPS: readonly RegionGroup[] = [
  {
    id: 'region-hk',
    name: '🇭🇰 香港节点',
    region: 'HK',
    type: 'url-test',
    slotId: 'slot-main',
    test: { ...DEFAULT_HEALTH_CHECK },
  },
  {
    id: 'region-tw',
    name: '🇹🇼 台湾节点',
    region: 'TW',
    type: 'url-test',
    slotId: 'slot-main',
    test: { ...DEFAULT_HEALTH_CHECK },
  },
  {
    id: 'region-jp',
    name: '🇯🇵 日本节点',
    region: 'JP',
    type: 'url-test',
    slotId: 'slot-main',
    test: { ...DEFAULT_HEALTH_CHECK },
  },
  {
    id: 'region-sg',
    name: '🇸🇬 新加坡节点',
    region: 'SG',
    type: 'url-test',
    slotId: 'slot-main',
    test: { ...DEFAULT_HEALTH_CHECK },
  },
  {
    id: 'region-us',
    name: '🇺🇸 美国节点',
    region: 'US',
    type: 'url-test',
    slotId: 'slot-main',
    test: { ...DEFAULT_HEALTH_CHECK },
  },
  {
    id: 'region-kr',
    name: '🇰🇷 韩国节点',
    region: 'KR',
    type: 'url-test',
    slotId: 'slot-main',
    test: { ...DEFAULT_HEALTH_CHECK },
  },
];

const EXTRA_HEAVY_REGION_GROUPS: readonly RegionGroup[] = [
  {
    id: 'region-gb',
    name: '🇬🇧 英国节点',
    region: 'GB',
    type: 'url-test',
    slotId: 'slot-main',
    test: { ...DEFAULT_HEALTH_CHECK },
  },
  {
    id: 'region-de',
    name: '🇩🇪 德国节点',
    region: 'DE',
    type: 'url-test',
    slotId: 'slot-main',
    test: { ...DEFAULT_HEALTH_CHECK },
  },
  {
    id: 'region-fr',
    name: '🇫🇷 法国节点',
    region: 'FR',
    type: 'url-test',
    slotId: 'slot-main',
    test: { ...DEFAULT_HEALTH_CHECK },
  },
  {
    id: 'region-nl',
    name: '🇳🇱 荷兰节点',
    region: 'NL',
    type: 'url-test',
    slotId: 'slot-main',
    test: { ...DEFAULT_HEALTH_CHECK },
  },
  {
    id: 'region-ca',
    name: '🇨🇦 加拿大节点',
    region: 'CA',
    type: 'url-test',
    slotId: 'slot-main',
    test: { ...DEFAULT_HEALTH_CHECK },
  },
  {
    id: 'region-au',
    name: '🇦🇺 澳大利亚节点',
    region: 'AU',
    type: 'url-test',
    slotId: 'slot-main',
    test: { ...DEFAULT_HEALTH_CHECK },
  },
];

const DEFAULT_MODULES: readonly TemplateModuleBinding[] = [
  { id: 'ip-no-resolve', enabled: true },
  { id: 'dns-leak-guard', enabled: false },
  { id: 'block-encrypted-dns', enabled: false },
  { id: 'game-download-direct', enabled: false },
  { id: 'tunnel-direct', enabled: false },
];

const cardRef = (cardId: string, overrides?: TemplateCardRef['overrides']): TemplateCardRef => ({
  cardId,
  enabled: true,
  ...(overrides ? { overrides } : {}),
});

const HEAVY_ALL_REGION_REFS: PolicyRef[] = [...CORE_REGION_GROUPS, ...EXTRA_HEAVY_REGION_GROUPS].map((group) => ({
  kind: 'region',
  regionGroupId: group.id,
}));

const NO_REGION_PROXY_CANDIDATES: PolicyRef[] = [
  { kind: 'card', cardId: 'proxy-select' },
  { kind: 'card', cardId: 'auto-select' },
  { kind: 'builtin', id: 'DIRECT' },
];

const NO_REGION_PROXY_ONLY_CANDIDATES: PolicyRef[] = [
  { kind: 'card', cardId: 'proxy-select' },
  { kind: 'card', cardId: 'auto-select' },
];

type StarterTemplatePreset = {
  tier: CanonicalStarterTemplateTier;
  id: string;
  slug: string;
  name: string;
  description: string;
  recommended?: boolean;
  buildBody: (groupMode: TemplateGroupMode, output: OutputProfile) => TemplateBody;
};

const STARTER_PRESETS: Record<CanonicalStarterTemplateTier, StarterTemplatePreset> = {
  less: {
    tier: 'less',
    id: 'builtin-less',
    slug: 'starter-less',
    name: '少一点',
    description: '只分国内外与 AI 服务，策略组精简、上手无负担。',
    buildBody: (groupMode, output) => ({
      slots: [structuredClone(DEFAULT_SLOT)],
      regionGroups: [],
      cards: [
        cardRef('auto-select'),
        cardRef('proxy-select', {
          group: {
            candidates: [
              { kind: 'card', cardId: 'auto-select' },
              { kind: 'slot', slotId: 'slot-main' },
              { kind: 'builtin', id: 'DIRECT' },
            ],
          },
        }),
        // Stage 1: pre-direct
        cardRef('lan-direct'),
        // Stage 2: app (AI only)
        cardRef('openai', { group: { candidates: structuredClone(NO_REGION_PROXY_ONLY_CANDIDATES) } }),
        cardRef('ai-services', { group: { candidates: structuredClone(NO_REGION_PROXY_ONLY_CANDIDATES) } }),
        // Stage 3: proxy-fallback
        cardRef('gfw-proxy', { group: { candidates: structuredClone(NO_REGION_PROXY_ONLY_CANDIDATES) } }),
        // Stage 5: domestic
        cardRef('domestic-direct'),
        // Stage 7: final
        cardRef('final-fallback', { group: { candidates: structuredClone(NO_REGION_PROXY_CANDIDATES) } }),
      ],
      groupMode,
      complexity: 'simple',
      final: { kind: 'card', cardId: 'final-fallback' },
      output,
      dns: structuredClone(DEFAULT_DNS_PROFILE),
      general: {
        testUrl: DEFAULT_HEALTH_CHECK.url,
        testIntervalSec: DEFAULT_HEALTH_CHECK.intervalSec,
        ipv6: false,
      },
      modules: structuredClone([...DEFAULT_MODULES]),
    }),
  },

  recommended: {
    tier: 'recommended',
    id: 'builtin-recommended',
    slug: 'starter-recommended',
    name: '推荐组合',
    description: '日常分流与清爽界面均衡（默认推荐），涵盖广告、AI、电报与主流流媒体，不含多余地区分组。',
    recommended: true,
    buildBody: (groupMode, output) => ({
      slots: [structuredClone(DEFAULT_SLOT)],
      regionGroups: [],
      cards: [
        cardRef('auto-select'),
        cardRef('proxy-select', {
          group: {
            candidates: [
              { kind: 'card', cardId: 'auto-select' },
              { kind: 'slot', slotId: 'slot-main' },
              { kind: 'builtin', id: 'DIRECT' },
            ],
          },
        }),
        // Stage 1: pre-direct
        cardRef('lan-direct'),
        cardRef('custom-direct'),
        cardRef('ad-block'),
        // Stage 2: app (default recommended scenarios — keeps visible groups within 8–12)
        cardRef('openai', { group: { candidates: structuredClone(NO_REGION_PROXY_ONLY_CANDIDATES) } }),
        cardRef('ai-services', { group: { candidates: structuredClone(NO_REGION_PROXY_ONLY_CANDIDATES) } }),
        cardRef('telegram', { group: { candidates: structuredClone(NO_REGION_PROXY_CANDIDATES) } }),
        cardRef('youtube', { group: { candidates: structuredClone(NO_REGION_PROXY_CANDIDATES) } }),
        cardRef('netflix', { group: { candidates: structuredClone(NO_REGION_PROXY_CANDIDATES) } }),
        cardRef('disney-plus', { group: { candidates: structuredClone(NO_REGION_PROXY_CANDIDATES) } }),
        cardRef('spotify', { group: { candidates: structuredClone(NO_REGION_PROXY_CANDIDATES) } }),
        cardRef('tiktok', { group: { candidates: structuredClone(NO_REGION_PROXY_CANDIDATES) } }),
        cardRef('speedtest'),
        // Stage 3: proxy-fallback
        cardRef('gfw-proxy', { group: { candidates: structuredClone(NO_REGION_PROXY_ONLY_CANDIDATES) } }),
        // Stage 4: ip
        cardRef('proxy-ip', { group: { candidates: structuredClone(NO_REGION_PROXY_ONLY_CANDIDATES) } }),
        // Stage 5: domestic
        cardRef('domestic-direct'),
        // Stage 6: port
        cardRef('non-standard-ports', { group: { candidates: structuredClone(NO_REGION_PROXY_CANDIDATES) } }),
        // Stage 7: final
        cardRef('final-fallback', { group: { candidates: structuredClone(NO_REGION_PROXY_CANDIDATES) } }),
      ],
      groupMode,
      complexity: 'advanced',
      final: { kind: 'card', cardId: 'final-fallback' },
      output,
      dns: structuredClone(DEFAULT_DNS_PROFILE),
      general: {
        testUrl: DEFAULT_HEALTH_CHECK.url,
        testIntervalSec: DEFAULT_HEALTH_CHECK.intervalSec,
        ipv6: false,
      },
      modules: structuredClone([...DEFAULT_MODULES]),
    }),
  },

  all: {
    tier: 'all',
    id: 'builtin-all',
    slug: 'starter-all',
    name: '全都要',
    description: '业务、地区、端口与 IP 分流最全，涵盖全部常见场景与欧美亚 12 个地区节点组。',
    buildBody: (groupMode, output) => ({
      slots: [structuredClone(DEFAULT_SLOT)],
      regionGroups: structuredClone([...CORE_REGION_GROUPS, ...EXTRA_HEAVY_REGION_GROUPS]),
      cards: [
        cardRef('auto-select'),
        cardRef('proxy-select', {
          group: {
            candidates: [
              { kind: 'card', cardId: 'auto-select' },
              ...HEAVY_ALL_REGION_REFS,
              { kind: 'slot', slotId: 'slot-main' },
              { kind: 'builtin', id: 'DIRECT' },
            ],
          },
        }),
        // Stage 1: pre-direct
        cardRef('lan-direct'),
        cardRef('custom-direct'),
        cardRef('ad-block'),
        // Stage 2: app
        cardRef('openai'),
        cardRef('ai-services'),
        cardRef('telegram'),
        cardRef('twitter'),
        cardRef('discord'),
        cardRef('youtube'),
        cardRef('netflix'),
        cardRef('disney-plus'),
        cardRef('bilibili-hkmt'),
        cardRef('spotify'),
        cardRef('tiktok'),
        cardRef('github'),
        cardRef('google-fcm'),
        cardRef('google'),
        cardRef('apple'),
        cardRef('onedrive'),
        cardRef('microsoft'),
        cardRef('steam'),
        cardRef('gaming-platforms'),
        cardRef('speedtest'),
        // Stage 3: proxy-fallback
        cardRef('gfw-proxy'),
        // Stage 4: ip
        cardRef('proxy-ip'),
        // Stage 5: domestic
        cardRef('domestic-direct'),
        // Stage 6: port
        cardRef('non-standard-ports'),
        // Stage 7: final
        cardRef('final-fallback'),
      ],
      groupMode,
      complexity: 'pro',
      final: { kind: 'card', cardId: 'final-fallback' },
      output,
      dns: structuredClone(DEFAULT_DNS_PROFILE),
      general: {
        testUrl: DEFAULT_HEALTH_CHECK.url,
        testIntervalSec: DEFAULT_HEALTH_CHECK.intervalSec,
        ipv6: false,
      },
      modules: [
        { id: 'ip-no-resolve', enabled: true },
        { id: 'dns-leak-guard', enabled: false },
        { id: 'block-encrypted-dns', enabled: false },
        { id: 'game-download-direct', enabled: true },
        { id: 'tunnel-direct', enabled: true },
      ],
    }),
  },
};

export type BuildStarterTemplateOptions = {
  /** Template-level business group mode (`select` or `fallback`, design §10.4). */
  groupMode?: TemplateGroupMode;
  /** Default output profile (`full` or `minimal`, design §10.13). */
  output?: OutputProfile;
};

/**
 * Instantiates one of the 3 built-in starter templates (少一点 / 推荐组合 / 全都要)
 * with backward-compatible mapping for legacy 4-tier names (`minimal` / `light` / `standard` / `heavy`)
 * and preserved legacy slugs (pure function, no I/O).
 */
export function buildStarterTemplate(tier: StarterTemplateTier, options?: BuildStarterTemplateOptions): TemplateRecord {
  const canonicalTier = normalizeStarterTier(tier);
  const preset = STARTER_PRESETS[canonicalTier];
  const groupMode: TemplateGroupMode = options?.groupMode ?? 'select';
  const output: OutputProfile = options?.output ?? 'full';
  const slug = tier in LEGACY_TIER_SLUGS ? LEGACY_TIER_SLUGS[tier as LegacyStarterTemplateTier] : preset.slug;

  return {
    id: preset.id,
    slug,
    name: preset.name,
    description: preset.description,
    baseKind: 'builtin',
    baseBody: preset.buildBody(groupMode, output),
    overlay: [],
    currentVersion: 1,
  };
}

/** The 3 default starter templates (`少一点` / `推荐组合` / `全都要`, `groupMode: 'select'`, `output: 'full'`). */
export const BUILTIN_TEMPLATES: readonly TemplateRecord[] = CANONICAL_STARTER_TIERS.map((tier) =>
  buildStarterTemplate(tier),
);
