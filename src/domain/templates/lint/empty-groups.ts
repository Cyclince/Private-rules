import type { NodeSlot } from '../../../shared/schemas/template';
import { filterNodes } from '../../nodes/filter';
import { resolveTemplateCards } from '../model';
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
  const emptyRegionIds = new Set<string>();

  // 1. Check each region group
  for (const rg of input.body.regionGroups) {
    const slot = rg.slotId ? slotById.get(rg.slotId) : input.body.slots[0];
    const rawNodes = resolveNodeNamesForSlot(rg.slotId ?? slot?.id, input.body.slots, input);
    if (!rawNodes) continue;

    const matched = filterNodes(
      rawNodes,
      {
        regions: [rg.region],
        include: rg.extraInclude,
        exclude: rg.extraExclude,
      },
      { excludeInfo: slot?.excludeInfo ?? true },
    );

    if (matched.length === 0) {
      emptyRegionIds.add(rg.id);
      issues.push({
        code: 'empty-group',
        severity: 'warning',
        message: `地区组 ${rg.name}（${rg.id}）筛选后没有匹配到任何节点。`,
        location: {
          regionGroupId: rg.id,
          slotId: rg.slotId ?? slot?.id,
        },
        suggestion: `检查订阅节点名预览是否包含 ${rg.region} 地区节点，放宽 extraInclude/extraExclude，或移除该地区组。`,
        details: {
          region: rg.region,
          totalPreviewNodes: rawNodes.length,
        },
      });
    }
  }

  // 2. Check each enabled card with slot filters or slot/region-only candidates
  const resolved = resolveTemplateCards(
    { ...input.body, final: input.body.final ?? { kind: 'builtin', id: 'DIRECT' } },
    input.cards,
  );
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
        if (!emptyRegionIds.has(candidate.regionGroupId)) {
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
