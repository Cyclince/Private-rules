import type { FriendlyRuleDescriptor } from '../../../domain/rules/friendly';
import type { DomainRule, RuleCategory } from '../../../types/domain-rules';
import type { MessageKey } from '../../i18n';

export type RuleCategorySortKey = 'alpha' | 'count' | 'created' | 'modified';
export type SortDirection = 'asc' | 'desc';

const SORT_STORAGE_KEY = 'private-rules-sort-rule-categories';
const VALID_SORT_KEYS = new Set<RuleCategorySortKey>(['alpha', 'count', 'created', 'modified']);

export const SYNC_INTERVAL_OPTIONS: ReadonlyArray<{ value: number; labelKey: MessageKey }> = [
  { value: 15, labelKey: 'ruleDialog.interval15' },
  { value: 30, labelKey: 'ruleDialog.interval30' },
  { value: 60, labelKey: 'ruleDialog.interval60' },
  { value: 360, labelKey: 'ruleDialog.interval360' },
  { value: 720, labelKey: 'ruleDialog.interval720' },
  { value: 1440, labelKey: 'ruleDialog.interval1440' },
];

export function intervalLabelKey(minutes?: number): MessageKey {
  switch (minutes) {
    case 15:
      return 'ruleDialog.interval15';
    case 30:
      return 'ruleDialog.interval30';
    case 360:
      return 'ruleDialog.interval360';
    case 720:
      return 'ruleDialog.interval720';
    case 1440:
      return 'ruleDialog.interval1440';
    default:
      return 'ruleDialog.interval60';
  }
}

export function readStoredRuleSort(): { key: RuleCategorySortKey; direction: SortDirection } {
  if (typeof window === 'undefined') return { key: 'alpha', direction: 'asc' };
  try {
    const saved = window.localStorage.getItem(SORT_STORAGE_KEY);
    if (!saved) return { key: 'alpha', direction: 'asc' };
    const [rawKey, rawDir] = saved.split(':');
    const key = VALID_SORT_KEYS.has(rawKey as RuleCategorySortKey) ? (rawKey as RuleCategorySortKey) : 'alpha';
    const direction: SortDirection = rawDir === 'desc' ? 'desc' : 'asc';
    return { key, direction };
  } catch {
    return { key: 'alpha', direction: 'asc' };
  }
}

export function writeStoredRuleSort(key: RuleCategorySortKey, direction: SortDirection): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, `${key}:${direction}`);
  } catch {
    // Ignore storage errors in restricted contexts.
  }
}

export function nextRuleSortDirection(
  currentKey: RuleCategorySortKey,
  currentDirection: SortDirection,
  nextKey: RuleCategorySortKey,
): SortDirection {
  if (nextKey === currentKey) {
    return currentDirection === 'desc' ? 'asc' : 'desc';
  }
  return nextKey === 'alpha' ? 'asc' : 'desc';
}

export function sortRuleCategories(
  categories: readonly RuleCategory[],
  key: RuleCategorySortKey,
  direction: SortDirection,
): RuleCategory[] {
  const sign = direction === 'desc' ? -1 : 1;
  return [...categories].sort((a, b) => {
    if (key === 'alpha') {
      return a.name.localeCompare(b.name, 'zh-CN') * sign;
    }
    if (key === 'count') {
      return ((a.ruleCount ?? a.rules.length) - (b.ruleCount ?? b.rules.length)) * sign;
    }
    const aTime = key === 'created' ? a.createdAt : a.updatedAt;
    const bTime = key === 'created' ? b.createdAt : b.updatedAt;
    return (Date.parse(aTime ?? '') - Date.parse(bTime ?? '')) * sign;
  });
}

export function formatSyncTimestamp(iso?: string): string {
  if (!iso) return '';
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toLocaleString();
}

export function formatFriendlyRuleType(descriptor: FriendlyRuleDescriptor, t: (key: MessageKey) => string): string {
  return t(descriptor.typeKey);
}

export function formatFriendlyRuleInline(descriptor: FriendlyRuleDescriptor, t: (key: MessageKey) => string): string {
  const typeLabel = t(descriptor.typeKey);
  const template = t(descriptor.inlineKey);
  return template
    .replace('{type}', typeLabel)
    .replace('{value}', descriptor.params.displayValue)
    .replace('{start}', descriptor.params.start ?? '')
    .replace('{end}', descriptor.params.end ?? '')
    .replace('{count}', descriptor.params.count ?? '')
    .replace('{zhCount}', descriptor.params.zhCount ?? '')
    .replace('{enCount}', descriptor.params.enCount ?? '')
    .replace('{prefix}', descriptor.params.prefix ?? '');
}

/** No extra label for no-resolve; only explain DNS resolution when it is allowed. */
export function formatRuleResolveHint(
  rule: Pick<DomainRule, 'type' | 'options'>,
  t: (key: MessageKey) => string,
): string {
  const isIpRule = ['IP-CIDR', 'SRC-IP-CIDR', 'IP-ASN', 'GEOIP'].includes(rule.type);
  return isIpRule && !rule.options?.noResolve ? t('ruleDetail.willResolveDomains') : '';
}

export function splitNonEmptyLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
