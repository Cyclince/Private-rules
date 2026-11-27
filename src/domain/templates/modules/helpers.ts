import type { TemplateClientId } from '../../../shared/clients';
import type { AppCard, PolicyRef, Stage } from '../../../shared/schemas/card';
import type { ResolvedTemplate } from '../model';
import { getStageOrder } from '../stages';

/** Where an enhancement module card is spliced into the resolved card list. */
export type ModuleCardPosition = 'top' | 'stage-start' | 'stage-end';

/** Cards contributed by enhancement modules (design §5.2) — infrastructure, never business groups. */
export const MODULE_CARD_PREFIX = 'module-';

function findLeadingInsertIndex(template: ResolvedTemplate): number {
  let index = 0;
  while (index < template.cards.length && template.cards[index].effective.hidden) {
    index += 1;
  }
  return index;
}

function findStageBoundaryIndex(template: ResolvedTemplate, stage: Stage, edge: 'start' | 'end'): number {
  const order = getStageOrder(stage);
  for (let index = 0; index < template.cards.length; index += 1) {
    const entry = template.cards[index];
    if (entry.effective.hidden) continue;
    const entryOrder = getStageOrder(entry.effective.stage);
    if (edge === 'start' ? entryOrder >= order : entryOrder > order) {
      return index;
    }
  }
  return template.cards.length;
}

function resolveInsertIndex(template: ResolvedTemplate, position: ModuleCardPosition, stage: Stage): number {
  if (position === 'top') return findLeadingInsertIndex(template);
  return findStageBoundaryIndex(template, stage, position === 'stage-start' ? 'start' : 'end');
}

/**
 * Inserts (or replaces) a module-contributed card at a deterministic position and keeps
 * `body.cards` in sync with the resolved card order. Purely functional.
 */
export function insertModuleCard(
  template: ResolvedTemplate,
  card: AppCard,
  position: ModuleCardPosition,
): ResolvedTemplate {
  const next = structuredClone(template);
  const insertIdx = resolveInsertIndex(next, position, card.stage);

  // Idempotency: drop any previous instance before re-inserting.
  next.cards = next.cards.filter((entry) => entry.cardId !== card.id);
  next.body.cards = next.body.cards.filter((ref) => ref.cardId !== card.id);

  const anchorId = next.cards[insertIdx]?.cardId;
  next.cards.splice(insertIdx, 0, {
    cardId: card.id,
    enabled: true,
    effective: card,
    effectiveGroupType: card.group.type,
    hasOverrides: false,
  });

  const anchorBodyIdx = anchorId ? next.body.cards.findIndex((ref) => ref.cardId === anchorId) : -1;
  const bodyIdx = anchorBodyIdx >= 0 ? anchorBodyIdx : Math.min(insertIdx, next.body.cards.length);
  next.body.cards.splice(bodyIdx, 0, { cardId: card.id, enabled: true });

  return next;
}

/** `[DIRECT]` plus the main proxy group when the template has one (lets users route it manually). */
export function buildDirectCandidates(template: ResolvedTemplate): PolicyRef[] {
  const candidates: PolicyRef[] = [{ kind: 'builtin', id: 'DIRECT' }];
  if (template.cards.some((entry) => entry.enabled && entry.cardId === 'proxy-select')) {
    candidates.push({ kind: 'card', cardId: 'proxy-select' });
  }
  return candidates;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type ClientPatchUpsertStatus = 'added' | 'already-present';

/**
 * Appends a top-level YAML mapping block to `body.clientPatches[client]` (mihomo-style
 * runtime parameters such as `tun:`), keeping the user's existing patch text intact.
 * An existing top-level key is never overwritten — the user's patch wins.
 */
export function upsertClientPatchSection(
  template: ResolvedTemplate,
  client: TemplateClientId,
  key: string,
  block: string,
): { template: ResolvedTemplate; status: ClientPatchUpsertStatus } {
  const next = structuredClone(template);
  const existing = next.body.clientPatches?.[client] ?? '';
  const keyPattern = new RegExp(`^${escapeRegExp(key)}\\s*:`, 'm');

  if (keyPattern.test(existing)) {
    return { template: next, status: 'already-present' };
  }

  const trimmed = existing.replace(/\s+$/, '');
  const patch = trimmed.length > 0 ? `${trimmed}\n${block}` : block;
  next.body.clientPatches = { ...(next.body.clientPatches ?? {}), [client]: patch };
  return { template: next, status: 'added' };
}
