import type { ComplexityTier, NodePool, NodePoolKind, RegionGroup, TemplateBody } from '../../shared/schemas/template';
import { recognizeGroupEmoji } from './icons-emoji';

const DEFAULT_POOL_ICON_BY_KIND: Readonly<Record<NodePoolKind, string>> = {
  region: '🌐',
  provider: '🛫',
  trait: '🏷️',
  all: '🌐',
  stability: '🔁',
};

const STARTER_TIER_TO_COMPLEXITY: Readonly<Record<string, ComplexityTier>> = {
  less: 'simple',
  minimal: 'simple',
  light: 'simple',
  simple: 'simple',
  recommended: 'advanced',
  standard: 'advanced',
  advanced: 'advanced',
  all: 'pro',
  heavy: 'pro',
  pro: 'pro',
};

const SLUG_TO_COMPLEXITY: Readonly<Record<string, ComplexityTier>> = {
  'starter-less': 'simple',
  'starter-minimal': 'simple',
  'starter-light': 'simple',
  'starter-simple': 'simple',
  less: 'simple',
  minimal: 'simple',
  light: 'simple',
  simple: 'simple',
  'starter-recommended': 'advanced',
  'starter-standard': 'advanced',
  'starter-advanced': 'advanced',
  recommended: 'advanced',
  standard: 'advanced',
  advanced: 'advanced',
  'starter-all': 'pro',
  'starter-heavy': 'pro',
  'starter-pro': 'pro',
  all: 'pro',
  heavy: 'pro',
  pro: 'pro',
};

/** Resolves a pool display icon (auto-recognized via `recognizeGroupIcon` when omitted). */
export function resolvePoolIcon(input: Pick<NodePool, 'name' | 'icon' | 'region' | 'type' | 'kind'>): string {
  const explicit = input.icon?.trim();
  if (explicit) return explicit;
  const recognized = recognizeGroupEmoji({
    name: input.name,
    region: input.region,
    groupType: input.kind === 'all' || input.kind === 'stability' ? input.type : undefined,
  });
  if (recognized.source !== 'fallback' && recognized.emoji) {
    return recognized.emoji;
  }
  return DEFAULT_POOL_ICON_BY_KIND[input.kind];
}

/** Converts a legacy `RegionGroup` entry into a `kind: 'region'` `NodePool` (design §3). */
export function regionGroupToNodePool(regionGroup: RegionGroup, options?: { defaultHidden?: boolean }): NodePool {
  const region = regionGroup.region.trim().toUpperCase();
  const icon = resolvePoolIcon({
    name: regionGroup.name,
    region,
    type: regionGroup.type,
    kind: 'region',
  });
  return {
    id: regionGroup.id,
    name: regionGroup.name,
    icon,
    sources: regionGroup.slotId ? [regionGroup.slotId] : 'all',
    ...(regionGroup.extraInclude ? { include: regionGroup.extraInclude } : {}),
    ...(regionGroup.extraExclude ? { exclude: regionGroup.extraExclude } : {}),
    region,
    kind: 'region',
    type: regionGroup.type,
    ...(regionGroup.test ? { test: structuredClone(regionGroup.test) } : {}),
    hidden: regionGroup.hidden ?? options?.defaultHidden ?? true,
  };
}

/** Converts a `kind: 'region'` `NodePool` back into a legacy `RegionGroup` for round-trip checks. */
export function nodePoolToRegionGroup(pool: NodePool): RegionGroup | null {
  if (pool.kind !== 'region' && !pool.region) {
    return null;
  }
  const region = (pool.region ?? '').trim().toUpperCase();
  if (!region) return null;

  return {
    id: pool.id,
    name: pool.name,
    region,
    type: pool.type,
    ...(pool.include ? { extraInclude: pool.include } : {}),
    ...(pool.exclude ? { extraExclude: pool.exclude } : {}),
    ...(pool.test ? { test: structuredClone(pool.test) } : {}),
    ...(Array.isArray(pool.sources) && pool.sources.length === 1 ? { slotId: pool.sources[0] } : {}),
    ...(pool.hidden !== undefined ? { hidden: pool.hidden } : {}),
  };
}

/** Normalizes a `NodePool`, filling default `icon` and `hidden: true` when omitted. */
export function normalizeNodePool(pool: NodePool, options?: { defaultHidden?: boolean }): NodePool {
  return {
    id: pool.id,
    name: pool.name,
    icon: resolvePoolIcon(pool),
    sources: Array.isArray(pool.sources) ? [...pool.sources] : 'all',
    ...(pool.include ? { include: pool.include } : {}),
    ...(pool.exclude ? { exclude: pool.exclude } : {}),
    ...(pool.region ? { region: pool.region.trim().toUpperCase() } : {}),
    kind: pool.kind,
    type: pool.type,
    ...(pool.members ? { members: [...pool.members] } : {}),
    ...(pool.test ? { test: structuredClone(pool.test) } : {}),
    hidden: pool.hidden ?? options?.defaultHidden ?? true,
  };
}

/** Maps a canonical/legacy starter tier name into the 3 complexity tiers (D12). */
export function starterTierToComplexity(tier: string): ComplexityTier {
  return STARTER_TIER_TO_COMPLEXITY[tier.trim().toLowerCase()] ?? 'advanced';
}

/** Resolves a canonical/legacy template slug into a `ComplexityTier`, if known. */
export function resolveComplexityBySlug(slug?: string | null): ComplexityTier | undefined {
  if (!slug) return undefined;
  return SLUG_TO_COMPLEXITY[slug.trim().toLowerCase()];
}

export type InferComplexityHints = {
  starterTier?: string;
  slug?: string;
};

/**
 * Infers a template's complexity tier (`simple` | `advanced` | `pro`) when `body.complexity`
 * is absent, inspecting explicit hints (`starterTier` / `slug`), `wizardMeta`, or `pools`.
 * Falls back to `'advanced'` when no signal can determine a tier (design §2).
 */
export function inferTemplateComplexity(
  body: Pick<TemplateBody, 'complexity' | 'wizardMeta' | 'regionGroups' | 'pools' | 'cards'>,
  hints?: InferComplexityHints,
): ComplexityTier {
  if (body.complexity) {
    return body.complexity;
  }
  if (hints?.starterTier) {
    return STARTER_TIER_TO_COMPLEXITY[hints.starterTier.trim().toLowerCase()] ?? 'advanced';
  }
  const bySlug = resolveComplexityBySlug(hints?.slug);
  if (bySlug) {
    return bySlug;
  }

  const wizardMeta = body.wizardMeta;
  if (wizardMeta) {
    if (wizardMeta.combineMode === 'perProvider') {
      return 'pro';
    }
    if (wizardMeta.groupMode === 'region') {
      return 'advanced';
    }
    const hasAdvancedScenarios = (wizardMeta.scenarios ?? []).some(
      (sc) => sc.enabled && sc.id !== 'domestic-direct' && sc.id !== 'ad-block',
    );
    const hasRulesets = (wizardMeta.rulesets ?? []).length > 0;
    const hasRegions = (body.regionGroups?.length ?? 0) > 0 || (body.pools?.some((p) => p.kind === 'region') ?? false);
    if (hasAdvancedScenarios || hasRulesets || hasRegions) {
      return 'advanced';
    }
    return 'simple';
  }

  return 'advanced';
}

/**
 * Returns the normalized `NodePool[]` for any `TemplateBody` without mutating the caller object.
 * Reads `body.pools` when present and appends/converts any legacy `body.regionGroups`.
 */
export function getNormalizedBodyPools(body: TemplateBody): NodePool[] {
  const defaultRegionHidden = body.wizardMeta?.groupMode === 'region' ? false : true;
  if (body.pools) {
    const pools = body.pools.map((pool) =>
      normalizeNodePool(pool, {
        defaultHidden: pool.kind === 'region' ? defaultRegionHidden : true,
      }),
    );
    const existingIds = new Set(pools.map((pool) => pool.id));
    for (const rg of body.regionGroups ?? []) {
      if (!existingIds.has(rg.id)) {
        pools.push(regionGroupToNodePool(rg, { defaultHidden: defaultRegionHidden }));
        existingIds.add(rg.id);
      }
    }
    return pools;
  }
  return (body.regionGroups ?? []).map((rg) => regionGroupToNodePool(rg, { defaultHidden: defaultRegionHidden }));
}

/**
 * Purely migrates a legacy or partial `TemplateBody` on read:
 *   - Converts legacy `regionGroups` into `kind: 'region'` `pools` (omitting `regionGroups`)
 *   - Auto-fills missing pool icons via `recognizeGroupIcon`
 *   - Infers `complexity` when missing (`simple` / `advanced` / `pro`, default `advanced`)
 */
export function migrateTemplateBody(body: TemplateBody, hints?: InferComplexityHints): TemplateBody {
  const next = structuredClone(body);
  next.pools = getNormalizedBodyPools(next);
  next.complexity = inferTemplateComplexity(next, hints);
  delete next.regionGroups;
  return next;
}

/**
 * Prepares a `TemplateBody` for DB persistence so write-back writes ONLY `pools`
 * (never legacy `regionGroups`) and always carries a resolved `complexity` tier.
 */
export function prepareTemplateBodyForStorage(body: TemplateBody, hints?: InferComplexityHints): TemplateBody {
  return migrateTemplateBody(body, hints);
}

/** Serializes a `TemplateBody` cleanly for SQLite/D1 storage (only `pools`, never `regionGroups`). */
export function serializeTemplateBodyForStorage(body: TemplateBody, hints?: InferComplexityHints): string {
  return JSON.stringify(prepareTemplateBodyForStorage(body, hints));
}
