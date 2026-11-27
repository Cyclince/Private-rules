/**
 * Node pool live preview (design §3.3).
 *
 * Pure matcher used by the professional-tier pool editor: it shows which of the
 * already-cached node names would land in the pool, without contacting the
 * airport. Regexes are compiled with the same case-insensitive behaviour the
 * mihomo/sing-box filters use; invalid input is reported instead of throwing.
 */

export type PoolPreviewInvalidKind = 'include' | 'exclude';

export type PoolPreviewResult = {
  /** Names that pass the include filter and are not removed by the exclude filter. */
  matched: string[];
  /** How many cached node names were considered. */
  total: number;
  /** Set when a filter could not be compiled; `matched` is then empty. */
  invalid?: PoolPreviewInvalidKind;
  /** Human-readable compile error for the invalid filter. */
  error?: string;
};

function compileFilter(pattern: string | null | undefined): { regex: RegExp } | { error: string } | null {
  const trimmed = pattern?.trim();
  if (!trimmed) return null;
  try {
    return { regex: new RegExp(trimmed, 'i') };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
}

function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/**
 * Applies the include / exclude regular expressions to cached node names.
 * An empty include pattern matches every node (an exclusion-only pool); an empty
 * exclude pattern removes nothing.
 */
export function previewPoolMatch(
  nodeNames: readonly string[],
  include?: string | null,
  exclude?: string | null,
  options: { limit?: number } = {},
): PoolPreviewResult {
  const names = uniqueNames(nodeNames);
  const includeFilter = compileFilter(include);
  if (includeFilter && 'error' in includeFilter) {
    return { matched: [], total: names.length, invalid: 'include', error: includeFilter.error };
  }
  const excludeFilter = compileFilter(exclude);
  if (excludeFilter && 'error' in excludeFilter) {
    return { matched: [], total: names.length, invalid: 'exclude', error: excludeFilter.error };
  }

  const limit = options.limit ?? 50;
  const matched: string[] = [];
  for (const name of names) {
    if (includeFilter && !includeFilter.regex.test(name)) continue;
    if (excludeFilter && excludeFilter.regex.test(name)) continue;
    matched.push(name);
    if (matched.length >= limit) break;
  }
  return { matched, total: names.length };
}

/** Copies a built-in pool definition without sharing mutable arrays/objects. */
export function clonePool<T extends { test?: object; members?: readonly string[] }>(pool: T): T {
  return {
    ...pool,
    ...(pool.test ? { test: { ...pool.test } } : {}),
    ...(pool.members ? { members: [...pool.members] } : {}),
  };
}
