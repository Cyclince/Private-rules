import type { TemplateClientId } from '../../shared/clients';
import type { CatalogEntry, Matcher, RemoteRuleBehavior, RemoteRuleFormat } from '../../shared/schemas/card';
import type { ResolvedTemplateCard } from './model';

/** Default remote ruleset refresh interval (8 hours) when unspecified. */
export const DEFAULT_RULESET_UPDATE_INTERVAL_SEC = 28_800;

/** Behavior split order mandated by design §9.5: Domain -> Classical -> IP. */
export const BEHAVIOR_SPLIT_ORDER: readonly RemoteRuleBehavior[] = ['domain', 'classical', 'ipcidr'];

/** Clients that execute local/inline rules before remote ruleset lists (design §10.6). */
const LOCAL_FIRST_CLIENTS = new Set<TemplateClientId>(['loon', 'quantumult-x']);

/** Clients with native GEOSITE support (design §10.6). */
const NATIVE_GEOSITE_CLIENTS = new Set<TemplateClientId>(['mihomo', 'stash', 'sing-box']);

export type PlannedProviderSource =
  | { kind: 'remote'; url: string }
  | { kind: 'catalog'; entryId: string; url: string }
  | { kind: 'ruleset'; ruleSetId: string; url?: string }
  | { kind: 'geosite-hosted'; name: string; url?: string }
  | { kind: 'geoip-ruleset'; name: string };

export type PlannedProvider = {
  /** Deterministic unique provider ID (deduplicated across all cards). */
  id: string;
  /** Canonical deduplication key. */
  dedupeKey: string;
  source: PlannedProviderSource;
  behavior: RemoteRuleBehavior;
  format: RemoteRuleFormat;
  updateIntervalSec: number;
  /** True when the target client must inline this ruleset to preserve rule priority. */
  inlineForPriority: boolean;
  /** Card IDs referencing this provider (in first-seen order, unique). */
  referencedBy: string[];
};

export type PlannedMatcherStrategy = 'provider' | 'native-geosite' | 'native-geoip' | 'self-hosted-ruleset' | 'inline';

export type PlannedMatcherBinding = {
  cardId: string;
  matcherIndex: number;
  matcher: Matcher;
  strategy: PlannedMatcherStrategy;
  /** Provider IDs in evaluation order (e.g. Domain -> Classical -> IP for split rulesets). */
  providerIds: string[];
  /** Present when `inlineForPriority` forced a remote ruleset to inline on Loon / QX. */
  inlinedForPriority: boolean;
};

export type PlannerWarningCode =
  'CATALOG_ENTRY_MISSING' | 'GEOSITE_CONVERTED_TO_SELF_HOSTED' | 'REMOTE_INLINED_FOR_LOCAL_FIRST_CLIENT';

export type PlannerWarning = {
  code: PlannerWarningCode;
  cardId: string;
  message: string;
};

export type RulesetPlannerInput = {
  cards: readonly ResolvedTemplateCard[];
  client: TemplateClientId;
  catalogIndex?: ReadonlyMap<string, CatalogEntry> | readonly CatalogEntry[];
  /**
   * Optional per-ruleset behavior breakdown (number of rules in each behavior
   * bucket). When supplied, a `ruleset` matcher emits only non-empty providers
   * in strict `domain -> classical -> ipcidr` order (design §9.5).
   */
  rulesetBehaviors?: ReadonlyMap<string, Partial<Record<RemoteRuleBehavior, number>>>;
  /** Optional base URL for self-hosted rulesets / converted GeoSite endpoints. */
  baseUrl?: string;
};

export type RulesetPlan = {
  client: TemplateClientId;
  /** Deduplicated provider table — every unique remote ruleset appears exactly once. */
  providers: PlannedProvider[];
  /** Per-card matcher resolution bindings. */
  bindings: PlannedMatcherBinding[];
  warnings: PlannerWarning[];
};

function toCatalogMap(
  catalog?: ReadonlyMap<string, CatalogEntry> | readonly CatalogEntry[],
): Map<string, CatalogEntry> {
  if (!catalog) return new Map();
  if ('entries' in catalog && 'get' in catalog) {
    return new Map(catalog);
  }
  return new Map(catalog.map((entry) => [entry.id, entry]));
}

function normalizeUrl(url: string): string {
  return url.trim();
}

function sanitizeIdPart(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'ruleset'
  );
}

function inferFormatFromUrl(url: string): RemoteRuleFormat {
  const lower = url.toLowerCase();
  if (lower.endsWith('.mrs')) return 'mrs';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  return 'text';
}

function buildSelfHostedRulesetUrl(
  baseUrl: string | undefined,
  ruleSetId: string,
  behavior: RemoteRuleBehavior,
  client: TemplateClientId,
): string | undefined {
  if (!baseUrl) return undefined;
  const trimmed = baseUrl.replace(/\/+$/, '');
  const encodedId = encodeURIComponent(ruleSetId);
  if (client === 'surge') {
    return `${trimmed}/rules/${encodedId}_${behavior}-surge.list`;
  }
  if (client === 'loon') {
    return `${trimmed}/rules/${encodedId}_${behavior}-loon.list`;
  }
  if (client === 'quantumult-x') {
    return `${trimmed}/rules/${encodedId}_${behavior}-qx.list`;
  }
  if (client === 'shadowrocket') {
    return `${trimmed}/rules/${encodedId}_${behavior}-shadowrocket.list`;
  }
  if (client === 'sing-box') {
    return `${trimmed}/rules/${encodedId}-sing-box.json`;
  }
  const formatSegment =
    behavior === 'domain' ? 'clash-domain' : behavior === 'ipcidr' ? 'clash-ipcidr' : 'clash-classical';
  return `${trimmed}/sub/${encodedId}/${formatSegment}`;
}

function buildSelfHostedGeositeUrl(
  baseUrl: string | undefined,
  name: string,
  client: TemplateClientId,
): string | undefined {
  if (!baseUrl) return undefined;
  const trimmed = baseUrl.replace(/\/+$/, '');
  const encodedName = encodeURIComponent(name.toLowerCase());
  if (client === 'surge') {
    return `${trimmed}/rules/geosite-${encodedName}-surge.list`;
  }
  if (client === 'loon') {
    return `${trimmed}/rules/geosite-${encodedName}-loon.list`;
  }
  if (client === 'quantumult-x') {
    return `${trimmed}/rules/geosite-${encodedName}-qx.list`;
  }
  if (client === 'shadowrocket') {
    return `${trimmed}/rules/geosite-${encodedName}-shadowrocket.list`;
  }
  return `${trimmed}/sub/geosite-${encodedName}/clash-domain`;
}

/**
 * Plans how every card matcher is referenced for a given client, guaranteeing:
 *   1. Identical remote rulesets (including catalog entries pointing to the same
 *      URL/behavior/format) are deduplicated into a single provider entry.
 *   2. Self-hosted rule sets split in deterministic `domain -> classical -> ipcidr` order.
 *   3. Clients without native GEOSITE fall back to deduplicated self-hosted rulesets.
 *   4. Local-first clients (Loon / QX) mark remote providers appearing before an
 *      inline rule as `inlineForPriority` so rule priority matches the template.
 */
export function planRulesetReferences(input: RulesetPlannerInput): RulesetPlan {
  const catalogMap = toCatalogMap(input.catalogIndex);
  const providersByKey = new Map<string, PlannedProvider>();
  const usedIds = new Set<string>();
  const bindings: PlannedMatcherBinding[] = [];
  const warnings: PlannerWarning[] = [];

  const activeCards = input.cards.filter((card) => card.enabled && !card.effective.hidden);

  // For local-first clients (Loon / QX), find the last card index containing an inline matcher.
  let lastInlineCardIdx = -1;
  if (LOCAL_FIRST_CLIENTS.has(input.client)) {
    activeCards.forEach((card, idx) => {
      if (card.effective.matchers.some((m) => m.kind === 'inline')) {
        lastInlineCardIdx = idx;
      }
    });
  }

  const allocateId = (baseSlug: string): string => {
    const clean = sanitizeIdPart(baseSlug);
    if (!usedIds.has(clean)) {
      usedIds.add(clean);
      return clean;
    }
    let suffix = 2;
    while (usedIds.has(`${clean}-${suffix}`)) {
      suffix += 1;
    }
    const candidate = `${clean}-${suffix}`;
    usedIds.add(candidate);
    return candidate;
  };

  const registerProvider = (params: {
    dedupeKey: string;
    preferredId: string;
    source: PlannedProviderSource;
    behavior: RemoteRuleBehavior;
    format: RemoteRuleFormat;
    updateIntervalSec?: number;
    inlineForPriority: boolean;
    cardId: string;
  }): PlannedProvider => {
    const existing = providersByKey.get(params.dedupeKey);
    const interval = params.updateIntervalSec ?? DEFAULT_RULESET_UPDATE_INTERVAL_SEC;

    if (existing) {
      if (!existing.referencedBy.includes(params.cardId)) {
        existing.referencedBy.push(params.cardId);
      }
      if (params.updateIntervalSec && params.updateIntervalSec < existing.updateIntervalSec) {
        existing.updateIntervalSec = params.updateIntervalSec;
      }
      if (params.inlineForPriority) {
        existing.inlineForPriority = true;
      }
      return existing;
    }

    const provider: PlannedProvider = {
      id: allocateId(params.preferredId),
      dedupeKey: params.dedupeKey,
      source: params.source,
      behavior: params.behavior,
      format: params.format,
      updateIntervalSec: interval,
      inlineForPriority: params.inlineForPriority,
      referencedBy: [params.cardId],
    };
    providersByKey.set(params.dedupeKey, provider);
    return provider;
  };

  activeCards.forEach((card, cardIdx) => {
    const beforeInlineRule = LOCAL_FIRST_CLIENTS.has(input.client) && cardIdx < lastInlineCardIdx;

    card.effective.matchers.forEach((matcher, matcherIndex) => {
      switch (matcher.kind) {
        case 'inline': {
          bindings.push({
            cardId: card.cardId,
            matcherIndex,
            matcher,
            strategy: 'inline',
            providerIds: [],
            inlinedForPriority: false,
          });
          return;
        }

        case 'remote': {
          const url = normalizeUrl(matcher.url);
          const format = matcher.format ?? inferFormatFromUrl(url);
          const dedupeKey = `remote:${url}|${matcher.behavior}|${format}`;
          const provider = registerProvider({
            dedupeKey,
            preferredId: `remote-${card.effective.slug}-${matcher.behavior}`,
            source: { kind: 'remote', url },
            behavior: matcher.behavior,
            format,
            updateIntervalSec: matcher.updateIntervalSec,
            inlineForPriority: beforeInlineRule,
            cardId: card.cardId,
          });
          if (beforeInlineRule) {
            warnings.push({
              code: 'REMOTE_INLINED_FOR_LOCAL_FIRST_CLIENT',
              cardId: card.cardId,
              message: `${input.client} 会先匹配本地规则，已将排在本地规则之前的远程规则集 ${provider.id} 标记为内联。`,
            });
          }
          bindings.push({
            cardId: card.cardId,
            matcherIndex,
            matcher,
            strategy: beforeInlineRule ? 'inline' : 'provider',
            providerIds: [provider.id],
            inlinedForPriority: beforeInlineRule,
          });
          return;
        }

        case 'catalog': {
          const entry = catalogMap.get(matcher.entryId);
          if (!entry) {
            warnings.push({
              code: 'CATALOG_ENTRY_MISSING',
              cardId: card.cardId,
              message: `组件 ${card.cardId} 引用的规则目录条目 ${matcher.entryId} 未找到。`,
            });
            const fallbackKey = `catalog-unresolved:${matcher.entryId}`;
            const provider = registerProvider({
              dedupeKey: fallbackKey,
              preferredId: `catalog-${matcher.entryId}`,
              source: { kind: 'catalog', entryId: matcher.entryId, url: '' },
              behavior: 'classical',
              format: 'text',
              updateIntervalSec: matcher.updateIntervalSec,
              inlineForPriority: beforeInlineRule,
              cardId: card.cardId,
            });
            bindings.push({
              cardId: card.cardId,
              matcherIndex,
              matcher,
              strategy: beforeInlineRule ? 'inline' : 'provider',
              providerIds: [provider.id],
              inlinedForPriority: beforeInlineRule,
            });
            return;
          }

          const url = normalizeUrl(entry.sourceUrl);
          const behavior = entry.behavior ?? 'classical';
          const format = entry.format ?? inferFormatFromUrl(url);
          // Share the exact same deduplication namespace as `remote` matchers pointing to the same URL!
          const dedupeKey = `remote:${url}|${behavior}|${format}`;
          const provider = registerProvider({
            dedupeKey,
            preferredId: `catalog-${entry.id}`,
            source: { kind: 'catalog', entryId: entry.id, url },
            behavior,
            format,
            updateIntervalSec: matcher.updateIntervalSec,
            inlineForPriority: beforeInlineRule,
            cardId: card.cardId,
          });
          if (beforeInlineRule) {
            warnings.push({
              code: 'REMOTE_INLINED_FOR_LOCAL_FIRST_CLIENT',
              cardId: card.cardId,
              message: `${input.client} 会先匹配本地规则，已将排在本地规则之前的目录规则 ${provider.id} 标记为内联。`,
            });
          }
          bindings.push({
            cardId: card.cardId,
            matcherIndex,
            matcher,
            strategy: beforeInlineRule ? 'inline' : 'provider',
            providerIds: [provider.id],
            inlinedForPriority: beforeInlineRule,
          });
          return;
        }

        case 'ruleset': {
          if (input.client === 'sing-box') {
            const url = buildSelfHostedRulesetUrl(input.baseUrl, matcher.ruleSetId, 'classical', input.client);
            const dedupeKey = `ruleset:${matcher.ruleSetId}|sing-box`;
            const provider = registerProvider({
              dedupeKey,
              preferredId: `ruleset-${matcher.ruleSetId}`,
              source: { kind: 'ruleset', ruleSetId: matcher.ruleSetId, url },
              behavior: 'classical',
              format: 'text',
              updateIntervalSec: matcher.updateIntervalSec,
              inlineForPriority: false,
              cardId: card.cardId,
            });
            bindings.push({
              cardId: card.cardId,
              matcherIndex,
              matcher,
              strategy: 'provider',
              providerIds: [provider.id],
              inlinedForPriority: false,
            });
            return;
          }

          const breakdown = input.rulesetBehaviors?.get(matcher.ruleSetId);
          const behaviors: RemoteRuleBehavior[] = breakdown
            ? BEHAVIOR_SPLIT_ORDER.filter((b) => (breakdown[b] ?? 0) > 0)
            : ['classical'];
          const effectiveBehaviors: RemoteRuleBehavior[] = behaviors.length > 0 ? behaviors : ['classical'];

          const providerIds: string[] = [];
          const selfHostedFormat: RemoteRuleFormat =
            input.client === 'surge' ||
            input.client === 'loon' ||
            input.client === 'quantumult-x' ||
            input.client === 'shadowrocket'
              ? 'text'
              : 'yaml';
          for (const behavior of effectiveBehaviors) {
            const url = buildSelfHostedRulesetUrl(input.baseUrl, matcher.ruleSetId, behavior, input.client);
            const dedupeKey = `ruleset:${matcher.ruleSetId}|${behavior}`;
            const provider = registerProvider({
              dedupeKey,
              preferredId: `ruleset-${matcher.ruleSetId}-${behavior}`,
              source: { kind: 'ruleset', ruleSetId: matcher.ruleSetId, url },
              behavior,
              format: selfHostedFormat,
              updateIntervalSec: matcher.updateIntervalSec,
              inlineForPriority: beforeInlineRule,
              cardId: card.cardId,
            });
            providerIds.push(provider.id);
          }

          if (beforeInlineRule) {
            warnings.push({
              code: 'REMOTE_INLINED_FOR_LOCAL_FIRST_CLIENT',
              cardId: card.cardId,
              message: `${input.client} 会先匹配本地规则，已将排在本地规则之前的规则集 ${matcher.ruleSetId} 标记为内联。`,
            });
          }
          bindings.push({
            cardId: card.cardId,
            matcherIndex,
            matcher,
            strategy: beforeInlineRule ? 'inline' : 'provider',
            providerIds,
            inlinedForPriority: beforeInlineRule,
          });
          return;
        }

        case 'geosite': {
          const normalizedName = matcher.name.trim().toLowerCase();
          if (NATIVE_GEOSITE_CLIENTS.has(input.client)) {
            if (input.client === 'sing-box') {
              const dedupeKey = `geosite-ruleset:${normalizedName}`;
              const provider = registerProvider({
                dedupeKey,
                preferredId: `geosite-${normalizedName}`,
                source: { kind: 'geosite-hosted', name: normalizedName },
                behavior: 'domain',
                format: 'text',
                updateIntervalSec: matcher.updateIntervalSec,
                inlineForPriority: false,
                cardId: card.cardId,
              });
              bindings.push({
                cardId: card.cardId,
                matcherIndex,
                matcher,
                strategy: 'provider',
                providerIds: [provider.id],
                inlinedForPriority: false,
              });
            } else {
              bindings.push({
                cardId: card.cardId,
                matcherIndex,
                matcher,
                strategy: 'native-geosite',
                providerIds: [],
                inlinedForPriority: false,
              });
            }
            return;
          }

          // Clients without native GEOSITE use a deduplicated self-hosted ruleset
          const url = buildSelfHostedGeositeUrl(input.baseUrl, normalizedName, input.client);
          const dedupeKey = `geosite-hosted:${normalizedName}`;
          const provider = registerProvider({
            dedupeKey,
            preferredId: `geosite-${normalizedName}`,
            source: { kind: 'geosite-hosted', name: normalizedName, url },
            behavior: 'domain',
            format: 'text',
            updateIntervalSec: matcher.updateIntervalSec,
            inlineForPriority: beforeInlineRule,
            cardId: card.cardId,
          });
          warnings.push({
            code: 'GEOSITE_CONVERTED_TO_SELF_HOSTED',
            cardId: card.cardId,
            message: `${input.client} 不原生支持 GEOSITE(${matcher.name})，已规划为自托管规则集 ${provider.id}。`,
          });
          bindings.push({
            cardId: card.cardId,
            matcherIndex,
            matcher,
            strategy: beforeInlineRule ? 'inline' : 'self-hosted-ruleset',
            providerIds: [provider.id],
            inlinedForPriority: beforeInlineRule,
          });
          return;
        }

        case 'geoip': {
          const normalizedName = matcher.name.trim().toLowerCase();
          if (input.client === 'sing-box') {
            const dedupeKey = `geoip-ruleset:${normalizedName}`;
            const provider = registerProvider({
              dedupeKey,
              preferredId: `geoip-${normalizedName}`,
              source: { kind: 'geoip-ruleset', name: normalizedName },
              behavior: 'ipcidr',
              format: 'text',
              updateIntervalSec: matcher.updateIntervalSec,
              inlineForPriority: false,
              cardId: card.cardId,
            });
            bindings.push({
              cardId: card.cardId,
              matcherIndex,
              matcher,
              strategy: 'provider',
              providerIds: [provider.id],
              inlinedForPriority: false,
            });
            return;
          }

          bindings.push({
            cardId: card.cardId,
            matcherIndex,
            matcher,
            strategy: 'native-geoip',
            providerIds: [],
            inlinedForPriority: false,
          });
        }
      }
    });
  });

  return {
    client: input.client,
    providers: [...providersByKey.values()],
    bindings,
    warnings,
  };
}
