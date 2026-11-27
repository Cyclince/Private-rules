import type { AppCard, PolicyRef } from '../../shared/schemas/card';
import type {
  QuickCreateScenarioInput,
  WizardGroupMode,
  WizardRouteTarget,
  WizardScenarioId,
} from '../../shared/schemas/quick-create';
import type { RegionGroup, TemplateBody, TemplateCardRef } from '../../shared/schemas/template';
import { getRegionDefinition } from '../nodes/regions';
import {
  ALWAYS_ENABLED_CARD_IDS,
  buildRegionGroupForCode,
  buildRouteCandidates,
  CANONICAL_BUILTIN_CARD_ORDER,
  extractRegionCodeFromRoute,
  resolveWizardRegionGroups,
  WIZARD_SCENARIO_DEFINITIONS,
  WIZARD_SCENARIO_MAP,
  type QuickCreateResolvedRuleset,
} from './quick-create';

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
  scenarios: SimpleScenarioItem[];
  rulesets: SimpleRulesetItem[];
  customItems: SimpleCustomItem[];
  groupMode: WizardGroupMode;
  hasCustomizations: boolean;
  availableRegions: Array<{ code: string; name: string; emoji: string }>;
};

const ALWAYS_ENABLED_SET = new Set<string>(ALWAYS_ENABLED_CARD_IDS);
const SCENARIO_CARD_ID_SET = new Set<string>(WIZARD_SCENARIO_DEFINITIONS.flatMap((def) => def.cardIds));

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
            : `slot:${ref.slotId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

/**
 * Maps a primary `PolicyRef` candidate back to a simple-view `WizardRouteTarget`.
 * Returns `null` when the candidate cannot be represented in the simple UI.
 */
export function mapPolicyRefToWizardRoute(
  ref: PolicyRef | undefined,
  regionGroupById: ReadonlyMap<string, RegionGroup>,
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
    return null;
  }
  if (ref.kind === 'region') {
    const group = regionGroupById.get(ref.regionGroupId);
    if (group?.region) {
      return `region:${group.region.toUpperCase()}`;
    }
    const match = /^region-([a-z]{2,8})$/i.exec(ref.regionGroupId);
    if (match) {
      return `region:${match[1].toUpperCase()}`;
    }
    return null;
  }
  return null;
}

function hasAdvancedCardOverrides(ref: TemplateCardRef, card?: AppCard): boolean {
  const ov = ref.overrides;
  if (!ov) return false;
  if (ov.name && ov.name !== card?.name) return true;
  if (ov.icon && ov.icon !== card?.icon) return true;
  if (ov.stage && ov.stage !== card?.stage) return true;
  if (ov.matchers && ov.matchers.length > 0) return true;
  if (ov.group?.type && ov.group.type !== (card?.group.type ?? 'select')) return true;
  if (ov.group?.test) return true;
  return false;
}

function isSimpleSingleRulesetCard(card: AppCard | undefined): string | null {
  if (!card) return null;
  if (ALWAYS_ENABLED_SET.has(card.id) || SCENARIO_CARD_ID_SET.has(card.id)) return null;
  if (card.matchers.length !== 1) return null;
  const matcher = card.matchers[0];
  if (matcher.kind !== 'ruleset') return null;
  if (card.group.type !== 'select' || card.group.test) return null;
  return matcher.ruleSetId;
}

function deriveGroupMode(body: TemplateBody, cardMap: ReadonlyMap<string, AppCard>): WizardGroupMode {
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

  // Collect region IDs explicitly targeted by non-hub cards
  const explicitlyTargetedRegions = new Set<string>();
  for (const ref of body.cards) {
    if (!ref.enabled || ALWAYS_ENABLED_SET.has(ref.cardId)) continue;
    const card = cardMap.get(ref.cardId);
    const primary = ref.overrides?.group?.candidates?.[0] ?? card?.group.candidates[0];
    if (primary?.kind === 'region') {
      explicitlyTargetedRegions.add(primary.regionGroupId);
    }
  }
  const hasUnreferencedRegionGroups = body.regionGroups.some((rg) => !explicitlyTargetedRegions.has(rg.id));

  if (body.wizardMeta?.groupMode) {
    if (body.wizardMeta.groupMode === 'region' && body.regionGroups.length > 0) return 'region';
    if (body.wizardMeta.groupMode === 'auto' && !hasUnreferencedRegionGroups) return 'auto';
    if (body.wizardMeta.groupMode === 'select') return 'select';
  }

  if (fallbackPrimary?.kind === 'card' && fallbackPrimary.cardId === 'auto-select' && !hasUnreferencedRegionGroups) {
    return 'auto';
  }
  if (body.regionGroups.length > 0) {
    return 'region';
  }
  return 'auto';
}

function hasTemplateLevelAdvancedCustomizations(body: TemplateBody): boolean {
  if (body.slots.length > 1 || (body.slots.length === 1 && body.slots[0].id !== 'slot-main')) {
    return true;
  }
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
  const nonDefaultModule = body.modules.some((m) => (m.id === 'ip-no-resolve' ? !m.enabled : m.enabled));
  if (nonDefaultModule) {
    return true;
  }
  if (body.regionGroups.some((rg) => Boolean(rg.extraInclude || rg.extraExclude))) {
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
  const regionGroupById = new Map<string, RegionGroup>(body.regionGroups.map((rg) => [rg.id, rg]));
  const refByCardId = new Map<string, TemplateCardRef>();
  for (const ref of body.cards) {
    refByCardId.set(ref.cardId, ref);
  }

  const groupMode = deriveGroupMode(body, cardMap);
  const scenarios: SimpleScenarioItem[] = [];
  const handledCardIds = new Set<string>(ALWAYS_ENABLED_CARD_IDS);

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
      if (hasAdvancedCardOverrides(ref, card)) {
        advancedOverrideFound = true;
      }
      const primary = ref.overrides?.group?.candidates?.[0] ?? card?.group.candidates[0];
      mappedRoutes.push(mapPolicyRefToWizardRoute(primary, regionGroupById));
    }

    const firstValidRoute = mappedRoutes.find((r): r is WizardRouteTarget => r !== null) ?? def.defaultRoute;
    const isComplete = enabledRefs.length === def.cardIds.length;
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
    if (rulesetId && !hasAdvancedCardOverrides(ref, card) && !seenRulesetIds.has(rulesetId)) {
      const primary = ref.overrides?.group?.candidates?.[0] ?? card?.group.candidates[0];
      const mappedRoute = mapPolicyRefToWizardRoute(primary, regionGroupById);
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

  // 3. Collect available regions from template's regionGroups
  const availableRegions: Array<{ code: string; name: string; emoji: string }> = [];
  const seenRegions = new Set<string>();
  for (const rg of body.regionGroups) {
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
    customItems.length > 0 || scenarios.some((sc) => sc.custom) || hasTemplateLevelAdvancedCustomizations(body);

  return {
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
    scenarios?: readonly QuickCreateScenarioInput[];
    rulesets?: readonly QuickCreateResolvedRuleset[];
    groupMode?: WizardGroupMode;
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
  }
  return ids;
}

/**
 * Pure domain updater for `PATCH /api/templates/:id/simple` (B3).
 * Only modifies simple-view editable concepts (non-custom scenarios, clean "My Rules"
 * ruleset items & ordering, and node `groupMode`). Every `custom` scenario, custom card,
 * disabled card, custom override, DNS/general/module/clientPatch/extra-slot setting is
 * preserved verbatim without overwriting.
 */
export function applySimpleTemplatePatch(input: ApplySimpleTemplatePatchInput): ApplySimpleTemplatePatchResult {
  const currentBody = structuredClone(input.currentBody);
  const builtinCardMap = new Map<string, AppCard>(input.builtinCards.map((c) => [c.id, c]));
  const currentSimple = mapTemplateToSimpleRouting(currentBody, input.cardMap, input.rulesetMap);

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

  // Merge non-custom scenarios (strictly ignore any patch targeting a custom scenario)
  const patchScenarioMap = new Map<WizardScenarioId, QuickCreateScenarioInput>();
  if (input.patch.scenarios) {
    for (const item of input.patch.scenarios) {
      if (!customScenarioIds.has(item.id)) {
        patchScenarioMap.set(item.id, item);
      }
    }
  }

  const nextScenarios: QuickCreateScenarioInput[] = currentSimple.scenarios.map((current) => {
    if (current.custom) {
      return {
        id: current.id,
        enabled: current.enabled,
        ...(current.configurableRoute ? { route: current.route } : {}),
      };
    }
    const patched = patchScenarioMap.get(current.id);
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
  for (const sc of nextScenarios) {
    if (!sc.enabled || customScenarioIds.has(sc.id)) continue;
    const code = extractRegionCodeFromRoute(sc.route);
    if (code) requiredRegionCodes.push(code);
  }
  for (const rs of nextRulesetInputs) {
    const code = extractRegionCodeFromRoute(rs.route);
    if (code) requiredRegionCodes.push(code);
  }

  // Collect region group IDs referenced by preserved/custom cards so we never drop them
  const preservedRegionGroupIds = new Set<string>();
  for (const ref of currentBody.cards) {
    const isManagedScenario = managedScenarioCardIds.has(ref.cardId);
    const isManagedRuleset = existingManagedRulesetCardIds.has(ref.cardId);
    if (isManagedScenario || isManagedRuleset || ALWAYS_ENABLED_SET.has(ref.cardId)) continue;
    const card = input.cardMap.get(ref.cardId);
    for (const rgId of collectRegionGroupIdsReferencedByCard(ref, card)) {
      preservedRegionGroupIds.add(rgId);
    }
  }
  for (const rg of currentBody.regionGroups) {
    if (rg.extraInclude || rg.extraExclude) {
      preservedRegionGroupIds.add(rg.id);
    }
  }

  // Resolve next regionGroups
  let nextRegionGroups: RegionGroup[];
  if (groupModeChanged) {
    const baseGroups = resolveWizardRegionGroups({
      groupMode: nextGroupMode,
      hasSubscription: input.hasSubscription,
      detectedRegions: input.detectedRegions,
      requiredRegionCodes,
    });
    const byId = new Map<string, RegionGroup>(baseGroups.map((g) => [g.id, g]));
    // Keep any preserved custom region groups
    for (const existing of currentBody.regionGroups) {
      if (preservedRegionGroupIds.has(existing.id) && !byId.has(existing.id)) {
        byId.set(existing.id, existing);
      }
    }
    nextRegionGroups = [...byId.values()];
  } else {
    nextRegionGroups = [...currentBody.regionGroups];
    const existingIds = new Set(nextRegionGroups.map((g) => g.id));
    for (const code of requiredRegionCodes) {
      const built = buildRegionGroupForCode(code);
      if (built && !existingIds.has(built.id)) {
        existingIds.add(built.id);
        nextRegionGroups.push(built);
      }
    }
  }

  const availableRegionGroupIds = nextRegionGroups.map((g) => g.id);
  const availableRegionSet = new Set(availableRegionGroupIds);
  const regionRefs: PolicyRef[] = availableRegionGroupIds.map((regionGroupId) => ({
    kind: 'region',
    regionGroupId,
  }));
  const filterExistingRegions = (candidates: readonly PolicyRef[]): PolicyRef[] =>
    candidates.filter((ref) => ref.kind !== 'region' || availableRegionSet.has(ref.regionGroupId));

  // Build next ruleset card refs & any newly generated cards
  const generatedCards: AppCard[] = [];
  const nextRulesetRefs: TemplateCardRef[] = [];

  for (const rs of nextRulesetInputs) {
    const candidates = buildRouteCandidates(rs.route, {
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

  // Determine desired enabled non-custom scenario cards & route overrides
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
      return matchesBase ? { cardId, enabled: true } : { cardId, enabled: true, overrides: { group: { candidates } } };
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

  const buildProxySelectRef = (existingRef?: TemplateCardRef): TemplateCardRef => {
    if (!groupModeChanged && existingRef) {
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
    const candidates: PolicyRef[] =
      nextGroupMode === 'select'
        ? dedupePolicyRefs([
            { kind: 'slot', slotId: 'slot-main' },
            { kind: 'card', cardId: 'auto-select' },
            ...regionRefs,
            { kind: 'builtin', id: 'DIRECT' },
          ])
        : dedupePolicyRefs([
            { kind: 'card', cardId: 'auto-select' },
            ...regionRefs,
            { kind: 'slot', slotId: 'slot-main' },
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
    existingHubRefs.size > 0 || desiredScenarioCardIds.size > 0 || nextRulesetRefs.length > 0 || groupModeChanged;

  const hubCards: TemplateCardRef[] = [];
  if (needsHubs) {
    hubCards.push(existingHubRefs.get('auto-select') ?? { cardId: 'auto-select', enabled: true });
    hubCards.push(buildProxySelectRef(existingHubRefs.get('proxy-select')));
  }

  // Remaining non-hub, non-managed-ruleset cards from currentBody in their original order
  const existingRest: TemplateCardRef[] = [];
  const placedCardIds = new Set<string>(hubCards.map((c) => c.cardId));
  for (const ref of nextRulesetRefs) placedCardIds.add(ref.cardId);

  for (const ref of currentBody.cards) {
    if (ref.cardId === 'auto-select' || ref.cardId === 'proxy-select') continue;
    if (existingManagedRulesetCardIds.has(ref.cardId)) continue;

    // Custom scenario cards & custom cards & disabled cards: keep verbatim!
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
        // User turned this scenario off -> remove it
        continue;
      }
      existingRest.push(buildManagedScenarioRef(ref.cardId));
      placedCardIds.add(ref.cardId);
      continue;
    }

    // Always-enabled cards (gfw-proxy, proxy-ip, non-standard-ports, speedtest, final-fallback)
    if (
      groupModeChanged &&
      (ref.cardId === 'gfw-proxy' || ref.cardId === 'proxy-ip' || ref.cardId === 'final-fallback')
    ) {
      const baseCard = builtinCardMap.get(ref.cardId);
      if (baseCard && !hasAdvancedCardOverrides(ref, baseCard)) {
        const baseFiltered = filterExistingRegions(baseCard.group.candidates);
        const adjusted =
          nextGroupMode === 'auto'
            ? dedupePolicyRefs([{ kind: 'card', cardId: 'auto-select' }, ...baseFiltered])
            : dedupePolicyRefs(baseFiltered);
        const changed = JSON.stringify(adjusted) !== JSON.stringify(baseCard.group.candidates);
        existingRest.push(
          changed
            ? { cardId: ref.cardId, enabled: ref.enabled, overrides: { group: { candidates: adjusted } } }
            : { cardId: ref.cardId, enabled: ref.enabled },
        );
        placedCardIds.add(ref.cardId);
        continue;
      }
    }

    existingRest.push(ref);
    placedCardIds.add(ref.cardId);
  }

  // Insert any newly enabled scenario cards that were not previously in currentBody.cards
  // at their canonical 7-layer position relative to existing cards
  const canonicalOrderIndex = new Map<string, number>(CANONICAL_BUILTIN_CARD_ORDER.map((id, idx) => [id, idx]));
  const newlyEnabledCards: TemplateCardRef[] = [];
  for (const cardId of CANONICAL_BUILTIN_CARD_ORDER) {
    if (!desiredScenarioCardIds.has(cardId) || placedCardIds.has(cardId)) continue;
    newlyEnabledCards.push(buildManagedScenarioRef(cardId));
    placedCardIds.add(cardId);
  }

  const mergedRest = [...existingRest];
  for (const newRef of newlyEnabledCards) {
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

  const finalCards: TemplateCardRef[] = [...hubCards, ...nextRulesetRefs, ...mergedRest];

  const nextBody: TemplateBody = {
    ...currentBody,
    regionGroups: nextRegionGroups,
    cards: finalCards,
    ...(currentBody.wizardMeta
      ? {
          wizardMeta: {
            ...currentBody.wizardMeta,
            groupMode: nextGroupMode,
            scenarios: nextScenarios,
            rulesets: nextRulesetInputs.map((rs) => ({ rulesetId: rs.rulesetId, route: rs.route })),
          },
        }
      : {}),
  };

  return { body: nextBody, generatedCards };
}
