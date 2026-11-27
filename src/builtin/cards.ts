import type { AppCard, PolicyRef } from '../shared/schemas/card';
import { DEFAULT_HEALTH_CHECK } from '../domain/templates/model';

const CORE_REGION_CANDIDATES: PolicyRef[] = [
  { kind: 'region', regionGroupId: 'region-hk' },
  { kind: 'region', regionGroupId: 'region-tw' },
  { kind: 'region', regionGroupId: 'region-jp' },
  { kind: 'region', regionGroupId: 'region-sg' },
  { kind: 'region', regionGroupId: 'region-us' },
  { kind: 'region', regionGroupId: 'region-kr' },
];

const STANDARD_PROXY_CANDIDATES: PolicyRef[] = [
  { kind: 'card', cardId: 'proxy-select' },
  { kind: 'card', cardId: 'auto-select' },
  ...CORE_REGION_CANDIDATES,
  { kind: 'builtin', id: 'DIRECT' },
];

const AI_PROXY_CANDIDATES: PolicyRef[] = [
  { kind: 'region', regionGroupId: 'region-us' },
  { kind: 'region', regionGroupId: 'region-jp' },
  { kind: 'region', regionGroupId: 'region-sg' },
  { kind: 'region', regionGroupId: 'region-tw' },
  { kind: 'card', cardId: 'proxy-select' },
];

const DIRECT_FIRST_CANDIDATES: PolicyRef[] = [
  { kind: 'builtin', id: 'DIRECT' },
  { kind: 'card', cardId: 'proxy-select' },
  { kind: 'card', cardId: 'auto-select' },
];

const HKMT_CANDIDATES: PolicyRef[] = [
  { kind: 'builtin', id: 'DIRECT' },
  { kind: 'region', regionGroupId: 'region-hk' },
  { kind: 'region', regionGroupId: 'region-tw' },
  { kind: 'card', cardId: 'proxy-select' },
];

/**
 * Built-in starter policy groups (~30 cards covering 13 of the 15 categories from
 * design revision r2 §4.2 and all 7 rule stratification stages, design §10.4 & §10.10).
 * The remaining categories (finance, shopping) are listed in docs/policy-groups-catalog.md (D14).
 *
 * Every card references only GeoSite / GeoIP / built-in catalog IDs / inline
 * port rules; no third-party rule content is bundled.
 */
export const BUILTIN_CARDS: readonly AppCard[] = [
  // ---- Hidden / Core Routing Hubs ----
  {
    id: 'auto-select',
    slug: 'auto-select',
    name: '⚡ 自动选择',
    icon: 'auto',
    category: 'base',
    stage: 'proxy-fallback',
    hidden: true,
    origin: 'builtin',
    group: {
      type: 'url-test',
      candidates: [{ kind: 'slot', slotId: 'slot-main' }],
      test: { ...DEFAULT_HEALTH_CHECK },
    },
    matchers: [],
  },
  {
    id: 'proxy-select',
    slug: 'proxy-select',
    name: '🚀 节点选择',
    icon: 'proxy',
    category: 'base',
    stage: 'proxy-fallback',
    hidden: true,
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: [
        { kind: 'card', cardId: 'auto-select' },
        ...CORE_REGION_CANDIDATES,
        { kind: 'slot', slotId: 'slot-main' },
        { kind: 'builtin', id: 'DIRECT' },
      ],
    },
    matchers: [],
  },

  // ---- Stage 1: pre-direct ----
  {
    id: 'lan-direct',
    slug: 'lan-direct',
    name: '🏠 局域网直连',
    icon: 'lan',
    category: 'domestic',
    stage: 'pre-direct',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: [
        { kind: 'builtin', id: 'DIRECT' },
        { kind: 'card', cardId: 'proxy-select' },
      ],
    },
    matchers: [
      { kind: 'geosite', name: 'private' },
      { kind: 'geoip', name: 'private', noResolve: true },
    ],
  },
  {
    id: 'direct-select',
    slug: 'direct-select',
    name: '🎯 直连',
    icon: 'direct',
    category: 'domestic',
    stage: 'pre-direct',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: [
        { kind: 'builtin', id: 'DIRECT' },
        { kind: 'card', cardId: 'proxy-select' },
      ],
    },
    matchers: [],
  },
  {
    id: 'custom-direct',
    slug: 'custom-direct',
    name: '🧭 常用直连补充',
    icon: 'domestic',
    category: 'domestic',
    stage: 'pre-direct',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: [
        { kind: 'builtin', id: 'DIRECT' },
        { kind: 'card', cardId: 'proxy-select' },
      ],
    },
    matchers: [{ kind: 'catalog', entryId: 'domestic-direct-custom', updateIntervalSec: 1800 }],
  },
  {
    id: 'ad-block',
    slug: 'ad-block',
    name: '🛡️ 广告拦截',
    icon: 'advertising',
    category: 'privacy',
    stage: 'pre-direct',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: [
        { kind: 'builtin', id: 'REJECT' },
        { kind: 'builtin', id: 'REJECT-DROP' },
        { kind: 'builtin', id: 'DIRECT' },
      ],
    },
    matchers: [{ kind: 'geosite', name: 'category-ads-all' }],
  },

  // ---- Stage 2: app (narrow before wide) ----
  {
    id: 'openai',
    slug: 'openai',
    name: '🤖 OpenAI / ChatGPT',
    icon: 'openai',
    category: 'ai',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: AI_PROXY_CANDIDATES,
    },
    matchers: [{ kind: 'geosite', name: 'openai' }],
  },
  {
    id: 'ai-services',
    slug: 'ai-services',
    name: '✨ AI 服务',
    icon: 'ai',
    category: 'ai',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: AI_PROXY_CANDIDATES,
    },
    matchers: [{ kind: 'geosite', name: 'category-ai-!cn' }],
  },
  {
    id: 'telegram',
    slug: 'telegram',
    name: '✈️ Telegram',
    icon: 'telegram',
    category: 'social',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: STANDARD_PROXY_CANDIDATES,
    },
    matchers: [{ kind: 'geosite', name: 'telegram' }],
  },
  {
    id: 'twitter',
    slug: 'twitter',
    name: '𝕏 X / Twitter',
    icon: 'twitter',
    category: 'social',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: STANDARD_PROXY_CANDIDATES,
    },
    matchers: [{ kind: 'geosite', name: 'twitter' }],
  },
  {
    id: 'discord',
    slug: 'discord',
    name: '💬 Discord',
    icon: 'discord',
    category: 'social',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: STANDARD_PROXY_CANDIDATES,
    },
    matchers: [{ kind: 'geosite', name: 'discord' }],
  },
  {
    id: 'youtube',
    slug: 'youtube',
    name: '▶️ YouTube',
    icon: 'youtube',
    category: 'streaming',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: STANDARD_PROXY_CANDIDATES,
    },
    matchers: [{ kind: 'geosite', name: 'youtube' }],
  },
  {
    id: 'netflix',
    slug: 'netflix',
    name: '🎬 Netflix',
    icon: 'netflix',
    category: 'streaming',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: STANDARD_PROXY_CANDIDATES,
    },
    matchers: [{ kind: 'geosite', name: 'netflix' }],
  },
  {
    id: 'disney-plus',
    slug: 'disney-plus',
    name: '🏰 Disney+',
    icon: 'disney',
    category: 'streaming',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: STANDARD_PROXY_CANDIDATES,
    },
    matchers: [{ kind: 'geosite', name: 'disney' }],
  },
  {
    id: 'bilibili-hkmt',
    slug: 'bilibili-hkmt',
    name: '📺 哔哩哔哩港澳台',
    icon: 'bilibili',
    category: 'regional-streaming',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: HKMT_CANDIDATES,
    },
    matchers: [{ kind: 'geosite', name: 'bilibili' }],
  },
  {
    id: 'spotify',
    slug: 'spotify',
    name: '🎵 Spotify',
    icon: 'spotify',
    category: 'music',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: STANDARD_PROXY_CANDIDATES,
    },
    matchers: [{ kind: 'geosite', name: 'spotify' }],
  },
  {
    id: 'tiktok',
    slug: 'tiktok',
    name: '🎵 TikTok',
    icon: 'tiktok',
    category: 'streaming',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: [
        { kind: 'region', regionGroupId: 'region-jp' },
        { kind: 'region', regionGroupId: 'region-tw' },
        { kind: 'region', regionGroupId: 'region-sg' },
        { kind: 'region', regionGroupId: 'region-us' },
        { kind: 'card', cardId: 'proxy-select' },
      ],
    },
    matchers: [{ kind: 'geosite', name: 'tiktok' }],
  },
  {
    id: 'github',
    slug: 'github',
    name: '🐙 GitHub',
    icon: 'github',
    category: 'developer',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: STANDARD_PROXY_CANDIDATES,
    },
    matchers: [{ kind: 'geosite', name: 'github' }],
  },
  {
    id: 'google-fcm',
    slug: 'google-fcm',
    name: '🔔 Google FCM',
    icon: 'google-fcm',
    category: 'cloud-office',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: [
        { kind: 'card', cardId: 'proxy-select' },
        { kind: 'builtin', id: 'DIRECT' },
        ...CORE_REGION_CANDIDATES,
      ],
    },
    matchers: [{ kind: 'geosite', name: 'googlefcm' }],
  },
  {
    id: 'google',
    slug: 'google',
    name: '🔍 Google',
    icon: 'google',
    category: 'cloud-office',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: STANDARD_PROXY_CANDIDATES,
    },
    matchers: [{ kind: 'geosite', name: 'google' }],
  },
  {
    id: 'apple',
    slug: 'apple',
    name: '🍎 Apple',
    icon: 'apple',
    category: 'apple',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: DIRECT_FIRST_CANDIDATES,
    },
    matchers: [{ kind: 'geosite', name: 'apple' }],
  },
  {
    id: 'onedrive',
    slug: 'onedrive',
    name: '☁️ OneDrive',
    icon: 'onedrive',
    category: 'cloud-office',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: STANDARD_PROXY_CANDIDATES,
    },
    matchers: [{ kind: 'geosite', name: 'onedrive' }],
  },
  {
    id: 'microsoft',
    slug: 'microsoft',
    name: '🪟 Microsoft',
    icon: 'microsoft',
    category: 'cloud-office',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: DIRECT_FIRST_CANDIDATES,
    },
    matchers: [{ kind: 'geosite', name: 'microsoft' }],
  },
  {
    id: 'steam',
    slug: 'steam',
    name: '🎮 Steam',
    icon: 'steam',
    category: 'gaming',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: STANDARD_PROXY_CANDIDATES,
    },
    matchers: [{ kind: 'geosite', name: 'steam' }],
  },
  {
    id: 'gaming-platforms',
    slug: 'gaming-platforms',
    name: '🕹️ 游戏平台',
    icon: 'gaming',
    category: 'gaming',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: STANDARD_PROXY_CANDIDATES,
    },
    matchers: [{ kind: 'geosite', name: 'category-games' }],
  },
  {
    id: 'speedtest',
    slug: 'speedtest',
    name: '⏱️ 测速工具',
    icon: 'speedtest',
    category: 'other',
    stage: 'app',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: DIRECT_FIRST_CANDIDATES,
    },
    matchers: [{ kind: 'geosite', name: 'speedtest' }],
  },

  // ---- Stage 3: proxy-fallback ----
  {
    id: 'gfw-proxy',
    slug: 'gfw-proxy',
    name: '🌐 GFW 代理',
    icon: 'proxy',
    category: 'base',
    stage: 'proxy-fallback',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: [
        { kind: 'card', cardId: 'proxy-select' },
        { kind: 'card', cardId: 'auto-select' },
        ...CORE_REGION_CANDIDATES,
      ],
    },
    matchers: [{ kind: 'geosite', name: 'gfw' }],
  },

  // ---- Stage 4: ip (no-resolve, after domain rules) ----
  {
    id: 'proxy-ip',
    slug: 'proxy-ip',
    name: '🧭 常用服务 IP',
    icon: 'proxy',
    category: 'base',
    stage: 'ip',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: [
        { kind: 'card', cardId: 'proxy-select' },
        { kind: 'card', cardId: 'auto-select' },
        ...CORE_REGION_CANDIDATES,
      ],
    },
    matchers: [
      { kind: 'geoip', name: 'telegram', noResolve: true },
      { kind: 'geoip', name: 'google', noResolve: true },
      { kind: 'geoip', name: 'netflix', noResolve: true },
      { kind: 'geoip', name: 'twitter', noResolve: true },
    ],
  },

  // ---- Stage 5: domestic ----
  {
    id: 'domestic-direct',
    slug: 'domestic-direct',
    name: '🇨🇳 国内直连',
    icon: 'domestic',
    category: 'domestic',
    stage: 'domestic',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: [
        { kind: 'builtin', id: 'DIRECT' },
        { kind: 'card', cardId: 'proxy-select' },
      ],
    },
    matchers: [
      { kind: 'geosite', name: 'cn' },
      { kind: 'geoip', name: 'cn', noResolve: true },
    ],
  },

  // ---- Stage 6: port ----
  {
    id: 'non-standard-ports',
    slug: 'non-standard-ports',
    name: '🔌 非标准端口',
    icon: 'other',
    category: 'other',
    stage: 'port',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: [
        { kind: 'builtin', id: 'DIRECT' },
        { kind: 'card', cardId: 'proxy-select' },
      ],
    },
    matchers: [
      {
        kind: 'inline',
        conditions: [
          {
            op: 'not',
            item: {
              op: 'or',
              items: [
                { op: 'rule', rule: { type: 'DST-PORT', value: '80' } },
                { op: 'rule', rule: { type: 'DST-PORT', value: '443' } },
              ],
            },
          },
        ],
      },
    ],
  },

  // ---- Stage 7: final ----
  {
    id: 'final-fallback',
    slug: 'final-fallback',
    name: '🐟 漏网之鱼',
    icon: 'final',
    category: 'base',
    stage: 'final',
    origin: 'builtin',
    group: {
      type: 'select',
      candidates: [
        { kind: 'card', cardId: 'proxy-select' },
        { kind: 'builtin', id: 'DIRECT' },
        { kind: 'card', cardId: 'auto-select' },
        ...CORE_REGION_CANDIDATES,
      ],
    },
    matchers: [],
  },
];

const BUILTIN_CARD_MAP = new Map<string, AppCard>(BUILTIN_CARDS.map((card) => [card.id, card]));

export function getBuiltinCard(id: string): AppCard | undefined {
  return BUILTIN_CARD_MAP.get(id);
}

export function getBuiltinCardMap(): ReadonlyMap<string, AppCard> {
  return BUILTIN_CARD_MAP;
}
