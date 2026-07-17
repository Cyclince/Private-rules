import type { DomainRule, RuleOptimizationMode } from '../types/domain-rules';

export type RuleCompactionResult = {
  rules: DomainRule[];
  originalCount: number;
  compactedCount: number;
  removedCount: number;
  generatedCount: number;
};

const DOMAIN_TYPES = new Set<DomainRule['type']>(['DOMAIN', 'DOMAIN-SUFFIX']);
const NOISY_KEYWORDS = new Set([
  'api', 'app', 'apps', 'cdn', 'cloud', 'download', 'edge', 'host', 'http', 'https', 'media',
  'mobile', 'net', 'online', 'prod', 'server', 'service', 'speed', 'st', 'static', 'test', 'web', 'www',
]);
const SPEEDTEST_SUFFIXES = ['ookla.com', 'ooklaserver.net', 'speedtest.net', 'stvidtest.net', 'nperf.com', 'fast.com'];
const SPEEDTEST_KEYWORDS = ['speedtest', 'ookla', 'nperf', 'velocidad', 'velocidade', 'velocimetro', 'medidor', 'spdt'];
const COMMON_SECOND_LEVEL_SUFFIXES = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);

function domainMatchesSuffix(domain: string, suffix: string) {
  return domain === suffix || domain.endsWith(`.${suffix}`);
}

function baseDomain(domain: string) {
  const labels = domain.split('.');
  if (labels.length <= 2) return domain;
  const tailLength = labels.at(-1)?.length === 2 && COMMON_SECOND_LEVEL_SUFFIXES.has(labels.at(-2) ?? '') ? 3 : 2;
  return labels.slice(-tailLength).join('.');
}

function keywordCandidates(domain: string) {
  const candidates = new Set<string>();
  for (const label of domain.split('.').slice(0, -1)) {
    candidates.add(label);
    for (const part of label.split(/[-_]/)) candidates.add(part);
  }
  return [...candidates].filter((value) => {
    if (value.length < 5 || value.length > 28 || NOISY_KEYWORDS.has(value)) return false;
    return /^[a-z][a-z0-9_-]*[a-z0-9]$/.test(value) && /[a-z]{4}/.test(value);
  });
}

function deriveKeywords(domainRules: DomainRule[]) {
  const matches = new Map<string, { rules: Set<string>; bases: Set<string> }>();
  for (const rule of domainRules) {
    for (const keyword of keywordCandidates(rule.value)) {
      const entry = matches.get(keyword) ?? { rules: new Set<string>(), bases: new Set<string>() };
      entry.rules.add(`${rule.type}:${rule.value}`);
      entry.bases.add(baseDomain(rule.value));
      matches.set(keyword, entry);
    }
  }

  const generic = [...matches.entries()]
    .filter(([, match]) => match.rules.size >= 6 && match.bases.size >= 4)
    .sort((a, b) => b[1].rules.size - a[1].rules.size || b[0].length - a[0].length)
    .map(([keyword]) => keyword);

  const speedtestEvidence = SPEEDTEST_SUFFIXES.some((suffix) => domainRules.some((rule) => domainMatchesSuffix(rule.value, suffix)))
    || SPEEDTEST_KEYWORDS.reduce((count, keyword) => count + (matches.get(keyword)?.rules.size ?? 0), 0) >= 8;
  const profile = speedtestEvidence
    ? SPEEDTEST_KEYWORDS.filter((keyword) => (matches.get(keyword)?.rules.size ?? 0) >= 2)
    : [];

  const selected: string[] = [];
  for (const keyword of [...profile, ...generic]) {
    if (selected.some((existing) => keyword.includes(existing) || existing.includes(keyword))) continue;
    selected.push(keyword);
    if (selected.length >= 16) break;
  }
  return selected;
}

function deriveSuffixes(domainRules: DomainRule[], mode: Exclude<RuleOptimizationMode, 'none'>) {
  const minimumLabels = mode === 'conservative' ? 4 : 3;
  const candidates = new Map<string, Set<string>>();
  for (const rule of domainRules) {
    const labels = rule.value.split('.');
    for (let start = 1; start <= labels.length - minimumLabels; start += 1) {
      const suffix = labels.slice(start).join('.');
      const matches = candidates.get(suffix) ?? new Set<string>();
      matches.add(`${rule.type}:${rule.value}`);
      candidates.set(suffix, matches);
    }
  }

  const known = mode === 'aggressive'
    ? SPEEDTEST_SUFFIXES.filter((suffix) => domainRules.some((rule) => domainMatchesSuffix(rule.value, suffix)))
    : [];
  const structural = [...candidates.entries()]
    .filter(([, matches]) => matches.size >= 4)
    .sort((a, b) => b[1].size - a[1].size || a[0].split('.').length - b[0].split('.').length)
    .map(([suffix]) => suffix);
  const selected: string[] = [];
  for (const suffix of [...known, ...structural]) {
    if (selected.some((parent) => domainMatchesSuffix(suffix, parent))) continue;
    for (let index = selected.length - 1; index >= 0; index -= 1) {
      if (domainMatchesSuffix(selected[index], suffix)) selected.splice(index, 1);
    }
    selected.push(suffix);
  }
  return selected;
}

function ipv4Network(value: string) {
  const [address, prefixText] = value.split('/');
  if (!address || !prefixText || address.includes(':')) return null;
  const octets = address.split('.').map(Number);
  const prefix = Number(prefixText);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255) || prefix < 0 || prefix > 32) return null;
  const ip = octets.reduce((result, octet) => ((result << 8) | octet) >>> 0, 0);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { network: (ip & mask) >>> 0, prefix };
}

function removeCoveredIpv4Rules(rules: DomainRule[]) {
  const parsed = rules.map((rule) => ({ rule, network: ipv4Network(rule.value) }));
  return parsed.filter((entry, index) => {
    if (!entry.network || (entry.rule.type !== 'IP-CIDR' && entry.rule.type !== 'SRC-IP-CIDR')) return true;
    return !parsed.some((candidate, candidateIndex) => {
      if (candidateIndex === index || candidate.rule.type !== entry.rule.type || !candidate.network) return false;
      if (candidate.network.prefix >= entry.network!.prefix) return false;
      const mask = candidate.network.prefix === 0 ? 0 : (0xffffffff << (32 - candidate.network.prefix)) >>> 0;
      return ((entry.network!.network & mask) >>> 0) === candidate.network.network;
    });
  }).map((entry) => entry.rule);
}

function generatedRule(type: 'DOMAIN-SUFFIX' | 'DOMAIN-KEYWORD', value: string, index: number, mode: Exclude<RuleOptimizationMode, 'none'>): DomainRule {
  const timestamp = new Date().toISOString();
  return {
    id: `compacted-${type.toLowerCase()}-${index}`,
    value,
    type,
    displayType: type === 'DOMAIN-SUFFIX' ? '域名后缀' : '域名关键词',
    enabled: true,
    note: `${mode === 'conservative' ? '保守' : '激进'}精简自动生成`,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Produces a coverage-preserving superset of the upstream rules. Exact
 * duplicates and already-covered details are removed; optimization heuristics
 * may intentionally cover additional sibling hosts, so every mode is opt-in.
 */
export function compactRules(input: DomainRule[], mode: Exclude<RuleOptimizationMode, 'none'>): RuleCompactionResult {
  const unique = new Map<string, DomainRule>();
  for (const rule of input) {
    const key = `${rule.type}:${rule.value}`.toLowerCase();
    if (!unique.has(key)) unique.set(key, rule);
  }
  const rules = [...unique.values()];
  const domainRules = rules.filter((rule) => DOMAIN_TYPES.has(rule.type));
  const existingSuffixes = rules.filter((rule) => rule.type === 'DOMAIN-SUFFIX').map((rule) => rule.value);
  const existingKeywords = rules.filter((rule) => rule.type === 'DOMAIN-KEYWORD').map((rule) => rule.value);
  const derivedSuffixes = deriveSuffixes(domainRules, mode).filter((suffix) => !existingSuffixes.includes(suffix));
  const derivedKeywords = mode === 'aggressive'
    ? deriveKeywords(domainRules).filter((keyword) => !existingKeywords.includes(keyword))
    : [];
  const allSuffixes = [...existingSuffixes, ...derivedSuffixes];
  const allKeywords = [...existingKeywords, ...derivedKeywords];

  const retained = rules.filter((rule) => {
    if (DOMAIN_TYPES.has(rule.type)) {
      const coveredBySuffix = allSuffixes.some((suffix) => domainMatchesSuffix(rule.value, suffix)
        && (rule.type === 'DOMAIN' || suffix !== rule.value));
      const coveredByKeyword = allKeywords.some((keyword) => rule.value.includes(keyword));
      return !coveredBySuffix && !coveredByKeyword;
    }
    if (rule.type === 'DOMAIN-KEYWORD') {
      return !allKeywords.some((keyword) => keyword !== rule.value && rule.value.includes(keyword));
    }
    return true;
  });
  const withIpv4CoverageRemoved = removeCoveredIpv4Rules(retained);
  const generated = [
    ...derivedSuffixes.map((suffix, index) => generatedRule('DOMAIN-SUFFIX', suffix, index, mode)),
    ...derivedKeywords.map((keyword, index) => generatedRule('DOMAIN-KEYWORD', keyword, index, mode)),
  ];
  const compacted = [...withIpv4CoverageRemoved, ...generated];
  return {
    rules: compacted,
    originalCount: input.length,
    compactedCount: compacted.length,
    removedCount: input.length - compacted.length,
    generatedCount: generated.length,
  };
}

/** @deprecated Use compactRules(input, 'aggressive'). */
export function compactRulesBalanced(input: DomainRule[]) {
  return compactRules(input, 'aggressive');
}
