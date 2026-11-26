import type { OutputProfile } from '../shared/clients';
import type { PolicyRef } from '../shared/schemas/card';
import type {
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

export const STARTER_TEMPLATE_TIERS = ['minimal', 'light', 'standard', 'heavy'] as const;
export type StarterTemplateTier = (typeof STARTER_TEMPLATE_TIERS)[number];

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

type StarterTemplatePreset = {
  tier: StarterTemplateTier;
  id: string;
  slug: string;
  name: string;
  description: string;
  recommended?: boolean;
  buildBody: (groupMode: TemplateGroupMode, output: OutputProfile) => TemplateBody;
};

const STARTER_PRESETS: Record<StarterTemplateTier, StarterTemplatePreset> = {
  minimal: {
    tier: 'minimal',
    id: 'builtin-minimal',
    slug: 'starter-minimal',
    name: '极简模板',
    description: '只代理 GFW 相关流量，其余全部直连，结构最精简。',
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
        cardRef('lan-direct'),
        cardRef('gfw-proxy', {
          group: {
            candidates: [
              { kind: 'card', cardId: 'proxy-select' },
              { kind: 'card', cardId: 'auto-select' },
            ],
          },
        }),
        cardRef('domestic-direct'),
      ],
      groupMode,
      final: { kind: 'builtin', id: 'DIRECT' },
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

  light: {
    tier: 'light',
    id: 'builtin-light',
    slug: 'starter-light',
    name: '轻量模板',
    description: '覆盖常用 AI、流媒体与开发服务，策略组少、易维护。',
    buildBody: (groupMode, output) => ({
      slots: [structuredClone(DEFAULT_SLOT)],
      regionGroups: structuredClone([...CORE_REGION_GROUPS]),
      cards: [
        cardRef('auto-select'),
        cardRef('proxy-select'),
        cardRef('lan-direct'),
        cardRef('ad-block'),
        cardRef('ai-services'),
        cardRef('telegram'),
        cardRef('youtube'),
        cardRef('netflix'),
        cardRef('github'),
        cardRef('google'),
        cardRef('apple'),
        cardRef('microsoft'),
        cardRef('domestic-direct'),
        cardRef('final-fallback'),
      ],
      groupMode,
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

  standard: {
    tier: 'standard',
    id: 'builtin-standard',
    slug: 'starter-standard',
    name: '标准模板',
    description: '日常分流与复杂度均衡（默认推荐），内置 7 层规则排序与常用地区节点组。',
    recommended: true,
    buildBody: (groupMode, output) => ({
      slots: [structuredClone(DEFAULT_SLOT)],
      regionGroups: structuredClone([...CORE_REGION_GROUPS]),
      cards: [
        cardRef('auto-select'),
        cardRef('proxy-select'),
        // Stage 1: pre-direct
        cardRef('lan-direct'),
        cardRef('ad-block'),
        // Stage 2: app (narrow before wide)
        cardRef('openai'),
        cardRef('ai-services'),
        cardRef('telegram'),
        cardRef('twitter'),
        cardRef('youtube'),
        cardRef('netflix'),
        cardRef('disney-plus'),
        cardRef('bilibili-hkmt'),
        cardRef('spotify'),
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
        // Stage 7: final
        cardRef('final-fallback'),
      ],
      groupMode,
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

  heavy: {
    tier: 'heavy',
    id: 'builtin-heavy',
    slug: 'starter-heavy',
    name: '重度模板',
    description: '业务、地区、端口与 IP 分流最全，涵盖欧美亚 12 个地区节点组。',
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
 * Instantiates one of the 4 built-in starter templates (极简 / 轻量 / 标准 / 重度)
 * with the requested `groupMode` and `output` profile (pure function, no I/O).
 */
export function buildStarterTemplate(tier: StarterTemplateTier, options?: BuildStarterTemplateOptions): TemplateRecord {
  const preset = STARTER_PRESETS[tier];
  const groupMode: TemplateGroupMode = options?.groupMode ?? 'select';
  const output: OutputProfile = options?.output ?? 'full';

  return {
    id: preset.id,
    slug: preset.slug,
    name: preset.name,
    description: preset.description,
    baseKind: 'builtin',
    baseBody: preset.buildBody(groupMode, output),
    overlay: [],
    currentVersion: 1,
  };
}

/** The 4 default starter templates (`groupMode: 'select'`, `output: 'full'`). */
export const BUILTIN_TEMPLATES: readonly TemplateRecord[] = STARTER_TEMPLATE_TIERS.map((tier) =>
  buildStarterTemplate(tier),
);
