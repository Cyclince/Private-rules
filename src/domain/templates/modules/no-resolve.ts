import type { Condition, Matcher } from '../../../shared/schemas/card';
import type { ResolvedTemplate } from '../model';
import type { EnhancementModule } from './types';

function addNoResolveToCondition(cond: Condition): Condition {
  if (cond.op === 'rule') {
    if (cond.rule.type === 'IP-CIDR' || cond.rule.type === 'IP-ASN' || cond.rule.type === 'GEOIP') {
      return {
        op: 'rule',
        rule: {
          ...cond.rule,
          options: { ...cond.rule.options, noResolve: true },
        },
      };
    }
    return cond;
  }
  if (cond.op === 'not') {
    return { op: 'not', item: addNoResolveToCondition(cond.item) };
  }
  return {
    op: cond.op,
    items: cond.items.map(addNoResolveToCondition),
  };
}

function addNoResolveToMatcher(matcher: Matcher): Matcher {
  if (matcher.kind === 'geoip') {
    return { ...matcher, noResolve: true };
  }
  if (matcher.kind === 'inline') {
    return {
      ...matcher,
      conditions: matcher.conditions.map(addNoResolveToCondition),
    };
  }
  return matcher;
}

/**
 * Enhancement module 1: IP 规则补 no-resolve (design §10.12).
 * Adds `noResolve: true` to all destination IP-based rules (`GEOIP`, `IP-CIDR`, `IP-ASN`)
 * and marks `ipcidr` providers so compilers append `no-resolve`.
 */
export const ipNoResolveModule: EnhancementModule = {
  id: 'ip-no-resolve',
  name: 'IP 规则补 no-resolve',
  description:
    '为目标 IP 类规则（IP-CIDR / IP-ASN / GEOIP）与 ipcidr 行为的规则集补充 no-resolve，避免提前触发 DNS 解析。',
  defaultEnabled: true,
  order: 50,
  affects: ['rules', 'providers'],
  supportedClients: ['mihomo', 'stash', 'surge', 'loon', 'quantumult-x', 'shadowrocket'],
  apply(template: ResolvedTemplate): ResolvedTemplate {
    const next = structuredClone(template);
    next.cards = next.cards.map((card) => {
      if (!card.enabled) return card;
      return {
        ...card,
        effective: {
          ...card.effective,
          matchers: card.effective.matchers.map(addNoResolveToMatcher),
        },
      };
    });
    return next;
  },
};
