import type { AppCard, PolicyRef } from '../../shared/schemas/card';
import type {
  NodeCombineMode,
  QuickCreatePreviewSummary,
  QuickCreateScenarioInput,
  WizardGroupMode,
  WizardRouteTarget,
  WizardScenarioId,
} from '../../shared/schemas/quick-create';
import type {
  ComplexityTier,
  NodePool,
  NodeSlot,
  RegionGroup,
  TemplateBody,
  TemplateCardRef,
  TemplateModuleBinding,
} from '../../shared/schemas/template';
import {
  ALL_AUTO_POOL,
  BUILTIN_REGION_POOL_CODES,
  BUILTIN_STATIC_POOLS,
  STABILITY_FALLBACK_POOL,
  TRAIT_POOLS,
  buildProviderPools,
} from '../../builtin/pools';
import { getRegionDefinition } from '../nodes/regions';
import {
  ALWAYS_ENABLED_CARD_IDS,
  buildRegionGroupForCode,
  buildRouteCandidates,
  CANONICAL_BUILTIN_CARD_ORDER,
  extractRegionCodeFromRoute,
  getDefaultWizardScenarios,
  resolveWizardRegionGroups,
  WIZARD_SCENARIO_DEFINITIONS,
  WIZARD_SCENARIO_MAP,
  type QuickCreateResolvedRuleset,
} from './quick-create';
import { buildDefaultModulesForComplexity } from './modules';
import { inferTemplateComplexity, nodePoolToRegionGroup, regionGroupToNodePool } from './pools';

export type SimpleRulesetRef = {
  id: string;
  name: string;
  slug: string;
};

export type SimpleScenarioItem = {
  id: WizardScenarioId;
  enabled: boolean;
  configurableRoute: boolean;
  route: WizardRouteTarget;
  custom: boolean;
  customReason?: string;
  cardIds: readonly string[];
};

export type SimpleRulesetItem = {
  rulesetId: string;
  cardId: string;
  name: string;
  slug?: string;
  route: WizardRouteTarget;
  missing: boolean;
};

export type SimpleCustomItem = {
  id: string;
  name: string;
  kind: 'card' | 'scenario' | 'advanced';
  reason?: string;
};

export type SimpleRoutingView = {
  complexity: ComplexityTier;
  scenarios: SimpleScenarioItem[];
  rulesets: SimpleRulesetItem[];
  customItems: SimpleCustomItem[];
  groupMode: WizardGroupMode;
  hasCustomizations: boolean;
  availableRegions: Array<{ code: string; name: string; emoji: string }>;
};

const ALWAYS_ENABLED_SET = new Set<string>(ALWAYS_ENABLED_CARD_IDS);
const INFRA_HANDLED_CARD_ID_SET = new Set<string>([...ALWAYS_ENABLED_CARD_IDS, 'direct-select']);
const SCENARIO_CARD_ID_SET = new Set<string>(WIZARD_SCENARIO_DEFINITIONS.flatMap((def) => def.cardIds));
const BUILTIN_STATIC_POOL_MAP = new Map<string, NodePool>(BUILTIN_STATIC_POOLS.map((pool) => [pool.id, pool]));

function dedupePolicyRefs(refs: readonly PolicyRef[]): PolicyRef[] {
  const result: PolicyRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key =
      ref.kind === 'builtin'
        ? `builtin:${ref.id}`
        : ref.kind === 'card'
          ? `card:${ref.cardId}`
          : ref.kind === 'region'
            ? `region:${ref.regionGroupId}`
            : ref.kind === 'pool'
              ? `pool:${ref.poolId}`
              : `slot:${ref.slotId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

function getSimpleRegionGroups(body: TemplateBody): RegionGroup[] {
  const fromPools = (body.pools ?? [])
    .map((pool) => nodePoolToRegionGroup(pool))
    .filter((rg): rg is RegionGroup => rg !== null);
  if (fromPools.length > 0) {
    return fromPools;
  }
  return [...(body.regionGroups ?? [])];
}

/**
 * Maps a primary `PolicyRef` candidate back to a simple-view `WizardRouteTarget`.
 * Returns `null` when the candidate cannot be represented in the simple UI.
 */
export function mapPolicyRefToWizardRoute(
  ref: PolicyRef | undefined,
  regionGroupById: ReadonlyMap<string, RegionGroup>,
  poolById?: ReadonlyMap<string, NodePool>,
): WizardRouteTarget | null {
  if (!ref) return null;
  if (ref.kind === 'builtin') {
    if (ref.id === 'DIRECT') return 'direct';
    if (ref.id === 'REJECT' || ref.id === 'REJECT-DROP') return 'reject';
    return null;
  }
  if (ref.kind === 'card') {
    if (ref.cardId === 'auto-select') return 'auto';
    if (ref.cardId === 'proxy-select') return 'proxy';
    if (ref.cardId === 'direct-select') return 'direct';
    return null;
  }
  if (ref.kind === 'region' || ref.kind === 'pool') {
    const id = ref.kind === 'pool' ? ref.poolId : ref.regionGroupId;
    if (ref.kind === 'pool') {
      const pool = poolById?.get(id);
      if (pool?.kind === 'all' || id === ALL_AUTO_POOL.id) return 'auto';
    }
    const group = regionGroupById.get(id);
    if (group?.region) {
      return `region:${group.region.toUpperCase()}`;
    }
    const match = /^region-([a-z]{2,8})$/i.exec(id);
    if (match) {
      return `region:${match[1].toUpperCase()}`;
    }
    return null;
  }
  return null;
}

function isDefaultSimpleCardOverrideName(cardId: string, name: string, complexity: ComplexityTier): boolean {
  if (complexity !== 'simple') return false;
  return (cardId === 'proxy-select' && name === '🚀 代理') || (cardId === 'ad-block' && name === '🚫 拦截');
}

function hasAdvancedCardOverrides(
  ref: TemplateCardRef,
  card?: AppCard,
  complexity: ComplexityTier = 'advanced',
): boolean {
  const ov = ref.overrides;
  if (!ov) return false;
  if (ov.name && ov.name !== card?.name && !isDefaultSimpleCardOverrideName(ref.cardId, ov.name, complexity)) {
    return true;
  }
  if (ov.icon && ov.icon !== card?.icon) return true;
  if (ov.stage && ov.stage !== card?.stage) return true;
  if (ov.matchers && ov.matchers.length > 0) return true;
  if (ov.group?.type && ov.group.type !== (card?.group.type ?? 'select')) return true;
  if (ov.group?.test) return true;
  return false;
}

function isSimpleSingleRulesetCard(card: AppCard | undefined): string | null {
  if (!card) return null;
  if (INFRA_HANDLED_CARD_ID_SET.has(card.id) || SCENARIO_CARD_ID_SET.has(card.id)) return null;
  if (card.matchers.length !== 1) return null;
  const matcher = card.matchers[0];
  if (matcher.kind !== 'ruleset') return null;
  if (card.group.type !== 'select' || card.group.test) return null;
  return matcher.ruleSetId;
}

function deriveGroupMode(
  body: TemplateBody,
  cardMap: ReadonlyMap<string, AppCard>,
  complexity: ComplexityTier,
): WizardGroupMode {
  if (complexity === 'simple' && body.wizardMeta?.groupMode) {
    return body.wizardMeta.groupMode;
  }
  const proxySelectRef = body.cards.find((c) => c.cardId === 'proxy-select' && c.enabled);
  const proxySelectCard = cardMap.get('proxy-select');
  const proxyPrimary = proxySelectRef?.overrides?.group?.candidates?.[0] ?? proxySelectCard?.group.candidates[0];

  if (proxyPrimary?.kind === 'slot') {
    return 'select';
  }

  const fallbackRef =
    body.cards.find((c) => c.cardId === 'final-fallback' && c.enabled) ??
    body.cards.find((c) => c.cardId === 'gfw-proxy' && c.enabled);
  const fallbackCard = fallbackRef ? cardMap.get(fallbackRef.cardId) : undefined;
  const fallbackPrimary = fallbackRef?.overrides?.group?.candidates?.[0] ?? fallbackCard?.group.candidates[0];

  const regionGroups = getSimpleRegionGroups(body);

  // Collect region IDs explicitly targeted by non-hub cards
  const explicitlyTargetedRegions = new Set<string>();
  for (const ref of body.cards) {
    if (!ref.enabled || INFRA_HANDLED_CARD_ID_SET.has(ref.cardId)) continue;
    const card = cardMap.get(ref.cardId);
    const primary = ref.overrides?.group?.candidates?.[0] ?? card?.group.candidates[0];
    if (primary?.kind === 'region') {
      explicitlyTargetedRegions.add(primary.regionGroupId);
    } else if (primary?.kind === 'pool') {
      explicitlyTargetedRegions.add(primary.poolId);
    }
  }
  const hasUnreferencedRegionGroups = regionGroups.some((rg) => !explicitlyTargetedRegions.has(rg.id));

  if (body.wizardMeta?.groupMode) {
    if (body.wizardMeta.groupMode === 'region' && regionGroups.length > 0) return 'region';
    if (body.wizardMeta.groupMode === 'auto' && (!hasUnreferencedRegionGroups || complexity === 'pro')) return 'auto';
    if (body.wizardMeta.groupMode === 'select') return 'select';
  }

  if (fallbackPrimary?.kind === 'card' && fallbackPrimary.cardId === 'auto-select' && !hasUnreferencedRegionGroups) {
    return 'auto';
  }
  if (regionGroups.length > 0) {
    return 'region';
  }
  return 'auto';
}

function getEnabledModuleIdsSignature(modules: readonly TemplateModuleBinding[]): string {
  return modules
    .filter((m) => m.enabled)
    .map((m) => m.id)
    .sort()
    .join(',');
}

function isDefaultModulesForBody(modules: readonly TemplateModuleBinding[], complexity: ComplexityTier): boolean {
  const sig = getEnabledModuleIdsSignature(modules);
  const tierSig = getEnabledModuleIdsSignature(buildDefaultModulesForComplexity(complexity));
  if (sig === tierSig) return true;
  if (sig === 'ip-no-resolve') return true;
  if (complexity === 'pro' && sig === 'game-download-direct,ip-no-resolve,tunnel-direct') return true;
  return false;
}

function isCustomizedBuiltinPool(pool: NodePool): boolean {
  if (pool.kind === 'region') {
    return Boolean(pool.include || pool.exclude);
  }
  if (pool.kind === 'provider') {
    return Boolean(pool.include || pool.exclude || pool.type !== 'url-test');
  }
  const preset = BUILTIN_STATIC_POOL_MAP.get(pool.id);
  if (!preset) return true;
  if (pool.type !== preset.type) return true;
  if ((pool.include ?? '') !== (preset.include ?? '')) return true;
  if ((pool.exclude ?? '') !== (preset.exclude ?? '')) return true;
  if (pool.kind === 'stability') {
    const presetMembers = preset.members ?? [];
    const curMembers = pool.members ?? [];
    // Narrowing stability members to available region/trait pools counts as uncustomized
    if (curMembers.some((id) => !presetMembers.includes(id))) return true;
  }
  return false;
}

function hasTemplateLevelAdvancedCustomizations(body: TemplateBody, complexity: ComplexityTier): boolean {
  if (
    body.clientPatches &&
    Object.values(body.clientPatches).some((v) => typeof v === 'string' && v.trim().length > 0)
  ) {
    return true;
  }
  if (body.dns && body.dns.mode !== 'fake-ip') {
    return true;
  }
  if (body.groupMode === 'fallback') {
    return true;
  }
  if (!isDefaultModulesForBody(body.modules, complexity)) {
    return true;
  }
  if (getSimpleRegionGroups(body).some((rg) => Boolean(rg.extraInclude || rg.extraExclude))) {
    return true;
  }
  if ((body.pools ?? []).some((pool) => isCustomizedBuiltinPool(pool))) {
    return true;
  }
  return false;
}

/**
 * Maps any `TemplateBody` (wizard-created, beta.1 starter, imported, or blank)
 * into the M2b simple-view routing structure (plan §4.3, §4.6, B3).
 */
export function mapTemplateToSimpleRouting(
  body: TemplateBody,
  cardMap: ReadonlyMap<string, AppCard>,
  rulesetMap: ReadonlyMap<string, SimpleRulesetRef>,
): SimpleRoutingView {
  const complexity = inferTemplateComplexity(body);
  const simpleRegionGroups = getSimpleRegionGroups(body);
  const regionGroupById = new Map<string, RegionGroup>(simpleRegionGroups.map((rg) => [rg.id, rg]));
  const poolById = new Map<string, NodePool>((body.pools ?? []).map((p) => [p.id, p]));
  const refByCardId = new Map<string, TemplateCardRef>();
  for (const ref of body.cards) {
    refByCardId.set(ref.cardId, ref);
  }

  const groupMode = deriveGroupMode(body, cardMap, complexity);
  const scenarios: SimpleScenarioItem[] = [];
  const handledCardIds = new Set<string>(INFRA_HANDLED_CARD_ID_SET);

  // 1. Map §4.6 scenarios
  for (const def of WIZARD_SCENARIO_DEFINITIONS) {
    const enabledRefs: TemplateCardRef[] = [];
    for (const cardId of def.cardIds) {
      const ref = refByCardId.get(cardId);
      if (ref) {
        handledCardIds.add(cardId);
        if (ref.enabled) enabledRefs.push(ref);
      }
    }

    if (enabledRefs.length === 0) {
      scenarios.push({
        id: def.id,
        enabled: false,
        configurableRoute: def.configurableRoute,
        route: def.defaultRoute,
        custom: false,
        cardIds: def.cardIds,
      });
      continue;
    }

    const mappedRoutes: Array<WizardRouteTarget | null> = [];
    let advancedOverrideFound = false;

    for (const ref of enabledRefs) {
      const card = cardMap.get(ref.cardId);
      if (hasAdvancedCardOverrides(ref, card, complexity)) {
        advancedOverrideFound = true;
      }
      const primary = ref.overrides?.group?.candidates?.[0] ?? card?.group.candidates[0];
      mappedRoutes.push(mapPolicyRefToWizardRoute(primary, regionGroupById, poolById));
    }

    const firstValidRoute = mappedRoutes.find((r): r is WizardRouteTarget => r !== null) ?? def.defaultRoute;
    const isSimpleDomesticComplete =
      complexity === 'simple' &&
      def.id === 'domestic-direct' &&
      enabledRefs.some((r) => r.cardId === 'lan-direct') &&
      enabledRefs.some((r) => r.cardId === 'domestic-direct');
    const isComplete = isSimpleDomesticComplete || enabledRefs.length === def.cardIds.length;
    const allMappable = mappedRoutes.every((r) => r !== null);
    const allAgree = allMappable && mappedRoutes.every((r) => r === mappedRoutes[0]);
    const fixedRouteMismatch = !def.configurableRoute && firstValidRoute !== def.defaultRoute;

    const isCustom = !isComplete || advancedOverrideFound || !allMappable || !allAgree || fixedRouteMismatch;
    let customReason: string | undefined;
    if (!isComplete) {
      customReason = 'partial_cards';
    } else if (advancedOverrideFound) {
      customReason = 'advanced_override';
    } else if (!allMappable) {
      customReason = 'custom_target';
    } else if (!allAgree) {
      customReason = 'mixed_routes';
    } else if (fixedRouteMismatch) {
      customReason = 'route_changed';
    }

    scenarios.push({
      id: def.id,
      enabled: true,
      configurableRoute: def.configurableRoute,
      route: firstValidRoute,
      custom: isCustom,
      ...(customReason ? { customReason } : {}),
      cardIds: def.cardIds,
    });
  }

  // 2. Map remaining enabled cards into "My Rules" (ruleset cards) or "customItems"
  const rulesets: SimpleRulesetItem[] = [];
  const seenRulesetIds = new Set<string>();
  const customItems: SimpleCustomItem[] = [];

  for (const ref of body.cards) {
    if (handledCardIds.has(ref.cardId)) continue;
    if (!ref.enabled) continue;

    const card = cardMap.get(ref.cardId);
    const rulesetId = isSimpleSingleRulesetCard(card);
    if (rulesetId && !hasAdvancedCardOverrides(ref, card, complexity) && !seenRulesetIds.has(rulesetId)) {
      const primary = ref.overrides?.group?.candidates?.[0] ?? card?.group.candidates[0];
      const mappedRoute = mapPolicyRefToWizardRoute(primary, regionGroupById, poolById);
      if (mappedRoute) {
        seenRulesetIds.add(rulesetId);
        const rs = rulesetMap.get(rulesetId);
        rulesets.push({
          rulesetId,
          cardId: ref.cardId,
          name: rs?.name ?? card?.name ?? rulesetId,
          ...(rs?.slug ? { slug: rs.slug } : {}),
          route: mappedRoute,
          missing: !rs,
        });
        continue;
      }
    }

    customItems.push({
      id: ref.cardId,
      name: ref.overrides?.name ?? card?.name ?? ref.cardId,
      kind: 'card',
      reason: rulesetId ? 'custom_target' : 'custom_card',
    });
  }

  // 3. Collect available regions from template's regionGroups (or migrated region pools)
  const availableRegions: Array<{ code: string; name: string; emoji: string }> = [];
  const seenRegions = new Set<string>();
  for (const rg of simpleRegionGroups) {
    const code = rg.region.toUpperCase();
    if (seenRegions.has(code)) continue;
    seenRegions.add(code);
    const def = getRegionDefinition(code);
    availableRegions.push({
      code,
      name: def?.nameZh ?? code,
      emoji: def?.flag ?? '🌐',
    });
  }

  const hasCustomizations =
    customItems.length > 0 ||
    scenarios.some((sc) => sc.custom) ||
    hasTemplateLevelAdvancedCustomizations(body, complexity);

  return {
    complexity,
    scenarios,
    rulesets,
    customItems,
    groupMode,
    hasCustomizations,
    availableRegions,
  };
}

export type ApplySimpleTemplatePatchInput = {
  currentBody: TemplateBody;
  cardMap: ReadonlyMap<string, AppCard>;
  builtinCards: readonly AppCard[];
  rulesetMap: ReadonlyMap<string, SimpleRulesetRef>;
  patch: {
    complexity?: ComplexityTier;
    scenarios?: readonly QuickCreateScenarioInput[];
    rulesets?: readonly QuickCreateResolvedRuleset[];
    groupMode?: WizardGroupMode;
    slots?: readonly NodeSlot[];
    combineMode?: NodeCombineMode;
    subscriptionPreviews?: Record<string, QuickCreatePreviewSummary>;
  };
  hasSubscription: boolean;
  detectedRegions?: readonly string[];
};

export type ApplySimpleTemplatePatchResult = {
  body: TemplateBody;
  generatedCards: AppCard[];
};

function collectRegionGroupIdsReferencedByCard(ref: TemplateCardRef, card?: AppCard): string[] {
  const candidates = ref.overrides?.group?.candidates ?? card?.group.candidates ?? [];
  const ids: string[] = [];
  for (const cand of candidates) {
    if (cand.kind === 'region') ids.push(cand.regionGroupId);
    else if (cand.kind === 'pool') ids.push(cand.poolId);
  }
  return ids;
}

function buildSimpleRulesetPatchCandidates(route: WizardRouteTarget): PolicyRef[] {
  if (route === 'direct') {
    return dedupePolicyRefs([
      { kind: 'builtin', id: 'DIRECT' },
      { kind: 'card', cardId: 'proxy-select' },
    ]);
  }
  if (route === 'reject') {
    return dedupePolicyRefs([
      { kind: 'builtin', id: 'REJECT' },
      { kind: 'builtin', id: 'REJECT-DROP' },
      { kind: 'builtin', id: 'DIRECT' },
    ]);
  }
  if (route === 'auto') {
    return dedupePolicyRefs([
      { kind: 'pool', poolId: ALL_AUTO_POOL.id },
      { kind: 'card', cardId: 'proxy-select' },
      { kind: 'builtin', id: 'DIRECT' },
    ]);
  }
  return dedupePolicyRefs([
    { kind: 'card', cardId: 'proxy-select' },
    { kind: 'pool', poolId: ALL_AUTO_POOL.id },
    { kind: 'builtin', id: 'DIRECT' },
  ]);
}

function stripSimpleOverrideFlags(ref: TemplateCardRef, cardId: string): TemplateCardRef {
  if (!ref.overrides) return { cardId, enabled: true };
  const nextOv = structuredClone(ref.overrides);
  if (nextOv.hidden) delete nextOv.hidden;
  if (
    (cardId === 'proxy-select' && nextOv.name === '🚀 代理') ||
    (cardId === 'ad-block' && nextOv.name === '🚫 拦截')
  ) {
    delete nextOv.name;
  }
  return Object.keys(nextOv).length > 0 ? { cardId, enabled: true, overrides: nextOv } : { cardId, enabled: true };
}

function isSimpleHubCardUncustomized(
  ref: TemplateCardRef | undefined,
  cardId: 'proxy-select' | 'ad-block',
  baseCard: AppCard | undefined,
  complexity: ComplexityTier,
): boolean {
  if (!ref) return true;
  return !hasAdvancedCardOverrides(ref, baseCard, complexity);
}

/**
 * Pure domain updater for `PATCH /api/templates/:id/simple` (B3 + N2).
 * Modifies complexity tiers (`simple` | `advanced` | `pro`), non-custom scenarios,
 * "My Rules" items & ordering, `groupMode`, `combineMode`, and slots while preserving
 * all user customizations (`custom` scenarios, custom cards, custom/edited pools,
 * custom overrides, DNS, modules, and client patches) across upgrades and downgrades.
 */
export function applySimpleTemplatePatch(input: ApplySimpleTemplatePatchInput): ApplySimpleTemplatePatchResult {
  const currentBody = structuredClone(input.currentBody);
  const builtinCardMap = new Map<string, AppCard>(input.builtinCards.map((c) => [c.id, c]));
  const currentSimple = mapTemplateToSimpleRouting(currentBody, input.cardMap, input.rulesetMap);

  const currentComplexity: ComplexityTier = currentSimple.complexity;
  const nextComplexity: ComplexityTier = input.patch.complexity ?? currentComplexity;
  const complexityChanged = nextComplexity !== currentComplexity;
  const upgradingToPro = complexityChanged && nextComplexity === 'pro';
  const upgradingFromSimple = complexityChanged && currentComplexity === 'simple' && nextComplexity !== 'simple';
  const downgradingToSimple = nextComplexity === 'simple';

  const customScenarioIds = new Set<WizardScenarioId>(
    currentSimple.scenarios.filter((sc) => sc.custom).map((sc) => sc.id),
  );
  const customScenarioCardIds = new Set<string>(
    WIZARD_SCENARIO_DEFINITIONS.filter((def) => customScenarioIds.has(def.id)).flatMap((def) => def.cardIds),
  );
  const managedScenarioCardIds = new Set<string>(
    WIZARD_SCENARIO_DEFINITIONS.filter((def) => !customScenarioIds.has(def.id)).flatMap((def) => def.cardIds),
  );

  // Clean ruleset cards currently managed by simple view
  const existingRulesetCardByRulesetId = new Map<string, { cardId: string; ref: TemplateCardRef }>();
  const existingManagedRulesetCardIds = new Set<string>();
  for (const item of currentSimple.rulesets) {
    const ref = currentBody.cards.find((c) => c.cardId === item.cardId);
    if (ref) {
      existingRulesetCardByRulesetId.set(item.rulesetId, { cardId: item.cardId, ref });
      existingManagedRulesetCardIds.add(item.cardId);
    }
  }

  // Resolve next scenarios across tier transitions while preserving custom scenarios verbatim
  const patchScenarioMap = new Map<WizardScenarioId, QuickCreateScenarioInput>();
  if (input.patch.scenarios) {
    for (const item of input.patch.scenarios) {
      if (!customScenarioIds.has(item.id)) {
        patchScenarioMap.set(item.id, item);
      }
    }
  }

  const defaultAdvancedScenarios = new Map(getDefaultWizardScenarios().map((s) => [s.id, s]));
  const nextScenarios: QuickCreateScenarioInput[] = currentSimple.scenarios.map((current) => {
    if (current.custom) {
      return {
        id: current.id,
        enabled: current.enabled,
        ...(current.configurableRoute ? { route: current.route } : {}),
      };
    }
    const patched = patchScenarioMap.get(current.id);
    if (nextComplexity === 'simple') {
      const enabled = current.id === 'domestic-direct' || current.id === 'ad-block';
      const route = current.configurableRoute ? (patched?.route ?? current.route) : current.route;
      return {
        id: current.id,
        enabled,
        ...(current.configurableRoute ? { route } : {}),
      };
    }
    if (upgradingToPro) {
      const enabled = patched ? patched.enabled : true;
      const route = current.configurableRoute ? (patched?.route ?? current.route) : current.route;
      return {
        id: current.id,
        enabled,
        ...(current.configurableRoute ? { route } : {}),
      };
    }
    if (upgradingFromSimple) {
      const advDefault = defaultAdvancedScenarios.get(current.id);
      const enabled = patched ? patched.enabled : (advDefault?.enabled ?? current.enabled);
      const route = current.configurableRoute ? (patched?.route ?? advDefault?.route ?? current.route) : current.route;
      return {
        id: current.id,
        enabled,
        ...(current.configurableRoute ? { route } : {}),
      };
    }
    const enabled = patched ? patched.enabled : current.enabled;
    const route = current.configurableRoute ? (patched?.route ?? current.route) : current.route;
    return {
      id: current.id,
      enabled,
      ...(current.configurableRoute ? { route } : {}),
    };
  });

  const groupModeChanged = input.patch.groupMode !== undefined && input.patch.groupMode !== currentSimple.groupMode;
  const nextGroupMode: WizardGroupMode = input.patch.groupMode ?? currentSimple.groupMode;

  // Determine next rulesets list
  const nextRulesetInputs: QuickCreateResolvedRuleset[] =
    input.patch.rulesets !== undefined
      ? [...input.patch.rulesets]
      : currentSimple.rulesets.map((item) => ({
          rulesetId: item.rulesetId,
          name: item.name,
          slug: item.slug ?? item.rulesetId,
          route: item.route,
          cardId: item.cardId,
          cardSlug: input.cardMap.get(item.cardId)?.slug ?? item.cardId,
        }));

  // Collect region codes explicitly required by non-custom enabled scenarios or rulesets
  const requiredRegionCodes: string[] = [];
  if (nextComplexity !== 'simple') {
    for (const sc of nextScenarios) {
      if (!sc.enabled || customScenarioIds.has(sc.id)) continue;
      const code = extractRegionCodeFromRoute(sc.route);
      if (code) requiredRegionCodes.push(code);
    }
    for (const rs of nextRulesetInputs) {
      const code = extractRegionCodeFromRoute(rs.route);
      if (code) requiredRegionCodes.push(code);
    }
  }

  // Collect pool/region IDs referenced by preserved/custom cards so we never drop them
  const preservedPoolIds = new Set<string>();
  for (const ref of currentBody.cards) {
    const isManagedScenario = managedScenarioCardIds.has(ref.cardId);
    const isManagedRuleset = existingManagedRulesetCardIds.has(ref.cardId);
    if (isManagedScenario || isManagedRuleset || INFRA_HANDLED_CARD_ID_SET.has(ref.cardId)) continue;
    const card = input.cardMap.get(ref.cardId);
    for (const poolId of collectRegionGroupIdsReferencedByCard(ref, card)) {
      preservedPoolIds.add(poolId);
    }
  }
  const currentRegionGroups = getSimpleRegionGroups(currentBody);
  for (const rg of currentRegionGroups) {
    if (rg.extraInclude || rg.extraExclude) {
      preservedPoolIds.add(rg.id);
    }
  }
  const currentPoolById = new Map<string, NodePool>((currentBody.pools ?? []).map((p) => [p.id, p]));
  for (const pool of currentBody.pools ?? []) {
    if (isCustomizedBuiltinPool(pool)) {
      preservedPoolIds.add(pool.id);
    }
  }

  const slotsChanged = input.patch.slots !== undefined;
  const nextSlots: NodeSlot[] = slotsChanged ? structuredClone([...input.patch.slots!]) : currentBody.slots;
  const nextSlotIdSet = new Set(nextSlots.map((slot) => slot.id));
  const singleMainSlot = nextSlots.length === 1 && nextSlots[0].id === 'slot-main';
  const regionSlotId = singleMainSlot ? 'slot-main' : null;
  const slotRefs: PolicyRef[] = nextSlots.map((slot) => ({ kind: 'slot', slotId: slot.id }));
  const nextCombineMode: NodeCombineMode | undefined =
    input.patch.combineMode ?? currentBody.combineMode ?? currentBody.wizardMeta?.combineMode;
  const combineModeChanged =
    input.patch.combineMode !== undefined &&
    input.patch.combineMode !== (currentBody.combineMode ?? currentBody.wizardMeta?.combineMode);

  // Resolve next regionGroups & pools
  let nextRegionGroups: RegionGroup[];
  if (downgradingToSimple) {
    nextRegionGroups = currentRegionGroups
      .filter((rg) => preservedPoolIds.has(rg.id))
      .map((rg) => ({ ...rg, hidden: true }));
  } else if (nextComplexity === 'pro') {
    const proSeedRegions =
      input.hasSubscription && (input.detectedRegions?.length ?? 0) > 0
        ? input.detectedRegions
        : BUILTIN_REGION_POOL_CODES;
    const baseGroups = resolveWizardRegionGroups({
      groupMode: 'region',
      hasSubscription: input.hasSubscription,
      detectedRegions: proSeedRegions,
      requiredRegionCodes,
      slotId: regionSlotId,
    });
    const byId = new Map<string, RegionGroup>(baseGroups.map((g) => [g.id, g]));
    for (const existing of currentRegionGroups) {
      if (byId.has(existing.id)) {
        const cur = byId.get(existing.id)!;
        if (existing.extraInclude || existing.extraExclude) {
          byId.set(existing.id, {
            ...cur,
            ...(existing.extraInclude ? { extraInclude: existing.extraInclude } : {}),
            ...(existing.extraExclude ? { extraExclude: existing.extraExclude } : {}),
          });
        }
      } else if (preservedPoolIds.has(existing.id)) {
        byId.set(existing.id, existing);
      }
    }
    nextRegionGroups = [...byId.values()];
  } else if (groupModeChanged || complexityChanged) {
    const baseGroups = resolveWizardRegionGroups({
      groupMode: nextGroupMode,
      hasSubscription: input.hasSubscription,
      detectedRegions: input.detectedRegions,
      requiredRegionCodes,
      slotId: regionSlotId,
    });
    const byId = new Map<string, RegionGroup>(baseGroups.map((g) => [g.id, g]));
    for (const existing of currentRegionGroups) {
      if (byId.has(existing.id) && (existing.extraInclude || existing.extraExclude)) {
        const cur = byId.get(existing.id)!;
        byId.set(existing.id, {
          ...cur,
          ...(existing.extraInclude ? { extraInclude: existing.extraInclude } : {}),
          ...(existing.extraExclude ? { extraExclude: existing.extraExclude } : {}),
        });
      } else if (preservedPoolIds.has(existing.id) && !byId.has(existing.id)) {
        byId.set(existing.id, existing);
      }
    }
    nextRegionGroups = [...byId.values()];
  } else {
    nextRegionGroups = [...currentRegionGroups];
    const existingIds = new Set(nextRegionGroups.map((g) => g.id));
    for (const code of requiredRegionCodes) {
      const built = buildRegionGroupForCode(code, regionSlotId);
      if (built && !existingIds.has(built.id)) {
        existingIds.add(built.id);
        nextRegionGroups.push(built);
      }
    }
  }

  if (slotsChanged) {
    nextRegionGroups = nextRegionGroups.map((rg) => {
      if (!rg.slotId) return rg;
      if (!nextSlotIdSet.has(rg.slotId) || (nextSlots.length > 1 && rg.slotId === 'slot-main')) {
        const cleaned = { ...rg };
        delete cleaned.slotId;
        return cleaned;
      }
      return rg;
    });
  }

  const availableRegionGroupIds = nextRegionGroups.map((g) => g.id);
  const availableRegionSet = new Set(availableRegionGroupIds);
  const regionRefs: PolicyRef[] = availableRegionGroupIds.map((regionGroupId) => ({
    kind: 'region',
    regionGroupId,
  }));

  // Assemble next pools
  const defaultRegionHidden = nextGroupMode !== 'region' || downgradingToSimple;
  const mergePreservedCustomPool = (pool: NodePool): NodePool => {
    const existing = currentPoolById.get(pool.id);
    if (!existing || !isCustomizedBuiltinPool(existing)) return pool;
    return {
      ...pool,
      ...(existing.include ? { include: existing.include } : {}),
      ...(existing.exclude ? { exclude: existing.exclude } : {}),
      ...(existing.type ? { type: existing.type } : {}),
      ...(existing.members ? { members: [...existing.members] } : {}),
      ...(existing.test ? { test: structuredClone(existing.test) } : {}),
    };
  };

  let nextPools: NodePool[] | undefined;
  if (downgradingToSimple) {
    const allAuto = mergePreservedCustomPool(structuredClone(ALL_AUTO_POOL));
    const extras: NodePool[] = [allAuto];
    const seenIds = new Set<string>([allAuto.id]);
    for (const rg of nextRegionGroups) {
      if (seenIds.has(rg.id)) continue;
      seenIds.add(rg.id);
      const fromRg = { ...regionGroupToNodePool(rg, { defaultHidden: true }), hidden: true };
      extras.push({ ...mergePreservedCustomPool(fromRg), hidden: true });
    }
    for (const pool of currentBody.pools ?? []) {
      if (seenIds.has(pool.id)) continue;
      if (preservedPoolIds.has(pool.id)) {
        seenIds.add(pool.id);
        extras.push({ ...structuredClone(pool), hidden: true });
      }
    }
    nextPools = extras;
  } else if (nextComplexity === 'pro') {
    const allAuto = mergePreservedCustomPool(structuredClone(ALL_AUTO_POOL));
    const regionPools = nextRegionGroups.map((rg) =>
      mergePreservedCustomPool(regionGroupToNodePool(rg, { defaultHidden: nextGroupMode !== 'region' })),
    );
    const providerPools = buildProviderPools(nextSlots, {
      hidden: (nextCombineMode ?? 'merge') !== 'perProvider',
    }).map(mergePreservedCustomPool);
    const traitPools = TRAIT_POOLS.map((p) => mergePreservedCustomPool(structuredClone(p)));
    const presentIds = new Set<string>([
      allAuto.id,
      ...regionPools.map((p) => p.id),
      ...providerPools.map((p) => p.id),
      ...traitPools.map((p) => p.id),
    ]);
    const rawStability = mergePreservedCustomPool(structuredClone(STABILITY_FALLBACK_POOL));
    const filteredMembers = (rawStability.members ?? []).filter((id) => presentIds.has(id));
    const stabilityPool: NodePool = {
      ...rawStability,
      members: filteredMembers.length > 0 ? filteredMembers : [ALL_AUTO_POOL.id],
    };
    const corePools: NodePool[] = [allAuto, ...regionPools, ...providerPools, ...traitPools, stabilityPool];
    const coreIds = new Set(corePools.map((p) => p.id));
    for (const pool of currentBody.pools ?? []) {
      if (!coreIds.has(pool.id) && preservedPoolIds.has(pool.id)) {
        corePools.push(structuredClone(pool));
        coreIds.add(pool.id);
      }
    }
    nextPools = corePools;
  } else if (currentBody.pools !== undefined || complexityChanged) {
    const regionPools = nextRegionGroups.map((rg) =>
      mergePreservedCustomPool(regionGroupToNodePool(rg, { defaultHidden: defaultRegionHidden })),
    );
    const regionIds = new Set(regionPools.map((p) => p.id));
    const preservedNonRegionPools: NodePool[] = [];
    for (const pool of currentBody.pools ?? []) {
      if (pool.kind === 'region' || regionIds.has(pool.id)) continue;
      if (complexityChanged) {
        if (preservedPoolIds.has(pool.id)) {
          preservedNonRegionPools.push({ ...structuredClone(pool), hidden: true });
        }
      } else {
        preservedNonRegionPools.push(structuredClone(pool));
      }
    }
    nextPools = [...regionPools, ...preservedNonRegionPools];
  }

  const activePoolIds = new Set<string>(nextPools ? nextPools.map((p) => p.id) : availableRegionGroupIds);
  const filterExistingRegions = (candidates: readonly PolicyRef[]): PolicyRef[] =>
    candidates.filter((ref) => {
      if (ref.kind === 'region') return availableRegionSet.has(ref.regionGroupId);
      if (ref.kind === 'pool') return activePoolIds.has(ref.poolId);
      return true;
    });

  // Build next ruleset card refs & any newly generated cards
  const generatedCards: AppCard[] = [];
  const nextRulesetRefs: TemplateCardRef[] = [];

  for (const rs of nextRulesetInputs) {
    const candidates =
      nextComplexity === 'simple'
        ? buildSimpleRulesetPatchCandidates(rs.route)
        : buildRouteCandidates(rs.route, {
            availableRegionGroupIds,
            groupMode: nextGroupMode,
          });
    const existing = existingRulesetCardByRulesetId.get(rs.rulesetId);
    if (existing) {
      const card = input.cardMap.get(existing.cardId);
      const matchesDefault = card && JSON.stringify(card.group.candidates) === JSON.stringify(candidates);
      nextRulesetRefs.push(
        matchesDefault
          ? { cardId: existing.cardId, enabled: true }
          : {
              cardId: existing.cardId,
              enabled: true,
              overrides: { group: { candidates } },
            },
      );
    } else {
      const newCard: AppCard = {
        id: rs.cardId,
        slug: rs.cardSlug,
        name: rs.name,
        category: 'other',
        stage: 'pre-direct',
        origin: 'user',
        group: {
          type: 'select',
          candidates,
        },
        matchers: [{ kind: 'ruleset', ruleSetId: rs.rulesetId, updateIntervalSec: 1800 }],
      };
      generatedCards.push(newCard);
      nextRulesetRefs.push({ cardId: newCard.id, enabled: true });
    }
  }

  const traitPoolRefs: PolicyRef[] =
    nextComplexity === 'pro' ? TRAIT_POOLS.map((pool) => ({ kind: 'pool', poolId: pool.id })) : [];

  let finalCards: TemplateCardRef[];
  let nextFinal: PolicyRef = currentBody.final;

  if (downgradingToSimple) {
    const existingById = new Map<string, TemplateCardRef>(currentBody.cards.map((c) => [c.cardId, c]));
    const existingProxyRef = existingById.get('proxy-select');
    const proxyCard = builtinCardMap.get('proxy-select') ?? input.cardMap.get('proxy-select');
    const simpleProxyCandidates = dedupePolicyRefs([
      { kind: 'pool', poolId: ALL_AUTO_POOL.id },
      ...slotRefs,
      { kind: 'builtin', id: 'DIRECT' },
    ]);
    const nextProxyRef: TemplateCardRef = isSimpleHubCardUncustomized(
      existingProxyRef,
      'proxy-select',
      proxyCard,
      currentComplexity,
    )
      ? {
          cardId: 'proxy-select',
          enabled: true,
          overrides: {
            name: '🚀 代理',
            group: { type: 'select', candidates: simpleProxyCandidates },
          },
        }
      : { ...existingProxyRef!, enabled: true };

    const existingDirectRef = existingById.get('direct-select');
    const nextDirectRef: TemplateCardRef = existingDirectRef
      ? { ...existingDirectRef, enabled: true }
      : { cardId: 'direct-select', enabled: true };

    const existingAdBlockRef = existingById.get('ad-block');
    const adBlockCard = builtinCardMap.get('ad-block') ?? input.cardMap.get('ad-block');
    const nextAdBlockRef: TemplateCardRef = isSimpleHubCardUncustomized(
      existingAdBlockRef,
      'ad-block',
      adBlockCard,
      currentComplexity,
    )
      ? { cardId: 'ad-block', enabled: true, overrides: { name: '🚫 拦截' } }
      : { ...existingAdBlockRef!, enabled: true };

    const nextLanRef: TemplateCardRef = existingById.get('lan-direct')
      ? { ...existingById.get('lan-direct')!, enabled: true }
      : { cardId: 'lan-direct', enabled: true };
    const nextDomesticRef: TemplateCardRef = existingById.get('domestic-direct')
      ? { ...existingById.get('domestic-direct')!, enabled: true }
      : { cardId: 'domestic-direct', enabled: true };

    const simpleCoreIds = new Set<string>([
      'proxy-select',
      'direct-select',
      'lan-direct',
      'ad-block',
      'domestic-direct',
      ...existingManagedRulesetCardIds,
    ]);

    const preservedAndDowngraded: TemplateCardRef[] = [];
    for (const ref of currentBody.cards) {
      if (simpleCoreIds.has(ref.cardId)) continue;
      const isCustom =
        customScenarioCardIds.has(ref.cardId) ||
        (!managedScenarioCardIds.has(ref.cardId) && !INFRA_HANDLED_CARD_ID_SET.has(ref.cardId));
      if (isCustom) {
        preservedAndDowngraded.push(ref);
      } else {
        // Hide/disable uncustomized higher-tier cards without losing them
        preservedAndDowngraded.push({
          ...ref,
          enabled: false,
          overrides: {
            ...ref.overrides,
            hidden: true,
          },
        });
      }
    }

    finalCards = [
      nextProxyRef,
      nextDirectRef,
      ...nextRulesetRefs,
      nextLanRef,
      nextAdBlockRef,
      nextDomesticRef,
      ...preservedAndDowngraded,
    ];
    nextFinal = { kind: 'card', cardId: 'proxy-select' };
  } else {
    // Determine desired enabled non-custom scenario cards & route overrides for advanced / pro
    const desiredScenarioCardIds = new Set<string>();
    const desiredScenarioRoute = new Map<string, WizardRouteTarget>();
    for (const sc of nextScenarios) {
      if (customScenarioIds.has(sc.id) || !sc.enabled) continue;
      const def = WIZARD_SCENARIO_MAP.get(sc.id);
      if (!def) continue;
      for (const cardId of def.cardIds) {
        desiredScenarioCardIds.add(cardId);
        if (def.configurableRoute && sc.route) {
          desiredScenarioRoute.set(cardId, sc.route);
        }
      }
    }

    const buildManagedScenarioRef = (cardId: string): TemplateCardRef => {
      const baseCard = builtinCardMap.get(cardId) ?? input.cardMap.get(cardId);
      const explicitRoute = desiredScenarioRoute.get(cardId);
      if (explicitRoute) {
        const candidates = buildRouteCandidates(explicitRoute, {
          availableRegionGroupIds,
          groupMode: nextGroupMode,
        });
        const matchesBase = baseCard && JSON.stringify(baseCard.group.candidates) === JSON.stringify(candidates);
        return matchesBase
          ? { cardId, enabled: true }
          : { cardId, enabled: true, overrides: { group: { candidates } } };
      }
      if (baseCard) {
        const filtered = filterExistingRegions(baseCard.group.candidates);
        const changed = filtered.length !== baseCard.group.candidates.length;
        return changed
          ? { cardId, enabled: true, overrides: { group: { candidates: filtered } } }
          : { cardId, enabled: true };
      }
      return { cardId, enabled: true };
    };

    const buildAutoSelectRef = (existingRef?: TemplateCardRef): TemplateCardRef => {
      if (!slotsChanged && !upgradingFromSimple && existingRef) {
        return stripSimpleOverrideFlags(existingRef, 'auto-select');
      }
      if (singleMainSlot) {
        return { cardId: 'auto-select', enabled: upgradingFromSimple ? true : (existingRef?.enabled ?? true) };
      }
      return {
        cardId: 'auto-select',
        enabled: upgradingFromSimple ? true : (existingRef?.enabled ?? true),
        overrides: {
          ...existingRef?.overrides,
          ...(existingRef?.overrides?.hidden ? { hidden: undefined } : {}),
          group: {
            ...existingRef?.overrides?.group,
            candidates: slotRefs,
          },
        },
      };
    };

    const buildProxySelectRef = (existingRef?: TemplateCardRef): TemplateCardRef => {
      if (!groupModeChanged && !slotsChanged && !complexityChanged && existingRef) {
        if (existingRef.overrides?.group?.candidates) {
          const filtered = filterExistingRegions(existingRef.overrides.group.candidates);
          return {
            ...existingRef,
            overrides: {
              ...existingRef.overrides,
              group: {
                ...existingRef.overrides.group,
                candidates: filtered,
              },
            },
          };
        }
        return existingRef;
      }
      const extraProRefs: PolicyRef[] =
        nextComplexity === 'pro'
          ? [{ kind: 'pool', poolId: STABILITY_FALLBACK_POOL.id }, ...regionRefs, ...traitPoolRefs]
          : [...regionRefs];
      const candidates: PolicyRef[] =
        nextGroupMode === 'select'
          ? dedupePolicyRefs([
              ...slotRefs,
              { kind: 'card', cardId: 'auto-select' },
              ...extraProRefs,
              { kind: 'builtin', id: 'DIRECT' },
            ])
          : dedupePolicyRefs([
              { kind: 'card', cardId: 'auto-select' },
              ...extraProRefs,
              ...slotRefs,
              { kind: 'builtin', id: 'DIRECT' },
            ]);
      return {
        cardId: 'proxy-select',
        enabled: true,
        overrides: {
          group: {
            type: 'select',
            candidates,
          },
        },
      };
    };

    // Preserve custom cards, custom scenario cards, disabled cards, and always-enabled cards
    const existingHubRefs = new Map<string, TemplateCardRef>();
    for (const ref of currentBody.cards) {
      if (ref.cardId === 'auto-select' || ref.cardId === 'proxy-select') {
        existingHubRefs.set(ref.cardId, ref);
      }
    }

    const needsHubs =
      existingHubRefs.size > 0 ||
      desiredScenarioCardIds.size > 0 ||
      nextRulesetRefs.length > 0 ||
      groupModeChanged ||
      slotsChanged ||
      complexityChanged;

    const hubCards: TemplateCardRef[] = [];
    if (needsHubs) {
      hubCards.push(buildAutoSelectRef(existingHubRefs.get('auto-select')));
      hubCards.push(buildProxySelectRef(existingHubRefs.get('proxy-select')));
    }

    // Remaining non-hub, non-managed-ruleset cards from currentBody in their original order
    const existingRest: TemplateCardRef[] = [];
    const placedCardIds = new Set<string>(hubCards.map((c) => c.cardId));
    for (const ref of nextRulesetRefs) placedCardIds.add(ref.cardId);

    for (const ref of currentBody.cards) {
      if (ref.cardId === 'auto-select' || ref.cardId === 'proxy-select') continue;
      if (existingManagedRulesetCardIds.has(ref.cardId)) continue;
      if (ref.cardId === 'direct-select') {
        const directCard = builtinCardMap.get('direct-select') ?? input.cardMap.get('direct-select');
        if (hasAdvancedCardOverrides(ref, directCard, currentComplexity)) {
          existingRest.push(ref);
          placedCardIds.add(ref.cardId);
        }
        continue;
      }

      // Custom scenario cards & custom cards & non-managed disabled cards: keep verbatim!
      if (
        customScenarioCardIds.has(ref.cardId) ||
        (!managedScenarioCardIds.has(ref.cardId) && !ALWAYS_ENABLED_SET.has(ref.cardId))
      ) {
        existingRest.push(ref);
        placedCardIds.add(ref.cardId);
        continue;
      }

      // Managed non-custom scenario cards
      if (managedScenarioCardIds.has(ref.cardId)) {
        if (!desiredScenarioCardIds.has(ref.cardId)) {
          continue;
        }
        existingRest.push(buildManagedScenarioRef(ref.cardId));
        placedCardIds.add(ref.cardId);
        continue;
      }

      // Always-enabled cards (gfw-proxy, proxy-ip, non-standard-ports, speedtest, final-fallback)
      const shouldRebuildAlwaysCard = groupModeChanged || complexityChanged || upgradingFromSimple;
      if (
        shouldRebuildAlwaysCard &&
        (ref.cardId === 'gfw-proxy' || ref.cardId === 'proxy-ip' || ref.cardId === 'final-fallback')
      ) {
        const baseCard = builtinCardMap.get(ref.cardId);
        const restoredRef = upgradingFromSimple ? stripSimpleOverrideFlags(ref, ref.cardId) : ref;
        if (baseCard && !hasAdvancedCardOverrides(restoredRef, baseCard, currentComplexity)) {
          const baseFiltered = filterExistingRegions(baseCard.group.candidates);
          const withStability =
            nextComplexity === 'pro'
              ? [{ kind: 'pool' as const, poolId: STABILITY_FALLBACK_POOL.id }, ...baseFiltered]
              : baseFiltered;
          const adjusted =
            nextGroupMode === 'auto'
              ? dedupePolicyRefs([{ kind: 'card', cardId: 'auto-select' }, ...withStability])
              : dedupePolicyRefs(withStability);
          const changed = JSON.stringify(adjusted) !== JSON.stringify(baseCard.group.candidates);
          existingRest.push(
            changed
              ? {
                  cardId: ref.cardId,
                  enabled: upgradingFromSimple ? true : ref.enabled,
                  overrides: { group: { candidates: adjusted } },
                }
              : { cardId: ref.cardId, enabled: upgradingFromSimple ? true : ref.enabled },
          );
          placedCardIds.add(ref.cardId);
          continue;
        }
      }

      existingRest.push(upgradingFromSimple ? stripSimpleOverrideFlags(ref, ref.cardId) : ref);
      placedCardIds.add(ref.cardId);
    }

    // Backfill newly enabled scenario cards & missing always-enabled infra cards when upgrading
    const canonicalOrderIndex = new Map<string, number>(CANONICAL_BUILTIN_CARD_ORDER.map((id, idx) => [id, idx]));
    const cardsToBackfill: TemplateCardRef[] = [];
    for (const cardId of CANONICAL_BUILTIN_CARD_ORDER) {
      if (cardId === 'auto-select' || cardId === 'proxy-select' || cardId === 'direct-select') continue;
      if (placedCardIds.has(cardId)) continue;
      if (desiredScenarioCardIds.has(cardId)) {
        cardsToBackfill.push(buildManagedScenarioRef(cardId));
        placedCardIds.add(cardId);
      } else if (upgradingFromSimple && ALWAYS_ENABLED_SET.has(cardId)) {
        cardsToBackfill.push(buildManagedScenarioRef(cardId));
        placedCardIds.add(cardId);
      }
    }

    const mergedRest = [...existingRest];
    for (const newRef of cardsToBackfill) {
      const newOrder = canonicalOrderIndex.get(newRef.cardId) ?? 999;
      let insertIdx = mergedRest.length;
      for (let i = 0; i < mergedRest.length; i += 1) {
        const existingOrder = canonicalOrderIndex.get(mergedRest[i].cardId);
        if (existingOrder !== undefined && existingOrder > newOrder) {
          insertIdx = i;
          break;
        }
      }
      mergedRest.splice(insertIdx, 0, newRef);
    }

    finalCards = [...hubCards, ...nextRulesetRefs, ...mergedRest];
    if (
      upgradingFromSimple ||
      (currentBody.final.kind === 'card' &&
        currentBody.final.cardId === 'proxy-select' &&
        placedCardIds.has('final-fallback'))
    ) {
      nextFinal = { kind: 'card', cardId: 'final-fallback' };
    }
  }

  let nextModules = currentBody.modules;
  if (complexityChanged && isDefaultModulesForBody(currentBody.modules, currentComplexity)) {
    nextModules = buildDefaultModulesForComplexity(nextComplexity);
  }

  let nextWizardMeta = currentBody.wizardMeta;
  if (nextWizardMeta) {
    const nextSubPreviews = input.patch.subscriptionPreviews ?? nextWizardMeta.subscriptionPreviews;
    const cleanedSubPreviews = nextSubPreviews
      ? Object.fromEntries(Object.entries(nextSubPreviews).filter(([slotId]) => nextSlotIdSet.has(slotId)))
      : undefined;
    nextWizardMeta = {
      ...nextWizardMeta,
      complexity: nextComplexity,
      groupMode: nextGroupMode,
      ...(nextCombineMode ? { combineMode: nextCombineMode } : {}),
      scenarios: nextScenarios,
      rulesets: nextRulesetInputs.map((rs) => ({ rulesetId: rs.rulesetId, route: rs.route })),
      ...(nextSlotIdSet.has('slot-main') && nextWizardMeta.previewSummary
        ? { previewSummary: nextWizardMeta.previewSummary }
        : { previewSummary: undefined }),
      ...(cleanedSubPreviews && Object.keys(cleanedSubPreviews).length > 0
        ? { subscriptionPreviews: cleanedSubPreviews }
        : { subscriptionPreviews: undefined }),
    };
  }

  const nextBody: TemplateBody = {
    ...currentBody,
    slots: nextSlots,
    regionGroups: nextRegionGroups,
    ...(nextPools !== undefined ? { pools: nextPools } : {}),
    complexity: nextComplexity,
    cards: finalCards,
    final: nextFinal,
    modules: nextModules,
    ...(nextCombineMode || combineModeChanged ? { combineMode: nextCombineMode } : {}),
    ...(nextWizardMeta ? { wizardMeta: nextWizardMeta } : {}),
  };

  return { body: nextBody, generatedCards };
}
