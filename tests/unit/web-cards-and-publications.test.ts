import { describe, expect, it } from 'vitest';
import { isTemplateClientSupported, SUPPORTED_TEMPLATE_CLIENTS, TEMPLATE_CLIENT_IDS } from '../../src/shared/clients';
import { BUILTIN_POLICY_IDS } from '../../src/shared/schemas/card';
import { RULE_TYPE_VALUES } from '../../src/shared/schemas/rule';
import {
  formatConditionLine,
  formatMatcherSummary,
  formatPolicyRefLabel,
  parseInlineRulesText,
  parsePolicyRef,
  serializePolicyRef,
} from '../../src/web/components/cards/card-helpers';
import type { MessageKey } from '../../src/web/i18n';
import {
  createAppQueryClient,
  invalidateCards,
  invalidatePublications,
  invalidateTemplates,
  queryKeys,
} from '../../src/web/lib/query';

const identityT = (key: MessageKey) => key;

describe('M4.4a card helpers, client support flags, and query invalidation', () => {
  it('round-trips policy references and formats preset/custom labels', () => {
    for (const id of BUILTIN_POLICY_IDS) {
      const ref = { kind: 'builtin', id } as const;
      expect(parsePolicyRef(serializePolicyRef(ref))).toEqual(ref);
    }

    expect(parsePolicyRef('card:openai')).toEqual({ kind: 'card', cardId: 'openai' });
    expect(parsePolicyRef('region:region-jp')).toEqual({ kind: 'region', regionGroupId: 'region-jp' });
    expect(parsePolicyRef('slot:slot-main')).toEqual({ kind: 'slot', slotId: 'slot-main' });
    expect(parsePolicyRef('unknown:foo')).toEqual({ kind: 'builtin', id: 'DIRECT' });

    const cardNames = new Map([['custom-card', 'My Custom Card']]);
    expect(formatPolicyRefLabel({ kind: 'card', cardId: 'proxy-select' }, identityT, cardNames)).toBe(
      'cards.routePreset.proxySelect',
    );
    expect(formatPolicyRefLabel({ kind: 'card', cardId: 'custom-card' }, identityT, cardNames)).toBe('My Custom Card');
    expect(formatPolicyRefLabel({ kind: 'region', regionGroupId: 'region-eu' }, identityT)).toBe('region-eu');
  });

  it('parses and formats inline rules including IP-CIDR6 normalization and no-resolve', () => {
    const raw = [
      '# comment line',
      'DOMAIN-SUFFIX,openai.com',
      'IP-CIDR6,2001:db8::/32,no-resolve',
      'INVALID-TYPE,example.com',
      'DST-PORT,443',
    ].join('\n');

    const conditions = parseInlineRulesText(raw);
    expect(conditions).toEqual([
      { op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'openai.com' } },
      { op: 'rule', rule: { type: 'IP-CIDR', value: '2001:db8::/32', options: { noResolve: true } } },
      { op: 'rule', rule: { type: 'DST-PORT', value: '443' } },
    ]);

    expect(formatConditionLine(conditions[0])).toBe('DOMAIN-SUFFIX,openai.com');
    expect(formatConditionLine(conditions[1])).toBe('IP-CIDR,2001:db8::/32,no-resolve');
    expect(formatConditionLine({ op: 'not', item: conditions[0] })).toBe('NOT,(DOMAIN-SUFFIX,openai.com)');
    expect(formatConditionLine({ op: 'and', items: [conditions[0], conditions[2]] })).toBe(
      'AND,(DOMAIN-SUFFIX,openai.com, DST-PORT,443)',
    );

    // Ensure every canonical rule type in shared/schemas/rule.ts is accepted by parseInlineRulesText
    for (const ruleType of RULE_TYPE_VALUES) {
      const parsed = parseInlineRulesText(`${ruleType},example.test`);
      expect(parsed, `Expected ${ruleType} to be accepted`).toHaveLength(1);
    }
  });

  it('formats matcher summaries for all 6 matcher kinds', () => {
    expect(formatMatcherSummary({ kind: 'catalog', entryId: 'ai-openai' }, identityT)).toContain('ai-openai');
    expect(formatMatcherSummary({ kind: 'ruleset', ruleSetId: 'rs-1' }, identityT)).toContain('rs-1');
    expect(formatMatcherSummary({ kind: 'geosite', name: 'openai' }, identityT)).toContain('openai');
    expect(formatMatcherSummary({ kind: 'geoip', name: 'cn', noResolve: true }, identityT)).toContain('no-resolve');
    expect(
      formatMatcherSummary(
        { kind: 'remote', url: 'https://example.com/list.txt', behavior: 'classical', format: 'text' },
        identityT,
      ),
    ).toContain('classical');
    expect(
      formatMatcherSummary(
        { kind: 'inline', conditions: [{ op: 'rule', rule: { type: 'DOMAIN', value: 'chat.openai.com' } }] },
        identityT,
      ),
    ).toContain('DOMAIN,chat.openai.com');
  });

  it('marks all 7 template clients as supported', () => {
    expect(SUPPORTED_TEMPLATE_CLIENTS).toEqual([
      'mihomo',
      'stash',
      'surge',
      'sing-box',
      'loon',
      'quantumult-x',
      'shadowrocket',
    ]);
    for (const client of TEMPLATE_CLIENT_IDS) {
      expect(isTemplateClientSupported(client), `Expected ${client} to be supported`).toBe(true);
    }
  });

  it('invalidates cards, templates, and publications query keys cleanly', async () => {
    const queryClient = createAppQueryClient();
    queryClient.setQueryData(queryKeys.cards.list(), { cards: [] });
    queryClient.setQueryData(queryKeys.cards.detail('c1'), { card: { id: 'c1' } });
    queryClient.setQueryData(queryKeys.templates.list(), { templates: [] });
    queryClient.setQueryData(queryKeys.templates.versions('t1'), { versions: [] });
    queryClient.setQueryData(queryKeys.publications.list(), { publications: [] });
    queryClient.setQueryData(queryKeys.publications.detail('p1'), { publication: { id: 'p1' } });

    await Promise.all([
      invalidateCards(queryClient, 'c1'),
      invalidateTemplates(queryClient, 't1'),
      invalidatePublications(queryClient, 'p1'),
    ]);

    expect(queryClient.getQueryState(queryKeys.cards.list())?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.cards.detail('c1'))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.templates.list())?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.templates.versions('t1'))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.publications.list())?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.publications.detail('p1'))?.isInvalidated).toBe(true);
  });
});
