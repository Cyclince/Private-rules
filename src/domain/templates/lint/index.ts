import { checkClientCapabilities } from './capability';
import { checkEmptyGroups } from './empty-groups';
import { checkIpMissingNoResolve } from './no-resolve';
import { checkDisabledBaseGroups, checkGroupCycles, checkMissingFinal, checkMissingGroupRefs } from './references';
import { checkRegexDialectCompatibility } from './regex-dialect';
import { checkReorderDiff } from './reorder-diff';
import { checkRuleShadowing, checkSubsetAfterSuperset } from './shadowing';
import { checkStageOrderViolations } from './stages';
import type { LintIssue, LintReport, LintTemplateInput } from './types';

export {
  LINT_CODES,
  type LintCode,
  type LintIssue,
  type LintLocation,
  type LintReport,
  type LintSeverity,
  type LintTemplateInput,
} from './types';
export { checkClientCapabilities } from './capability';
export { checkEmptyGroups } from './empty-groups';
export { checkIpMissingNoResolve } from './no-resolve';
export { checkDisabledBaseGroups, checkGroupCycles, checkMissingFinal, checkMissingGroupRefs } from './references';
export { checkRegexDialectCompatibility } from './regex-dialect';
export { checkReorderDiff, type ReorderDiffEntry } from './reorder-diff';
export { checkRuleShadowing, checkSubsetAfterSuperset, ruleCompletelyShadows } from './shadowing';
export { checkStageOrderViolations } from './stages';

/**
 * Runs all 12 pure-function template linters in deterministic order (design §10.7).
 * Safe for both live frontend editor feedback and backend save/publish validation.
 */
export function lintTemplate(input: LintTemplateInput): LintReport {
  const issues: LintIssue[] = [
    ...checkMissingFinal(input),
    ...checkMissingGroupRefs(input),
    ...checkGroupCycles(input),
    ...checkDisabledBaseGroups(input),
    ...checkStageOrderViolations(input),
    ...checkSubsetAfterSuperset(input),
    ...checkRuleShadowing(input),
    ...checkIpMissingNoResolve(input),
    ...checkEmptyGroups(input),
    ...checkRegexDialectCompatibility(input),
    ...checkClientCapabilities(input),
    ...checkReorderDiff(input),
  ];

  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const issue of issues) {
    if (issue.severity === 'error') errorCount += 1;
    else if (issue.severity === 'warning') warningCount += 1;
    else infoCount += 1;
  }

  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    issues,
  };
}
