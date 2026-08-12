import type { ClientId, DomainRule, RuleCategory, RulesData } from '../../types/domain-rules';
import { slugify } from '../slug';

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
  | 'v2ray';

export type Formatter = {
  id: FormatterId;
  name: string;
  extension: string;
  format: (category: RuleCategory, data: RulesData) => string;
};

function ruleLine(rule: DomainRule) {
  return `${rule.type},${rule.value}`;
}

function updatedLabel(category: RuleCategory) {
  const parsed = new Date(category.updatedAt);
  if (Number.isNaN(parsed.getTime())) return category.updatedAt;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
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

export function list(category: RuleCategory) {
  const lines: string[] = generationHeader(category);
  lines.push(...commentLines(category.note || category.description));
  for (const rule of enabled(category)) {
    lines.push(...ruleNote(rule.note));
    lines.push(ruleLine(rule));
  }
  return `${lines.join('\n')}\n`;
}

function qxType(type: DomainRule['type']) {
  if (type === 'DOMAIN') return 'HOST';
  if (type === 'DOMAIN-SUFFIX') return 'HOST-SUFFIX';
  if (type === 'DOMAIN-KEYWORD') return 'HOST-KEYWORD';
  return type;
}

export function quantumultX(category: RuleCategory, data: RulesData) {
  const policy = data.settings.policyName.trim();
  const lines: string[] = generationHeader(category);
  lines.push(...commentLines(category.note || category.description));
  for (const rule of enabled(category)) {
    lines.push(...ruleNote(rule.note));
    const base = `${qxType(rule.type)},${rule.value}`;
    lines.push(policy ? `${base},${policy}` : base);
  }
  return `${lines.join('\n')}\n`;
}

export function singBoxJson(category: RuleCategory) {
  const destination: Record<string, Array<string | number>> = {};
  const source: Record<string, string[]> = {};
  const ports: Record<string, Array<string | number>> = {};
  const append = (target: Record<string, Array<string | number>>, field: string, value: string | number) => {
    (target[field] ??= []).push(value);
  };

  for (const rule of enabled(category)) {
    if (rule.type === 'DOMAIN') append(destination, 'domain', rule.value);
    else if (rule.type === 'DOMAIN-SUFFIX') append(destination, 'domain_suffix', rule.value);
    else if (rule.type === 'DOMAIN-KEYWORD') append(destination, 'domain_keyword', rule.value);
    else if (rule.type === 'IP-CIDR') append(destination, 'ip_cidr', rule.value);
    else if (rule.type === 'SRC-IP-CIDR') append(source, 'source_ip_cidr', rule.value);
    else if (rule.type === 'DST-PORT' && rule.value.includes('-')) append(ports, 'port_range', rule.value.replace('-', ':'));
    else if (rule.type === 'DST-PORT') append(ports, 'port', Number(rule.value));
  }

  const rules = [destination, source, ports].filter((rule) => Object.keys(rule).length > 0);
  return `${JSON.stringify({
    _meta: {
      generatedFor: category.name,
      generatedBy: 'Private Rules',
      updatedAt: updatedLabel(category),
      description: category.note?.trim() || category.description?.trim() || `${category.name}规则`,
    },
    version: 2,
    rules,
  }, null, 2)}\n`;
}

export function url(category: RuleCategory) {
  return `${generationHeader(category).join('\n')}\n${enabled(category)
    .map((rule) => rule.value)
    .join('\n')}\n`;
}

export const formatters: Record<string, Formatter> = {
  general: { id: 'general', name: 'GeneralFormatter', extension: '.list', format: (category) => list(category) },
  yaml: { id: 'yaml', name: 'ClashFormatter', extension: '.yaml', format: (category) => yaml(category) },
  clash: { id: 'clash', name: 'ClashFormatter', extension: '.yaml', format: (category) => yaml(category) },
  mihomo: { id: 'mihomo', name: 'MihomoFormatter', extension: '.yaml', format: (category) => yaml(category) },
  openclash: { id: 'openclash', name: 'OpenClashFormatter', extension: '.yaml', format: (category) => yaml(category) },
  'clash-verge': { id: 'clash-verge', name: 'ClashVergeFormatter', extension: '.yaml', format: (category) => yaml(category) },
  stash: { id: 'stash', name: 'StashFormatter', extension: '.yaml', format: (category) => yaml(category) },
  loon: { id: 'loon', name: 'LoonFormatter', extension: '.list', format: (category) => list(category) },
  shadowrocket: { id: 'shadowrocket', name: 'ShadowrocketFormatter', extension: '-shadowrocket.list', format: (category) => list(category) },
  surge: { id: 'surge', name: 'SurgeFormatter', extension: '-surge.list', format: (category) => list(category) },
  'surge-mac': { id: 'surge-mac', name: 'SurgeMacFormatter', extension: '-surge.list', format: (category) => list(category) },
  egern: { id: 'egern', name: 'EgernFormatter', extension: '-egern.list', format: (category) => list(category) },
  surfboard: { id: 'surfboard', name: 'SurfboardFormatter', extension: '-surfboard.list', format: (category) => list(category) },
  'sing-box': { id: 'sing-box', name: 'SingBoxFormatter', extension: '-sing-box.json', format: (category) => singBoxJson(category) },
  v2ray: { id: 'v2ray', name: 'V2RayFormatter', extension: '-v2ray.list', format: (category) => list(category) },
  'quantumult-x': { id: 'quantumult-x', name: 'QuantumultXFormatter', extension: '-qx.list', format: quantumultX },
  json: { id: 'json', name: 'JsonFormatter', extension: '.json', format: (category) => singBoxJson(category) },
  url: { id: 'url', name: 'UrlFormatter', extension: '.txt', format: (category) => url(category) },
};

export function baseName(category: RuleCategory) {
  return slugify(category.slug || category.name);
}

export function fileNameForClient(category: RuleCategory, client: ClientId) {
  const formatter = formatters[client] ?? formatters.general;
  return `${baseName(category)}${formatter.extension}`;
}

export function resolveFile(data: RulesData, fileName: string) {
  const lower = fileName.toLowerCase();
  for (const category of data.categories) {
    if (category.enabled === false) continue;
    const base = baseName(category).toLowerCase();
    const candidates: Array<[string, Formatter]> = [
      [`${base}.yaml`, formatters.yaml],
      [`${base}.yml`, formatters.yaml],
      [`${base}.list`, formatters.general],
      [`${base}.conf`, formatters.general],
      [`${base}.txt`, formatters.url],
      [`${base}-qx.list`, formatters['quantumult-x']],
      [`${base}-surge.list`, formatters.surge],
      [`${base}-shadowrocket.list`, formatters.shadowrocket],
      [`${base}-egern.list`, formatters.egern],
      [`${base}-surfboard.list`, formatters.surfboard],
      [`${base}-sing-box.json`, formatters['sing-box']],
      [`${base}-v2ray.list`, formatters.v2ray],
      [`${base}.json`, formatters.json],
    ];
    const match = candidates.find(([candidate]) => candidate === lower);
    if (match) {
      const formatter = match[1];
      return {
        category,
        formatter,
        body: formatter.format(category, data),
        contentType: formatter.id === 'json' || formatter.id === 'sing-box' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      };
    }
  }
  return null;
}
