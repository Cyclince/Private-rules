import type { DomainRule, DomainRuleType } from '../../types/domain-rules';
import { parseCidrRange } from './conflicts';

export type CoverageRuleLike = Pick<DomainRule, 'type' | 'value'> & {
  enabled?: boolean;
};

export type CoverageRemovalReason = 'exact-duplicate' | 'domain-suffix-covered' | 'cidr-covered';

export type CoverageRemovalSample = {
  removed: { type: DomainRuleType; value: string };
  coveredBy: { type: DomainRuleType; value: string };
  reason: CoverageRemovalReason;
};

export type CoverageDedupOptions<TRule extends CoverageRuleLike = CoverageRuleLike> = {
  /** Whether coverage deduplication is enabled (defaults to `true`). */
  enabled?: boolean;
  /** Maximum number of removal samples collected for preview (defaults to 20). */
  sampleLimit?: number;
  /**
   * Optional already-existing rules in the same ruleset (e.g. manual rules or
   * rules from sibling sources in the same category) that can cover entries in
   * `input`, without ever being modified or returned in `rules`.
   */
  existingCoveringRules?: readonly TRule[];
};

export type CoverageDedupResult<TRule extends CoverageRuleLike = DomainRule> = {
  rules: TRule[];
  originalCount: number;
  keptCount: number;
  removedCount: number;
  /** Number of entries removed specifically because a broader rule covers them. */
  coveredRemovedCount: number;
  /** Number of entries removed as exact duplicates (case-insensitive / canonical CIDR). */
  duplicateRemovedCount: number;
  /** Representative samples of removed entries (coverage removals prioritized). */
  samples: CoverageRemovalSample[];
};

export type RulesetSourceMergeInput<TRule extends CoverageRuleLike = DomainRule> = {
  /** Manual rules in the ruleset (always retained; act as covering rules for upstream sources). */
  manualRules?: readonly TRule[];
  /** Upstream sources belonging to the same ruleset, in merge order. */
  sources: readonly {
    id: string;
    /** Defaults to `true`. Set `false` to preserve legacy / per-source opt-out behavior. */
    coverageDedup?: boolean;
    rules: readonly TRule[];
  }[];
  sampleLimit?: number;
};

export type RulesetSourceMergeResult<TRule extends CoverageRuleLike = DomainRule> = {
  rules: TRule[];
  originalCount: number;
  keptCount: number;
  removedCount: number;
  coveredRemovedCount: number;
  duplicateRemovedCount: number;
  samples: CoverageRemovalSample[];
  perSource: Record<
    string,
    {
      originalCount: number;
      keptCount: number;
      removedCount: number;
      coveredRemovedCount: number;
      duplicateRemovedCount: number;
      coverageDedup: boolean;
    }
  >;
};

const NETWORK_TYPES = new Set<DomainRuleType>(['IP-CIDR', 'SRC-IP-CIDR']);

function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\+?\./, '')
    .replace(/\.$/, '');
}

function canonicalExactKey(rule: CoverageRuleLike): string {
  if (rule.type === 'DOMAIN' || rule.type === 'DOMAIN-SUFFIX') {
    return `${rule.type}:${normalizeDomain(rule.value)}`;
  }
  if (NETWORK_TYPES.has(rule.type)) {
    const parsed = parseCidrRange(rule.value.trim());
    if (parsed) {
      return `${rule.type}:${parsed.ipv6 ? 'v6' : 'v4'}:${parsed.start.toString(16)}-${parsed.end.toString(16)}`;
    }
  }
  return `${rule.type}:${rule.value.trim().toLowerCase()}`;
}

/**
 * Finds the broadest covering `DOMAIN-SUFFIX` in `suffixIndex` for a normalized
 * domain value. For `DOMAIN`, exact equality (`example.com` covered by
 * `DOMAIN-SUFFIX,example.com`) counts; for `DOMAIN-SUFFIX`, only strict parent
 * suffixes count.
 */
function findBroadestCoveringSuffix(
  normalized: string,
  includeSelf: boolean,
  suffixIndex: ReadonlyMap<string, CoverageRuleLike>,
): CoverageRuleLike | undefined {
  const labels = normalized.split('.').filter(Boolean);
  if (labels.length === 0) return undefined;

  // Walk from shortest (broadest) ancestor down to narrowest candidate.
  const minStart = includeSelf ? 0 : 1;
  for (let start = labels.length - 1; start >= minStart; start -= 1) {
    const candidate = labels.slice(start).join('.');
    const hit = suffixIndex.get(candidate);
    if (hit) return hit;
  }
  return undefined;
}

type IndexedCidrEntry = {
  source: 'existing' | 'input';
  index: number;
  rule: CoverageRuleLike;
  start: bigint;
  end: bigint;
};

/**
 * Deduplicates rules within a single ruleset by removing exact duplicates and
 * entries covered by broader rules in the same ruleset (design §9.3.1):
 *   - `DOMAIN-SUFFIX,a.com` covers `DOMAIN,a.com`, `DOMAIN,x.a.com`, and `DOMAIN-SUFFIX,x.a.com`.
 *   - `IP-CIDR` covers narrower `IP-CIDR` ranges (IPv4 and IPv6 independently).
 *   - `SRC-IP-CIDR` covers narrower `SRC-IP-CIDR` ranges (IPv4 and IPv6 independently).
 *
 * Pure O(n log n + n * L) function — never crosses ruleset boundaries and never
 * touches I/O.
 */
export function deduplicateCoveredRules<TRule extends CoverageRuleLike = DomainRule>(
  input: readonly TRule[],
  options?: CoverageDedupOptions<CoverageRuleLike>,
): CoverageDedupResult<TRule> {
  const enabled = options?.enabled !== false;
  const sampleLimit = Math.max(0, options?.sampleLimit ?? 20);

  if (!enabled || input.length === 0) {
    return {
      rules: [...input],
      originalCount: input.length,
      keptCount: input.length,
      removedCount: 0,
      coveredRemovedCount: 0,
      duplicateRemovedCount: 0,
      samples: [],
    };
  }

  const existingCovering = (options?.existingCoveringRules ?? []).filter((rule) => rule.enabled !== false);
  const removedReason = new Map<number, { reason: CoverageRemovalReason; coveredBy: CoverageRuleLike }>();

  // Pass 1: Exact deduplication (existing rules take precedence over input; first input wins within input)
  const seenExact = new Map<string, CoverageRuleLike>();
  for (const rule of existingCovering) {
    const key = canonicalExactKey(rule);
    if (!seenExact.has(key)) seenExact.set(key, rule);
  }

  for (let i = 0; i < input.length; i += 1) {
    const rule = input[i];
    if (rule.enabled === false) continue;
    const key = canonicalExactKey(rule);
    const existing = seenExact.get(key);
    if (existing) {
      removedReason.set(i, { reason: 'exact-duplicate', coveredBy: existing });
    } else {
      seenExact.set(key, rule);
    }
  }

  // Pass 2: Domain-suffix coverage (O(n * labelDepth))
  const suffixIndex = new Map<string, CoverageRuleLike>();
  for (const rule of existingCovering) {
    if (rule.type === 'DOMAIN-SUFFIX') {
      const normalized = normalizeDomain(rule.value);
      if (normalized && !suffixIndex.has(normalized)) {
        suffixIndex.set(normalized, rule);
      }
    }
  }
  for (let i = 0; i < input.length; i += 1) {
    if (removedReason.has(i)) continue;
    const rule = input[i];
    if (rule.enabled === false || rule.type !== 'DOMAIN-SUFFIX') continue;
    const normalized = normalizeDomain(rule.value);
    if (normalized && !suffixIndex.has(normalized)) {
      suffixIndex.set(normalized, rule);
    }
  }

  if (suffixIndex.size > 0) {
    for (let i = 0; i < input.length; i += 1) {
      if (removedReason.has(i)) continue;
      const rule = input[i];
      if (rule.enabled === false) continue;
      if (rule.type !== 'DOMAIN' && rule.type !== 'DOMAIN-SUFFIX') continue;

      const normalized = normalizeDomain(rule.value);
      if (!normalized) continue;
      const covering = findBroadestCoveringSuffix(normalized, rule.type === 'DOMAIN', suffixIndex);
      if (covering) {
        removedReason.set(i, { reason: 'domain-suffix-covered', coveredBy: covering });
      }
    }
  }

  // Pass 3: CIDR containment sweep (O(n log n)) separately per (type, ipVersion)
  const cidrBuckets: Record<'IP-CIDR:v4' | 'IP-CIDR:v6' | 'SRC-IP-CIDR:v4' | 'SRC-IP-CIDR:v6', IndexedCidrEntry[]> = {
    'IP-CIDR:v4': [],
    'IP-CIDR:v6': [],
    'SRC-IP-CIDR:v4': [],
    'SRC-IP-CIDR:v6': [],
  };

  existingCovering.forEach((rule, idx) => {
    if (!NETWORK_TYPES.has(rule.type)) return;
    const parsed = parseCidrRange(rule.value.trim());
    if (!parsed) return;
    const bucketKey = `${rule.type}:${parsed.ipv6 ? 'v6' : 'v4'}` as keyof typeof cidrBuckets;
    cidrBuckets[bucketKey].push({ source: 'existing', index: idx, rule, start: parsed.start, end: parsed.end });
  });

  for (let i = 0; i < input.length; i += 1) {
    if (removedReason.has(i)) continue;
    const rule = input[i];
    if (rule.enabled === false || !NETWORK_TYPES.has(rule.type)) continue;
    const parsed = parseCidrRange(rule.value.trim());
    if (!parsed) continue;
    const bucketKey = `${rule.type}:${parsed.ipv6 ? 'v6' : 'v4'}` as keyof typeof cidrBuckets;
    cidrBuckets[bucketKey].push({ source: 'input', index: i, rule, start: parsed.start, end: parsed.end });
  }

  for (const entries of Object.values(cidrBuckets)) {
    if (entries.length < 2) continue;
    // Sort by start ASC, end DESC (broadest prefix first), existing before input, index ASC
    entries.sort((a, b) => {
      if (a.start !== b.start) return a.start < b.start ? -1 : 1;
      if (a.end !== b.end) return a.end > b.end ? -1 : 1;
      if (a.source !== b.source) return a.source === 'existing' ? -1 : 1;
      return a.index - b.index;
    });

    let active: IndexedCidrEntry | null = null;
    for (const entry of entries) {
      if (active && entry.end <= active.end) {
        if (entry.source === 'input') {
          const isExact = entry.start === active.start && entry.end === active.end;
          removedReason.set(entry.index, {
            reason: isExact ? 'exact-duplicate' : 'cidr-covered',
            coveredBy: active.rule,
          });
        }
        continue;
      }
      active = entry;
    }
  }

  // Materialize kept rules in original relative order and build preview samples
  const kept: TRule[] = [];
  const coveredSamples: CoverageRemovalSample[] = [];
  const duplicateSamples: CoverageRemovalSample[] = [];
  let coveredRemovedCount = 0;
  let duplicateRemovedCount = 0;

  for (let i = 0; i < input.length; i += 1) {
    const removal = removedReason.get(i);
    if (!removal) {
      kept.push(input[i]);
      continue;
    }
    const sample: CoverageRemovalSample = {
      removed: { type: input[i].type, value: input[i].value },
      coveredBy: { type: removal.coveredBy.type, value: removal.coveredBy.value },
      reason: removal.reason,
    };
    if (removal.reason === 'exact-duplicate') {
      duplicateRemovedCount += 1;
      if (duplicateSamples.length < sampleLimit) duplicateSamples.push(sample);
    } else {
      coveredRemovedCount += 1;
      if (coveredSamples.length < sampleLimit) coveredSamples.push(sample);
    }
  }

  // Prioritize coverage-removal samples in previews so users see broader->narrower explanations first
  const samples = [...coveredSamples, ...duplicateSamples].slice(0, sampleLimit);

  return {
    rules: kept,
    originalCount: input.length,
    keptCount: kept.length,
    removedCount: coveredRemovedCount + duplicateRemovedCount,
    coveredRemovedCount,
    duplicateRemovedCount,
    samples,
  };
}

/**
 * Merges manual rules and multiple upstream sources within ONE ruleset while
 * respecting each source's `coverageDedup` switch (default `true`; set `false`
 * for legacy/opt-out sources). Manual rules are never removed.
 */
export function mergeRulesetWithCoverageDedup<TRule extends CoverageRuleLike = DomainRule>(
  input: RulesetSourceMergeInput<TRule>,
): RulesetSourceMergeResult<TRule> {
  const sampleLimit = Math.max(0, input.sampleLimit ?? 20);
  const manual = [...(input.manualRules ?? [])];
  const merged: TRule[] = [...manual];

  const samples: CoverageRemovalSample[] = [];
  const perSource: RulesetSourceMergeResult<TRule>['perSource'] = {};
  let originalCount = manual.length;
  let coveredRemovedCount = 0;
  let duplicateRemovedCount = 0;

  // Track exact keys already emitted by manual rules and earlier sources
  const emittedExact = new Map<string, CoverageRuleLike>();
  for (const rule of manual) {
    if (rule.enabled !== false) {
      emittedExact.set(canonicalExactKey(rule), rule);
    }
  }

  for (let sourceIndex = 0; sourceIndex < input.sources.length; sourceIndex += 1) {
    const source = input.sources[sourceIndex]!;
    const coverageEnabled = source.coverageDedup !== false;
    originalCount += source.rules.length;

    if (!coverageEnabled) {
      // Opt-out: preserve all source rules except exact duplicates already in the ruleset
      const kept: TRule[] = [];
      let sourceDupRemoved = 0;
      for (const rule of source.rules) {
        if (rule.enabled === false) {
          kept.push(rule);
          continue;
        }
        const key = canonicalExactKey(rule);
        const existing = emittedExact.get(key);
        if (existing) {
          sourceDupRemoved += 1;
          duplicateRemovedCount += 1;
          if (samples.length < sampleLimit) {
            samples.push({
              removed: { type: rule.type, value: rule.value },
              coveredBy: { type: existing.type, value: existing.value },
              reason: 'exact-duplicate',
            });
          }
          continue;
        }
        emittedExact.set(key, rule);
        kept.push(rule);
      }
      merged.push(...kept);
      perSource[source.id] = {
        originalCount: source.rules.length,
        keptCount: kept.length,
        removedCount: sourceDupRemoved,
        coveredRemovedCount: 0,
        duplicateRemovedCount: sourceDupRemoved,
        coverageDedup: false,
      };
      continue;
    }

    // Build sibling covering pool: manual + other sources' rules in the same ruleset
    // so coverage is independent of source ordering for sources with coverageDedup enabled.
    const siblingPool: CoverageRuleLike[] = [...manual];
    for (let otherIndex = 0; otherIndex < input.sources.length; otherIndex += 1) {
      if (otherIndex === sourceIndex) continue;
      siblingPool.push(...input.sources[otherIndex]!.rules);
    }
    // Also deduplicate against exact keys already emitted by manual/earlier sources
    const preFiltered: TRule[] = [];
    let preDupCount = 0;
    for (const rule of source.rules) {
      if (rule.enabled === false) {
        preFiltered.push(rule);
        continue;
      }
      const key = canonicalExactKey(rule);
      const existing = emittedExact.get(key);
      if (existing) {
        preDupCount += 1;
        duplicateRemovedCount += 1;
        if (samples.length < sampleLimit) {
          samples.push({
            removed: { type: rule.type, value: rule.value },
            coveredBy: { type: existing.type, value: existing.value },
            reason: 'exact-duplicate',
          });
        }
        continue;
      }
      preFiltered.push(rule);
    }

    const deduped = deduplicateCoveredRules(preFiltered, {
      enabled: true,
      sampleLimit: Math.max(0, sampleLimit - samples.length),
      existingCoveringRules: siblingPool,
    });

    for (const rule of deduped.rules) {
      if (rule.enabled !== false) {
        emittedExact.set(canonicalExactKey(rule), rule);
      }
    }
    merged.push(...deduped.rules);
    coveredRemovedCount += deduped.coveredRemovedCount;
    duplicateRemovedCount += deduped.duplicateRemovedCount;
    for (const sample of deduped.samples) {
      if (samples.length < sampleLimit) samples.push(sample);
    }

    perSource[source.id] = {
      originalCount: source.rules.length,
      keptCount: deduped.keptCount,
      removedCount: preDupCount + deduped.removedCount,
      coveredRemovedCount: deduped.coveredRemovedCount,
      duplicateRemovedCount: preDupCount + deduped.duplicateRemovedCount,
      coverageDedup: true,
    };
  }

  return {
    rules: merged,
    originalCount,
    keptCount: merged.length,
    removedCount: coveredRemovedCount + duplicateRemovedCount,
    coveredRemovedCount,
    duplicateRemovedCount,
    samples,
    perSource,
  };
}
