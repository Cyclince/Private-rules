import type { NodeSlot } from '../../../shared/schemas/template';
import { filterNodes } from '../../nodes/filter';
import { resolveTemplateCards } from '../model';
import { getNormalizedBodyPools } from '../pools';
import type { LintIssue, LintTemplateInput } from './types';

function resolveNodeNamesForSlot(
  slotId: string | undefined,
  slots: readonly NodeSlot[],
  input: Pick<LintTemplateInput, 'nodeNamesBySlot' | 'nodeNames'>,
): readonly string[] | undefined {
  const bySlot = input.nodeNamesBySlot;
  if (bySlot) {
    const isMap = bySlot instanceof Map;
    const record = isMap ? null : (bySlot as Readonly<Record<string, readonly string[]>>);
    if (slotId) {
      if (isMap) {
        return bySlot.get(slotId);
      }
      if (record && Object.prototype.hasOwnProperty.call(record, slotId)) {
        return record[slotId];
      }
    }
    // If no slotId is pinned on a region group, merge all slot preview lists.
    const merged: string[] = [];
    const entries = isMap ? [...bySlot.values()] : Object.values(record ?? {});
    if (entries.length > 0) {
      for (const list of entries) merged.push(...list);
      return merged;
    }
  }
  if (input.nodeNames !== undefined && (slots.length <= 1 || !slotId || slots.some((s) => s.id === slotId))) {
    return input.nodeNames;
  }
  return undefined;
}

/**
 * Checks whether any region group or slot-filtered strategy group yields zero
 * nodes after applying slot `excludeInfo` and region/regex filters (design §10.7).
 * Only runs when node name preview data (`nodeNamesBySlot` or `nodeNames`) is provided.
 */
export function checkEmptyGroups(
  input: Pick<LintTemplateInput, 'body' | 'cards' | 'nodeNamesBySlot' | 'nodeNames'>,
): LintIssue[] {
  if (!input.nodeNamesBySlot && !input.nodeNames) {
    return [];
  }

  const issues: LintIssue[] = [];
  const slotById = new Map(input.body.slots.map((slot) => [slot.id, slot]));
  const bodyForPools = {
    ...input.body,
    final: input.body.final ?? { kind: 'builtin' as const, id: 'DIRECT' as const },
  };
  const normalizedPools = getNormalizedBodyPools(bodyForPools);
  const poolById = new Map(normalizedPools.map((pool) => [pool.id, pool]));
  const emptyPoolIds = new Set<string>();

  const resolveRawNodesForSources = (
    sources: 'all' | readonly string[],
  ): { rawNodes: readonly string[] | undefined; primarySlot?: NodeSlot } => {
    if (sources === 'all') {
      const merged: string[] = [];
      for (const slot of input.body.slots) {
        const list = resolveNodeNamesForSlot(slot.id, input.body.slots, input);
        if (list) merged.push(...list);
      }
      if (merged.length > 0) return { rawNodes: merged, primarySlot: input.body.slots[0] };
      const fallback = resolveNodeNamesForSlot(undefined, input.body.slots, input);
      return { rawNodes: fallback, primarySlot: input.body.slots[0] };
    }
    if (sources.length === 1) {
      const slot = slotById.get(sources[0]);
      return { rawNodes: resolveNodeNamesForSlot(sources[0], input.body.slots, input), primarySlot: slot };
    }
    const merged: string[] = [];
    let anyResolved = false;
    for (const slotId of sources) {
      const list = resolveNodeNamesForSlot(slotId, input.body.slots, input);
      if (list) {
        anyResolved = true;
        merged.push(...list);
      }
    }
    return { rawNodes: anyResolved ? merged : undefined, primarySlot: slotById.get(sources[0]) };
  };

  // 1. Check each node pool (including migrated legacy regionGroups)
  for (const pool of normalizedPools) {
    if (pool.kind === 'stability') {
      continue;
    }
    const { rawNodes, primarySlot } = resolveRawNodesForSources(pool.sources);
    if (!rawNodes) continue;

    const matched = filterNodes(
      rawNodes,
      {
        ...(pool.region ? { regions: [pool.region] } : {}),
        ...(pool.include ? { include: pool.include } : {}),
        ...(pool.exclude ? { exclude: pool.exclude } : {}),
      },
      { excludeInfo: primarySlot?.excludeInfo ?? true },
    );

    if (matched.length === 0) {
      emptyPoolIds.add(pool.id);
      const isRegion = pool.kind === 'region';
      issues.push({
        code: 'empty-group',
        severity: 'warning',
        message: isRegion
          ? `地区组 ${pool.name}（${pool.id}）筛选后没有匹配到任何节点。`
          : `节点池 ${pool.name}（${pool.id}）筛选后没有匹配到任何节点。`,
        location: isRegion
          ? {
              regionGroupId: pool.id,
              poolId: pool.id,
              slotId: Array.isArray(pool.sources) ? pool.sources[0] : primarySlot?.id,
            }
          : {
              poolId: pool.id,
              slotId: Array.isArray(pool.sources) ? pool.sources[0] : primarySlot?.id,
            },
        suggestion: isRegion
          ? `检查订阅节点名预览是否包含 ${pool.region} 地区节点，放宽 include/exclude，或移除该地区组。`
          : `检查订阅节点名预览是否包含符合 ${pool.name} 条件的节点，或调整 include/exclude 正则。`,
        details: {
          ...(pool.region ? { region: pool.region } : {}),
          kind: pool.kind,
          totalPreviewNodes: rawNodes.length,
        },
      });
    }
  }

  for (const pool of normalizedPools) {
    if (pool.kind !== 'stability') continue;
    const members = pool.members ?? [];
    if (members.length === 0 || members.every((memberId) => !poolById.has(memberId) || emptyPoolIds.has(memberId))) {
      emptyPoolIds.add(pool.id);
    }
  }

  // 2. Check each enabled card with slot filters or slot/region/pool-only candidates
  const resolved = resolveTemplateCards(bodyForPools, input.cards);
  const cardIndexById = new Map(input.body.cards.map((ref, idx) => [ref.cardId, idx]));

  for (const resolvedCard of resolved.cards) {
    if (!resolvedCard.enabled) continue;
    const card = resolvedCard.effective;
    let hasNonEmptySource = false;
    let checkedAnySlotSource = false;

    for (const candidate of card.group.candidates) {
      if (candidate.kind === 'builtin' || candidate.kind === 'card') {
        hasNonEmptySource = true;
        continue;
      }
      if (candidate.kind === 'region') {
        checkedAnySlotSource = true;
        if (!emptyPoolIds.has(candidate.regionGroupId)) {
          hasNonEmptySource = true;
        }
        continue;
      }
      if (candidate.kind === 'pool') {
        checkedAnySlotSource = true;
        if (!emptyPoolIds.has(candidate.poolId)) {
          hasNonEmptySource = true;
        }
        continue;
      }
      // candidate.kind === 'slot'
      const slot = slotById.get(candidate.slotId);
      const rawNodes = resolveNodeNamesForSlot(candidate.slotId, input.body.slots, input);
      if (!rawNodes) {
        hasNonEmptySource = true;
        continue;
      }
      checkedAnySlotSource = true;
      const matched = filterNodes(rawNodes, candidate.filter, { excludeInfo: slot?.excludeInfo ?? true });
      if (matched.length > 0) {
        hasNonEmptySource = true;
      } else if (candidate.filter) {
        issues.push({
          code: 'empty-group',
          severity: 'warning',
          message: `组件 ${card.name}（${card.id}）的槽位筛选条件未匹配到任何节点。`,
          location: {
            cardId: card.id,
            cardIndex: cardIndexById.get(card.id),
            slotId: candidate.slotId,
            stage: card.stage,
          },
          suggestion: '调整该候选出口的地区或正则筛选条件，或添加备用出口。',
          details: {
            slotId: candidate.slotId,
            filter: candidate.filter,
            totalPreviewNodes: rawNodes.length,
          },
        });
      }
    }

    if (checkedAnySlotSource && !hasNonEmptySource) {
      const alreadyReported = issues.some((issue) => issue.location.cardId === card.id);
      if (!alreadyReported) {
        issues.push({
          code: 'empty-group',
          severity: 'warning',
          message: `策略组 ${card.name}（${card.id}）的所有节点候选均为空，运行时将无可用节点。`,
          location: {
            cardId: card.id,
            cardIndex: cardIndexById.get(card.id),
            stage: card.stage,
          },
          suggestion: '为该策略组添加有效的地区组、槽位或回退候选（如 DIRECT / 节点选择）。',
        });
      }
    }
  }

  return issues;
}
