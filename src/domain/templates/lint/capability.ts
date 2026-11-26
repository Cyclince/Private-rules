import { TEMPLATE_CLIENT_IDS, type TemplateClientId } from '../../../shared/clients';
import type { Condition, InlineRule } from '../../../shared/schemas/card';
import { getClientCapabilities } from '../capabilities';
import { resolveTemplateCards } from '../model';
import type { LintIssue, LintTemplateInput } from './types';

function inspectCondition(cond: Condition, out: { hasLogicalOp: boolean; rules: InlineRule[] }): void {
  if (cond.op === 'rule') {
    out.rules.push(cond.rule);
    return;
  }
  out.hasLogicalOp = true;
  if (cond.op === 'not') {
    inspectCondition(cond.item, out);
    return;
  }
  for (const item of cond.items) {
    inspectCondition(item, out);
  }
}

/**
 * Checks per-client feature and rule compatibility against the capability matrix
 * (design §10.6 & §10.7), emitting `info` diagnostics for features that will be
 * converted, downgraded, or skipped on target clients.
 */
export function checkClientCapabilities(input: Pick<LintTemplateInput, 'body' | 'cards' | 'clients'>): LintIssue[] {
  const clients: readonly TemplateClientId[] = input.clients ?? TEMPLATE_CLIENT_IDS;
  const resolved = resolveTemplateCards(
    { ...input.body, final: input.body.final ?? { kind: 'builtin', id: 'DIRECT' } },
    input.cards,
  );
  const cardIndexById = new Map(input.body.cards.map((ref, idx) => [ref.cardId, idx]));
  const issues: LintIssue[] = [];

  for (const client of clients) {
    const cap = getClientCapabilities(client);

    // Track whether any inline rule appears after a remote matcher (for Loon / QX local-first priority)
    let hasSeenRemoteForLocalFirst = false;
    let firstRemoteCardId: string | undefined;

    for (const resolvedCard of resolved.cards) {
      if (!resolvedCard.enabled) continue;
      const card = resolvedCard.effective;
      const cardIndex = cardIndexById.get(card.id);

      // 1. Group type support (e.g. sing-box lacks native fallback / load-balance)
      if (!cap.supportedGroupTypes.has(resolvedCard.effectiveGroupType)) {
        issues.push({
          code: 'client-unsupported',
          severity: 'info',
          message: `${client} 不原生支持策略组类型 ${resolvedCard.effectiveGroupType}（组件 ${card.name}），编译时将降级转换。`,
          location: { cardId: card.id, cardIndex, client, stage: card.stage, field: 'group.type' },
          suggestion: `在 ${client} 下该组将转换为兼容类型；如需全客户端行为一致，可改用 select 或 url-test。`,
          details: { feature: 'group-type', groupType: resolvedCard.effectiveGroupType, action: 'converted' },
        });
      }

      // 2. REJECT-DROP support
      if (!cap.rejectDrop && card.group.candidates.some((c) => c.kind === 'builtin' && c.id === 'REJECT-DROP')) {
        issues.push({
          code: 'client-unsupported',
          severity: 'info',
          message: `${client} 不支持 REJECT-DROP（组件 ${card.name}），编译时将降级为 REJECT。`,
          location: { cardId: card.id, cardIndex, client, stage: card.stage, field: 'group.candidates' },
          suggestion: '该差异会由编译器自动降级为 REJECT，通常无需手工修改。',
          details: { feature: 'reject-drop', action: 'downgraded' },
        });
      }

      if (card.hidden) continue;

      card.matchers.forEach((matcher, matcherIndex) => {
        if (matcher.kind === 'geosite') {
          if (cap.geosite === 'none') {
            issues.push({
              code: 'client-unsupported',
              severity: 'info',
              message: `${client} 不原生支持 GEOSITE(${matcher.name})，编译时将转换为自托管规则集引用。`,
              location: { cardId: card.id, cardIndex, matcherIndex, client, stage: card.stage },
              suggestion: '确保服务端已同步对应 GeoSite 规则集，编译器会自动替换为规则集链接。',
              details: { feature: 'geosite', name: matcher.name, action: 'converted' },
            });
          } else if (cap.geosite === 'partial') {
            issues.push({
              code: 'client-unsupported',
              severity: 'info',
              message: `${client} 仅部分支持 GEOSITE(${matcher.name})，建议核对目标规则是否存在于 Stash 规则库。`,
              location: { cardId: card.id, cardIndex, matcherIndex, client, stage: card.stage },
              suggestion: '如遇到未生效的 GeoSite，可改用规则目录或自托管规则集。',
              details: { feature: 'geosite', name: matcher.name, action: 'partial' },
            });
          }
          if (cap.localFirstRules && cap.geosite === 'none') {
            hasSeenRemoteForLocalFirst = true;
            firstRemoteCardId ??= card.id;
          }
          return;
        }

        if (matcher.kind === 'remote') {
          if (matcher.format && !cap.supportedRemoteFormats.has(matcher.format)) {
            issues.push({
              code: 'client-unsupported',
              severity: 'info',
              message: `${client} 不支持远程规则集格式 ${matcher.format}（${matcher.url}），将被转换或跳过。`,
              location: { cardId: card.id, cardIndex, matcherIndex, client, stage: card.stage },
              suggestion: `改为通用 text 格式规则集，或使用自托管规则集由服务端按客户端输出。`,
              details: { feature: 'remote-format', format: matcher.format, url: matcher.url, action: 'skipped' },
            });
          }
          if (cap.localFirstRules) {
            hasSeenRemoteForLocalFirst = true;
            firstRemoteCardId ??= card.id;
          }
          return;
        }

        if (matcher.kind === 'catalog' || matcher.kind === 'ruleset') {
          if (cap.localFirstRules) {
            hasSeenRemoteForLocalFirst = true;
            firstRemoteCardId ??= card.id;
          }
          return;
        }

        if (matcher.kind === 'inline') {
          if (cap.localFirstRules && hasSeenRemoteForLocalFirst) {
            issues.push({
              code: 'client-unsupported',
              severity: 'info',
              message: `${client} 会先匹配本地规则再匹配远程列表，排在组件 ${card.name} 内联规则之前的远程规则集需内联以维持优先级。`,
              location: { cardId: card.id, cardIndex, matcherIndex, client, stage: card.stage },
              suggestion: '规则集规划器会自动将前置远程列表标记为内联以保持优先级一致。',
              details: {
                feature: 'local-first-priority',
                precedingRemoteCardId: firstRemoteCardId,
                action: 'converted',
              },
            });
            hasSeenRemoteForLocalFirst = false;
          }

          for (const cond of matcher.conditions) {
            const inspected = { hasLogicalOp: false, rules: [] as InlineRule[] };
            inspectCondition(cond, inspected);

            if (inspected.hasLogicalOp && !cap.logicalRules) {
              issues.push({
                code: 'client-unsupported',
                severity: 'info',
                message: `${client} 不支持逻辑组合规则（AND / OR / NOT），组件 ${card.name} 中的该规则将被跳过。`,
                location: { cardId: card.id, cardIndex, matcherIndex, client, stage: card.stage },
                suggestion: `如需在 ${client} 生效，请拆分为扁平的普通规则，或在发布时关注兼容性报告。`,
                details: { feature: 'logical-rule', action: 'skipped' },
              });
            }

            inspected.rules.forEach((rule, ruleIndex) => {
              if (!cap.supportedRuleTypes.has(rule.type)) {
                issues.push({
                  code: 'client-unsupported',
                  severity: 'info',
                  message: `${client} 不支持规则类型 ${rule.type}（${rule.value}），编译时将被跳过或转换。`,
                  location: { cardId: card.id, cardIndex, matcherIndex, ruleIndex, client, stage: card.stage },
                  suggestion: `使用所有目标客户端通用的规则类型（如 DOMAIN-SUFFIX / IP-CIDR），或在兼容性报告中确认影响范围。`,
                  details: { feature: 'rule-type', ruleType: rule.type, value: rule.value, action: 'skipped' },
                });
              }
            });
          }
        }
      });
    }
  }

  return issues;
}
