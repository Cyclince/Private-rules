import { describe, expect, it } from 'vitest';
import { BUILTIN_CARDS, BUILTIN_CATALOG, buildStarterTemplate } from '../../src/builtin';
import {
  STAGES,
  checkStageOrdering,
  findInsertIndexForStage,
  inferCardStage,
  planRulesetReferences,
  recognizeGroupIcon,
  resolveTemplateCards,
  sortCardsByStage,
  type AppCard,
  type ResolvedTemplateCard,
} from '../../src/domain/templates';

describe('7-layer stage rule stratification', () => {
  it('defines all 7 stages in strict priority order', () => {
    expect(STAGES).toEqual(['pre-direct', 'app', 'proxy-fallback', 'ip', 'domestic', 'port', 'final']);
  });

  it('computes insertion indices and stable-sorts out-of-order cards', () => {
    const cards = [
      { cardId: 'lan-direct', enabled: true },
      { cardId: 'openai', enabled: true },
      { cardId: 'gfw-proxy', enabled: true },
      { cardId: 'domestic-direct', enabled: true },
      { cardId: 'final-fallback', enabled: true },
    ];

    expect(findInsertIndexForStage(cards, BUILTIN_CARDS, 'pre-direct')).toBe(1);
    expect(findInsertIndexForStage(cards, BUILTIN_CARDS, 'app')).toBe(2);
    expect(findInsertIndexForStage(cards, BUILTIN_CARDS, 'ip')).toBe(3);
    expect(findInsertIndexForStage(cards, BUILTIN_CARDS, 'port')).toBe(4);

    // Move an IP card before an app card and verify violation detection + stable sort
    const outOfOrder = [
      { cardId: 'lan-direct', enabled: true },
      { cardId: 'proxy-ip', enabled: true },
      { cardId: 'openai', enabled: true },
      { cardId: 'youtube', enabled: true },
      { cardId: 'domestic-direct', enabled: true },
    ];
    const violations = checkStageOrdering(outOfOrder, BUILTIN_CARDS);
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.cardId)).toEqual(['openai', 'youtube']);

    const sorted = sortCardsByStage(outOfOrder, BUILTIN_CARDS);
    expect(sorted.map((c) => c.cardId)).toEqual(['lan-direct', 'openai', 'youtube', 'proxy-ip', 'domestic-direct']);
    expect(checkStageOrdering(sorted, BUILTIN_CARDS)).toEqual([]);
  });

  it('infers stages for imported cards from matchers and metadata', () => {
    expect(
      inferCardStage({
        slug: 'my-cn',
        name: 'China',
        category: 'domestic',
        matchers: [{ kind: 'geosite', name: 'cn' }],
      }).stage,
    ).toBe('domestic');

    expect(
      inferCardStage({
        slug: 'tg-ip',
        name: 'TG IP',
        category: 'other',
        matchers: [{ kind: 'geoip', name: 'telegram', noResolve: true }],
      }).stage,
    ).toBe('ip');

    expect(
      inferCardStage({
        slug: 'weird-ports',
        name: 'Ports',
        category: 'other',
        matchers: [{ kind: 'inline', conditions: [{ op: 'rule', rule: { type: 'DST-PORT', value: '8443' } }] }],
      }).stage,
    ).toBe('port');

    expect(
      inferCardStage({
        slug: 'mystery',
        name: 'Mystery Group',
        category: 'other',
        matchers: [],
      }),
    ).toMatchObject({ stage: 'app', confident: false });
  });
});

describe('strategy group icon recognition (§10.9 priority)', () => {
  const samplePack = [
    { name: 'ChatGPT', url: 'https://icons.example/chatgpt.png' },
    { name: 'YouTube', url: 'https://icons.example/youtube.png' },
    { name: 'Hong Kong', url: 'https://icons.example/hk.png' },
    { name: 'Auto', url: 'https://icons.example/auto.png' },
    { name: 'Telegram', url: 'https://icons.example/telegram.png' },
  ];

  it('prioritizes embedded emoji first while still linking semantic pack icons', () => {
    const res = recognizeGroupIcon({ name: '🚀 OpenAI ChatGPT' }, samplePack);
    expect(res.source).toBe('emoji');
    expect(res.emoji).toBe('🚀');
    expect(res.packIcon?.name).toBe('ChatGPT');
  });

  it('falls through service -> region -> role -> matcher in order', () => {
    expect(recognizeGroupIcon({ name: 'YouTube Video' }, samplePack)).toMatchObject({
      source: 'service',
      key: 'youtube',
      packIcon: { name: 'YouTube' },
    });

    expect(recognizeGroupIcon({ name: '香港高速节点' }, samplePack)).toMatchObject({
      source: 'region',
      key: 'hk',
      emoji: '🇭🇰',
      packIcon: { name: 'Hong Kong' },
    });

    expect(recognizeGroupIcon({ name: 'Custom Group', groupType: 'url-test' }, samplePack)).toMatchObject({
      source: 'role',
      key: 'auto',
      packIcon: { name: 'Auto' },
    });

    expect(
      recognizeGroupIcon({ name: 'My Custom Rules', matchers: [{ kind: 'geosite', name: 'telegram' }] }, samplePack),
    ).toMatchObject({
      source: 'matcher',
      key: 'telegram',
      packIcon: { name: 'Telegram' },
    });
  });
});

describe('ruleset reference planner (deduplication & client strategies)', () => {
  function makeResolvedCard(card: AppCard): ResolvedTemplateCard {
    return {
      cardId: card.id,
      enabled: true,
      effective: card,
      effectiveGroupType: card.group.type,
      hasOverrides: false,
    };
  }

  it('deduplicates identical remote rulesets referenced by multiple cards and catalog entries', () => {
    const sharedUrl =
      'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/OpenAI/OpenAI.list';

    const cardA = makeResolvedCard({
      id: 'card-a',
      slug: 'card-a',
      name: 'Card A',
      category: 'ai',
      stage: 'app',
      group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
      matchers: [{ kind: 'catalog', entryId: 'ai-openai', updateIntervalSec: 7200 }],
    });

    const cardB = makeResolvedCard({
      id: 'card-b',
      slug: 'card-b',
      name: 'Card B',
      category: 'ai',
      stage: 'app',
      group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
      matchers: [{ kind: 'remote', url: sharedUrl, behavior: 'classical', format: 'text', updateIntervalSec: 1800 }],
    });

    const plan = planRulesetReferences({
      cards: [cardA, cardB],
      client: 'mihomo',
      catalogIndex: BUILTIN_CATALOG,
    });

    expect(plan.providers).toHaveLength(1);
    expect(plan.providers[0].referencedBy).toEqual(['card-a', 'card-b']);
    expect(plan.providers[0].updateIntervalSec).toBe(1800);
    expect(plan.bindings).toHaveLength(2);
    expect(plan.bindings[0].providerIds).toEqual(plan.bindings[1].providerIds);
  });

  it('splits self-hosted rulesets in Domain -> Classical -> IP order and deduplicates repeated geosite on Surge', () => {
    const card1 = makeResolvedCard({
      id: 'custom-rs',
      slug: 'custom-rs',
      name: 'Custom Ruleset',
      category: 'other',
      stage: 'app',
      group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
      matchers: [
        { kind: 'ruleset', ruleSetId: 'my-work' },
        { kind: 'geosite', name: 'openai' },
      ],
    });
    const card2 = makeResolvedCard({
      id: 'dup-geo',
      slug: 'dup-geo',
      name: 'Dup Geo',
      category: 'ai',
      stage: 'app',
      group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
      matchers: [{ kind: 'geosite', name: 'OPENAI' }],
    });

    const plan = planRulesetReferences({
      cards: [card1, card2],
      client: 'surge',
      baseUrl: 'https://rules.example.com',
      rulesetBehaviors: new Map([['my-work', { ipcidr: 5, domain: 10, classical: 3 }]]),
    });

    // Ruleset split strictly follows Domain -> Classical -> IP
    const rsProviders = plan.providers.filter((p) => p.source.kind === 'ruleset');
    expect(rsProviders.map((p) => p.behavior)).toEqual(['domain', 'classical', 'ipcidr']);
    expect(plan.bindings[0].providerIds).toEqual(rsProviders.map((p) => p.id));

    // Surge has no native GEOSITE: both `openai` and `OPENAI` share ONE self-hosted provider
    const geositeProviders = plan.providers.filter((p) => p.source.kind === 'geosite-hosted');
    expect(geositeProviders).toHaveLength(1);
    expect(geositeProviders[0].referencedBy).toEqual(['custom-rs', 'dup-geo']);
  });

  it('marks remote providers preceding inline rules as inlineForPriority on Loon and Quantumult X', () => {
    const heavy = buildStarterTemplate('heavy');
    const resolved = resolveTemplateCards(heavy.baseBody, BUILTIN_CARDS);

    // Heavy template has `custom-direct` (catalog remote) BEFORE `non-standard-ports` (inline rule)
    const loonPlan = planRulesetReferences({
      cards: resolved.cards,
      client: 'loon',
      catalogIndex: BUILTIN_CATALOG,
      baseUrl: 'https://rules.example.com',
    });

    const customDirectBinding = loonPlan.bindings.find((b) => b.cardId === 'custom-direct');
    expect(customDirectBinding?.inlinedForPriority).toBe(true);
    expect(loonPlan.warnings.some((w) => w.code === 'REMOTE_INLINED_FOR_LOCAL_FIRST_CLIENT')).toBe(true);

    // Mihomo does NOT need to inline remote lists before inline rules
    const mihomoPlan = planRulesetReferences({
      cards: resolved.cards,
      client: 'mihomo',
      catalogIndex: BUILTIN_CATALOG,
    });
    expect(mihomoPlan.bindings.find((b) => b.cardId === 'custom-direct')?.inlinedForPriority).toBe(false);
  });
});
