import type { CatalogEntry, Condition, InlineRule, Matcher } from '../../../shared/schemas/card';
import { resolveTemplateCards } from '../model';
import type { LintIssue, LintTemplateInput } from './types';

function toCatalogMap(
  catalog?: ReadonlyMap<string, CatalogEntry> | readonly CatalogEntry[],
): Map<string, CatalogEntry> {
  if (!catalog) return new Map();
  if ('entries' in catalog && 'get' in catalog) return new Map(catalog);
  return new Map(catalog.map((entry) => [entry.id, entry]));
}

function collectInlineRules(cond: Condition, out: InlineRule[]): void {
  if (cond.op === 'rule') {
    out.push(cond.rule);
    return;
  }
  if (cond.op === 'not') {
    collectInlineRules(cond.item, out);
    return;
  }
  for (const item of cond.items) {
    collectInlineRules(item, out);
  }
}

function matcherCanMatchDomain(matcher: Matcher, catalogMap: ReadonlyMap<string, CatalogEntry>): boolean {
  switch (matcher.kind) {
    case 'geosite':
    case 'ruleset':
      return true;
    case 'geoip':
      return false;
    case 'remote':
      return matcher.behavior !== 'ipcidr';
    case 'catalog': {
      const entry = catalogMap.get(matcher.entryId);
      return !entry || entry.behavior !== 'ipcidr';
    }
    case 'inline': {
      const rules: InlineRule[] = [];
      for (const cond of matcher.conditions) collectInlineRules(cond, rules);
      return rules.some(
        (rule) =>
          rule.type === 'DOMAIN' ||
          rule.type === 'DOMAIN-SUFFIX' ||
          rule.type === 'DOMAIN-KEYWORD' ||
          rule.type === 'DOMAIN-REGEX' ||
          rule.type === 'URL-REGEX' ||
          rule.type === 'GEOSITE',
      );
    }
  }
}

type IpItem = {
  cardId: string;
  cardName: string;
  cardIndex: number;
  stage: 'pre-direct' | 'app' | 'proxy-fallback' | 'ip' | 'domestic' | 'port' | 'final';
  matcherIndex: number;
  ruleIndex?: number;
  ruleLabel: string;
  hasNoResolve: boolean;
  evalPosition: number;
};

/**
 * Checks for IP-based rules (GEOIP / IP-CIDR / IP-ASN) placed before domain rules
 * without `no-resolve`, which triggers premature DNS resolution and potential leaks (design §10.7).
 */
export function checkIpMissingNoResolve(
  input: Pick<LintTemplateInput, 'body' | 'cards' | 'catalogIndex' | 'caches'>,
): LintIssue[] {
  const catalogMap = toCatalogMap(input.catalogIndex ?? input.caches?.catalogIndex);
  const resolved = resolveTemplateCards(
    { ...input.body, final: input.body.final ?? { kind: 'builtin', id: 'DIRECT' } },
    input.cards,
  );
  const cardIndexById = new Map(input.body.cards.map((ref, idx) => [ref.cardId, idx]));

  const ipItems: IpItem[] = [];
  let lastDomainPosition = -1;
  let evalPosition = 0;

  for (const resolvedCard of resolved.cards) {
    if (!resolvedCard.enabled) continue;
    const card = resolvedCard.effective;
    if (card.hidden) continue;
    const cardIndex = cardIndexById.get(card.id) ?? 0;

    card.matchers.forEach((matcher, matcherIndex) => {
      const pos = evalPosition;
      evalPosition += 1;

      if (matcherCanMatchDomain(matcher, catalogMap)) {
        lastDomainPosition = pos;
      }

      if (matcher.kind === 'geoip') {
        ipItems.push({
          cardId: card.id,
          cardName: card.name,
          cardIndex,
          stage: card.stage,
          matcherIndex,
          ruleLabel: `GEOIP,${matcher.name}`,
          hasNoResolve: Boolean(matcher.noResolve),
          evalPosition: pos,
        });
      } else if (matcher.kind === 'inline') {
        const rules: InlineRule[] = [];
        for (const cond of matcher.conditions) collectInlineRules(cond, rules);
        rules.forEach((rule, ruleIndex) => {
          if (rule.type === 'IP-CIDR' || rule.type === 'IP-ASN' || rule.type === 'GEOIP') {
            ipItems.push({
              cardId: card.id,
              cardName: card.name,
              cardIndex,
              stage: card.stage,
              matcherIndex,
              ruleIndex,
              ruleLabel: `${rule.type},${rule.value}`,
              hasNoResolve: Boolean(rule.options?.noResolve),
              evalPosition: pos,
            });
          }
        });
      }
    });
  }

  const issues: LintIssue[] = [];
  for (const item of ipItems) {
    if (item.hasNoResolve) continue;
    // Trigger when placed before a subsequent domain rule (causes premature DNS lookup).
    if (item.evalPosition < lastDomainPosition) {
      issues.push({
        code: 'ip-missing-no-resolve',
        severity: 'warning',
        message: `组件 ${item.cardName} 中的 IP 规则「${item.ruleLabel}」排在域名规则之前且缺少 no-resolve，会提前触发 DNS 解析并可能导致泄漏或变慢。`,
        location: {
          cardId: item.cardId,
          cardIndex: item.cardIndex,
          matcherIndex: item.matcherIndex,
          ...(item.ruleIndex !== undefined ? { ruleIndex: item.ruleIndex } : {}),
          stage: item.stage,
        },
        suggestion:
          '为该规则补充 noResolve: true，或启用「IP 规则补 no-resolve」增强模块，或将其移动到所有域名规则之后。',
        details: {
          rule: item.ruleLabel,
        },
      });
    }
  }

  return issues;
}
