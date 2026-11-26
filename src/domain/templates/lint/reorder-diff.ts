import type { Condition, InlineRule, PolicyRef } from '../../../shared/schemas/card';
import type { TemplateBody } from '../../../shared/schemas/template';
import { resolveTemplateCards } from '../model';
import { probeTemplate, type ProbeCaches, type ProbeRuleEntry } from '../probe';
import type { LintIssue, LintTemplateInput } from './types';

/**
 * Built-in representative sample domains for common GeoSite / catalog matchers,
 * used exclusively for reorder-diff simulation when explicit rule caches are absent.
 */
const BUILTIN_REPRESENTATIVE_RULES: Readonly<Record<string, readonly ProbeRuleEntry[]>> = {
  openai: [
    { type: 'DOMAIN-SUFFIX', value: 'openai.com' },
    { type: 'DOMAIN-SUFFIX', value: 'chatgpt.com' },
  ],
  claude: [{ type: 'DOMAIN-SUFFIX', value: 'claude.ai' }],
  anthropic: [{ type: 'DOMAIN-SUFFIX', value: 'anthropic.com' }],
  gemini: [{ type: 'DOMAIN-SUFFIX', value: 'gemini.google.com' }],
  'category-ai-!cn': [
    { type: 'DOMAIN-SUFFIX', value: 'openai.com' },
    { type: 'DOMAIN-SUFFIX', value: 'chatgpt.com' },
    { type: 'DOMAIN-SUFFIX', value: 'claude.ai' },
    { type: 'DOMAIN-SUFFIX', value: 'perplexity.ai' },
  ],
  googlefcm: [{ type: 'DOMAIN', value: 'mtalk.google.com' }],
  youtube: [
    { type: 'DOMAIN-SUFFIX', value: 'youtube.com' },
    { type: 'DOMAIN-SUFFIX', value: 'googlevideo.com' },
  ],
  google: [
    { type: 'DOMAIN-SUFFIX', value: 'google.com' },
    { type: 'DOMAIN-SUFFIX', value: 'youtube.com' },
    { type: 'DOMAIN', value: 'mtalk.google.com' },
  ],
  onedrive: [{ type: 'DOMAIN-SUFFIX', value: 'onedrive.live.com' }],
  microsoft: [
    { type: 'DOMAIN-SUFFIX', value: 'microsoft.com' },
    { type: 'DOMAIN-SUFFIX', value: 'onedrive.live.com' },
  ],
  apple: [{ type: 'DOMAIN-SUFFIX', value: 'apple.com' }],
  'apple-tv': [{ type: 'DOMAIN-SUFFIX', value: 'tv.apple.com' }],
  netflix: [{ type: 'DOMAIN-SUFFIX', value: 'netflix.com' }],
  disney: [{ type: 'DOMAIN-SUFFIX', value: 'disneyplus.com' }],
  spotify: [{ type: 'DOMAIN-SUFFIX', value: 'spotify.com' }],
  tiktok: [{ type: 'DOMAIN-SUFFIX', value: 'tiktok.com' }],
  bilibili: [{ type: 'DOMAIN-SUFFIX', value: 'bilibili.com' }],
  telegram: [{ type: 'DOMAIN-SUFFIX', value: 't.me' }],
  twitter: [{ type: 'DOMAIN-SUFFIX', value: 'x.com' }],
  discord: [{ type: 'DOMAIN-SUFFIX', value: 'discord.com' }],
  github: [{ type: 'DOMAIN-SUFFIX', value: 'github.com' }],
  'steam@cn': [{ type: 'DOMAIN-SUFFIX', value: 'steamcontent.com' }],
  steam: [
    { type: 'DOMAIN-SUFFIX', value: 'steampowered.com' },
    { type: 'DOMAIN-SUFFIX', value: 'steamcontent.com' },
  ],
  'category-games': [
    { type: 'DOMAIN-SUFFIX', value: 'steampowered.com' },
    { type: 'DOMAIN-SUFFIX', value: 'epicgames.com' },
  ],
  'category-ads-all': [{ type: 'DOMAIN-SUFFIX', value: 'doubleclick.net' }],
  gfw: [
    { type: 'DOMAIN-SUFFIX', value: 'google.com' },
    { type: 'DOMAIN-SUFFIX', value: 'wikipedia.org' },
  ],
  cn: [
    { type: 'DOMAIN-SUFFIX', value: 'baidu.com' },
    { type: 'DOMAIN-SUFFIX', value: 'qq.com' },
  ],
  private: [{ type: 'DOMAIN-SUFFIX', value: 'local' }],
};

export type ReorderDiffEntry = {
  target: string;
  beforeCardId: string | null;
  beforeLabel: string;
  afterCardId: string | null;
  afterLabel: string;
};

function collectInlineRules(cond: Condition, out: InlineRule[]): void {
  if (cond.op === 'rule') {
    out.push(cond.rule);
    return;
  }
  if (cond.op === 'not') {
    collectInlineRules(cond.item, out);
    return;
  }
  for (const item of cond.items) collectInlineRules(item, out);
}

function sampleTargetFromRule(rule: ProbeRuleEntry): string | null {
  const val = rule.value.trim().toLowerCase();
  switch (rule.type) {
    case 'DOMAIN':
      return val;
    case 'DOMAIN-SUFFIX':
      return `sub.${val}`;
    case 'DOMAIN-KEYWORD':
      return `${val}.example.com`;
    case 'IP-CIDR':
      return val.split('/')[0] ?? null;
    default:
      return null;
  }
}

function formatPolicyLabel(cardId: string | null, cardName: string | null, policy: PolicyRef): string {
  if (cardName) return cardName;
  if (cardId) return cardId;
  if (policy.kind === 'builtin') return policy.id;
  if (policy.kind === 'card') return policy.cardId;
  if (policy.kind === 'region') return policy.regionGroupId;
  return policy.slotId;
}

function mergeSimulationCaches(caches?: ProbeCaches): ProbeCaches {
  const geositeRules = new Map<string, readonly ProbeRuleEntry[]>(Object.entries(BUILTIN_REPRESENTATIVE_RULES));
  if (caches?.geositeRules) {
    for (const [k, v] of caches.geositeRules) {
      geositeRules.set(k.toLowerCase(), v);
    }
  }
  return {
    ...caches,
    geositeRules,
  };
}

function collectCandidateTargets(
  body: TemplateBody,
  cards: LintTemplateInput['cards'],
  caches: ProbeCaches,
  extraSamples?: readonly string[],
): string[] {
  const targets = new Set<string>(extraSamples ?? []);
  const resolved = resolveTemplateCards(body, cards);

  for (const resolvedCard of resolved.cards) {
    if (!resolvedCard.enabled || resolvedCard.effective.hidden) continue;
    for (const matcher of resolvedCard.effective.matchers) {
      if (matcher.kind === 'inline') {
        const rules: InlineRule[] = [];
        for (const cond of matcher.conditions) collectInlineRules(cond, rules);
        for (const rule of rules) {
          const sample = sampleTargetFromRule(rule);
          if (sample) targets.add(sample);
        }
      } else if (matcher.kind === 'geosite') {
        const rules = caches.geositeRules?.get(matcher.name.trim().toLowerCase());
        rules?.slice(0, 5).forEach((rule) => {
          const sample = sampleTargetFromRule(rule);
          if (sample) targets.add(sample);
        });
      } else if (matcher.kind === 'ruleset') {
        caches.rulesetRules
          ?.get(matcher.ruleSetId)
          ?.slice(0, 10)
          .forEach((rule) => {
            const sample = sampleTargetFromRule(rule);
            if (sample) targets.add(sample);
          });
      } else if (matcher.kind === 'remote') {
        caches.remoteRules
          ?.get(matcher.url)
          ?.slice(0, 10)
          .forEach((rule) => {
            const sample = sampleTargetFromRule(rule);
            if (sample) targets.add(sample);
          });
      } else if (matcher.kind === 'catalog') {
        caches.catalogRules
          ?.get(matcher.entryId)
          ?.slice(0, 10)
          .forEach((rule) => {
            const sample = sampleTargetFromRule(rule);
            if (sample) targets.add(sample);
          });
      }
    }
  }

  return [...targets];
}

/**
 * Compares template rule matching before and after card reordering, returning
 * `reorder-diff` info issues listing sample domains/IPs whose matched group changed (design §10.7).
 */
export function checkReorderDiff(
  input: Pick<LintTemplateInput, 'body' | 'cards' | 'previousCards' | 'previousBody' | 'caches' | 'sampleTargets'>,
): LintIssue[] {
  if (!input.previousBody && !input.previousCards) {
    return [];
  }

  const normalizedCurrent: TemplateBody = {
    ...input.body,
    final: input.body.final ?? { kind: 'builtin', id: 'DIRECT' },
  };
  const previousBody: TemplateBody = input.previousBody ?? {
    ...normalizedCurrent,
    cards: [...(input.previousCards ?? [])],
  };

  // Skip if card order & enabled flags are identical
  const sameOrder =
    previousBody.cards.length === normalizedCurrent.cards.length &&
    previousBody.cards.every(
      (c, idx) =>
        c.cardId === normalizedCurrent.cards[idx]?.cardId && c.enabled === normalizedCurrent.cards[idx]?.enabled,
    );
  if (sameOrder) {
    return [];
  }

  const simCaches = mergeSimulationCaches(input.caches);
  const targets = collectCandidateTargets(normalizedCurrent, input.cards, simCaches, input.sampleTargets);
  const diffs: ReorderDiffEntry[] = [];

  for (const target of targets) {
    const before = probeTemplate({ target, body: previousBody, cards: input.cards, caches: simCaches });
    const after = probeTemplate({ target, body: normalizedCurrent, cards: input.cards, caches: simCaches });

    const beforeKey =
      before.cardId ?? (before.policy.kind === 'builtin' ? before.policy.id : JSON.stringify(before.policy));
    const afterKey = after.cardId ?? (after.policy.kind === 'builtin' ? after.policy.id : JSON.stringify(after.policy));

    if (beforeKey !== afterKey) {
      diffs.push({
        target,
        beforeCardId: before.cardId,
        beforeLabel: formatPolicyLabel(before.cardId, before.cardName, before.policy),
        afterCardId: after.cardId,
        afterLabel: formatPolicyLabel(after.cardId, after.cardName, after.policy),
      });
    }
  }

  if (diffs.length === 0) {
    return [];
  }

  const previewText = diffs
    .slice(0, 5)
    .map((d) => `${d.target}（${d.beforeLabel} → ${d.afterLabel}）`)
    .join('、');

  return [
    {
      code: 'reorder-diff',
      severity: 'info',
      message: `调整顺序导致 ${diffs.length} 个样例目标改走其他策略组：${previewText}${diffs.length > 5 ? ' 等' : ''}。`,
      location: {
        cardId: diffs[0].afterCardId ?? undefined,
        field: 'cards',
      },
      suggestion: '确认以上样例的路由变更符合预期；如为误操作可撤销排序。',
      details: {
        changes: diffs,
      },
    },
  ];
}
