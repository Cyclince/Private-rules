import {
  CATALOG_CATEGORY_VALUES,
  CATEGORY_EMOJI,
  normalizeCatalogCategory,
  type PrimaryCatalogCategory,
} from '../../../../shared/app-categories';
import type { ComplexityTier } from '../../../../shared/schemas/template';
import type { WizardRouteTarget, WizardScenarioId } from '../../../../shared/schemas/quick-create';
import type { SimpleTemplateView } from '../../../../application/templates';

type SimpleScenarioItem = SimpleTemplateView['routing']['scenarios'][number];

/**
 * Pure data mapping for the template detail page (design revision r2 §8).
 *
 * Everything in this module is dependency-free so the four-tab layout, the tier
 * switch confirmation and the policy-group grouping can be unit-tested without
 * rendering React.
 */

export const DETAIL_TAB_IDS = ['routing', 'nodes', 'modules', 'output'] as const;
export type DetailTabId = (typeof DETAIL_TAB_IDS)[number];

export function isDetailTab(value: unknown): value is DetailTabId {
  return typeof value === 'string' && (DETAIL_TAB_IDS as readonly string[]).includes(value);
}

export function detailTabTestId(tab: DetailTabId): string {
  return `template-tab-${tab}`;
}

/* ------------------------------------------------------------------ tiers */

export const TIER_IDS: readonly ComplexityTier[] = ['simple', 'advanced', 'pro'];

const TIER_RANK: Record<ComplexityTier, number> = { simple: 0, advanced: 1, pro: 2 };

export function tierRank(tier: ComplexityTier): number {
  return TIER_RANK[tier];
}

/** Upgrading keeps everything; only a step down hides extra parts. */
export function isTierDowngrade(from: ComplexityTier, to: ComplexityTier): boolean {
  return TIER_RANK[to] < TIER_RANK[from];
}

/** Which regions/pools each tier exposes (design §2.1). */
export function tierSupportsRegionPools(tier: ComplexityTier): boolean {
  return tier !== 'simple';
}

export function tierSupportsCustomPools(tier: ComplexityTier): boolean {
  return tier === 'pro';
}

export function tierShowsRegex(tier: ComplexityTier): boolean {
  return tier === 'pro';
}

/** Simple tier only offers the three plain destinations. */
export function routesForTier(tier: ComplexityTier): readonly WizardRouteTarget[] {
  if (tier === 'simple') return ['proxy', 'direct', 'reject'];
  return ['proxy', 'auto', 'direct', 'reject'];
}

/* ------------------------------------------------------ policy group cards */

/** Static fallback so grouping never depends on the cards API being loaded. */
export const SCENARIO_CATEGORY: Record<WizardScenarioId, PrimaryCatalogCategory> = {
  'domestic-direct': 'domestic',
  'ad-block': 'privacy',
  ai: 'ai',
  telegram: 'social',
  streaming: 'streaming',
  'bilibili-hkmt': 'regional-streaming',
  social: 'social',
  github: 'developer',
  gaming: 'gaming',
  'apple-ms-google': 'apple',
};

export type RoutingCardKind = 'scenario' | 'custom' | 'proxy' | 'direct' | 'reject';

export type RoutingCard = {
  /** Stable key: scenario id, card id or hub id. */
  id: string;
  kind: RoutingCardKind;
  /** I18n key for built-in scenarios and destinations. */
  titleKey?: string;
  /** Raw user-facing name for custom cards and rulesets. */
  title?: string;
  /** Emoji or card icon text; the UI renders it inside a tinted tile. */
  icon: string;
  category: PrimaryCatalogCategory;
  enabled: boolean;
  configurableRoute: boolean;
  route: WizardRouteTarget;
  /** True when the card was customized in the advanced editor (read-only here). */
  custom: boolean;
  testId: string;
};

export type RoutingCategoryGroup = {
  category: PrimaryCatalogCategory;
  emoji: string;
  cards: RoutingCard[];
};

export type RoutingCardSource = {
  scenarios: readonly SimpleScenarioItem[];
  customItems: SimpleTemplateView['routing']['customItems'];
  /** Optional card catalogue metadata (id -> icon/category) for nicer icons. */
  cardMeta?: ReadonlyMap<string, { icon?: string; category?: string }>;
};

/**
 * Groups the template's policy-group cards into the 15 canonical categories.
 * Empty categories are kept so callers can decide whether to render a heading
 * (the unit test asserts the full 15-bucket ordering).
 */
export function groupRoutingCards(source: RoutingCardSource): RoutingCategoryGroup[] {
  const buckets = new Map<PrimaryCatalogCategory, RoutingCard[]>(
    CATALOG_CATEGORY_VALUES.map((category) => [category, []]),
  );

  for (const scenario of source.scenarios) {
    const category = SCENARIO_CATEGORY[scenario.id] ?? 'other';
    const primaryCardId = scenario.cardIds[0];
    const meta = primaryCardId ? source.cardMeta?.get(primaryCardId) : undefined;
    buckets.get(category)!.push({
      id: scenario.id,
      kind: 'scenario',
      titleKey: `wizard.scenario.${scenario.id}`,
      icon: meta?.icon ?? CATEGORY_EMOJI[category],
      category,
      enabled: scenario.enabled,
      configurableRoute: scenario.configurableRoute,
      route: scenario.route,
      custom: scenario.custom,
      testId: `simple-scenario-row-${scenario.id}`,
    });
  }

  for (const item of source.customItems) {
    if (item.kind === 'scenario') continue;
    const meta = source.cardMeta?.get(item.id);
    const category = normalizeCatalogCategory(meta?.category ?? '') ?? 'other';
    buckets.get(category)!.push({
      id: item.id,
      kind: 'custom',
      title: item.name,
      icon: meta?.icon ?? CATEGORY_EMOJI[category],
      category,
      enabled: true,
      configurableRoute: false,
      route: 'proxy',
      custom: true,
      testId: `simple-custom-item-${item.id}`,
    });
  }

  return CATALOG_CATEGORY_VALUES.map((category) => ({
    category,
    emoji: CATEGORY_EMOJI[category],
    cards: [...buckets.get(category)!].sort((a, b) => Number(b.enabled) - Number(a.enabled)),
  }));
}

/**
 * Simple tier shows exactly three fixed destinations (design §2.1): the proxy
 * hub, direct and reject. Tracking toggles the two routing scenarios behind them.
 */
export function buildSimpleTierCards(scenarios: readonly SimpleScenarioItem[]): RoutingCard[] {
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const domestic = byId.get('domestic-direct');
  const adBlock = byId.get('ad-block');
  return [
    {
      id: 'proxy',
      kind: 'proxy',
      titleKey: 'templateDetail.hubProxy',
      icon: '🚀',
      category: 'base',
      enabled: true,
      configurableRoute: false,
      route: 'auto',
      custom: Boolean(domestic?.custom),
      testId: 'simple-hub-card-proxy',
    },
    {
      id: 'direct',
      kind: 'direct',
      titleKey: 'templateDetail.hubDirect',
      icon: '🎯',
      category: 'base',
      enabled: domestic?.enabled ?? true,
      configurableRoute: false,
      route: 'direct',
      custom: Boolean(domestic?.custom),
      testId: 'simple-hub-card-direct',
    },
    {
      id: 'reject',
      kind: 'reject',
      titleKey: 'templateDetail.hubReject',
      icon: '🚫',
      category: 'base',
      enabled: adBlock?.enabled ?? true,
      configurableRoute: false,
      route: 'reject',
      custom: Boolean(adBlock?.custom),
      testId: 'simple-hub-card-reject',
    },
  ];
}

/* ---------------------------------------------------------------- modules */

export type ModuleAvailability = {
  supported: boolean;
  /** Client ids the module can be compiled for (empty when unknown). */
  unsupportedClients: readonly string[];
};

/**
 * A module is greyed out when none of the template's chosen software supports it.
 * With no software chosen yet nothing is greyed out (the user can still enable it).
 */
export function describeModuleAvailability(
  supportedClients: readonly string[] | undefined,
  templateClients: readonly string[],
): ModuleAvailability {
  const supported = supportedClients ?? [];
  if (templateClients.length === 0 || supported.length === 0) {
    return { supported: true, unsupportedClients: [] };
  }
  const unsupportedClients = templateClients.filter((client) => !supported.includes(client));
  return { supported: unsupportedClients.length < templateClients.length, unsupportedClients };
}

export function templateClientIds(view: Pick<SimpleTemplateView, 'outputs'>): string[] {
  const ids = new Set<string>();
  for (const output of view.outputs) for (const client of output.clients) ids.add(client);
  return [...ids];
}
