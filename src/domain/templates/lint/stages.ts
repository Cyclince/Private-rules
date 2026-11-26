import { checkStageOrdering, getStageMetadata } from '../stages';
import type { LintIssue, LintTemplateInput } from './types';

/** Checks whether enabled non-hidden cards violate the 7-layer stage ordering (design §10.10). */
export function checkStageOrderViolations(input: Pick<LintTemplateInput, 'body' | 'cards'>): LintIssue[] {
  const violations = checkStageOrdering(input.body.cards, input.cards);

  return violations.map((v): LintIssue => {
    const stageMeta = getStageMetadata(v.stage);
    const prevMeta = getStageMetadata(v.precedingStage);
    return {
      code: 'stage-order-violation',
      severity: 'warning',
      message: v.message,
      location: {
        cardId: v.cardId,
        cardIndex: v.index,
        stage: v.stage,
      },
      suggestion: `将组件 ${v.cardId}（${stageMeta.labelZh}层）移到 ${v.precedingCardId}（${prevMeta.labelZh}层）之前，或调整分层排序。`,
      details: {
        stage: v.stage,
        precedingCardId: v.precedingCardId,
        precedingStage: v.precedingStage,
      },
    };
  });
}
