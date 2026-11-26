import type {
  AppCard,
  BuiltinPolicyId,
  CatalogCategory,
  Condition,
  GroupType,
  InlineRule,
  Matcher,
  RemoteRuleBehavior,
  RemoteRuleFormat,
  Stage,
} from '../../../shared/schemas/card';
import { RULE_TYPE_VALUES, type RuleType } from '../../../shared/schemas/rule';
import { detectNodeRegions, findRegionByQuery } from '../../nodes';
import { inferCardStage } from '../stages';

const RULE_TYPE_SET = new Set<string>(RULE_TYPE_VALUES);
const BUILTIN_POLICY_MAP = new Map<string, BuiltinPolicyId>([
  ['DIRECT', 'DIRECT'],
  ['REJECT', 'REJECT'],
  ['REJECT-DROP', 'REJECT-DROP'],
]);

const GROUP_TYPE_SET = new Set<GroupType>(['select', 'url-test', 'fallback', 'load-balance']);

/** Deterministic FNV-1a 32-bit hex digest for stable CJK/symbol IDs without randomness. */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Converts an arbitrary group/slot name into a deterministic, URL-safe slug. */
export function makeDeterministicSlug(rawName: string, prefix = 'group'): string {
  const ascii = rawName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  if (ascii.length >= 2) {
    return ascii;
  }
  return `${prefix}-${fnv1aHex(rawName.trim())}`;
}

export function allocateUniqueId(baseSlug: string, used: Set<string>): string {
  let candidate = baseSlug;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${baseSlug}-${counter}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

export function parseBuiltinPolicy(name: string): BuiltinPolicyId | null {
  return BUILTIN_POLICY_MAP.get(name.trim().toUpperCase()) ?? null;
}

export function parseGroupType(raw: string): GroupType | null {
  const normalized = raw.trim().toLowerCase() as GroupType;
  return GROUP_TYPE_SET.has(normalized) ? normalized : null;
}

export function inferRemoteFormatFromUrl(url: string): RemoteRuleFormat {
  const lower = url.toLowerCase();
  if (lower.endsWith('.mrs')) return 'mrs';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  return 'text';
}

export function inferRemoteBehaviorFromUrl(url: string): RemoteRuleBehavior {
  const lower = url.toLowerCase();
  if (/ipcidr|geoip|chinaip|ip\.list|ip\.yaml/.test(lower)) return 'ipcidr';
  if (/domain\.list|domain\.yaml|geosite/.test(lower)) return 'domain';
  return 'classical';
}

/**
 * Normalizes a rule type token (`IP-CIDR6` -> `IP-CIDR`) and validates it
 * against the 14 canonical rule types.
 */
export function normalizeRuleType(rawType: string): RuleType | null {
  const upper = rawType.trim().toUpperCase();
  const normalized = upper === 'IP-CIDR6' ? 'IP-CIDR' : upper;
  return RULE_TYPE_SET.has(normalized) ? (normalized as RuleType) : null;
}

export function parseInlineRuleParts(rawType: string, rawValue: string, noResolve: boolean): InlineRule | null {
  const type = normalizeRuleType(rawType);
  if (!type) return null;
  const value = rawValue.trim();
  if (!value) return null;
  return {
    type,
    value,
    ...(noResolve ? { options: { noResolve: true } } : {}),
  };
}

/** Splits a comma-separated expression respecting nested parentheses. */
export function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts;
}

/** Parses a mihomo logical condition expression such as `(DOMAIN-SUFFIX,a.com)` or `(AND,((...),(...)))`. */
export function parseConditionExpr(expr: string): Condition | null {
  let trimmed = expr.trim();
  while (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    // Only unwrap if the outer parentheses match each other
    let depth = 0;
    let wrapsEntire = true;
    for (let i = 0; i < trimmed.length - 1; i += 1) {
      if (trimmed[i] === '(') depth += 1;
      else if (trimmed[i] === ')') depth -= 1;
      if (depth === 0) {
        wrapsEntire = false;
        break;
      }
    }
    if (!wrapsEntire) break;
    trimmed = trimmed.slice(1, -1).trim();
  }

  const parts = splitTopLevelCommas(trimmed);
  if (parts.length < 2) return null;
  const head = parts[0].toUpperCase();

  if (head === 'AND' || head === 'OR') {
    const bodyExpr = parts.slice(1).join(',').trim();
    const unwrapped = bodyExpr.startsWith('(') && bodyExpr.endsWith(')') ? bodyExpr.slice(1, -1) : bodyExpr;
    const subExprs = splitTopLevelCommas(unwrapped);
    const items: Condition[] = [];
    for (const sub of subExprs) {
      const parsed = parseConditionExpr(sub);
      if (!parsed) return null;
      items.push(parsed);
    }
    if (items.length === 0) return null;
    return { op: head === 'AND' ? 'and' : 'or', items };
  }

  if (head === 'NOT') {
    const bodyExpr = parts.slice(1).join(',').trim();
    const inner = parseConditionExpr(bodyExpr);
    if (!inner) return null;
    return { op: 'not', item: inner };
  }

  // Atomic rule: TYPE,VALUE[,no-resolve]
  const hasNoResolve = parts.slice(2).some((opt) => opt.toLowerCase() === 'no-resolve');
  const rule = parseInlineRuleParts(parts[0], parts[1], hasNoResolve);
  if (!rule) return null;
  return { op: 'rule', rule };
}

/**
 * Attempts to recognize a single built-in region ISO code for a node-filter-only
 * proxy group (design §10.5 & §10.11).
 */
export function detectSingleRegionForGroup(name: string, includeRegex?: string): string | null {
  const exact = findRegionByQuery(name);
  if (exact) return exact.code;

  const fromName = detectNodeRegions(name);
  if (fromName.length === 1) return fromName[0];
  if (fromName.length > 1) return null;

  if (includeRegex) {
    // Strip negative lookahead groups like `(?!.*(流量|到期))` before inspecting positive tokens
    const positiveOnly = includeRegex.replace(/\(\?![^)]*\)/g, ' ');
    const fromRegex = detectNodeRegions(positiveOnly);
    if (fromRegex.length === 1) return fromRegex[0];
  }
  return null;
}

/** Infers a `CatalogCategory` from group name and matchers for imported cards. */
export function inferCardCategory(name: string, matchers: readonly Matcher[]): CatalogCategory {
  const matcherHints = matchers
    .map((m) => {
      if (m.kind === 'geosite' || m.kind === 'geoip') return m.name;
      if (m.kind === 'remote') return m.url;
      if (m.kind === 'catalog') return m.entryId;
      return '';
    })
    .join(' ');
  const text = `${name} ${matcherHints}`.toLowerCase();

  if (/\b(openai|chatgpt|claude|anthropic|gemini|copilot|ai)\b|人工智能/.test(text)) return 'ai';
  if (
    /\b(youtube|netflix|disney|bilibili|spotify|tiktok|media|streaming|hbo|bahamut)\b|油管|奈飞|媒体|流媒体|哔哩/.test(
      text,
    )
  ) {
    return 'streaming';
  }
  if (/\b(telegram|twitter|discord|facebook|instagram|whatsapp|social)\b|电报|推特|社交/.test(text)) return 'social';
  if (/\b(steam|epic|game|gaming|playstation|xbox|nintendo|blizzard)\b|游戏/.test(text)) return 'gaming';
  if (/\b(adblock|adguard|banad|ads|privacy|hijacking|reject)\b|广告|拦截|隐私|净化/.test(text)) {
    return 'advertising';
  }
  if (/\b(china|cn|domestic|direct|lan|local|private)\b|国内|大陆|直连|局域网/.test(text)) return 'domestic';
  if (
    /\b(google|apple|microsoft|github|onedrive|gfw|proxy|auto|select|dns|tunnel)\b|谷歌|苹果|微软|代理|节点/.test(text)
  ) {
    return 'infrastructure';
  }
  return 'other';
}

/**
 * Infers the 7-layer stage for an imported card, prioritizing explicit domestic
 * geo matchers (`GEOSITE,cn` / `GEOIP,cn`) over generic "直连" group names.
 */
export function inferImportedCardStage(card: Pick<AppCard, 'slug' | 'name' | 'category' | 'matchers'>): Stage {
  if (
    card.matchers.length > 0 &&
    card.matchers.every(
      (m) => (m.kind === 'geosite' || m.kind === 'geoip') && /^(cn|china|geolocation-cn)$/i.test(m.name),
    )
  ) {
    return 'domestic';
  }
  return inferCardStage(card).stage;
}
