import { toCardMap, type CardLookup } from '../../../domain/templates/model';
import { validateModuleCombination } from '../../../domain/templates/modules';
import type { ConflictResolution, OverlayConflict } from '../../../domain/templates/overlay';
import { applyOverlay } from '../../../domain/templates/overlay';
import { getStageOrder, sortCardsByStage } from '../../../domain/templates/stages';
import type { AppCard, PolicyRef } from '../../../shared/schemas/card';
import type {
  TemplateBody,
  TemplateCardRef,
  TemplateModuleBinding,
  TemplateOverlay,
  TemplateOverlayOp,
} from '../../../shared/schemas/template';

/**
 * Reorders `cards` by moving `activeCardId` to the position of `overCardId`
 * and synthesizes the minimal anchor-based `moveCard` overlay op so future
 * upstream rebases remain resilient.
 */
export function buildMoveCardOp(
  cards: readonly TemplateCardRef[],
  activeCardId: string,
  overCardId: string,
): { nextCards: TemplateCardRef[]; op: TemplateOverlayOp } | null {
  if (activeCardId === overCardId) return null;
  const fromIndex = cards.findIndex((c) => c.cardId === activeCardId);
  const toIndex = cards.findIndex((c) => c.cardId === overCardId);
  if (fromIndex === -1 || toIndex === -1) return null;

  const nextCards = [...cards];
  const [moved] = nextCards.splice(fromIndex, 1);
  nextCards.splice(toIndex, 0, moved);

  const prev = toIndex > 0 ? nextCards[toIndex - 1] : undefined;
  const next = toIndex < nextCards.length - 1 ? nextCards[toIndex + 1] : undefined;
  const op: TemplateOverlayOp = prev
    ? { op: 'moveCard', cardId: activeCardId, afterCardId: prev.cardId }
    : next
      ? { op: 'moveCard', cardId: activeCardId, beforeCardId: next.cardId }
      : { op: 'moveCard', cardId: activeCardId, toIndex };

  return { nextCards, op };
}

/**
 * Builds an `addCard` overlay op anchored at the deterministic stage insertion
 * index (skipping hidden routing-hub groups that emit no rules) so newly added
 * cards automatically land cleanly in their 7-layer stage.
 */
export function buildAddCardOp(
  cards: readonly TemplateCardRef[],
  cardLookup: CardLookup,
  card: AppCard,
): TemplateOverlayOp {
  const lookupMap = toCardMap(cardLookup);
  const targetOrder = getStageOrder(card.stage);
  let insertIdx = cards.length;
  for (let i = 0; i < cards.length; i += 1) {
    const existing = lookupMap.get(cards[i].cardId);
    if (existing?.hidden) continue;
    const effectiveStage = cards[i].overrides?.stage ?? existing?.stage;
    if (effectiveStage && getStageOrder(effectiveStage) > targetOrder) {
      insertIdx = i;
      break;
    }
  }
  const before = cards[insertIdx];
  const after = insertIdx > 0 ? cards[insertIdx - 1] : undefined;
  if (before) {
    return { op: 'addCard', cardId: card.id, enabled: true, beforeCardId: before.cardId };
  }
  if (after) {
    return { op: 'addCard', cardId: card.id, enabled: true, afterCardId: after.cardId };
  }
  return { op: 'addCard', cardId: card.id, enabled: true };
}

/**
 * Builds a sequence of `moveCard` ops that re-aligns cards back into canonical
 * 7-layer stage order without dropping overrides.
 */
export function buildSortByStageOps(cards: readonly TemplateCardRef[], cardLookup: CardLookup): TemplateOverlayOp[] {
  const sorted = sortCardsByStage(cards, cardLookup);
  const same = sorted.every((item, idx) => item.cardId === cards[idx]?.cardId);
  if (same) return [];

  const ops: TemplateOverlayOp[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (i === 0) {
      ops.push({ op: 'moveCard', cardId: current.cardId, toIndex: 0 });
    } else {
      ops.push({ op: 'moveCard', cardId: current.cardId, afterCardId: sorted[i - 1].cardId });
    }
  }
  return ops;
}

/**
 * Appends an overlay operation while compacting redundant tail scalar ops
 * (e.g. repeated `setGroupMode`, `setOutput`, `setFinal`, `setDns`, `setModule`,
 * `setPatch` on the same target) to keep `overlay` concise and readable.
 */
export function appendOverlayOp(overlay: TemplateOverlay, op: TemplateOverlayOp): TemplateOverlay {
  const next = [...overlay];
  const replaceSingleton = (predicate: (existing: TemplateOverlayOp) => boolean) => {
    const idx = next.findIndex(predicate);
    if (idx !== -1) next.splice(idx, 1);
    next.push(op);
    return next;
  };

  switch (op.op) {
    case 'setGroupMode':
      return replaceSingleton((item) => item.op === 'setGroupMode');
    case 'setOutput':
      return replaceSingleton((item) => item.op === 'setOutput');
    case 'setFinal':
      return replaceSingleton((item) => item.op === 'setFinal');
    case 'setDns':
      return replaceSingleton((item) => item.op === 'setDns');
    case 'setGeneral':
      return replaceSingleton((item) => item.op === 'setGeneral');
    case 'setModule':
      return replaceSingleton((item) => item.op === 'setModule' && item.moduleId === op.moduleId);
    case 'setPatch':
      return replaceSingleton((item) => item.op === 'setPatch' && item.client === op.client);
    case 'setCardEnabled':
      return replaceSingleton((item) => item.op === 'setCardEnabled' && item.cardId === op.cardId);
    default:
      next.push(op);
      return next;
  }
}

export function resolveDraftBody(baseBody: TemplateBody, overlay: TemplateOverlay): TemplateBody {
  return applyOverlay(baseBody, overlay).resolved;
}

export type ModuleToggleCheck = {
  allowed: boolean;
  reason?: string;
  conflictWith?: string;
};

/**
 * Checks whether toggling `moduleId` to `nextEnabled` would create a module
 * conflict (design §10.12) using the pure domain validator.
 */
export function checkModuleToggleConflict(
  currentModules: readonly TemplateModuleBinding[],
  moduleId: string,
  nextEnabled: boolean,
): ModuleToggleCheck {
  if (!nextEnabled) return { allowed: true };
  const exists = currentModules.some((m) => m.id === moduleId);
  const candidate: TemplateModuleBinding[] = exists
    ? currentModules.map((m) => (m.id === moduleId ? { ...m, enabled: true } : m))
    : [...currentModules, { id: moduleId, enabled: true }];

  const result = validateModuleCombination(candidate);
  if (result.ok) return { allowed: true };
  const firstConflict = result.conflicts[0];
  if (firstConflict) {
    return {
      allowed: false,
      reason: firstConflict.reason,
      conflictWith: firstConflict.moduleA === moduleId ? firstConflict.moduleB : firstConflict.moduleA,
    };
  }
  return {
    allowed: false,
    reason: result.errors[0]?.message ?? 'Module combination is invalid.',
  };
}

export type VersionDiffLine = {
  kind: 'same' | 'added' | 'removed';
  text: string;
};

export type TemplateVersionDiff = {
  addedCards: string[];
  removedCards: string[];
  reorderedCards: boolean;
  modifiedCards: string[];
  addedRegionGroups: string[];
  removedRegionGroups: string[];
  addedSlots: string[];
  removedSlots: string[];
  groupModeChanged: boolean;
  outputChanged: boolean;
  finalChanged: boolean;
  dnsChanged: boolean;
  modulesChanged: boolean;
  patchesChanged: boolean;
  lines: VersionDiffLine[];
};

function formatPolicyShort(ref: PolicyRef): string {
  if (ref.kind === 'builtin') return ref.id;
  if (ref.kind === 'card') return `card:${ref.cardId}`;
  if (ref.kind === 'region') return `region:${ref.regionGroupId}`;
  return `slot:${ref.slotId}`;
}

function summarizeBodyLines(body: TemplateBody): string[] {
  const lines: string[] = [
    `groupMode: ${body.groupMode}`,
    `output: ${body.output}`,
    `final: ${formatPolicyShort(body.final)}`,
    `dns.mode: ${body.dns.mode}`,
    `slots (${body.slots.length}): ${body.slots.map((s) => s.id).join(', ') || '-'}`,
    `regionGroups (${body.regionGroups.length}): ${body.regionGroups.map((r) => `${r.id}(${r.region}:${r.type})`).join(', ') || '-'}`,
    `modules: ${
      body.modules
        .filter((m) => m.enabled)
        .map((m) => m.id)
        .join(', ') || '-'
    }`,
  ];
  body.cards.forEach((card, index) => {
    const flags = [card.enabled ? 'on' : 'off'];
    if (card.overrides?.stage) flags.push(`stage=${card.overrides.stage}`);
    if (card.overrides?.group?.candidates?.[0]) {
      flags.push(`route=${formatPolicyShort(card.overrides.group.candidates[0])}`);
    }
    lines.push(`card[${index + 1}]: ${card.cardId} (${flags.join(', ')})`);
  });
  const patches = Object.entries(body.clientPatches ?? {}).filter(([, val]) => Boolean(val?.trim()));
  for (const [client, content] of patches) {
    lines.push(`patch[${client}]: ${content?.split('\n').length ?? 0} lines`);
  }
  return lines;
}

/** Computes a structured + line-level comparison between two template version snapshots. */
export function diffTemplateBodies(before: TemplateBody, after: TemplateBody): TemplateVersionDiff {
  const beforeCardIds = before.cards.map((c) => c.cardId);
  const afterCardIds = after.cards.map((c) => c.cardId);
  const beforeCardMap = new Map(before.cards.map((c) => [c.cardId, c]));
  const afterCardMap = new Map(after.cards.map((c) => [c.cardId, c]));

  const addedCards = afterCardIds.filter((id) => !beforeCardMap.has(id));
  const removedCards = beforeCardIds.filter((id) => !afterCardMap.has(id));
  const commonBefore = beforeCardIds.filter((id) => afterCardMap.has(id));
  const commonAfter = afterCardIds.filter((id) => beforeCardMap.has(id));
  const reorderedCards = commonBefore.some((id, idx) => commonAfter[idx] !== id);
  const modifiedCards = commonAfter.filter(
    (id) => JSON.stringify(beforeCardMap.get(id)) !== JSON.stringify(afterCardMap.get(id)),
  );

  const beforeRegionIds = new Set(before.regionGroups.map((r) => r.id));
  const afterRegionIds = new Set(after.regionGroups.map((r) => r.id));
  const addedRegionGroups = after.regionGroups.filter((r) => !beforeRegionIds.has(r.id)).map((r) => r.id);
  const removedRegionGroups = before.regionGroups.filter((r) => !afterRegionIds.has(r.id)).map((r) => r.id);

  const beforeSlotIds = new Set(before.slots.map((s) => s.id));
  const afterSlotIds = new Set(after.slots.map((s) => s.id));
  const addedSlots = after.slots.filter((s) => !beforeSlotIds.has(s.id)).map((s) => s.id);
  const removedSlots = before.slots.filter((s) => !afterSlotIds.has(s.id)).map((s) => s.id);

  const beforeLines = summarizeBodyLines(before);
  const afterLines = summarizeBodyLines(after);
  const afterSet = new Set(afterLines);
  const beforeSet = new Set(beforeLines);
  const lines: VersionDiffLine[] = [];

  for (const line of beforeLines) {
    if (!afterSet.has(line)) {
      lines.push({ kind: 'removed', text: line });
    } else {
      lines.push({ kind: 'same', text: line });
    }
  }
  for (const line of afterLines) {
    if (!beforeSet.has(line)) {
      lines.push({ kind: 'added', text: line });
    }
  }

  return {
    addedCards,
    removedCards,
    reorderedCards,
    modifiedCards,
    addedRegionGroups,
    removedRegionGroups,
    addedSlots,
    removedSlots,
    groupModeChanged: before.groupMode !== after.groupMode,
    outputChanged: before.output !== after.output,
    finalChanged: JSON.stringify(before.final) !== JSON.stringify(after.final),
    dnsChanged: JSON.stringify(before.dns) !== JSON.stringify(after.dns),
    modulesChanged: JSON.stringify(before.modules) !== JSON.stringify(after.modules),
    patchesChanged: JSON.stringify(before.clientPatches ?? {}) !== JSON.stringify(after.clientPatches ?? {}),
    lines,
  };
}

/**
 * Builds a valid `retarget` ConflictResolution replacement op for an upstream
 * rebase conflict when the user picks a replacement target id.
 */
export function buildRetargetResolution(conflict: OverlayConflict, newTargetId: string): ConflictResolution {
  const { op } = conflict;
  let replacement: TemplateOverlayOp;

  switch (op.op) {
    case 'addCard':
      if (conflict.reason === 'ANCHOR_MISSING') {
        replacement = op.afterCardId
          ? { ...op, afterCardId: newTargetId }
          : op.beforeCardId
            ? { ...op, beforeCardId: newTargetId }
            : { ...op, cardId: newTargetId };
      } else {
        replacement = { ...op, cardId: newTargetId };
      }
      break;
    case 'removeCard':
    case 'setCardEnabled':
    case 'setCardOverride':
      replacement = { ...op, cardId: newTargetId };
      break;
    case 'moveCard':
      if (conflict.reason === 'ANCHOR_MISSING') {
        replacement = op.afterCardId
          ? { ...op, afterCardId: newTargetId }
          : op.beforeCardId
            ? { ...op, beforeCardId: newTargetId }
            : { ...op, cardId: newTargetId };
      } else {
        replacement = { ...op, cardId: newTargetId };
      }
      break;
    case 'removeRegionGroup':
    case 'updateRegionGroup':
      replacement = { ...op, regionGroupId: newTargetId };
      break;
    case 'removeSlot':
    case 'updateSlot':
      replacement = { ...op, slotId: newTargetId };
      break;
    case 'setFinal':
      replacement = { ...op, final: { kind: 'card', cardId: newTargetId } };
      break;
    default:
      replacement = op;
  }

  return {
    opIndex: conflict.opIndex,
    action: 'retarget',
    replacement,
  };
}

export function formatOverlayOpSummary(op: TemplateOverlayOp): string {
  switch (op.op) {
    case 'addCard':
      return `addCard(${op.cardId})`;
    case 'removeCard':
      return `removeCard(${op.cardId})`;
    case 'moveCard':
      return `moveCard(${op.cardId}${op.afterCardId ? ` after ${op.afterCardId}` : op.beforeCardId ? ` before ${op.beforeCardId}` : ''})`;
    case 'setCardEnabled':
      return `setCardEnabled(${op.cardId}=${String(op.enabled)})`;
    case 'setCardOverride':
      return `setCardOverride(${op.cardId})`;
    case 'addRegionGroup':
      return `addRegionGroup(${op.regionGroup.id})`;
    case 'removeRegionGroup':
      return `removeRegionGroup(${op.regionGroupId})`;
    case 'updateRegionGroup':
      return `updateRegionGroup(${op.regionGroupId})`;
    case 'addSlot':
      return `addSlot(${op.slot.id})`;
    case 'removeSlot':
      return `removeSlot(${op.slotId})`;
    case 'updateSlot':
      return `updateSlot(${op.slotId})`;
    case 'setGroupMode':
      return `setGroupMode(${op.groupMode})`;
    case 'setFinal':
      return `setFinal(${formatPolicyShort(op.final)})`;
    case 'setOutput':
      return `setOutput(${op.output})`;
    case 'setDns':
      return `setDns(${op.dns.mode})`;
    case 'setGeneral':
      return 'setGeneral(...)';
    case 'setModule':
      return `setModule(${op.moduleId}=${String(op.enabled)})`;
    case 'setPatch':
      return `setPatch(${op.client})`;
    case 'setLegacyGeodata':
      return `setLegacyGeodata(${String(op.legacyGeodata)})`;
  }
}
