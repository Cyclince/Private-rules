import { TEMPLATE_CLIENT_IDS, type TemplateClientId } from '../../../shared/clients';
import type { Condition, InlineRule } from '../../../shared/schemas/card';
import { detectRegexDialectIssues, getRegionDefinition, type RegexDialectWarning } from '../../nodes';
import { resolveTemplateCards } from '../model';
import { getNormalizedBodyPools } from '../pools';
import type { LintIssue, LintSeverity, LintTemplateInput } from './types';

function severityForRegexWarning(warning: RegexDialectWarning): LintSeverity {
  return warning.code === 'INVALID_REGEX' ? 'error' : 'warning';
}

function suggestionForRegexWarning(warning: RegexDialectWarning, client: TemplateClientId): string {
  switch (warning.code) {
    case 'INVALID_REGEX':
      return '修复正则表达式语法错误（检查括号配对与转义字符）。';
    case 'LOOKBEHIND_UNSUPPORTED':
      return `${client} 不支持后行断言，请改用普通分组或拆分 include/exclude 筛选条件。`;
    case 'LOOKAHEAD_UNSUPPORTED':
      return `${client} 不支持前瞻断言，请改用不含 (?=)/(?!) 的等价正则，或使用独立排除字段。`;
    case 'INLINE_FLAG_UNSUPPORTED':
      return `${client} 使用 JS 正则引擎，移除内联 (?i) 标志（服务端筛选默认忽略大小写）。`;
    case 'EXCLUDE_REQUIRES_LOOKAHEAD':
      return `${client} 仅支持单条筛选正则且不支持负向前瞻，请简化排除条件。`;
    case 'UNKNOWN_REGION':
      return '请使用内置地区词典支持的标准 ISO 两位国家/地区代码（如 HK、JP、US）。';
    default:
      return `调整正则表达式以兼容 ${client} 的正则方言。`;
  }
}

function collectRegexInlineRules(cond: Condition, out: InlineRule[]): void {
  if (cond.op === 'rule') {
    if (cond.rule.type === 'DOMAIN-REGEX' || cond.rule.type === 'URL-REGEX') {
      out.push(cond.rule);
    }
    return;
  }
  if (cond.op === 'not') {
    collectRegexInlineRules(cond.item, out);
    return;
  }
  for (const item of cond.items) {
    collectRegexInlineRules(item, out);
  }
}

/**
 * Statically checks region-group filters, slot node filters, and inline regex rules
 * against each target client's regex dialect (design §10.7, §10.11).
 */
export function checkRegexDialectCompatibility(
  input: Pick<LintTemplateInput, 'body' | 'cards' | 'clients'>,
): LintIssue[] {
  const clients = input.clients ?? TEMPLATE_CLIENT_IDS;
  const issues: LintIssue[] = [];
  const cardIndexById = new Map(input.body.cards.map((ref, idx) => [ref.cardId, idx]));
  const bodyWithFinal = {
    ...input.body,
    final: input.body.final ?? { kind: 'builtin' as const, id: 'DIRECT' as const },
  };

  // 1. Check node pools (including migrated legacy region groups)
  for (const pool of getNormalizedBodyPools(bodyWithFinal)) {
    const isRegion = pool.kind === 'region';
    const baseLocation = isRegion ? { regionGroupId: pool.id, poolId: pool.id } : { poolId: pool.id };

    if (isRegion && (!pool.region || !getRegionDefinition(pool.region))) {
      issues.push({
        code: 'regex-dialect-incompatible',
        severity: 'warning',
        message: `地区组 ${pool.name}（${pool.id}）使用了未知的地区代码 ${pool.region ?? ''}，无法按内置词典生成跨客户端正则。`,
        location: { ...baseLocation, field: 'region' },
        suggestion: '请修改为内置地区词典支持的标准 ISO 国家/地区代码（如 HK、TW、JP、SG、US）。',
        details: { region: pool.region },
      });
    }

    for (const client of clients) {
      if (pool.include) {
        for (const warn of detectRegexDialectIssues(pool.include, client)) {
          issues.push({
            code: 'regex-dialect-incompatible',
            severity: severityForRegexWarning(warn),
            message: `${isRegion ? '地区组' : '节点池'} ${pool.name} 的${isRegion ? ' extraInclude ' : ' include '}正则在 ${client} 上不兼容：${warn.message}`,
            location: { ...baseLocation, client, field: isRegion ? 'extraInclude' : 'include' },
            suggestion: suggestionForRegexWarning(warn, client),
            details: { pattern: pool.include, warningCode: warn.code },
          });
        }
      }
      if (pool.exclude) {
        for (const warn of detectRegexDialectIssues(pool.exclude, client)) {
          issues.push({
            code: 'regex-dialect-incompatible',
            severity: severityForRegexWarning(warn),
            message: `${isRegion ? '地区组' : '节点池'} ${pool.name} 的${isRegion ? ' extraExclude ' : ' exclude '}正则在 ${client} 上不兼容：${warn.message}`,
            location: { ...baseLocation, client, field: isRegion ? 'extraExclude' : 'exclude' },
            suggestion: suggestionForRegexWarning(warn, client),
            details: { pattern: pool.exclude, warningCode: warn.code },
          });
        }
      }
    }
  }

  // 2. Check slot candidate filters and inline DOMAIN-REGEX / URL-REGEX rules on enabled cards
  const resolved = resolveTemplateCards(bodyWithFinal, input.cards);

  for (const resolvedCard of resolved.cards) {
    if (!resolvedCard.enabled) continue;
    const card = resolvedCard.effective;
    const cardIndex = cardIndexById.get(card.id);

    for (const candidate of card.group.candidates) {
      if (candidate.kind !== 'slot' || !candidate.filter) continue;
      for (const client of clients) {
        if (candidate.filter.include) {
          for (const warn of detectRegexDialectIssues(candidate.filter.include, client)) {
            issues.push({
              code: 'regex-dialect-incompatible',
              severity: severityForRegexWarning(warn),
              message: `组件 ${card.name} 的节点包含正则在 ${client} 上不兼容：${warn.message}`,
              location: { cardId: card.id, cardIndex, slotId: candidate.slotId, client, field: 'filter.include' },
              suggestion: suggestionForRegexWarning(warn, client),
              details: { pattern: candidate.filter.include, warningCode: warn.code },
            });
          }
        }
        if (candidate.filter.exclude) {
          for (const warn of detectRegexDialectIssues(candidate.filter.exclude, client)) {
            issues.push({
              code: 'regex-dialect-incompatible',
              severity: severityForRegexWarning(warn),
              message: `组件 ${card.name} 的节点排除正则在 ${client} 上不兼容：${warn.message}`,
              location: { cardId: card.id, cardIndex, slotId: candidate.slotId, client, field: 'filter.exclude' },
              suggestion: suggestionForRegexWarning(warn, client),
              details: { pattern: candidate.filter.exclude, warningCode: warn.code },
            });
          }
        }
      }
    }

    card.matchers.forEach((matcher, matcherIndex) => {
      if (matcher.kind !== 'inline') return;
      const regexRules: InlineRule[] = [];
      for (const cond of matcher.conditions) collectRegexInlineRules(cond, regexRules);

      regexRules.forEach((rule, ruleIndex) => {
        for (const client of clients) {
          for (const warn of detectRegexDialectIssues(rule.value, client)) {
            issues.push({
              code: 'regex-dialect-incompatible',
              severity: severityForRegexWarning(warn),
              message: `组件 ${card.name} 的 ${rule.type} 正则在 ${client} 上不兼容：${warn.message}`,
              location: { cardId: card.id, cardIndex, matcherIndex, ruleIndex, client, stage: card.stage },
              suggestion: suggestionForRegexWarning(warn, client),
              details: { ruleType: rule.type, pattern: rule.value, warningCode: warn.code },
            });
          }
        }
      });
    });
  }

  return issues;
}
