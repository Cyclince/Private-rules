import type {
  AppCard,
  AppCardGroup,
  AppCardOverride,
  CatalogCategory,
  Condition,
  GroupHealthCheck,
  GroupType,
  Matcher,
  NodeFilter,
  PolicyRef,
  Stage,
} from '../../shared/schemas/card';
import type {
  DnsProfile,
  GeneralSettings,
  NodeSlot,
  RegionGroup,
  TemplateBody,
  TemplateCardRef,
  TemplateGroupMode,
  TemplateModuleBinding,
  TemplateOverlayOp,
  TemplateRecord,
} from '../../shared/schemas/template';

export type {
  AppCard,
  AppCardGroup,
  AppCardOverride,
  CatalogCategory,
  Condition,
  DnsProfile,
  GeneralSettings,
  GroupHealthCheck,
  GroupType,
  Matcher,
  NodeFilter,
  NodeSlot,
  PolicyRef,
  RegionGroup,
  Stage,
  TemplateBody,
  TemplateCardRef,
  TemplateGroupMode,
  TemplateModuleBinding,
  TemplateOverlayOp,
  TemplateRecord,
};

export const DEFAULT_HEALTH_CHECK: Readonly<GroupHealthCheck> = {
  url: 'https://cp.cloudflare.com/generate_204',
  intervalSec: 300,
  toleranceMs: 50,
};

export type CardLookup = ReadonlyMap<string, AppCard> | Readonly<Record<string, AppCard>> | readonly AppCard[];

export function toCardMap(cards: CardLookup): Map<string, AppCard> {
  if (cards instanceof Map) {
    return new Map(cards);
  }
  if (Array.isArray(cards)) {
    return new Map(cards.map((card) => [card.id, card]));
  }
  return new Map(Object.entries(cards));
}

export type ResolvedTemplateCard = {
  cardId: string;
  enabled: boolean;
  effective: AppCard;
  effectiveGroupType: GroupType;
  hasOverrides: boolean;
};

export type ResolvedTemplate = {
  body: TemplateBody;
  cards: ResolvedTemplateCard[];
  missingCardIds: string[];
};

const BUSINESS_FALLBACK_STAGES = new Set<Stage>(['app', 'proxy-fallback', 'ip']);

/**
 * Determines whether a card is a business routing group eligible for the
 * template-level `groupMode` (`select` / `fallback`) toggle (design §10.4).
 * Terminal/direct-only groups (e.g. ad-block, LAN direct, domestic direct) stay
 * `select` so health checks never run against REJECT / DIRECT-first groups.
 */
export function isBusinessGroupForModeToggle(card: AppCard): boolean {
  if (card.hidden) return false;
  if (!BUSINESS_FALLBACK_STAGES.has(card.stage)) return false;
  if (card.group.type !== 'select') return false;
  const firstCandidate = card.group.candidates[0];
  if (firstCandidate?.kind === 'builtin') return false;
  return true;
}

/** Applies card overrides and template-level `groupMode` to produce the effective card. */
export function resolveCardForTemplate(
  baseCard: AppCard,
  ref: TemplateCardRef,
  body: Pick<TemplateBody, 'groupMode' | 'general'>,
): ResolvedTemplateCard {
  const overrides = ref.overrides;
  const mergedGroup: AppCardGroup = {
    type: overrides?.group?.type ?? baseCard.group.type,
    candidates: overrides?.group?.candidates
      ? structuredClone(overrides.group.candidates)
      : structuredClone(baseCard.group.candidates),
    ...((overrides?.group?.test ?? baseCard.group.test)
      ? { test: structuredClone(overrides?.group?.test ?? baseCard.group.test) }
      : {}),
  };

  const mergedCard: AppCard = {
    ...baseCard,
    name: overrides?.name ?? baseCard.name,
    icon: overrides?.icon !== undefined ? overrides.icon : baseCard.icon,
    stage: overrides?.stage ?? baseCard.stage,
    group: mergedGroup,
    matchers: overrides?.matchers ? structuredClone(overrides.matchers) : structuredClone(baseCard.matchers),
    hidden: overrides?.hidden ?? baseCard.hidden,
  };

  let effectiveGroupType: GroupType = mergedCard.group.type;
  if (body.groupMode === 'fallback' && !overrides?.group?.type && isBusinessGroupForModeToggle(mergedCard)) {
    effectiveGroupType = 'fallback';
    mergedCard.group = {
      ...mergedCard.group,
      type: 'fallback',
      test: mergedCard.group.test ?? {
        url: body.general?.testUrl ?? DEFAULT_HEALTH_CHECK.url,
        intervalSec: body.general?.testIntervalSec ?? DEFAULT_HEALTH_CHECK.intervalSec,
      },
    };
  }

  return {
    cardId: ref.cardId,
    enabled: ref.enabled,
    effective: mergedCard,
    effectiveGroupType,
    hasOverrides: Boolean(overrides && Object.keys(overrides).length > 0),
  };
}

/** Resolves all card references in a template body against a card registry. */
export function resolveTemplateCards(body: TemplateBody, cards: CardLookup): ResolvedTemplate {
  const cardMap = toCardMap(cards);
  const resolvedCards: ResolvedTemplateCard[] = [];
  const missingCardIds: string[] = [];

  for (const ref of body.cards) {
    const baseCard = cardMap.get(ref.cardId);
    if (!baseCard) {
      missingCardIds.push(ref.cardId);
      continue;
    }
    resolvedCards.push(resolveCardForTemplate(baseCard, ref, body));
  }

  return {
    body,
    cards: resolvedCards,
    missingCardIds,
  };
}

export type ReferenceIssueKind =
  | 'MISSING_CARD_IN_TEMPLATE'
  | 'MISSING_CARD_REF'
  | 'MISSING_REGION_GROUP_REF'
  | 'MISSING_SLOT_REF'
  | 'DISABLED_CARD_REF';

export type ReferenceIssue = {
  kind: ReferenceIssueKind;
  sourceId: string;
  targetId: string;
  message: string;
};

export type TemplateGraphValidation = {
  ok: boolean;
  /** Canonical cycle paths, e.g. `['card-a', 'card-b', 'card-a']`. */
  cycles: string[][];
  missingRefs: ReferenceIssue[];
  disabledRefs: ReferenceIssue[];
  duplicateIds: {
    cards: string[];
    regionGroups: string[];
    slots: string[];
  };
};

function findDuplicateStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

/**
 * Validates group reference integrity and acyclicity across a template's cards,
 * region groups, node slots, and `final` policy (design §10.7, §10.11).
 */
export function validateTemplateGraph(body: TemplateBody, cards: CardLookup): TemplateGraphValidation {
  const cardMap = toCardMap(cards);
  const slotIds = new Set(body.slots.map((slot) => slot.id));
  const regionGroupIds = new Set(body.regionGroups.map((group) => group.id));
  const templateCardById = new Map<string, TemplateCardRef>();
  for (const ref of body.cards) {
    templateCardById.set(ref.cardId, ref);
  }

  const duplicateIds = {
    cards: findDuplicateStrings(body.cards.map((ref) => ref.cardId)),
    regionGroups: findDuplicateStrings(body.regionGroups.map((group) => group.id)),
    slots: findDuplicateStrings(body.slots.map((slot) => slot.id)),
  };

  const missingRefs: ReferenceIssue[] = [];
  const disabledRefs: ReferenceIssue[] = [];
  const adjacency = new Map<string, string[]>();

  // Check region group slot references
  for (const regionGroup of body.regionGroups) {
    if (regionGroup.slotId && !slotIds.has(regionGroup.slotId)) {
      missingRefs.push({
        kind: 'MISSING_SLOT_REF',
        sourceId: regionGroup.id,
        targetId: regionGroup.slotId,
        message: `地区组 ${regionGroup.id} 引用了不存在的节点槽位 ${regionGroup.slotId}。`,
      });
    }
  }

  const checkPolicyRef = (sourceId: string, policy: PolicyRef, recordEdge: boolean) => {
    if (policy.kind === 'builtin') return;
    if (policy.kind === 'slot') {
      if (!slotIds.has(policy.slotId)) {
        missingRefs.push({
          kind: 'MISSING_SLOT_REF',
          sourceId,
          targetId: policy.slotId,
          message: `组 ${sourceId} 引用了不存在的节点槽位 ${policy.slotId}。`,
        });
      }
      return;
    }
    if (policy.kind === 'region') {
      if (!regionGroupIds.has(policy.regionGroupId)) {
        missingRefs.push({
          kind: 'MISSING_REGION_GROUP_REF',
          sourceId,
          targetId: policy.regionGroupId,
          message: `组 ${sourceId} 引用了不存在的地区组 ${policy.regionGroupId}。`,
        });
      }
      return;
    }

    // policy.kind === 'card'
    const targetRef = templateCardById.get(policy.cardId);
    if (!targetRef || !cardMap.has(policy.cardId)) {
      missingRefs.push({
        kind: 'MISSING_CARD_REF',
        sourceId,
        targetId: policy.cardId,
        message: `组 ${sourceId} 引用了模板中不存在的组件 ${policy.cardId}。`,
      });
      return;
    }
    if (!targetRef.enabled) {
      disabledRefs.push({
        kind: 'DISABLED_CARD_REF',
        sourceId,
        targetId: policy.cardId,
        message: `组 ${sourceId} 引用了已禁用的组件 ${policy.cardId}。`,
      });
    }
    if (recordEdge) {
      const edges = adjacency.get(sourceId) ?? [];
      edges.push(policy.cardId);
      adjacency.set(sourceId, edges);
    }
  };

  for (const ref of body.cards) {
    const baseCard = cardMap.get(ref.cardId);
    if (!baseCard) {
      missingRefs.push({
        kind: 'MISSING_CARD_IN_TEMPLATE',
        sourceId: 'template',
        targetId: ref.cardId,
        message: `模板引用的组件 ${ref.cardId} 不存在。`,
      });
      continue;
    }
    if (!ref.enabled) continue;

    const resolved = resolveCardForTemplate(baseCard, ref, body);
    if (!adjacency.has(ref.cardId)) {
      adjacency.set(ref.cardId, []);
    }
    for (const candidate of resolved.effective.group.candidates) {
      checkPolicyRef(ref.cardId, candidate, true);
    }
  }

  checkPolicyRef('final', body.final, false);

  // Detect cycles via three-color DFS (0 = unvisited, 1 = visiting, 2 = visited)
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seenCycleSignatures = new Set<string>();

  const dfs = (node: string) => {
    color.set(node, 1);
    stack.push(node);

    for (const next of adjacency.get(node) ?? []) {
      const state = color.get(next) ?? 0;
      if (state === 1) {
        const startIdx = stack.indexOf(next);
        if (startIdx >= 0) {
          const cycle = [...stack.slice(startIdx), next];
          const core = cycle.slice(0, -1);
          const minNode = [...core].sort()[0];
          const minIdx = core.indexOf(minNode);
          const canonical = [...core.slice(minIdx), ...core.slice(0, minIdx), minNode];
          const signature = canonical.join('->');
          if (!seenCycleSignatures.has(signature)) {
            seenCycleSignatures.add(signature);
            cycles.push(canonical);
          }
        }
      } else if (state === 0 && adjacency.has(next)) {
        dfs(next);
      }
    }

    stack.pop();
    color.set(node, 2);
  };

  for (const node of adjacency.keys()) {
    if ((color.get(node) ?? 0) === 0) {
      dfs(node);
    }
  }

  const ok =
    cycles.length === 0 &&
    missingRefs.length === 0 &&
    disabledRefs.length === 0 &&
    duplicateIds.cards.length === 0 &&
    duplicateIds.regionGroups.length === 0 &&
    duplicateIds.slots.length === 0;

  return {
    ok,
    cycles,
    missingRefs,
    disabledRefs,
    duplicateIds,
  };
}
