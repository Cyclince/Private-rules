import type { ClientId, ClientLink } from '../types/domain-rules';
import { getImportLink } from './client-import';
import { TEMPLATE_CLIENTS, type NodeAccessClass, type TemplateClientId } from './clients';

/**
 * Single catalog for "which software do you use?" (design revision §1.2).
 * This file is shared by server and web and must stay free of DOM I/O.
 * The three syntax families are internal only; the UI never shows them.
 */
export const APP_PLATFORMS = ['ios', 'ipados', 'macos', 'windows', 'android', 'linux', 'router'] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

export const APP_FAMILIES = ['mihomo', 'singbox', 'apple'] as const;
export type AppFamily = (typeof APP_FAMILIES)[number];

export const APP_STATUSES = ['ready', 'rules-only', 'planned'] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

export type AppDefinitionInput = {
  id: string;
  name: string;
  aliases: readonly string[];
  platforms: readonly AppPlatform[];
  family: AppFamily;
  /** Existing rule subscription id (src/types/domain-rules.ts ClientId). */
  ruleClientId: ClientId;
  /** Existing full-config compiler id, or null when only rule subscriptions are supported. */
  templateClientId: TemplateClientId | null;
  /** Existing one-click import key (src/shared/client-import.ts), or null when unavailable. */
  importClientId: TemplateClientId | null;
  status: AppStatus;
  /** i18n key prefix; the resolved key is `apps.howTo.<id>`. */
  howToKey: string;
  /** Optional icon asset path; empty until licensed artwork is added (design §2.1 方案 A, fallback badge). */
  icon?: string;
};

export type AppDefinition = Omit<AppDefinitionInput, 'templateClientId' | 'icon'> & {
  templateClientId: TemplateClientId | null;
  /** Derived from templateClientId so catalog and compiler can never disagree (design §11.1). */
  nodeAccess: NodeAccessClass | null;
  /** Empty until licensed artwork lands; AppIcon then falls back to the letter badge (design §2.1 D3). */
  icon: string;
};

/**
 * Mapping notes for review (design §1.2 D1–D2). These are the rows where more than one existing
 * ClientId could have been chosen; each one picked the closest existing id:
 * - surge: one row for iOS/iPadOS/macOS. `surge` and `surge-mac` emit the same LIST content, so the
 *   row maps to `surge`; `surge-mac` remains in the family fallback order.
 * - clash-party / flclash: no dedicated rule link exists, so both map to `mihomo` (classical YAML).
 * - clash-meta-android / clashmi: no dedicated rule link exists, so both map to the generic `clash`.
 * - karing: sing-box family, so the closest rule link is `sing-box`; no full config is assumed.
 * - openclash: mihomo config only; there is no import URL scheme, so `importClientId` is null.
 * - egern / surfboard: no compiler yet, so `templateClientId` is null and status is `rules-only`.
 * - hiddify: rule-subscription support is unverified, so the row stays `planned` (hidden).
 */
const APP_SOURCES = [
  {
    id: 'shadowrocket',
    name: 'Shadowrocket',
    aliases: ['小火箭'],
    platforms: ['ios', 'ipados', 'macos'],
    family: 'apple',
    ruleClientId: 'shadowrocket',
    templateClientId: 'shadowrocket',
    importClientId: 'shadowrocket',
    status: 'ready',
    howToKey: 'apps.howTo.shadowrocket',
  },
  {
    id: 'quantumult-x',
    name: 'Quantumult X',
    aliases: ['圈X', 'QX', 'QuantumultX'],
    platforms: ['ios', 'ipados', 'macos'],
    family: 'apple',
    ruleClientId: 'quantumult-x',
    templateClientId: 'quantumult-x',
    importClientId: 'quantumult-x',
    status: 'ready',
    howToKey: 'apps.howTo.quantumult-x',
  },
  {
    id: 'loon',
    name: 'Loon',
    aliases: ['Loon Lite'],
    platforms: ['ios', 'ipados', 'macos'],
    family: 'apple',
    ruleClientId: 'loon',
    templateClientId: 'loon',
    importClientId: 'loon',
    status: 'ready',
    howToKey: 'apps.howTo.loon',
  },
  {
    id: 'surge',
    // Surge for iOS and Mac share one output file (both formatters emit the same LIST and differ only
    // in filename), so the catalog keeps one row instead of asking users to pick iOS vs Mac.
    // `ruleLinkForApp` therefore prefers `surge`; `surge-mac` sits in the family fallback order.
    name: 'Surge',
    aliases: ['Surge Mac', 'Surge for Mac'],
    platforms: ['ios', 'ipados', 'macos'],
    family: 'apple',
    ruleClientId: 'surge',
    templateClientId: 'surge',
    importClientId: 'surge',
    status: 'ready',
    howToKey: 'apps.howTo.surge',
  },
  {
    id: 'stash',
    // D1: Stash is grouped with the mihomo family because its configuration and rule syntax are Clash-compatible.
    name: 'Stash',
    aliases: [],
    platforms: ['ios', 'ipados', 'macos'],
    family: 'mihomo',
    ruleClientId: 'stash',
    templateClientId: 'stash',
    importClientId: 'stash',
    status: 'ready',
    howToKey: 'apps.howTo.stash',
  },
  {
    id: 'egern',
    // D1: Egern is grouped with the Apple family; it has no full-config compiler yet.
    name: 'Egern',
    aliases: [],
    platforms: ['ios', 'ipados', 'macos'],
    family: 'apple',
    ruleClientId: 'egern',
    templateClientId: null,
    importClientId: null,
    status: 'rules-only',
    howToKey: 'apps.howTo.egern',
  },
  {
    id: 'sing-box',
    name: 'sing-box',
    aliases: ['SFA', 'SFI', 'SFM', 'singbox'],
    platforms: ['ios', 'ipados', 'macos', 'windows', 'android', 'linux'],
    family: 'singbox',
    ruleClientId: 'sing-box',
    templateClientId: 'sing-box',
    importClientId: 'sing-box',
    status: 'ready',
    howToKey: 'apps.howTo.sing-box',
  },
  {
    id: 'clash-verge-rev',
    name: 'Clash Verge Rev',
    aliases: ['Clash Verge'],
    platforms: ['macos', 'windows', 'linux'],
    family: 'mihomo',
    // `clash-verge` is the most specific rule link; classical YAML is the family fallback.
    ruleClientId: 'clash-verge',
    templateClientId: 'mihomo',
    importClientId: 'mihomo',
    status: 'ready',
    howToKey: 'apps.howTo.clash-verge-rev',
  },
  {
    id: 'clash-party',
    name: 'Clash Party',
    aliases: ['Mihomo Party'],
    platforms: ['macos', 'windows'],
    family: 'mihomo',
    ruleClientId: 'mihomo',
    templateClientId: 'mihomo',
    importClientId: 'mihomo',
    status: 'ready',
    howToKey: 'apps.howTo.clash-party',
  },
  {
    id: 'flclash',
    name: 'FlClash',
    aliases: [],
    platforms: ['macos', 'windows', 'android', 'linux'],
    family: 'mihomo',
    ruleClientId: 'mihomo',
    templateClientId: 'mihomo',
    importClientId: 'mihomo',
    status: 'ready',
    howToKey: 'apps.howTo.flclash',
  },
  {
    id: 'clash-meta-android',
    // Mapping uncertainty: no dedicated link exists; the generic `clash` YAML provider is closest.
    name: 'Clash Meta for Android',
    aliases: ['Clash Meta', 'CMFA'],
    platforms: ['android'],
    family: 'mihomo',
    ruleClientId: 'clash',
    templateClientId: 'mihomo',
    importClientId: 'mihomo',
    status: 'ready',
    howToKey: 'apps.howTo.clash-meta-android',
  },
  {
    id: 'karing',
    // Mapping uncertainty: sing-box rule-set JSON is assumed usable; no full config yet.
    name: 'Karing',
    aliases: [],
    platforms: ['windows', 'android'],
    family: 'singbox',
    ruleClientId: 'sing-box',
    templateClientId: null,
    importClientId: null,
    status: 'rules-only',
    howToKey: 'apps.howTo.karing',
  },
  {
    id: 'surfboard',
    name: 'Surfboard',
    aliases: [],
    platforms: ['android'],
    family: 'apple',
    ruleClientId: 'surfboard',
    templateClientId: null,
    importClientId: null,
    status: 'rules-only',
    howToKey: 'apps.howTo.surfboard',
  },
  {
    id: 'openclash',
    // OpenClash consumes a Clash-compatible config; the template output chooses the minimal profile later.
    name: 'OpenClash',
    aliases: ['OpenClash for OpenWrt'],
    platforms: ['router'],
    family: 'mihomo',
    ruleClientId: 'openclash',
    templateClientId: 'mihomo',
    importClientId: null,
    status: 'ready',
    howToKey: 'apps.howTo.openclash',
  },
  {
    id: 'clashmi',
    // Mapping uncertainty: ClashMi speaks Clash syntax; generic `clash` link chosen, no full-config compiler yet.
    name: 'ClashMi',
    aliases: [],
    platforms: ['ios', 'ipados', 'android'],
    family: 'mihomo',
    ruleClientId: 'clash',
    templateClientId: null,
    importClientId: null,
    status: 'rules-only',
    howToKey: 'apps.howTo.clashmi',
  },
  {
    id: 'hiddify',
    // Mapping uncertainty: Hiddify rule-subscription support is unverified, so it stays hidden until checked.
    name: 'Hiddify',
    aliases: [],
    platforms: ['ios', 'ipados', 'macos', 'windows', 'android', 'linux'],
    family: 'singbox',
    ruleClientId: 'sing-box',
    templateClientId: null,
    importClientId: null,
    status: 'planned',
    howToKey: 'apps.howTo.hiddify',
  },
] as const satisfies readonly AppDefinitionInput[];

export type AppId = (typeof APP_SOURCES)[number]['id'];

function defineApp(input: AppDefinitionInput): AppDefinition {
  return {
    ...input,
    icon: input.icon ?? '',
    nodeAccess: input.templateClientId ? TEMPLATE_CLIENTS[input.templateClientId].nodeAccess : null,
  };
}

export const APPS: readonly AppDefinition[] = APP_SOURCES.map((app) => defineApp(app));
export const APP_IDS: readonly AppId[] = APP_SOURCES.map((app) => app.id);

const APP_BY_ID = new Map<string, AppDefinition>(APPS.map((app) => [app.id, app]));

export function getApp(id: string): AppDefinition | undefined {
  return APP_BY_ID.get(id);
}

/** Platform lookup for the picker. Hidden "planned" apps are excluded unless explicitly requested. */
export function appsByPlatform(platform: AppPlatform, options: { includePlanned?: boolean } = {}): AppDefinition[] {
  return APPS.filter((app) => app.platforms.includes(platform) && (options.includePlanned || app.status !== 'planned'));
}

/**
 * Family fallback order. A software's own ruleClientId always wins; these order the
 * remaining links when that exact file is absent (least specific last).
 */
const FAMILY_LINK_PREFERENCE: Record<AppFamily, readonly ClientId[]> = {
  mihomo: ['yaml-classical', 'mihomo', 'clash', 'stash', 'clash-verge', 'openclash', 'general', 'json'],
  singbox: ['sing-box', 'json', 'general', 'url'],
  apple: ['surge', 'surge-mac', 'loon', 'quantumult-x', 'shadowrocket', 'egern', 'surfboard', 'general', 'url'],
};

function resolveApp(app: AppId | AppDefinition): AppDefinition | undefined {
  return typeof app === 'string' ? getApp(app) : app;
}

/**
 * Picks the single most suitable rule subscription link for a software.
 * Within a family the shape never changes: mihomo apps get a classical YAML rule provider, sing-box
 * apps get the JSON rule set, Apple-family apps get their own LIST. The app's own file is preferred,
 * then the family fallback. A link with a usable address beats an identically shaped but empty one,
 * so callers can render a disabled state instead of an obviously wrong file.
 */
export function ruleLinkForApp(app: AppId | AppDefinition, links: readonly ClientLink[]): ClientLink | null {
  const definition = resolveApp(app);
  if (!definition) return null;
  const order = [
    definition.ruleClientId,
    ...FAMILY_LINK_PREFERENCE[definition.family].filter((clientId) => clientId !== definition.ruleClientId),
  ];
  const available = links.filter((link) => link.supported !== false);
  const byId = new Map(available.map((link) => [link.id, link]));
  for (const clientId of order) {
    const link = byId.get(clientId);
    if (link?.recommendedUrl) return link;
  }
  for (const clientId of order) {
    const link = byId.get(clientId);
    if (link) return link;
  }
  return null;
}

export function templateClientForApp(app: AppId | AppDefinition): TemplateClientId | null {
  return resolveApp(app)?.templateClientId ?? null;
}

/** Reuses the verification gate in client-import.ts: unverified or missing schemes return null. */
export function importLinkForApp(app: AppId | AppDefinition, url: string, name: string): string | null {
  const definition = resolveApp(app);
  if (!definition?.importClientId) return null;
  return getImportLink(definition.importClientId, url, name);
}
