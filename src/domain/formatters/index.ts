import type { ClientId, DomainRule, RuleCategory, RulesData } from '../../types/domain-rules';
import { slugify } from '../rules/slug';

export {
  BEHAVIOR_SPLIT_ORDER,
  classifyRuleBehavior,
  splitRulesetByBehavior,
  summarizeRulesetBehaviors,
  type BehaviorSplitCategoryInput,
  type BehaviorSplitFile,
  type BehaviorSplitOptions,
  type BehaviorSplitResult,
  type BehaviorSplitRule,
  type RulesetBehavior,
} from './behavior-split';

export type FormatterId =
  | ClientId
  | 'yaml'
  | 'mihomo'
  | 'openclash'
  | 'clash-verge'
  | 'stash'
  | 'surge-mac'
  | 'egern'
  | 'surfboard'
  | 'sing-box'
  | 'v2ray'
  | 'yaml-classical'
  | 'yaml-domain'
  | 'yaml-ipcidr';

export type FormatterSkippedRule = {
  type: DomainRule['type'];
  value: string;
  reason: string;
};

export type FormatResult = {
  body: string;
  skipped: FormatterSkippedRule[];
};

export type Formatter = {
  id: FormatterId;
  name: string;
  extension: string;
  format: (category: RuleCategory, data: RulesData) => string;
  formatWithReport?: (category: RuleCategory, data: RulesData) => FormatResult;
};

const NO_RESOLVE_RULE_TYPES = new Set<DomainRule['type']>(['IP-CIDR', 'SRC-IP-CIDR', 'IP-ASN', 'GEOIP']);
const QX_UNSUPPORTED_TYPES = new Set<DomainRule['type']>(['DOMAIN-REGEX', 'PROCESS-NAME', 'URL-REGEX', 'NETWORK']);
const LOON_UNSUPPORTED_TYPES = new Set<DomainRule['type']>(['PROCESS-NAME']);
/**
 * iOS clients (Loon, Quantumult X) cannot match by process, so PROCESS-NAME rules
 * are omitted from their rule files entirely (no comment line). They are still
 * listed in the compatibility report.
 */
const SILENTLY_DROPPED_TYPES = new Set<DomainRule['type']>(['PROCESS-NAME']);
const SINGBOX_UNSUPPORTED_NEW_TYPES = new Set<DomainRule['type']>(['USER-AGENT', 'URL-REGEX']);

function ruleLine(rule: DomainRule) {
  const noResolve = rule.options?.noResolve && NO_RESOLVE_RULE_TYPES.has(rule.type) ? ',no-resolve' : '';
  return `${rule.type},${rule.value}${noResolve}`;
}

function updatedLabel(category: RuleCategory) {
  const parsed = new Date(category.updatedAt);
  if (Number.isNaN(parsed.getTime())) return category.updatedAt;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(parsed);
}

function generationHeader(category: RuleCategory) {
  return [`# Generated for ${category.name} by Private Rules`, `# UPDATED: ${updatedLabel(category)}`];
}

function commentLines(note?: string, indent = '') {
  if (!note?.trim()) return [];
  return note
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `${indent}# --- ${line.replace(/^#+\s*/, '')} ---`);
}

function ruleNote(note?: string, indent = '') {
  if (!note?.trim()) return [];
  return note
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `${indent}# ${line.replace(/^#+\s*/, '')}`);
}

function enabled(category: RuleCategory) {
  const seen = new Set<string>();
  return category.rules.filter((rule) => {
    const key = `${rule.type}:${rule.value}`.toLowerCase();
    if (!rule.enabled || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function yaml(category: RuleCategory) {
  const lines = [...generationHeader(category), 'payload:'];
  lines.push(...commentLines(category.note || category.description, '  '));
  for (const rule of enabled(category)) {
    lines.push(...ruleNote(rule.note, '  '));
    lines.push(`  - ${ruleLine(rule)}`);
  }
  return `${lines.join('\n')}\n`;
}

function yamlPayload(category: RuleCategory, values: Array<{ value: string; note?: string }>) {
  const lines = [...generationHeader(category), values.length ? 'payload:' : 'payload: []'];
  lines.push(...commentLines(category.note || category.description, '  '));
  for (const item of values) {
    lines.push(...ruleNote(item.note, '  '));
    lines.push(`  - '${item.value.replace(/'/g, "''")}'`);
  }
  return `${lines.join('\n')}\n`;
}

/** Mihomo `behavior: domain`: exact domains and `+.` suffix matches only. */
export function domainYaml(category: RuleCategory) {
  const values = enabled(category).flatMap((rule) => {
    if (rule.type === 'DOMAIN') return [{ value: rule.value, note: rule.note }];
    if (rule.type === 'DOMAIN-SUFFIX') return [{ value: `+.${rule.value.replace(/^\+?\./, '')}`, note: rule.note }];
    return [];
  });
  return yamlPayload(category, values);
}

/** A Classical provider narrowed to IP and port rules for IP-oriented routing. */
export function ipcidrYaml(category: RuleCategory) {
  const rules = enabled(category).filter((item) =>
    ['DST-PORT', 'SRC-PORT', 'IP-CIDR', 'SRC-IP-CIDR'].includes(item.type),
  );
  const lines = [...generationHeader(category), rules.length ? 'payload:' : 'payload: []'];
  lines.push(...commentLines(category.note || category.description, '  '));
  for (const rule of rules) {
    lines.push(...ruleNote(rule.note, '  '));
    const base = `${rule.type},${rule.value}`;
    const noResolve = rule.type === 'IP-CIDR' || (rule.type === 'SRC-IP-CIDR' && rule.options?.noResolve);
    lines.push(`  - ${base}${noResolve ? ',no-resolve' : ''}`);
  }
  return `${lines.join('\n')}\n`;
}

export function listWithReport(category: RuleCategory, loonCompatible = false): FormatResult {
  const lines: string[] = generationHeader(category);
  const skipped: FormatterSkippedRule[] = [];
  lines.push(...commentLines(category.note || category.description));
  for (const rule of enabled(category)) {
    if (loonCompatible && LOON_UNSUPPORTED_TYPES.has(rule.type)) {
      const reason = `Loon does not support ${rule.type}`;
      skipped.push({ type: rule.type, value: rule.value, reason });
      if (!SILENTLY_DROPPED_TYPES.has(rule.type)) lines.push(`# skipped (${reason}): ${rule.type},${rule.value}`);
      continue;
    }
    lines.push(...ruleNote(rule.note));
    if (loonCompatible && rule.type === 'DST-PORT') {
      lines.push(`DEST-PORT,${rule.value}`);
    } else if (loonCompatible && rule.type === 'NETWORK') {
      lines.push(`PROTOCOL,${rule.value.toUpperCase()}`);
    } else {
      lines.push(ruleLine(rule));
    }
  }
  return { body: `${lines.join('\n')}\n`, skipped };
}

export function list(category: RuleCategory, loonCompatible = false) {
  return listWithReport(category, loonCompatible).body;
}

function qxType(type: DomainRule['type']) {
  if (type === 'DOMAIN') return 'HOST';
  if (type === 'DOMAIN-SUFFIX') return 'HOST-SUFFIX';
  if (type === 'DOMAIN-KEYWORD') return 'HOST-KEYWORD';
  return type;
}

export function quantumultXWithReport(category: RuleCategory, data: RulesData): FormatResult {
  const policy = data.settings.policyName.trim();
  const lines: string[] = generationHeader(category);
  const skipped: FormatterSkippedRule[] = [];
  lines.push(...commentLines(category.note || category.description));
  for (const rule of enabled(category)) {
    if (QX_UNSUPPORTED_TYPES.has(rule.type)) {
      const reason = `Quantumult X does not support ${rule.type}`;
      skipped.push({ type: rule.type, value: rule.value, reason });
      if (!SILENTLY_DROPPED_TYPES.has(rule.type)) lines.push(`# skipped (${reason}): ${rule.type},${rule.value}`);
      continue;
    }
    lines.push(...ruleNote(rule.note));
    const noResolve = rule.options?.noResolve && NO_RESOLVE_RULE_TYPES.has(rule.type) ? ',no-resolve' : '';
    const base = `${qxType(rule.type)},${rule.value}`;
    lines.push(policy ? `${base},${policy}${noResolve}` : `${base}${noResolve}`);
  }
  return { body: `${lines.join('\n')}\n`, skipped };
}

export function quantumultX(category: RuleCategory, data: RulesData) {
  return quantumultXWithReport(category, data).body;
}

export function singBoxJsonWithReport(category: RuleCategory): FormatResult {
  const destination: Record<string, Array<string | number>> = {};
  const source: Record<string, Array<string | number>> = {};
  const ports: Record<string, Array<string | number>> = {};
  const skipped: FormatterSkippedRule[] = [];
  const append = (target: Record<string, Array<string | number>>, field: string, value: string | number) => {
    (target[field] ??= []).push(value);
  };

  for (const rule of enabled(category)) {
    if (rule.type === 'DOMAIN') append(destination, 'domain', rule.value);
    else if (rule.type === 'DOMAIN-SUFFIX') append(destination, 'domain_suffix', rule.value);
    else if (rule.type === 'DOMAIN-KEYWORD') append(destination, 'domain_keyword', rule.value);
    else if (rule.type === 'DOMAIN-REGEX') append(destination, 'domain_regex', rule.value);
    else if (rule.type === 'IP-CIDR') append(destination, 'ip_cidr', rule.value);
    else if (rule.type === 'PROCESS-NAME') append(destination, 'process_name', rule.value);
    else if (rule.type === 'NETWORK') append(destination, 'network', rule.value.toLowerCase());
    else if (rule.type === 'SRC-IP-CIDR') append(source, 'source_ip_cidr', rule.value);
    else if (rule.type === 'SRC-PORT' && rule.value.includes('-')) {
      append(source, 'source_port_range', rule.value.replace('-', ':'));
    } else if (rule.type === 'SRC-PORT') append(source, 'source_port', Number(rule.value));
    else if (rule.type === 'DST-PORT' && rule.value.includes('-')) {
      append(ports, 'port_range', rule.value.replace('-', ':'));
    } else if (rule.type === 'DST-PORT') append(ports, 'port', Number(rule.value));
    else if (SINGBOX_UNSUPPORTED_NEW_TYPES.has(rule.type)) {
      skipped.push({
        type: rule.type,
        value: rule.value,
        reason: `sing-box rule-set does not support ${rule.type}`,
      });
    }
  }

  const rules = [destination, source, ports].filter((rule) => Object.keys(rule).length > 0);
  return {
    body: `${JSON.stringify({ version: 2, rules }, null, 2)}\n`,
    skipped,
  };
}

export function singBoxJson(category: RuleCategory) {
  return singBoxJsonWithReport(category).body;
}

export function url(category: RuleCategory) {
  return `${generationHeader(category).join('\n')}\n${enabled(category)
    .map((rule) => rule.value)
    .join('\n')}\n`;
}

export const formatters: Record<string, Formatter> = {
  general: { id: 'general', name: 'GeneralFormatter', extension: '.list', format: (category) => list(category) },
  yaml: { id: 'yaml', name: 'ClashFormatter', extension: '.yaml', format: (category) => yaml(category) },
  'yaml-classical': {
    id: 'yaml-classical',
    name: 'MihomoClassicalFormatter',
    extension: '_Classical.yaml',
    format: (category) => yaml(category),
  },
  'yaml-domain': {
    id: 'yaml-domain',
    name: 'MihomoDomainFormatter',
    extension: '_Domain.yaml',
    format: (category) => domainYaml(category),
  },
  'yaml-ipcidr': {
    id: 'yaml-ipcidr',
    name: 'MihomoIPCIDRFormatter',
    extension: '_IPCIDR.yaml',
    format: (category) => ipcidrYaml(category),
  },
  clash: { id: 'clash', name: 'ClashFormatter', extension: '.yaml', format: (category) => yaml(category) },
  mihomo: { id: 'mihomo', name: 'MihomoFormatter', extension: '.yaml', format: (category) => yaml(category) },
  openclash: { id: 'openclash', name: 'OpenClashFormatter', extension: '.yaml', format: (category) => yaml(category) },
  'clash-verge': {
    id: 'clash-verge',
    name: 'ClashVergeFormatter',
    extension: '.yaml',
    format: (category) => yaml(category),
  },
  stash: { id: 'stash', name: 'StashFormatter', extension: '.yaml', format: (category) => yaml(category) },
  loon: {
    id: 'loon',
    name: 'LoonFormatter',
    extension: '-loon.list',
    format: (category) => list(category, true),
    formatWithReport: (category) => listWithReport(category, true),
  },
  shadowrocket: {
    id: 'shadowrocket',
    name: 'ShadowrocketFormatter',
    extension: '-shadowrocket.list',
    format: (category) => list(category),
  },
  surge: { id: 'surge', name: 'SurgeFormatter', extension: '-surge.list', format: (category) => list(category) },
  'surge-mac': {
    id: 'surge-mac',
    name: 'SurgeMacFormatter',
    extension: '-surge.list',
    format: (category) => list(category),
  },
  egern: { id: 'egern', name: 'EgernFormatter', extension: '-egern.list', format: (category) => list(category) },
  surfboard: {
    id: 'surfboard',
    name: 'SurfboardFormatter',
    extension: '-surfboard.list',
    format: (category) => list(category),
  },
  'sing-box': {
    id: 'sing-box',
    name: 'SingBoxFormatter',
    extension: '-sing-box.json',
    format: (category) => singBoxJson(category),
    formatWithReport: (category) => singBoxJsonWithReport(category),
  },
  v2ray: { id: 'v2ray', name: 'V2RayFormatter', extension: '-v2ray.list', format: (category) => list(category) },
  'quantumult-x': {
    id: 'quantumult-x',
    name: 'QuantumultXFormatter',
    extension: '-qx.list',
    format: quantumultX,
    formatWithReport: quantumultXWithReport,
  },
  json: {
    id: 'json',
    name: 'JsonFormatter',
    extension: '.json',
    format: (category) => singBoxJson(category),
    formatWithReport: (category) => singBoxJsonWithReport(category),
  },
  url: { id: 'url', name: 'UrlFormatter', extension: '.txt', format: (category) => url(category) },
};

export function baseName(category: RuleCategory) {
  return slugify(category.slug || category.name);
}

export function fileNameForClient(category: RuleCategory, client: ClientId) {
  const formatter = formatters[client] ?? formatters.general;
  return `${baseName(category)}${formatter.extension}`;
}

export const SUBSCRIPTION_FILE_SUFFIXES: ReadonlyArray<readonly [string, Formatter]> = [
  ['_Classical.yaml', formatters['yaml-classical']],
  ['_Domain.yaml', formatters['yaml-domain']],
  // Compatibility for the common "Domian" typo used by older copied links.
  ['_Domian.yaml', formatters['yaml-domain']],
  ['_IPCIDR.yaml', formatters['yaml-ipcidr']],
  ['-shadowrocket.list', formatters.shadowrocket],
  ['-surfboard.list', formatters.surfboard],
  ['-sing-box.json', formatters['sing-box']],
  ['-surge.list', formatters.surge],
  ['-egern.list', formatters.egern],
  ['-v2ray.list', formatters.v2ray],
  ['-loon.list', formatters.loon],
  ['-qx.list', formatters['quantumult-x']],
  ['.yaml', formatters.yaml],
  ['.yml', formatters.yaml],
  ['.list', formatters.general],
  ['.conf', formatters.general],
  ['.txt', formatters.url],
  ['.json', formatters.json],
];

export type FormattedSubscriptionFile = {
  category: RuleCategory;
  formatter: Formatter;
  body: string;
  skipped: FormatterSkippedRule[];
  contentType: string;
};

/**
 * Splits a subscription filename into candidate `{ slug, formatter }` pairs
 * ordered so specific client suffixes (`-loon.list`, `_IPCIDR.yaml`, ...) take
 * precedence over generic ones (`.list`, `.yaml`), while still allowing a
 * category whose slug ends with `-loon` to fall back to `.list`.
 *
 * Suffix matching is case-insensitive (matching 1.0.7), while the extracted
 * `slug` preserves the original casing from `fileName` so callers can prefer
 * exact case matches before falling back to case-insensitive lookup.
 */
export function subscriptionFileCandidates(fileName: string): Array<{ slug: string; formatter: Formatter }> {
  const lower = fileName.toLowerCase();
  const candidates: Array<{ slug: string; formatter: Formatter }> = [];
  for (const [suffix, formatter] of SUBSCRIPTION_FILE_SUFFIXES) {
    const lowerSuffix = suffix.toLowerCase();
    if (lower.endsWith(lowerSuffix) && fileName.length > suffix.length) {
      candidates.push({ slug: fileName.slice(0, -suffix.length), formatter });
    }
  }
  return candidates;
}

export function subscriptionFileNamesForSlug(slug: string): string[] {
  const base = slugify(slug);
  return SUBSCRIPTION_FILE_SUFFIXES.map(([suffix]) => `${base}${suffix}`);
}

export function formatCategoryFile(
  category: RuleCategory,
  formatter: Formatter,
  data: RulesData,
): FormattedSubscriptionFile {
  const formatted = formatter.formatWithReport
    ? formatter.formatWithReport(category, data)
    : { body: formatter.format(category, data), skipped: [] };
  return {
    category,
    formatter,
    body: formatted.body,
    skipped: formatted.skipped,
    contentType:
      formatter.id === 'json' || formatter.id === 'sing-box'
        ? 'application/json; charset=utf-8'
        : 'text/plain; charset=utf-8',
  };
}

export function resolveFile(data: RulesData, fileName: string): FormattedSubscriptionFile | null {
  const candidates = subscriptionFileCandidates(fileName);
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    const exact = data.categories.find(
      (category) => category.enabled !== false && baseName(category) === candidate.slug,
    );
    if (exact) {
      return formatCategoryFile(exact, candidate.formatter, data);
    }

    const lowerSlug = candidate.slug.toLowerCase();
    const insensitive = data.categories.find(
      (category) => category.enabled !== false && baseName(category).toLowerCase() === lowerSlug,
    );
    if (insensitive) {
      return formatCategoryFile(insensitive, candidate.formatter, data);
    }
  }
  return null;
}
