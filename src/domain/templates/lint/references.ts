import type { PolicyRef } from '../../../shared/schemas/card';
import type { TemplateBody } from '../../../shared/schemas/template';
import { validateTemplateGraph } from '../model';
import type { LintIssue, LintTemplateInput } from './types';

function isFinalMissing(final: TemplateBody['final'] | null | undefined): boolean {
  if (!final) return true;
  if (final.kind === 'card') return !final.cardId.trim();
  if (final.kind === 'region') return !final.regionGroupId.trim();
  if (final.kind === 'slot') return !final.slotId.trim();
  if (final.kind === 'builtin') return !final.id;
  return true;
}

/** Checks for a missing or unset `final` (MATCH / FINAL) fallback policy. */
export function checkMissingFinal(input: Pick<LintTemplateInput, 'body'>): LintIssue[] {
  if (!isFinalMissing(input.body.final)) {
    return [];
  }
  return [
    {
      code: 'missing-final',
      severity: 'error',
      message: '模板缺少兜底出口（final / MATCH），未命中任何规则的流量将无处可去。',
      location: { field: 'final', stage: 'final' },
      suggestion: '设置模板的 final 兜底出口（例如指向漏网之鱼组件或 DIRECT）。',
    },
  ];
}

function buildGraphInput(body: LintTemplateInput['body']): TemplateBody {
  const placeholderFinal: PolicyRef = isFinalMissing(body.final)
    ? { kind: 'builtin', id: 'DIRECT' }
    : (body.final as PolicyRef);
  return {
    ...body,
    final: placeholderFinal,
  };
}

/** Checks for missing group/card/region/slot references across cards, region groups, and final. */
export function checkMissingGroupRefs(input: Pick<LintTemplateInput, 'body' | 'cards'>): LintIssue[] {
  const graph = validateTemplateGraph(buildGraphInput(input.body), input.cards);
  const cardIndexById = new Map(input.body.cards.map((ref, idx) => [ref.cardId, idx]));

  return graph.missingRefs.map((ref): LintIssue => {
    const isFinal = ref.sourceId === 'final';
    const isRegion = ref.kind === 'MISSING_SLOT_REF' && input.body.regionGroups.some((rg) => rg.id === ref.sourceId);
    const suggestion =
      ref.kind === 'MISSING_SLOT_REF'
        ? `在模板中新增节点槽位 ${ref.targetId}，或修改引用指向已有槽位。`
        : ref.kind === 'MISSING_REGION_GROUP_REF'
          ? `在模板中新增地区组 ${ref.targetId}，或将其从候选出口中移除。`
          : `确保组件 ${ref.targetId} 已加入模板并存在定义，或从候选出口中移除该引用。`;

    return {
      code: 'missing-group-ref',
      severity: 'error',
      message: ref.message,
      location: {
        ...(isFinal
          ? { field: 'final', stage: 'final' as const }
          : isRegion
            ? { regionGroupId: ref.sourceId }
            : ref.sourceId !== 'template'
              ? { cardId: ref.sourceId, cardIndex: cardIndexById.get(ref.sourceId) }
              : { cardId: ref.targetId, cardIndex: cardIndexById.get(ref.targetId) }),
      },
      suggestion,
      details: {
        kind: ref.kind,
        sourceId: ref.sourceId,
        targetId: ref.targetId,
      },
    };
  });
}

/** Checks for circular candidate references between strategy groups (e.g. A -> B -> A). */
export function checkGroupCycles(input: Pick<LintTemplateInput, 'body' | 'cards'>): LintIssue[] {
  const graph = validateTemplateGraph(buildGraphInput(input.body), input.cards);
  const cardIndexById = new Map(input.body.cards.map((ref, idx) => [ref.cardId, idx]));

  return graph.cycles.map((cycle): LintIssue => {
    const startCard = cycle[0];
    return {
      code: 'group-cycle',
      severity: 'error',
      message: `检测到策略组循环引用：${cycle.join(' -> ')}。`,
      location: {
        cardId: startCard,
        cardIndex: cardIndexById.get(startCard),
      },
      suggestion: `断开循环链路（例如从 ${cycle[cycle.length - 2]} 的候选中移除对 ${startCard} 的引用）。`,
      details: { cycle },
    };
  });
}

/** Checks for disabled cards/base groups that are still referenced by enabled cards or final. */
export function checkDisabledBaseGroups(input: Pick<LintTemplateInput, 'body' | 'cards'>): LintIssue[] {
  const graph = validateTemplateGraph(buildGraphInput(input.body), input.cards);
  const cardIndexById = new Map(input.body.cards.map((ref, idx) => [ref.cardId, idx]));

  return graph.disabledRefs.map((ref): LintIssue => {
    const isFinal = ref.sourceId === 'final';
    return {
      code: 'disabled-base-group',
      severity: 'error',
      message: ref.message,
      location: isFinal
        ? { field: 'final', stage: 'final' }
        : { cardId: ref.sourceId, cardIndex: cardIndexById.get(ref.sourceId) },
      suggestion: `重新启用被依赖的基础组 ${ref.targetId}，或修改 ${isFinal ? '兜底出口' : ref.sourceId} 的候选列表。`,
      details: {
        sourceId: ref.sourceId,
        disabledCardId: ref.targetId,
      },
    };
  });
}
