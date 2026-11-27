import type { BuiltinPolicyId, Condition, Matcher, PolicyRef } from '../../../shared/schemas/card';
import type { RuleType } from '../../../shared/schemas/rule';
import type { MessageKey } from '../../i18n';

export type RoutePresetOption = {
  value: string;
  labelKey: MessageKey;
  ref: PolicyRef;
};

export const ROUTE_PRESET_OPTIONS: readonly RoutePresetOption[] = [
  {
    value: 'card:proxy-select',
    labelKey: 'cards.routePreset.proxySelect',
    ref: { kind: 'card', cardId: 'proxy-select' },
  },
  { value: 'card:auto-select', labelKey: 'cards.routePreset.autoSelect', ref: { kind: 'card', cardId: 'auto-select' } },
  { value: 'builtin:DIRECT', labelKey: 'cards.routePreset.direct', ref: { kind: 'builtin', id: 'DIRECT' } },
  { value: 'builtin:REJECT', labelKey: 'cards.routePreset.reject', ref: { kind: 'builtin', id: 'REJECT' } },
  {
    value: 'builtin:REJECT-DROP',
    labelKey: 'cards.routePreset.rejectDrop',
    ref: { kind: 'builtin', id: 'REJECT-DROP' },
  },
  {
    value: 'region:region-hk',
    labelKey: 'cards.routePreset.regionHk',
    ref: { kind: 'region', regionGroupId: 'region-hk' },
  },
  {
    value: 'region:region-tw',
    labelKey: 'cards.routePreset.regionTw',
    ref: { kind: 'region', regionGroupId: 'region-tw' },
  },
  {
    value: 'region:region-jp',
    labelKey: 'cards.routePreset.regionJp',
    ref: { kind: 'region', regionGroupId: 'region-jp' },
  },
  {
    value: 'region:region-sg',
    labelKey: 'cards.routePreset.regionSg',
    ref: { kind: 'region', regionGroupId: 'region-sg' },
  },
  {
    value: 'region:region-us',
    labelKey: 'cards.routePreset.regionUs',
    ref: { kind: 'region', regionGroupId: 'region-us' },
  },
  {
    value: 'region:region-kr',
    labelKey: 'cards.routePreset.regionKr',
    ref: { kind: 'region', regionGroupId: 'region-kr' },
  },
  { value: 'slot:slot-main', labelKey: 'cards.routePreset.slotMain', ref: { kind: 'slot', slotId: 'slot-main' } },
];

const BUILTIN_POLICIES: readonly BuiltinPolicyId[] = ['DIRECT', 'REJECT', 'REJECT-DROP'];
const RULE_TYPES: readonly RuleType[] = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'DOMAIN-REGEX',
  'IP-CIDR',
  'SRC-IP-CIDR',
  'IP-ASN',
  'DST-PORT',
  'SRC-PORT',
  'GEOSITE',
  'GEOIP',
  'PROCESS-NAME',
  'USER-AGENT',
  'URL-REGEX',
  'NETWORK',
];
const BUILTIN_SET = new Set<string>(BUILTIN_POLICIES);
const RULE_TYPE_SET = new Set<string>(RULE_TYPES);
const PRESET_BY_VALUE = new Map(ROUTE_PRESET_OPTIONS.map((item) => [item.value, item]));

export function serializePolicyRef(ref: PolicyRef): string {
  switch (ref.kind) {
    case 'builtin':
      return `builtin:${ref.id}`;
    case 'card':
      return `card:${ref.cardId}`;
    case 'region':
      return `region:${ref.regionGroupId}`;
    case 'pool':
      return `pool:${ref.poolId}`;
    case 'slot':
      return `slot:${ref.slotId}`;
  }
}

export function parsePolicyRef(raw: string): PolicyRef {
  const colonIdx = raw.indexOf(':');
  const kind = colonIdx > 0 ? raw.slice(0, colonIdx) : 'builtin';
  const target = colonIdx > 0 ? raw.slice(colonIdx + 1).trim() : raw.trim();

  if (kind === 'builtin' && BUILTIN_SET.has(target)) {
    return { kind: 'builtin', id: target as BuiltinPolicyId };
  }
  if (kind === 'card' && target) {
    return { kind: 'card', cardId: target };
  }
  if (kind === 'region' && target) {
    return { kind: 'region', regionGroupId: target };
  }
  if (kind === 'pool' && target) {
    return { kind: 'pool', poolId: target };
  }
  if (kind === 'slot' && target) {
    return { kind: 'slot', slotId: target };
  }
  return { kind: 'builtin', id: 'DIRECT' };
}

export function formatPolicyRefLabel(
  ref: PolicyRef,
  t: (key: MessageKey) => string,
  cardNames?: ReadonlyMap<string, string>,
): string {
  const key = serializePolicyRef(ref);
  const preset = PRESET_BY_VALUE.get(key);
  if (preset) return t(preset.labelKey);
  if (ref.kind === 'card') return cardNames?.get(ref.cardId) ?? ref.cardId;
  if (ref.kind === 'region') return ref.regionGroupId;
  if (ref.kind === 'pool') return ref.poolId;
  if (ref.kind === 'slot') return ref.slotId;
  return ref.id;
}

export function formatConditionLine(condition: Condition): string {
  if (condition.op === 'rule') {
    const suffix = condition.rule.options?.noResolve ? ',no-resolve' : '';
    return `${condition.rule.type},${condition.rule.value}${suffix}`;
  }
  if (condition.op === 'not') {
    return `NOT,(${formatConditionLine(condition.item)})`;
  }
  const opLabel = condition.op.toUpperCase();
  return `${opLabel},(${condition.items.map(formatConditionLine).join(', ')})`;
}

export function parseInlineRulesText(raw: string): Condition[] {
  const conditions: Condition[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(',').map((part) => part.trim());
    if (parts.length < 2) continue;
    const rawType = parts[0].toUpperCase() === 'IP-CIDR6' ? 'IP-CIDR' : parts[0].toUpperCase();
    if (!RULE_TYPE_SET.has(rawType)) continue;
    const value = parts[1];
    if (!value) continue;
    const noResolve = parts.slice(2).some((opt) => opt.toLowerCase() === 'no-resolve');
    conditions.push({
      op: 'rule',
      rule: {
        type: rawType as RuleType,
        value,
        ...(noResolve ? { options: { noResolve: true } } : {}),
      },
    });
  }
  return conditions;
}

export function formatMatcherSummary(matcher: Matcher, t: (key: MessageKey) => string): string {
  const prefix = t(`cards.matcherKind.${matcher.kind}` as MessageKey);
  switch (matcher.kind) {
    case 'catalog':
      return `${prefix}: ${matcher.entryId}`;
    case 'ruleset':
      return `${prefix}: ${matcher.ruleSetId}`;
    case 'geosite':
      return `${prefix}: ${matcher.name}`;
    case 'geoip':
      return `${prefix}: ${matcher.name}${matcher.noResolve ? ' (no-resolve)' : ''}`;
    case 'remote':
      return `${prefix}: ${matcher.url} (${matcher.behavior})`;
    case 'inline':
      return `${prefix}: ${matcher.conditions.length} (${matcher.conditions.slice(0, 2).map(formatConditionLine).join('; ')})`;
  }
}
