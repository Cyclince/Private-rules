import type { NodeFilter } from '../../shared/schemas/card';
import { getRegionDefinition, listRegionDefinitions, type RegionDefinition } from './regions';
import { NON_NODE_INFO_KEYWORDS, escapeRegexLiteral } from './regex';

const INFO_NODE_REGEX = new RegExp(NON_NODE_INFO_KEYWORDS.map(escapeRegexLiteral).join('|'), 'i');

type CompiledRegionMatcher = {
  entry: RegionDefinition;
  unambiguousRegex: RegExp;
  strictCaseCodeRegex: RegExp | null;
  shortTermRegex: RegExp | null;
  excludeMaskRegex: RegExp | null;
};

function compileRegionMatcher(entry: RegionDefinition): CompiledRegionMatcher {
  const branches: string[] = [];
  if (entry.flag) {
    branches.push(escapeRegexLiteral(entry.flag));
  }
  for (const term of entry.zhTerms) {
    branches.push(escapeRegexLiteral(term));
  }
  for (const term of entry.enTerms) {
    const escaped = escapeRegexLiteral(term).replace(/ /g, '[ _-]?');
    if (/^[A-Za-z]/.test(term) && term.length <= 5) {
      branches.push(`(?<![A-Za-z])${escaped}(?![A-Za-z])`);
    } else {
      branches.push(escaped);
    }
  }
  if (entry.codes.length > 0) {
    branches.push(`(?<![A-Za-z])(?:${entry.codes.map(escapeRegexLiteral).join('|')})(?![A-Za-z])`);
  }

  const unambiguousRegex = new RegExp(branches.join('|'), 'i');
  const strictCaseCodeRegex =
    entry.strictCaseCodes && entry.strictCaseCodes.length > 0
      ? new RegExp(`(?<![A-Za-z])(?:${entry.strictCaseCodes.map(escapeRegexLiteral).join('|')})(?![A-Za-z])`)
      : null;
  const shortTermRegex =
    entry.shortZhTerms && entry.shortZhTerms.length > 0
      ? new RegExp(entry.shortZhTerms.map(escapeRegexLiteral).join('|'))
      : null;

  // Sort excludes longest-first so compound words like `印度尼西亚` mask cleanly before `印尼`.
  const excludeMaskRegex =
    entry.excludes.length > 0
      ? new RegExp(
          [...entry.excludes]
            .sort((a, b) => b.length - a.length)
            .map(escapeRegexLiteral)
            .join('|'),
          'gi',
        )
      : null;

  return { entry, unambiguousRegex, strictCaseCodeRegex, shortTermRegex, excludeMaskRegex };
}

const REGION_MATCHERS = new Map<string, CompiledRegionMatcher>(
  listRegionDefinitions().map((entry) => [entry.code.toUpperCase(), compileRegionMatcher(entry)]),
);

/** Returns true if a subscription entry looks like an info/notice banner rather than a proxy node. */
export function isInfoNode(name: string): boolean {
  return INFO_NODE_REGEX.test(name);
}

/**
 * Matches a node name against a built-in ISO region code using:
 *   1. Masking known false-positive compounds (e.g. `烟台` for `TW`, `印度尼西亚` for `IN`, `尼日利亚` for `JP`)
 *   2. Unambiguous flag / multi-char Chinese / English / ASCII-bounded ISO+IATA codes (plus strict-case codes)
 *   3. Single-character Chinese shorthands on the exclusion-masked string
 */
export function matchRegion(name: string, regionCode: string): boolean {
  const normalized = regionCode.trim().toUpperCase();
  const compiled = REGION_MATCHERS.get(normalized);
  if (!compiled) {
    return false;
  }

  const masked = compiled.excludeMaskRegex ? name.replace(compiled.excludeMaskRegex, ' ') : name;

  if (compiled.unambiguousRegex.test(masked)) {
    return true;
  }

  if (compiled.strictCaseCodeRegex?.test(masked)) {
    return true;
  }

  if (!compiled.shortTermRegex) {
    return false;
  }

  return compiled.shortTermRegex.test(masked);
}

/** Detects all ISO region codes matched by a node name. */
export function detectNodeRegions(name: string): string[] {
  const matched: string[] = [];
  for (const [code] of REGION_MATCHERS) {
    if (matchRegion(name, code)) {
      matched.push(code);
    }
  }
  return matched;
}

function compileUserPattern(pattern: string): RegExp | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/^\(\?i\)/, '');
  try {
    return new RegExp(normalized, 'i');
  } catch {
    return null;
  }
}

export type FilterNodesOptions = {
  /** Exclude subscription traffic/expiry/website info banners (default: false). */
  excludeInfo?: boolean;
};

/** Evaluates whether a single node name passes the given `NodeFilter` and options. */
export function matchNodeFilter(name: string, filter?: NodeFilter, options?: FilterNodesOptions): boolean {
  if (options?.excludeInfo && isInfoNode(name)) {
    return false;
  }

  if (!filter) {
    return true;
  }

  if (filter.regions && filter.regions.length > 0) {
    const matchedAnyRegion = filter.regions.some((code) => {
      if (!getRegionDefinition(code)) return false;
      return matchRegion(name, code);
    });
    if (!matchedAnyRegion) {
      return false;
    }
  }

  if (filter.include) {
    const includeRegex = compileUserPattern(filter.include);
    if (!includeRegex || !includeRegex.test(name)) {
      return false;
    }
  }

  if (filter.exclude) {
    const excludeRegex = compileUserPattern(filter.exclude);
    if (excludeRegex && excludeRegex.test(name)) {
      return false;
    }
  }

  return true;
}

/** Pure node list filter supporting either plain node names or objects with `{ name }`. */
export function filterNodes<T extends string | { name: string }>(
  nodes: readonly T[],
  filter?: NodeFilter,
  options?: FilterNodesOptions,
): T[] {
  return nodes.filter((node) => {
    const name = typeof node === 'string' ? node : node.name;
    return matchNodeFilter(name, filter, options);
  });
}
