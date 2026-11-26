import type { TemplateClientId } from '../../shared/clients';
import { getRegionDefinition, type RegionDefinition } from './regions';

export type RegexEngineKind = 'pcre2-like' | 'icu' | 'js' | 're2-safe';

export type RegexDialect = {
  client: TemplateClientId;
  engine: RegexEngineKind;
  supportsInlineCaseInsensitive: boolean;
  supportsLookahead: boolean;
  supportsLookbehind: boolean;
  supportsSeparateExclude: boolean;
  filterKey: string;
  excludeFilterKey?: string;
};

/**
 * Per-client node-name regex dialect capabilities (design §10.6, §10.11).
 * `quantumult-x` stays on the conservative RE2-safe subset (no lookaround) so
 * generated filters never fail at runtime; `sing-box` runs in server-side JS.
 */
export const CLIENT_REGEX_DIALECTS: Record<TemplateClientId, RegexDialect> = {
  mihomo: {
    client: 'mihomo',
    engine: 'pcre2-like',
    supportsInlineCaseInsensitive: true,
    supportsLookahead: true,
    supportsLookbehind: true,
    supportsSeparateExclude: true,
    filterKey: 'filter',
    excludeFilterKey: 'exclude-filter',
  },
  stash: {
    client: 'stash',
    engine: 'icu',
    supportsInlineCaseInsensitive: true,
    supportsLookahead: true,
    supportsLookbehind: true,
    supportsSeparateExclude: true,
    filterKey: 'filter',
    excludeFilterKey: 'exclude-filter',
  },
  surge: {
    client: 'surge',
    engine: 'icu',
    supportsInlineCaseInsensitive: true,
    supportsLookahead: true,
    supportsLookbehind: true,
    supportsSeparateExclude: false,
    filterKey: 'policy-regex-filter',
  },
  'sing-box': {
    client: 'sing-box',
    engine: 'js',
    supportsInlineCaseInsensitive: false,
    supportsLookahead: true,
    supportsLookbehind: true,
    supportsSeparateExclude: true,
    filterKey: 'js-filter',
    excludeFilterKey: 'js-exclude-filter',
  },
  loon: {
    client: 'loon',
    engine: 'icu',
    supportsInlineCaseInsensitive: true,
    supportsLookahead: true,
    supportsLookbehind: true,
    supportsSeparateExclude: false,
    filterKey: 'NameRegex',
  },
  'quantumult-x': {
    client: 'quantumult-x',
    engine: 're2-safe',
    supportsInlineCaseInsensitive: true,
    supportsLookahead: false,
    supportsLookbehind: false,
    supportsSeparateExclude: false,
    filterKey: 'server-tag-regex',
  },
  shadowrocket: {
    client: 'shadowrocket',
    engine: 'icu',
    supportsInlineCaseInsensitive: true,
    supportsLookahead: true,
    supportsLookbehind: false,
    supportsSeparateExclude: false,
    filterKey: 'policy-regex-filter',
  },
};

/** Non-node info banner keywords excluded at the NodeSlot layer (design §10.2, §11.2). */
export const NON_NODE_INFO_KEYWORDS: readonly string[] = [
  '流量',
  '到期',
  '官网',
  '官網',
  '剩余',
  '剩餘',
  '过期',
  '過期',
  '重置',
  '套餐',
  '公告',
  '群组',
  '群組',
  '失联',
  '失聯',
  '网址',
  '網址',
  '最新域名',
  '订阅',
  '訂閱',
  '客服',
  '续费',
  '續費',
  '频道',
  '頻道',
  '防失联',
  'Traffic',
  'Expire',
  'Expired',
  'Reset',
  'Website',
  'Official',
  'Remaining',
  'Bandwidth',
  'Support',
  'Channel',
];

export type RegexDialectWarningCode =
  | 'UNKNOWN_REGION'
  | 'SHORTHAND_OMITTED_FOR_SAFETY'
  | 'EXCLUDE_REQUIRES_LOOKAHEAD'
  | 'LOOKBEHIND_UNSUPPORTED'
  | 'LOOKAHEAD_UNSUPPORTED'
  | 'INLINE_FLAG_UNSUPPORTED'
  | 'INVALID_REGEX';

export type RegexDialectWarning = {
  code: RegexDialectWarningCode;
  message: string;
  region?: string;
};

export type CompiledNodeRegex = {
  client: TemplateClientId;
  dialect: RegexDialect;
  /** Primary include regex (no negative wrapper when `exclude` is handled separately). */
  include: string;
  /** Separate exclude regex when applicable (for `exclude-filter` or JS filtering). */
  exclude?: string;
  /** Single-field regex usable when the client has only one regex field. */
  combined: string;
  /** JS RegExp flags (`'i'` for `sing-box`, `''` when inline `(?i)` is embedded). */
  flags: string;
  warnings: RegexDialectWarning[];
};

export function escapeRegexLiteral(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withCaseFlag(pattern: string, dialect: RegexDialect): string {
  return dialect.supportsInlineCaseInsensitive ? `(?i)${pattern}` : pattern;
}

/**
 * Wraps an ASCII token alternation with letter boundaries so `HK` matches
 * `HK01`, `HK-1`, `[HK]`, `HK_VIP` while rejecting `SHOCK`, `THINK`, `MUSIC`.
 */
function buildAsciiCodeBranch(codes: readonly string[], dialect: RegexDialect): string {
  if (codes.length === 0) return '';
  const body = codes.map(escapeRegexLiteral).join('|');
  if (dialect.supportsLookbehind && dialect.supportsLookahead) {
    return `(?<![A-Za-z])(?:${body})(?![A-Za-z])`;
  }
  return `(?:^|[^A-Za-z])(?:${body})(?:$|[^A-Za-z])`;
}

/**
 * Builds a locally guarded shorthand expression such as:
 *   `(?<!每|今|尼)(?<!到期|续费)日(?!志|常|期)`
 * Grouping lookbehinds by exact character length guarantees compatibility with
 * both ICU (fixed-length alternation per lookbehind) and JS / PCRE2 engines.
 */
function buildGuardedShortTerm(
  shortTerm: string,
  excludes: readonly string[],
  dialect: RegexDialect,
): { pattern: string | null; omitted: boolean } {
  const relevantExcludes = excludes.filter((word) => word.includes(shortTerm));
  if (relevantExcludes.length === 0) {
    return { pattern: escapeRegexLiteral(shortTerm), omitted: false };
  }
  if (!dialect.supportsLookahead || !dialect.supportsLookbehind) {
    // Without lookbehind we cannot safely guard prefix-based exclusions like `尼日利亚` or `连云港`.
    return { pattern: null, omitted: true };
  }

  const prefixesByLength = new Map<number, Set<string>>();
  const suffixes = new Set<string>();

  for (const word of relevantExcludes) {
    const idx = word.indexOf(shortTerm);
    const prefix = word.slice(0, idx);
    const suffix = word.slice(idx + shortTerm.length);

    // Prefer blocking the prefix when present (e.g. `尼` in `尼日利亚`, `到期` in `到期日`),
    // otherwise block the suffix (e.g. `志` in `日志`, `西兰` in `新西兰`).
    if (prefix.length > 0) {
      const bucket = prefixesByLength.get(prefix.length) ?? new Set<string>();
      bucket.add(prefix);
      prefixesByLength.set(prefix.length, bucket);
    } else if (suffix.length > 0) {
      suffixes.add(suffix);
    }
  }

  const lookbehinds = [...prefixesByLength.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, items]) => `(?<!${[...items].map(escapeRegexLiteral).join('|')})`)
    .join('');

  const lookahead = suffixes.size > 0 ? `(?!${[...suffixes].map(escapeRegexLiteral).join('|')})` : '';

  return {
    pattern: `${lookbehinds}${escapeRegexLiteral(shortTerm)}${lookahead}`,
    omitted: false,
  };
}

function buildSingleRegionBranches(
  entry: RegionDefinition,
  dialect: RegexDialect,
  warnings: RegexDialectWarning[],
): string[] {
  const branches: string[] = [];

  if (entry.flag) {
    branches.push(escapeRegexLiteral(entry.flag));
  }
  for (const term of entry.zhTerms) {
    const guarded = buildGuardedShortTerm(term, entry.excludes, dialect);
    if (guarded.pattern) {
      branches.push(guarded.pattern);
    } else {
      branches.push(escapeRegexLiteral(term));
    }
  }
  for (const term of entry.enTerms) {
    const escaped = escapeRegexLiteral(term).replace(/ /g, '[ _-]?');
    if (/^[A-Za-z]/.test(term) && term.length <= 5) {
      branches.push(buildAsciiCodeBranch([term], dialect));
    } else {
      branches.push(escaped);
    }
  }
  if (entry.codes.length > 0) {
    branches.push(buildAsciiCodeBranch(entry.codes, dialect));
  }
  if (entry.shortZhTerms && entry.shortZhTerms.length > 0) {
    for (const shortTerm of entry.shortZhTerms) {
      const guarded = buildGuardedShortTerm(shortTerm, entry.excludes, dialect);
      if (guarded.pattern) {
        branches.push(guarded.pattern);
      } else if (guarded.omitted) {
        warnings.push({
          code: 'SHORTHAND_OMITTED_FOR_SAFETY',
          region: entry.code,
          message: `${dialect.client} 不支持后行断言，已省略地区 ${entry.code} 的单字简称「${shortTerm}」以避免误匹配（如 ${entry.excludes.slice(0, 2).join('、')}）。`,
        });
      }
    }
  }

  return branches;
}

/**
 * Generates a client-dialect-aware node regex from one or more ISO region codes
 * plus optional extra include / exclude patterns (design §10.11).
 */
export function buildRegionRegex(
  regionCodes: string | readonly string[],
  client: TemplateClientId,
  options?: { extraInclude?: string; extraExclude?: string },
): CompiledNodeRegex {
  const dialect = CLIENT_REGEX_DIALECTS[client];
  const codes = (Array.isArray(regionCodes) ? regionCodes : [regionCodes])
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);

  const warnings: RegexDialectWarning[] = [];
  const branches: string[] = [];

  for (const code of codes) {
    const entry = getRegionDefinition(code);
    if (!entry) {
      warnings.push({
        code: 'UNKNOWN_REGION',
        region: code,
        message: `内置地区词典中未找到地区代码 ${code}。`,
      });
      continue;
    }
    branches.push(...buildSingleRegionBranches(entry, dialect, warnings));
  }

  if (options?.extraInclude?.trim()) {
    branches.push(`(?:${options.extraInclude.trim()})`);
  }

  const rawInclude = branches.length > 0 ? branches.join('|') : '(?!)';
  const include = withCaseFlag(rawInclude, dialect);

  const rawExclude = options?.extraExclude?.trim();
  const exclude = rawExclude ? withCaseFlag(rawExclude, dialect) : undefined;

  let combined = include;
  if (rawExclude) {
    if (dialect.supportsLookahead) {
      combined = withCaseFlag(`^(?!.*(?:${rawExclude})).*(?:${rawInclude})`, dialect);
    } else {
      warnings.push({
        code: 'EXCLUDE_REQUIRES_LOOKAHEAD',
        message: `${client} 不支持负向前瞻，无法在单条正则内联排除条件「${rawExclude}」。`,
      });
    }
  }

  return {
    client,
    dialect,
    include,
    exclude,
    combined,
    flags: dialect.supportsInlineCaseInsensitive ? '' : 'i',
    warnings,
  };
}

/**
 * Generates the slot-level `excludeInfo` filter regex that removes traffic,
 * expiry, website, and notice entries from a subscription (design §11.2).
 */
export function buildExcludeInfoRegex(client: TemplateClientId): CompiledNodeRegex {
  const dialect = CLIENT_REGEX_DIALECTS[client];
  const rawExclude = NON_NODE_INFO_KEYWORDS.map(escapeRegexLiteral).join('|');
  const exclude = withCaseFlag(rawExclude, dialect);
  const warnings: RegexDialectWarning[] = [];

  let combined: string;
  if (dialect.supportsLookahead) {
    combined = withCaseFlag(`^(?!.*(?:${rawExclude})).*$`, dialect);
  } else {
    combined = '.*';
    warnings.push({
      code: 'EXCLUDE_REQUIRES_LOOKAHEAD',
      message: `${client} 不支持负向前瞻，无法通过单条正则排除非节点信息条目。`,
    });
  }

  return {
    client,
    dialect,
    include: '.*',
    exclude,
    combined,
    flags: dialect.supportsInlineCaseInsensitive ? '' : 'i',
    warnings,
  };
}

/**
 * Statically detects regex syntax features incompatible with a target client's
 * regex dialect (for editor linting and compiler diagnostics).
 */
export function detectRegexDialectIssues(pattern: string, client: TemplateClientId): RegexDialectWarning[] {
  const dialect = CLIENT_REGEX_DIALECTS[client];
  const issues: RegexDialectWarning[] = [];

  if (!dialect.supportsLookbehind && /\(\?<[=!]/.test(pattern)) {
    issues.push({
      code: 'LOOKBEHIND_UNSUPPORTED',
      message: `${client} 不支持后行断言 (?<= / ?<!)。`,
    });
  }

  if (!dialect.supportsLookahead && /\(\?[=!]/.test(pattern)) {
    issues.push({
      code: 'LOOKAHEAD_UNSUPPORTED',
      message: `${client} 不支持前瞻断言 (?= / ?!)。`,
    });
  }

  if (!dialect.supportsInlineCaseInsensitive && /\(\?[imsx-]+\)/.test(pattern)) {
    issues.push({
      code: 'INLINE_FLAG_UNSUPPORTED',
      message: `${client}（JS 正则引擎）不支持内联标志 (?i)。`,
    });
  }

  // Validate syntax by stripping supported inline (?i) before passing to JS RegExp.
  const jsCandidate = pattern.replace(/^\(\?[imsx]+\)/, '');
  try {
    new RegExp(jsCandidate, 'i');
  } catch (error) {
    issues.push({
      code: 'INVALID_REGEX',
      message: `正则表达式语法无效：${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return issues;
}
