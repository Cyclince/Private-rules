import { describe, expect, it } from 'vitest';
import { BUILTIN_CARDS, BUILTIN_CATALOG, STARTER_TEMPLATE_TIERS, buildStarterTemplate } from '../../src/builtin';
import {
  LINT_CODES,
  checkClientCapabilities,
  checkDisabledBaseGroups,
  checkEmptyGroups,
  checkGroupCycles,
  checkIpMissingNoResolve,
  checkMissingFinal,
  checkMissingGroupRefs,
  checkRegexDialectCompatibility,
  checkReorderDiff,
  checkRuleShadowing,
  checkStageOrderViolations,
  checkSubsetAfterSuperset,
  lintTemplate,
  type AppCard,
  type TemplateBody,
} from '../../src/domain/templates';

function makeBaseBody(overrides?: Partial<TemplateBody>): TemplateBody {
  const std = structuredClone(buildStarterTemplate('light').baseBody);
  return { ...std, ...overrides };
}

function makeCard(partial: Partial<AppCard> & Pick<AppCard, 'id' | 'name'>): AppCard {
  return {
    slug: partial.id,
    category: 'other',
    stage: 'app',
    group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
    matchers: [],
    ...partial,
  };
}

describe('12 pure-function template linters (positive & negative cases)', () => {
  it('exposes all 12 expected lint codes and passes all 4 built-in starter templates with 0 errors', () => {
    expect(LINT_CODES).toHaveLength(12);

    for (const tier of STARTER_TEMPLATE_TIERS) {
      const tpl = buildStarterTemplate(tier);
      const report = lintTemplate({
        body: tpl.baseBody,
        cards: BUILTIN_CARDS,
        catalogIndex: BUILTIN_CATALOG,
        clients: ['mihomo'],
      });
      expect(report.ok).toBe(true);
      expect(report.errorCount).toBe(0);
      expect(report.issues.filter((i) => i.code === 'stage-order-violation')).toEqual([]);
      expect(report.issues.filter((i) => i.code === 'subset-after-superset')).toEqual([]);
      expect(report.issues.filter((i) => i.code === 'ip-missing-no-resolve')).toEqual([]);
      expect(report.issues.filter((i) => i.code === 'rule-shadowing')).toEqual([]);
    }
  });

  // 1. rule-shadowing
  it('1) rule-shadowing: flags shadowed domains, CIDRs, and duplicate matchers (positive) and allows non-overlapping rules (negative)', () => {
    const broadCard = makeCard({
      id: 'broad',
      name: 'Broad',
      matchers: [
        {
          kind: 'inline',
          conditions: [
            { op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'google.com' } },
            { op: 'rule', rule: { type: 'IP-CIDR', value: '10.0.0.0/8', options: { noResolve: true } } },
          ],
        },
        { kind: 'geosite', name: 'openai' },
      ],
    });
    const narrowCard = makeCard({
      id: 'narrow',
      name: 'Narrow',
      matchers: [
        {
          kind: 'inline',
          conditions: [
            { op: 'rule', rule: { type: 'DOMAIN', value: 'mail.google.com' } },
            { op: 'rule', rule: { type: 'IP-CIDR', value: '10.1.0.0/16', options: { noResolve: true } } },
          ],
        },
        { kind: 'geosite', name: 'openai' },
      ],
    });

    const positiveBody = makeBaseBody({
      cards: [
        { cardId: 'broad', enabled: true },
        { cardId: 'narrow', enabled: true },
      ],
      final: { kind: 'builtin', id: 'DIRECT' },
    });
    const positive = checkRuleShadowing({ body: positiveBody, cards: [broadCard, narrowCard] });
    expect(positive).toHaveLength(3);
    expect(positive.every((i) => i.code === 'rule-shadowing' && i.severity === 'warning')).toBe(true);
    expect(positive.every((i) => i.location.cardId === 'narrow' && i.suggestion.length > 0)).toBe(true);

    // Negative: narrow placed BEFORE broad with distinct geosite
    const distinctNarrow = makeCard({
      id: 'narrow-clean',
      name: 'Narrow Clean',
      matchers: [
        {
          kind: 'inline',
          conditions: [
            { op: 'rule', rule: { type: 'DOMAIN', value: 'mail.google.com' } },
            { op: 'rule', rule: { type: 'IP-CIDR', value: '10.1.0.0/16', options: { noResolve: true } } },
          ],
        },
        { kind: 'geosite', name: 'github' },
      ],
    });
    const negativeBody = makeBaseBody({
      cards: [
        { cardId: 'narrow-clean', enabled: true },
        { cardId: 'broad', enabled: true },
      ],
      final: { kind: 'builtin', id: 'DIRECT' },
    });
    expect(checkRuleShadowing({ body: negativeBody, cards: [distinctNarrow, broadCard] })).toEqual([]);
  });

  // 2. reorder-diff
  it('2) reorder-diff: lists sample domains whose routed group changes after reordering (positive) and stays silent when routing is unchanged (negative)', () => {
    const std = buildStarterTemplate('standard').baseBody;
    const reorderedCards = [...std.cards];
    const openaiIdx = reorderedCards.findIndex((c) => c.cardId === 'openai');
    const aiIdx = reorderedCards.findIndex((c) => c.cardId === 'ai-services');
    // Swap `openai` and `ai-services` so `ai-services` now intercepts openai.com first
    [reorderedCards[openaiIdx], reorderedCards[aiIdx]] = [reorderedCards[aiIdx], reorderedCards[openaiIdx]];

    const positive = checkReorderDiff({
      body: { ...std, cards: reorderedCards },
      previousCards: std.cards,
      cards: BUILTIN_CARDS,
    });
    expect(positive).toHaveLength(1);
    expect(positive[0]).toMatchObject({
      code: 'reorder-diff',
      severity: 'info',
    });
    const changes = positive[0].details?.changes as Array<{
      target: string;
      beforeCardId: string;
      afterCardId: string;
    }>;
    expect(
      changes.some(
        (c) => c.target.includes('openai.com') && c.beforeCardId === 'openai' && c.afterCardId === 'ai-services',
      ),
    ).toBe(true);

    // Negative: identical order produces no reorder-diff
    expect(checkReorderDiff({ body: std, previousCards: std.cards, cards: BUILTIN_CARDS })).toEqual([]);
  });

  // 3. missing-group-ref
  it('3) missing-group-ref: flags missing card, region group, and slot references (positive) and passes valid references (negative)', () => {
    const brokenCard = makeCard({
      id: 'broken',
      name: 'Broken',
      group: {
        type: 'select',
        candidates: [
          { kind: 'card', cardId: 'ghost-card' },
          { kind: 'region', regionGroupId: 'ghost-region' },
          { kind: 'slot', slotId: 'ghost-slot' },
        ],
      },
    });
    const positiveBody = makeBaseBody({
      cards: [{ cardId: 'broken', enabled: true }],
      final: { kind: 'builtin', id: 'DIRECT' },
    });
    const positive = checkMissingGroupRefs({ body: positiveBody, cards: [brokenCard] });
    expect(positive).toHaveLength(3);
    expect(positive.every((i) => i.code === 'missing-group-ref' && i.severity === 'error')).toBe(true);

    // Negative: valid starter template
    expect(checkMissingGroupRefs({ body: makeBaseBody(), cards: BUILTIN_CARDS })).toEqual([]);
  });

  // 4. group-cycle
  it('4) group-cycle: flags circular references A -> B -> A (positive) and passes acyclic graphs (negative)', () => {
    const cardA = makeCard({
      id: 'card-a',
      name: 'Group A',
      group: { type: 'select', candidates: [{ kind: 'card', cardId: 'card-b' }] },
    });
    const cardB = makeCard({
      id: 'card-b',
      name: 'Group B',
      group: { type: 'select', candidates: [{ kind: 'card', cardId: 'card-a' }] },
    });
    const positiveBody = makeBaseBody({
      cards: [
        { cardId: 'card-a', enabled: true },
        { cardId: 'card-b', enabled: true },
      ],
      final: { kind: 'builtin', id: 'DIRECT' },
    });
    const positive = checkGroupCycles({ body: positiveBody, cards: [cardA, cardB] });
    expect(positive).toHaveLength(1);
    expect(positive[0]).toMatchObject({
      code: 'group-cycle',
      severity: 'error',
    });
    expect(positive[0].details?.cycle).toEqual(['card-a', 'card-b', 'card-a']);

    // Negative: acyclic starter template
    expect(checkGroupCycles({ body: makeBaseBody(), cards: BUILTIN_CARDS })).toEqual([]);
  });

  // 5. empty-group
  it('5) empty-group: flags region groups and slot-filtered cards with 0 matching nodes (positive) and passes when nodes match (negative)', () => {
    const body = makeBaseBody({
      regionGroups: [
        { id: 'region-hk', name: '🇭🇰 香港', region: 'HK', type: 'url-test', slotId: 'slot-main' },
        { id: 'region-kr', name: '🇰🇷 韩国', region: 'KR', type: 'url-test', slotId: 'slot-main' },
      ],
      cards: [{ cardId: 'iplc-only', enabled: true }],
      final: { kind: 'builtin', id: 'DIRECT' },
    });
    const iplcCard = makeCard({
      id: 'iplc-only',
      name: 'IPLC 专线',
      group: {
        type: 'url-test',
        candidates: [{ kind: 'slot', slotId: 'slot-main', filter: { include: 'IPLC' } }],
      },
    });

    // Only HK nodes + info banners -> region-kr and iplc-only are both empty
    const positive = checkEmptyGroups({
      body,
      cards: [iplcCard],
      nodeNamesBySlot: { 'slot-main': ['剩余流量：80GB', '🇭🇰 香港 01', '🇭🇰 香港 02'] },
    });
    expect(positive.map((i) => i.location.regionGroupId ?? i.location.cardId)).toEqual(['region-kr', 'iplc-only']);
    expect(positive.every((i) => i.code === 'empty-group' && i.severity === 'warning')).toBe(true);

    // Negative: all groups have matching nodes
    const negative = checkEmptyGroups({
      body,
      cards: [iplcCard],
      nodeNamesBySlot: { 'slot-main': ['🇭🇰 香港 IPLC 01', '🇰🇷 首尔 01'] },
    });
    expect(negative).toEqual([]);
  });

  // 6. missing-final
  it('6) missing-final: flags unset final policy (positive) and passes when final is set (negative)', () => {
    const body = makeBaseBody();
    const withoutFinal = { ...body, final: undefined };
    const positive = checkMissingFinal({ body: withoutFinal });
    expect(positive).toHaveLength(1);
    expect(positive[0]).toMatchObject({
      code: 'missing-final',
      severity: 'error',
      location: { field: 'final', stage: 'final' },
    });

    // Negative
    expect(checkMissingFinal({ body })).toEqual([]);
  });

  // 7. client-unsupported
  it('7) client-unsupported: reports per-client unsupported features (positive) and stays quiet when features are natively supported (negative)', () => {
    const complexCard = makeCard({
      id: 'complex',
      name: 'Complex',
      group: { type: 'fallback', candidates: [{ kind: 'builtin', id: 'REJECT-DROP' }] },
      matchers: [
        { kind: 'geosite', name: 'openai' },
        { kind: 'remote', url: 'https://rules.example/ai.mrs', behavior: 'domain', format: 'mrs' },
        {
          kind: 'inline',
          conditions: [
            {
              op: 'and',
              items: [
                { op: 'rule', rule: { type: 'PROCESS-NAME', value: 'curl' } },
                { op: 'rule', rule: { type: 'DST-PORT', value: '443' } },
              ],
            },
          ],
        },
      ],
    });
    const body = makeBaseBody({
      cards: [{ cardId: 'complex', enabled: true }],
      final: { kind: 'builtin', id: 'DIRECT' },
    });

    const qxIssues = checkClientCapabilities({ body, cards: [complexCard], clients: ['quantumult-x'] });
    expect(qxIssues.length).toBeGreaterThanOrEqual(4);
    expect(
      qxIssues.every(
        (i) => i.code === 'client-unsupported' && i.severity === 'info' && i.location.client === 'quantumult-x',
      ),
    ).toBe(true);
    expect(qxIssues.some((i) => i.details?.feature === 'logical-rule')).toBe(true);
    expect(qxIssues.some((i) => i.details?.feature === 'geosite')).toBe(true);
    expect(qxIssues.some((i) => i.details?.feature === 'remote-format')).toBe(true);

    // Negative: simple universal card on mihomo
    const simpleCard = makeCard({
      id: 'simple',
      name: 'Simple',
      group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
      matchers: [
        { kind: 'inline', conditions: [{ op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'example.com' } }] },
      ],
    });
    const simpleBody = makeBaseBody({
      cards: [{ cardId: 'simple', enabled: true }],
      final: { kind: 'builtin', id: 'DIRECT' },
    });
    expect(
      checkClientCapabilities({ body: simpleBody, cards: [simpleCard], clients: ['mihomo', 'surge', 'quantumult-x'] }),
    ).toEqual([]);
  });

  // 8. disabled-base-group
  it('8) disabled-base-group: flags disabling a referenced base group (positive) and passes when enabled (negative)', () => {
    const body = makeBaseBody();
    const disabledBody: TemplateBody = {
      ...body,
      cards: body.cards.map((c) => (c.cardId === 'proxy-select' ? { ...c, enabled: false } : c)),
    };

    const positive = checkDisabledBaseGroups({ body: disabledBody, cards: BUILTIN_CARDS });
    expect(positive.length).toBeGreaterThan(0);
    expect(positive.every((i) => i.code === 'disabled-base-group' && i.severity === 'error')).toBe(true);
    expect(positive[0].details?.disabledCardId).toBe('proxy-select');

    // Negative
    expect(checkDisabledBaseGroups({ body, cards: BUILTIN_CARDS })).toEqual([]);
  });

  // 9. stage-order-violation
  it('9) stage-order-violation: flags IP stage placed before app stage (positive) and passes stratified templates (negative)', () => {
    const body = makeBaseBody({
      cards: [
        { cardId: 'lan-direct', enabled: true },
        { cardId: 'proxy-ip', enabled: true },
        { cardId: 'openai', enabled: true },
        { cardId: 'domestic-direct', enabled: true },
      ],
    });
    const positive = checkStageOrderViolations({ body, cards: BUILTIN_CARDS });
    expect(positive).toHaveLength(1);
    expect(positive[0]).toMatchObject({
      code: 'stage-order-violation',
      severity: 'warning',
      location: { cardId: 'openai', stage: 'app' },
    });

    // Negative
    expect(
      checkStageOrderViolations({ body: buildStarterTemplate('standard').baseBody, cards: BUILTIN_CARDS }),
    ).toEqual([]);
  });

  // 10. subset-after-superset
  it('10) subset-after-superset: flags openai after category-ai-!cn, googlefcm after google, and catalog child after parent (positive) vs narrow-before-wide (negative)', () => {
    const catParent = makeCard({
      id: 'cat-games',
      name: 'All Games',
      matchers: [{ kind: 'catalog', entryId: 'gaming-all' }],
    });
    const catChild = makeCard({
      id: 'cat-steam-cn',
      name: 'Steam CN',
      matchers: [{ kind: 'catalog', entryId: 'gaming-steam-cn' }],
    });

    const positiveBody = makeBaseBody({
      cards: [
        { cardId: 'ai-services', enabled: true },
        { cardId: 'openai', enabled: true },
        { cardId: 'google', enabled: true },
        { cardId: 'google-fcm', enabled: true },
        { cardId: 'cat-games', enabled: true },
        { cardId: 'cat-steam-cn', enabled: true },
      ],
    });
    const positive = checkSubsetAfterSuperset({
      body: positiveBody,
      cards: [...BUILTIN_CARDS, catParent, catChild],
      catalogIndex: BUILTIN_CATALOG,
    });
    expect(positive.map((i) => i.location.cardId)).toEqual(['openai', 'google-fcm', 'cat-steam-cn']);
    expect(positive.every((i) => i.code === 'subset-after-superset' && i.severity === 'warning')).toBe(true);

    // Negative: narrow before wide
    const negativeBody = makeBaseBody({
      cards: [
        { cardId: 'openai', enabled: true },
        { cardId: 'ai-services', enabled: true },
        { cardId: 'google-fcm', enabled: true },
        { cardId: 'google', enabled: true },
        { cardId: 'cat-steam-cn', enabled: true },
        { cardId: 'cat-games', enabled: true },
      ],
    });
    expect(
      checkSubsetAfterSuperset({
        body: negativeBody,
        cards: [...BUILTIN_CARDS, catParent, catChild],
        catalogIndex: BUILTIN_CATALOG,
      }),
    ).toEqual([]);
  });

  // 11. ip-missing-no-resolve
  it('11) ip-missing-no-resolve: flags IP/GEOIP rules before domain rules lacking no-resolve (positive) and passes with no-resolve or when trailing (negative)', () => {
    const ipCardMissing = makeCard({
      id: 'bad-ip',
      name: 'Bad IP',
      stage: 'ip',
      matchers: [
        { kind: 'geoip', name: 'telegram' },
        { kind: 'inline', conditions: [{ op: 'rule', rule: { type: 'IP-CIDR', value: '91.108.4.0/22' } }] },
      ],
    });
    const domainCard = makeCard({
      id: 'later-domain',
      name: 'Later Domain',
      stage: 'domestic',
      matchers: [{ kind: 'geosite', name: 'cn' }],
    });

    const positiveBody = makeBaseBody({
      cards: [
        { cardId: 'bad-ip', enabled: true },
        { cardId: 'later-domain', enabled: true },
      ],
    });
    const positive = checkIpMissingNoResolve({ body: positiveBody, cards: [ipCardMissing, domainCard] });
    expect(positive).toHaveLength(2);
    expect(positive.every((i) => i.code === 'ip-missing-no-resolve' && i.severity === 'warning')).toBe(true);

    // Negative A: with noResolve: true
    const ipCardClean = makeCard({
      id: 'good-ip',
      name: 'Good IP',
      stage: 'ip',
      matchers: [
        { kind: 'geoip', name: 'telegram', noResolve: true },
        {
          kind: 'inline',
          conditions: [{ op: 'rule', rule: { type: 'IP-CIDR', value: '91.108.4.0/22', options: { noResolve: true } } }],
        },
      ],
    });
    expect(
      checkIpMissingNoResolve({
        body: makeBaseBody({
          cards: [
            { cardId: 'good-ip', enabled: true },
            { cardId: 'later-domain', enabled: true },
          ],
        }),
        cards: [ipCardClean, domainCard],
      }),
    ).toEqual([]);

    // Negative B: IP rule without noResolve placed AFTER all domain rules
    expect(
      checkIpMissingNoResolve({
        body: makeBaseBody({
          cards: [
            { cardId: 'later-domain', enabled: true },
            { cardId: 'bad-ip', enabled: true },
          ],
        }),
        cards: [domainCard, ipCardMissing],
      }),
    ).toEqual([]);
  });

  // 12. regex-dialect-incompatible
  it('12) regex-dialect-incompatible: flags unsupported lookbehind/lookahead/inline flags and invalid syntax (positive) and passes portable regexes (negative)', () => {
    const badRegexCard = makeCard({
      id: 'bad-regex',
      name: 'Bad Regex',
      group: {
        type: 'select',
        candidates: [{ kind: 'slot', slotId: 'slot-main', filter: { include: '(?i)(?<!尼)日' } }],
      },
      matchers: [
        {
          kind: 'inline',
          conditions: [{ op: 'rule', rule: { type: 'DOMAIN-REGEX', value: '[unclosed(' } }],
        },
      ],
    });
    const body = makeBaseBody({
      regionGroups: [{ id: 'region-hk', name: 'HK', region: 'HK', type: 'url-test', extraInclude: '(?=IEPL)HK' }],
      cards: [{ cardId: 'bad-regex', enabled: true }],
    });

    const qxIssues = checkRegexDialectCompatibility({
      body,
      cards: [badRegexCard],
      clients: ['quantumult-x', 'sing-box'],
    });
    expect(
      qxIssues.some(
        (i) =>
          i.location.client === 'quantumult-x' &&
          i.details?.warningCode === 'LOOKAHEAD_UNSUPPORTED' &&
          i.severity === 'warning',
      ),
    ).toBe(true);
    expect(
      qxIssues.some(
        (i) =>
          i.location.client === 'quantumult-x' &&
          i.details?.warningCode === 'LOOKBEHIND_UNSUPPORTED' &&
          i.severity === 'warning',
      ),
    ).toBe(true);
    expect(
      qxIssues.some(
        (i) =>
          i.location.client === 'sing-box' &&
          i.details?.warningCode === 'INLINE_FLAG_UNSUPPORTED' &&
          i.severity === 'warning',
      ),
    ).toBe(true);
    expect(qxIssues.some((i) => i.details?.warningCode === 'INVALID_REGEX' && i.severity === 'error')).toBe(true);

    // Negative: portable regex without lookaround or inline flags
    const goodRegexCard = makeCard({
      id: 'good-regex',
      name: 'Good Regex',
      group: {
        type: 'select',
        candidates: [{ kind: 'slot', slotId: 'slot-main', filter: { include: 'IPLC|IEPL' } }],
      },
      matchers: [
        {
          kind: 'inline',
          conditions: [{ op: 'rule', rule: { type: 'DOMAIN-REGEX', value: '^api-[0-9]+\\.example\\.com$' } }],
        },
      ],
    });
    const cleanBody = makeBaseBody({
      regionGroups: [{ id: 'region-hk', name: 'HK', region: 'HK', type: 'url-test', extraInclude: 'IPLC|BGP' }],
      cards: [{ cardId: 'good-regex', enabled: true }],
    });
    expect(
      checkRegexDialectCompatibility({
        body: cleanBody,
        cards: [goodRegexCard],
        clients: ['mihomo', 'surge', 'quantumult-x', 'sing-box'],
      }),
    ).toEqual([]);
  });
});
