import type { CatalogEntry, Condition, InlineRule, Matcher, Stage } from '../../../shared/schemas/card';
import { parseCidrRange } from '../../rules/conflicts';
import { resolveTemplateCards } from '../model';
import type { ProbeRuleEntry } from '../probe';
import type { LintIssue, LintTemplateInput } from './types';

function toCatalogMap(
  catalog?: ReadonlyMap<string, CatalogEntry> | readonly CatalogEntry[],
): Map<string, CatalogEntry> {
  if (!catalog) return new Map();
  if ('entries' in catalog && 'get' in catalog) return new Map(catalog);
  return new Map(catalog.map((entry) => [entry.id, entry]));
}

function parsePortRange(value: string): { start: number; end: number } | null {
  const [startText, endText = startText] = value.trim().split('-');
  const start = Number(startText);
  const end = Number(endText);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  return { start, end };
}

/**
 * Returns a human-readable reason if `earlier` completely covers `later`,
 * meaning `later` can never be matched after `earlier`.
 */
export function ruleCompletelyShadows(earlier: ProbeRuleEntry, later: ProbeRuleEntry): string | null {
  const eVal = earlier.value.trim().toLowerCase();
  const lVal = later.value.trim().toLowerCase();

  if (earlier.type === later.type && eVal === lVal) {
    return `规则 ${later.type},${later.value} 与更早出现的规则完全重复`;
  }

  if (earlier.type === 'DOMAIN-SUFFIX') {
    if (later.type === 'DOMAIN' && (lVal === eVal || lVal.endsWith(`.${eVal}`))) {
      return `DOMAIN-SUFFIX,${earlier.value} 已完全覆盖精确域名 ${later.value}`;
    }
    if (later.type === 'DOMAIN-SUFFIX' && (lVal === eVal || lVal.endsWith(`.${eVal}`))) {
      return `DOMAIN-SUFFIX,${earlier.value} 已完全覆盖更窄的后缀 ${later.value}`;
    }
  }

  if (earlier.type === 'DOMAIN-KEYWORD') {
    if (
      (later.type === 'DOMAIN' || later.type === 'DOMAIN-SUFFIX' || later.type === 'DOMAIN-KEYWORD') &&
      lVal.includes(eVal)
    ) {
      return `DOMAIN-KEYWORD,${earlier.value} 已完全覆盖包含该关键词的规则 ${later.type},${later.value}`;
    }
  }

  if ((earlier.type === 'IP-CIDR' || earlier.type === 'SRC-IP-CIDR') && earlier.type === later.type) {
    const eRange = parseCidrRange(eVal);
    const lRange = parseCidrRange(lVal);
    if (eRange && lRange && eRange.ipv6 === lRange.ipv6 && eRange.start <= lRange.start && eRange.end >= lRange.end) {
      return `${earlier.type},${earlier.value} 网段已完全包含 ${later.value}`;
    }
  }

  if ((earlier.type === 'DST-PORT' || earlier.type === 'SRC-PORT') && earlier.type === later.type) {
    const ePort = parsePortRange(eVal);
    const lPort = parsePortRange(lVal);
    if (ePort && lPort && ePort.start <= lPort.start && ePort.end >= lPort.end) {
      return `${earlier.type},${earlier.value} 端口范围已完全包含 ${later.value}`;
    }
  }

  return null;
}

type FlattenedRule = {
  cardId: string;
  cardName: string;
  cardIndex: number;
  stage: Stage;
  matcherIndex: number;
  ruleIndex?: number;
  rule: ProbeRuleEntry;
};

type FlattenedMatcherKey = {
  key: string;
  label: string;
  cardId: string;
  cardName: string;
  cardIndex: number;
  stage: Stage;
  matcherIndex: number;
};

function extractTopLevelAtomicRules(cond: Condition, out: InlineRule[]): void {
  // Only unconditional rules (or OR branches) unconditionally match on their own.
  // Rules nested inside AND / NOT are narrower conjunctions and do not shadow standalone rules.
  if (cond.op === 'rule') {
    out.push(cond.rule);
    return;
  }
  if (cond.op === 'or') {
    for (const item of cond.items) {
      extractTopLevelAtomicRules(item, out);
    }
  }
}

function matcherCanonicalKey(matcher: Matcher): { key: string; label: string } | null {
  switch (matcher.kind) {
    case 'geosite':
      return { key: `geosite:${matcher.name.trim().toLowerCase()}`, label: `GEOSITE,${matcher.name}` };
    case 'geoip':
      return { key: `geoip:${matcher.name.trim().toLowerCase()}`, label: `GEOIP,${matcher.name}` };
    case 'ruleset':
      return { key: `ruleset:${matcher.ruleSetId.trim()}`, label: `ruleset:${matcher.ruleSetId}` };
    case 'catalog':
      return { key: `catalog:${matcher.entryId.trim()}`, label: `catalog:${matcher.entryId}` };
    case 'remote':
      return { key: `remote:${matcher.behavior}:${matcher.url.trim()}`, label: `remote:${matcher.url}` };
    case 'inline':
      return null;
  }
}

/**
 * Detects rules or matchers that are completely covered by an earlier rule or
 * matcher and therefore can never take effect (design §10.7).
 */
export function checkRuleShadowing(
  input: Pick<LintTemplateInput, 'body' | 'cards' | 'caches' | 'catalogIndex'>,
): LintIssue[] {
  const resolved = resolveTemplateCards(
    { ...input.body, final: input.body.final ?? { kind: 'builtin', id: 'DIRECT' } },
    input.cards,
  );
  const cardIndexById = new Map(input.body.cards.map((ref, idx) => [ref.cardId, idx]));
  const catalogMap = toCatalogMap(input.catalogIndex ?? input.caches?.catalogIndex);

  const issues: LintIssue[] = [];
  const seenRules: FlattenedRule[] = [];
  const seenMatchers = new Map<string, FlattenedMatcherKey>();

  for (const resolvedCard of resolved.cards) {
    if (!resolvedCard.enabled) continue;
    const card = resolvedCard.effective;
    if (card.hidden) continue;
    const cardIndex = cardIndexById.get(card.id) ?? 0;

    card.matchers.forEach((matcher, matcherIndex) => {
      // 1. Exact duplicate non-inline matchers (e.g. duplicate GEOSITE / GEOIP / remote / catalog / ruleset)
      const canonical = matcherCanonicalKey(matcher);
      if (canonical) {
        const previous = seenMatchers.get(canonical.key);
        if (previous) {
          issues.push({
            code: 'rule-shadowing',
            severity: 'warning',
            message: `组件 ${card.name} 的匹配源「${canonical.label}」已被更早的组件 ${previous.cardName} 完全遮蔽，永远不会生效。`,
            location: {
              cardId: card.id,
              cardIndex,
              matcherIndex,
              stage: card.stage,
            },
            suggestion:
              previous.cardId === card.id
                ? `删除组件 ${card.name} 中重复的匹配源「${canonical.label}」。`
                : `移除重复的匹配源，或调整 ${card.name} 与 ${previous.cardName} 的先后顺序。`,
            details: {
              shadowedByCardId: previous.cardId,
              shadowedByMatcherIndex: previous.matcherIndex,
              matcherLabel: canonical.label,
            },
          });
        } else {
          seenMatchers.set(canonical.key, {
            key: canonical.key,
            label: canonical.label,
            cardId: card.id,
            cardName: card.name,
            cardIndex,
            stage: card.stage,
            matcherIndex,
          });
        }
      }

      // 2. Collect rule entries (inline rules + cached rules from rulesets/remote/catalog/geosite)
      const currentRules: Array<{ rule: ProbeRuleEntry; ruleIndex?: number }> = [];
      if (matcher.kind === 'inline') {
        const atomic: InlineRule[] = [];
        for (const cond of matcher.conditions) {
          extractTopLevelAtomicRules(cond, atomic);
        }
        atomic.forEach((rule, idx) => currentRules.push({ rule, ruleIndex: idx }));
      } else if (matcher.kind === 'ruleset') {
        const cached = input.caches?.rulesetRules?.get(matcher.ruleSetId);
        cached?.forEach((rule, idx) => currentRules.push({ rule, ruleIndex: idx }));
      } else if (matcher.kind === 'remote') {
        const cached = input.caches?.remoteRules?.get(matcher.url);
        cached?.forEach((rule, idx) => currentRules.push({ rule, ruleIndex: idx }));
      } else if (matcher.kind === 'catalog') {
        const entry = catalogMap.get(matcher.entryId);
        const cached =
          input.caches?.catalogRules?.get(matcher.entryId) ??
          (entry ? input.caches?.remoteRules?.get(entry.sourceUrl) : undefined);
        cached?.forEach((rule, idx) => currentRules.push({ rule, ruleIndex: idx }));
      } else if (matcher.kind === 'geosite') {
        const cached = input.caches?.geositeRules?.get(matcher.name.trim().toLowerCase());
        cached?.forEach((rule, idx) => currentRules.push({ rule, ruleIndex: idx }));
      }

      for (const { rule, ruleIndex } of currentRules) {
        let shadowedBy: { entry: FlattenedRule; reason: string } | null = null;
        for (const earlier of seenRules) {
          const reason = ruleCompletelyShadows(earlier.rule, rule);
          if (reason) {
            shadowedBy = { entry: earlier, reason };
            break;
          }
        }

        if (shadowedBy) {
          issues.push({
            code: 'rule-shadowing',
            severity: 'warning',
            message: `组件 ${card.name} 中的规则「${rule.type},${rule.value}」被更早的组件 ${shadowedBy.entry.cardName} 遮蔽（${shadowedBy.reason}）。`,
            location: {
              cardId: card.id,
              cardIndex,
              matcherIndex,
              ...(ruleIndex !== undefined ? { ruleIndex } : {}),
              stage: card.stage,
            },
            suggestion:
              shadowedBy.entry.cardId === card.id
                ? `删除组件 ${card.name} 中被遮蔽的冗余规则「${rule.type},${rule.value}」。`
                : `如果希望「${rule.type},${rule.value}」走 ${card.name}，请将 ${card.name} 移到 ${shadowedBy.entry.cardName} 之前；否则可删除该冗余规则。`,
            details: {
              rule: `${rule.type},${rule.value}`,
              shadowedByCardId: shadowedBy.entry.cardId,
              shadowedByRule: `${shadowedBy.entry.rule.type},${shadowedBy.entry.rule.value}`,
            },
          });
        }

        seenRules.push({
          cardId: card.id,
          cardName: card.name,
          cardIndex,
          stage: card.stage,
          matcherIndex,
          ruleIndex,
          rule,
        });
      }
    });
  }

  return issues;
}

/**
 * Known semantic subset -> superset relationships for GeoSite names (design §10.7).
 * Each key is a narrower GeoSite set contained inside every listed superset.
 */
const GEOSITE_SUPERSETS: Readonly<Record<string, readonly string[]>> = {
  openai: ['category-ai-!cn', 'category-ai-chat-!cn'],
  anthropic: ['category-ai-!cn', 'category-ai-chat-!cn'],
  claude: ['category-ai-!cn', 'category-ai-chat-!cn'],
  gemini: ['category-ai-!cn', 'google'],
  perplexity: ['category-ai-!cn'],
  googlefcm: ['google'],
  'google-cn': ['google'],
  youtube: ['google', 'category-entertainment'],
  onedrive: ['microsoft'],
  'apple-tv': ['apple'],
  'apple-cn': ['apple'],
  'steam@cn': ['steam', 'category-games'],
  steam: ['category-games'],
  epicgames: ['category-games'],
  blizzard: ['category-games'],
  ea: ['category-games'],
  ubisoft: ['category-games'],
  sony: ['category-games'],
  nintendo: ['category-games'],
  netflix: ['category-entertainment'],
  disney: ['category-entertainment'],
  spotify: ['category-entertainment'],
  tiktok: ['category-entertainment'],
  'bilibili@cn': ['bilibili'],
};

/** Maps built-in catalog IDs to equivalent GeoSite names for cross-matcher subset checks. */
const CATALOG_TO_GEOSITE: Readonly<Record<string, string>> = {
  'ai-all': 'category-ai-!cn',
  'ai-openai': 'openai',
  'ai-claude': 'claude',
  'ai-gemini': 'gemini',
  'streaming-global': 'category-entertainment',
  'streaming-youtube': 'youtube',
  'streaming-netflix': 'netflix',
  'streaming-disney': 'disney',
  'streaming-spotify': 'spotify',
  'streaming-tiktok': 'tiktok',
  'streaming-apple-tv': 'apple-tv',
  'gaming-all': 'category-games',
  'gaming-steam': 'steam',
  'gaming-steam-cn': 'steam@cn',
  'gaming-epic': 'epicgames',
  'infra-google': 'google',
  'infra-google-fcm': 'googlefcm',
  'infra-apple': 'apple',
  'infra-microsoft': 'microsoft',
  'infra-onedrive': 'onedrive',
  'ads-all': 'category-ads-all',
};

type SemanticToken = {
  cardId: string;
  cardName: string;
  cardIndex: number;
  stage: Stage;
  matcherIndex: number;
  label: string;
  geositeName?: string;
  catalogId?: string;
};

function getCatalogAncestors(catalogId: string, catalogMap: ReadonlyMap<string, CatalogEntry>): Set<string> {
  const ancestors = new Set<string>();
  let current = catalogMap.get(catalogId)?.parentId;
  let guard = 0;
  while (current && !ancestors.has(current) && guard < 16) {
    ancestors.add(current);
    current = catalogMap.get(current)?.parentId;
    guard += 1;
  }
  return ancestors;
}

function getGeositeSupersets(name: string): Set<string> {
  const result = new Set<string>();
  const queue = [name.toLowerCase()];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const parent of GEOSITE_SUPERSETS[current] ?? []) {
      if (!result.has(parent)) {
        result.add(parent);
        queue.push(parent);
      }
    }
  }
  return result;
}

function isStrictSubsetOf(
  narrow: SemanticToken,
  broad: SemanticToken,
  catalogMap: ReadonlyMap<string, CatalogEntry>,
): boolean {
  if (narrow.cardId === broad.cardId) return false;

  // 1. Catalog parentId hierarchy (transitive)
  if (narrow.catalogId && broad.catalogId) {
    const ancestors = getCatalogAncestors(narrow.catalogId, catalogMap);
    if (ancestors.has(broad.catalogId)) return true;
  }

  // 2. GeoSite hierarchy (direct or mapped from catalog)
  const narrowGeo = narrow.geositeName ?? (narrow.catalogId ? CATALOG_TO_GEOSITE[narrow.catalogId] : undefined);
  const broadGeo = broad.geositeName ?? (broad.catalogId ? CATALOG_TO_GEOSITE[broad.catalogId] : undefined);
  if (narrowGeo && broadGeo && narrowGeo !== broadGeo) {
    const supersets = getGeositeSupersets(narrowGeo);
    if (supersets.has(broadGeo)) return true;
  }

  return false;
}

/**
 * Checks whether a narrower matcher/card (e.g. `openai`, `googlefcm`, `steam`, `onedrive`)
 * is positioned after a broader superset matcher/card (e.g. `category-ai-!cn`, `google`,
 * `category-games`, `microsoft`) (design §10.7, §10.10).
 */
export function checkSubsetAfterSuperset(
  input: Pick<LintTemplateInput, 'body' | 'cards' | 'catalogIndex' | 'caches'>,
): LintIssue[] {
  const catalogMap = toCatalogMap(input.catalogIndex ?? input.caches?.catalogIndex);
  const resolved = resolveTemplateCards(
    { ...input.body, final: input.body.final ?? { kind: 'builtin', id: 'DIRECT' } },
    input.cards,
  );
  const cardIndexById = new Map(input.body.cards.map((ref, idx) => [ref.cardId, idx]));

  const seenTokens: SemanticToken[] = [];
  const issues: LintIssue[] = [];
  const reportedPairs = new Set<string>();

  for (const resolvedCard of resolved.cards) {
    if (!resolvedCard.enabled) continue;
    const card = resolvedCard.effective;
    if (card.hidden) continue;
    const cardIndex = cardIndexById.get(card.id) ?? 0;

    card.matchers.forEach((matcher, matcherIndex) => {
      let token: SemanticToken | null = null;
      if (matcher.kind === 'geosite') {
        token = {
          cardId: card.id,
          cardName: card.name,
          cardIndex,
          stage: card.stage,
          matcherIndex,
          label: `GEOSITE,${matcher.name}`,
          geositeName: matcher.name.trim().toLowerCase(),
        };
      } else if (matcher.kind === 'catalog') {
        token = {
          cardId: card.id,
          cardName: card.name,
          cardIndex,
          stage: card.stage,
          matcherIndex,
          label: `catalog:${matcher.entryId}`,
          catalogId: matcher.entryId,
        };
      }

      if (!token) return;

      for (const earlier of seenTokens) {
        if (isStrictSubsetOf(token, earlier, catalogMap)) {
          const pairKey = `${earlier.cardId}>>${token.cardId}:${token.matcherIndex}`;
          if (reportedPairs.has(pairKey)) continue;
          reportedPairs.add(pairKey);

          issues.push({
            code: 'subset-after-superset',
            severity: 'warning',
            message: `较窄的子集组件 ${card.name}（${token.label}）排在包含它的较宽超集 ${earlier.cardName}（${earlier.label}）之后，将优先被后者截获。`,
            location: {
              cardId: card.id,
              cardIndex,
              matcherIndex,
              stage: card.stage,
            },
            suggestion: `遵循“窄在前、宽在后”原则，将 ${card.name} 拖动到 ${earlier.cardName} 之前。`,
            details: {
              subsetMatcher: token.label,
              supersetCardId: earlier.cardId,
              supersetMatcher: earlier.label,
            },
          });
        }
      }

      seenTokens.push(token);
    });
  }

  return issues;
}
