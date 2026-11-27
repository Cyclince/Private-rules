import type { DomainRule, DomainRuleType, RuleCategory } from '../../types/domain-rules';
import { parseCidrRange } from '../rules/conflicts';
import { deduplicateCoveredRules } from '../rules/coverage-dedup';
import { slugify } from '../rules/slug';

/**
 * Canonical behavior split order (design §9.5):
 * `domain` (exact/suffix, fastest trie) -> `classical` (keywords/regex/ports/geo) -> `ipcidr` (IPv4/IPv6 CIDR).
 */
export const BEHAVIOR_SPLIT_ORDER = ['domain', 'classical', 'ipcidr'] as const;

export type RulesetBehavior = (typeof BEHAVIOR_SPLIT_ORDER)[number];

export type BehaviorSplitRule = Pick<DomainRule, 'type' | 'value' | 'enabled' | 'options'>;

export type BehaviorSplitCategoryInput = Pick<RuleCategory, 'name' | 'slug' | 'updatedAt'> & {
  rules: readonly BehaviorSplitRule[];
  sourceLabel?: string;
};

export type BehaviorSplitOptions = {
  /** Human-readable source attribution written to `# SOURCE:`. Defaults to category slug/name. */
  source?: string;
  /** Override `# UPDATED:` timestamp string. Defaults to category.updatedAt (ISO-8601 or formatted). */
  updatedAt?: string;
  /** Whether to apply coverage deduplication before splitting (defaults to `false`). */
  coverageDedup?: boolean;
};

export type BehaviorSplitFile = {
  behavior: RulesetBehavior;
  /** Conventional YAML ruleset filename, e.g. `<slug>_domain.yaml`. */
  fileName: string;
  /** Conventional plain-text ruleset filename, e.g. `<slug>_domain.list`. */
  textFileName: string;
  count: number;
  entries: string[];
  yaml: string;
  text: string;
};

export type BehaviorSplitResult = {
  order: readonly RulesetBehavior[];
  total: number;
  counts: Record<RulesetBehavior, number>;
  buckets: Record<RulesetBehavior, string[]>;
  /** Non-empty behavior files in strict `domain -> classical -> ipcidr` order. */
  files: BehaviorSplitFile[];
};

const CLASSICAL_NO_RESOLVE_TYPES = new Set<DomainRuleType>(['IP-CIDR', 'IP-ASN', 'GEOIP']);

const CLASSICAL_TYPE_ORDER: Readonly<Record<string, number>> = {
  'DOMAIN-KEYWORD': 1,
  'DOMAIN-REGEX': 2,
  GEOSITE: 3,
  'PROCESS-NAME': 4,
  'DST-PORT': 5,
  'SRC-PORT': 6,
  'USER-AGENT': 7,
  'URL-REGEX': 8,
  'SRC-IP-CIDR': 9,
  'IP-ASN': 10,
  GEOIP: 11,
  NETWORK: 12,
};

function compareAscii(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Strips CR/LF/Unicode line separators and control characters so comment headers
 * cannot break out into YAML keys or executable rules.
 */
function sanitizeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\r\n\u2028\u2029\x00-\x1f\x7f]+/g, ' ').trim();
}

function sanitizeRuleScalar(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\r\n\u2028\u2029\x00-\x1f\x7f]+/g, '').trim();
}

function quoteYamlSingleScalar(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Classifies a single rule into its disjoint behavior bucket (design §9.5):
 * - `DOMAIN` / `DOMAIN-SUFFIX` -> `domain`
 * - `IP-CIDR` (IPv4 & IPv6 destination CIDR) -> `ipcidr`
 * - All other types (including `SRC-IP-CIDR`, ports, keywords, regex, geo) -> `classical`
 */
export function classifyRuleBehavior(rule: Pick<BehaviorSplitRule, 'type'>): RulesetBehavior {
  if (rule.type === 'DOMAIN' || rule.type === 'DOMAIN-SUFFIX') return 'domain';
  if (rule.type === 'IP-CIDR') return 'ipcidr';
  return 'classical';
}

type DomainEntry = {
  normalized: string;
  isExact: boolean;
  formatted: string;
};

type IpCidrEntry = {
  formatted: string;
  ipv6: boolean;
  start: bigint;
  end: bigint;
  valid: boolean;
};

type ClassicalEntry = {
  typeRank: number;
  type: string;
  lowerValue: string;
  formatted: string;
};

function prepareActiveRules(rules: readonly BehaviorSplitRule[], coverageDedup: boolean): BehaviorSplitRule[] {
  const enabledRules = rules.filter((rule) => rule.enabled !== false);
  const deduped = deduplicateCoveredRules(enabledRules, { enabled: coverageDedup, sampleLimit: 0 });
  return deduped.rules;
}

function partitionAndSort(
  rules: readonly BehaviorSplitRule[],
  coverageDedup: boolean,
): Record<RulesetBehavior, string[]> {
  const active = prepareActiveRules(rules, coverageDedup);

  const domainEntries: DomainEntry[] = [];
  const classicalEntries: ClassicalEntry[] = [];
  const ipcidrEntries: IpCidrEntry[] = [];

  for (const rule of active) {
    const cleanValue = sanitizeRuleScalar(rule.value);
    if (!cleanValue) continue;
    const behavior = classifyRuleBehavior(rule);

    if (behavior === 'domain') {
      const normalized = cleanValue
        .toLowerCase()
        .replace(/^\+?\./, '')
        .replace(/\.$/, '');
      if (!normalized) continue;
      const isExact = rule.type === 'DOMAIN';
      domainEntries.push({
        normalized,
        isExact,
        formatted: isExact ? normalized : `+.${normalized}`,
      });
      continue;
    }

    if (behavior === 'ipcidr') {
      const parsed = parseCidrRange(cleanValue);
      ipcidrEntries.push({
        formatted: cleanValue,
        ipv6: parsed?.ipv6 ?? cleanValue.includes(':'),
        start: parsed?.start ?? 0n,
        end: parsed?.end ?? 0n,
        valid: Boolean(parsed),
      });
      continue;
    }

    const noResolve = rule.options?.noResolve && CLASSICAL_NO_RESOLVE_TYPES.has(rule.type) ? ',no-resolve' : '';
    const formatted = `${rule.type},${cleanValue}${noResolve}`;
    classicalEntries.push({
      typeRank: CLASSICAL_TYPE_ORDER[rule.type] ?? 99,
      type: rule.type,
      lowerValue: cleanValue.toLowerCase(),
      formatted,
    });
  }

  // Deterministic, locale-independent sorting per bucket
  domainEntries.sort(
    (a, b) =>
      compareAscii(a.normalized, b.normalized) ||
      (a.isExact === b.isExact ? 0 : a.isExact ? 1 : -1) ||
      compareAscii(a.formatted, b.formatted),
  );

  classicalEntries.sort(
    (a, b) =>
      a.typeRank - b.typeRank ||
      compareAscii(a.type, b.type) ||
      compareAscii(a.lowerValue, b.lowerValue) ||
      compareAscii(a.formatted, b.formatted),
  );

  ipcidrEntries.sort((a, b) => {
    if (a.valid !== b.valid) return a.valid ? -1 : 1;
    if (a.ipv6 !== b.ipv6) return a.ipv6 ? 1 : -1;
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    if (a.end !== b.end) return a.end > b.end ? -1 : 1;
    return compareAscii(a.formatted, b.formatted);
  });

  // Final exact-string deduplication after canonical formatting
  const unique = (items: readonly string[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
    return out;
  };

  return {
    domain: unique(domainEntries.map((item) => item.formatted)),
    classical: unique(classicalEntries.map((item) => item.formatted)),
    ipcidr: unique(ipcidrEntries.map((item) => item.formatted)),
  };
}

function buildHeaderLines(meta: { name: string; source: string; total: number; updated: string }): string[] {
  return [
    `# NAME: ${sanitizeHeaderValue(meta.name)}`,
    `# SOURCE: ${sanitizeHeaderValue(meta.source)}`,
    `# TOTAL: ${meta.total}`,
    `# UPDATED: ${sanitizeHeaderValue(meta.updated)}`,
  ];
}

function formatBehaviorYaml(
  meta: { name: string; source: string; total: number; updated: string },
  entries: readonly string[],
): string {
  const lines = [...buildHeaderLines(meta), entries.length > 0 ? 'payload:' : 'payload: []'];
  for (const entry of entries) {
    lines.push(`  - ${quoteYamlSingleScalar(entry)}`);
  }
  return `${lines.join('\n')}\n`;
}

function formatBehaviorText(
  meta: { name: string; source: string; total: number; updated: string },
  entries: readonly string[],
): string {
  const lines = [...buildHeaderLines(meta), ...entries];
  return `${lines.join('\n')}\n`;
}

/**
 * Counts rules per disjoint behavior bucket (`domain`, `classical`, `ipcidr`),
 * directly matching `planRulesetReferences`'s `rulesetBehaviors` input.
 */
export function summarizeRulesetBehaviors(
  rules: readonly BehaviorSplitRule[],
  options: { coverageDedup?: boolean } = {},
): Record<RulesetBehavior, number> {
  const buckets = partitionAndSort(rules, options.coverageDedup ?? false);
  return {
    domain: buckets.domain.length,
    classical: buckets.classical.length,
    ipcidr: buckets.ipcidr.length,
  };
}

/**
 * Splits a ruleset into disjoint `domain`, `classical`, and `ipcidr` artifacts
 * in strict `domain -> classical -> ipcidr` order with deterministic sorting
 * and standardized `# NAME / # SOURCE / # TOTAL / # UPDATED` headers (design §9.5).
 *
 * Pure function; does not alter any legacy 1.0.x subscription formatter output.
 */
export function splitRulesetByBehavior(
  category: BehaviorSplitCategoryInput,
  options: BehaviorSplitOptions = {},
): BehaviorSplitResult {
  const buckets = partitionAndSort(category.rules, options.coverageDedup ?? false);
  const baseSlug = slugify(category.slug || category.name);
  const sourceLabel = options.source ?? category.sourceLabel ?? `private-rules/${baseSlug}`;
  const updated = options.updatedAt ?? category.updatedAt;

  const files: BehaviorSplitFile[] = [];
  for (const behavior of BEHAVIOR_SPLIT_ORDER) {
    const entries = buckets[behavior];
    if (entries.length === 0) continue;
    const meta = {
      name: `${category.name} (${behavior})`,
      source: sourceLabel,
      total: entries.length,
      updated,
    };
    files.push({
      behavior,
      fileName: `${baseSlug}_${behavior}.yaml`,
      textFileName: `${baseSlug}_${behavior}.list`,
      count: entries.length,
      entries,
      yaml: formatBehaviorYaml(meta, entries),
      text: formatBehaviorText(meta, entries),
    });
  }

  const counts: Record<RulesetBehavior, number> = {
    domain: buckets.domain.length,
    classical: buckets.classical.length,
    ipcidr: buckets.ipcidr.length,
  };

  return {
    order: BEHAVIOR_SPLIT_ORDER,
    total: counts.domain + counts.classical + counts.ipcidr,
    counts,
    buckets,
    files,
  };
}
