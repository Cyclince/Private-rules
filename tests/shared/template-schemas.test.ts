import { describe, expect, it } from 'vitest';
import {
  appCardSchema,
  backupSchema,
  catalogEntrySchema,
  conditionSchema,
  publicationFormSchema,
  publicationSchema,
  templateOverlayOpSchema,
  templateSchema,
} from '../../src/shared/schemas';

describe('shared card, template, and publication schemas', () => {
  it('validates recursive condition trees and normalizes IP-CIDR6 rules', () => {
    const parsed = conditionSchema.parse({
      op: 'and',
      items: [
        { op: 'rule', rule: { type: 'IP-CIDR6', value: '2001:db8::/32', options: { noResolve: true } } },
        {
          op: 'not',
          item: {
            op: 'or',
            items: [
              { op: 'rule', rule: { type: 'DST-PORT', value: '80' } },
              { op: 'rule', rule: { type: 'DST-PORT', value: '443' } },
            ],
          },
        },
      ],
    });
    expect(parsed.op).toBe('and');
    if (parsed.op === 'and' && parsed.items[0].op === 'rule') {
      expect(parsed.items[0].rule.type).toBe('IP-CIDR');
    }
  });

  it('validates a full AppCard and rejects empty candidates', () => {
    const valid = appCardSchema.parse({
      id: 'card-openai',
      slug: 'openai',
      name: 'OpenAI',
      category: 'ai',
      stage: 'app',
      group: {
        type: 'select',
        candidates: [
          { kind: 'region', regionGroupId: 'region-us' },
          { kind: 'builtin', id: 'DIRECT' },
        ],
      },
      matchers: [{ kind: 'geosite', name: 'openai' }],
    });
    expect(valid.stage).toBe('app');

    const invalid = appCardSchema.safeParse({
      id: 'card-bad',
      slug: 'bad',
      name: 'Bad',
      category: 'ai',
      stage: 'app',
      group: { type: 'select', candidates: [] },
      matchers: [],
    });
    expect(invalid.success).toBe(false);
  });

  it('validates catalog entries, overlay ops, template records, and publications', () => {
    const entry = catalogEntrySchema.parse({
      id: 'ai-openai',
      provider: 'blackmatrix7',
      name: 'OpenAI',
      aliases: ['ChatGPT'],
      category: 'ai',
      defaultRoute: 'proxy',
      sourceUrl: 'https://example.com/openai.list',
    });
    expect(entry.aliases).toEqual(['ChatGPT']);

    const op = templateOverlayOpSchema.parse({
      op: 'setCardOverride',
      cardId: 'openai',
      overrides: { group: { type: 'fallback' } },
    });
    expect(op.op).toBe('setCardOverride');

    const tpl = templateSchema.parse({
      id: 'tpl-1',
      slug: 'my-tpl',
      name: 'My Template',
      baseKind: 'builtin',
      baseBody: {
        slots: [{ id: 'slot-main', name: 'Main', excludeInfo: true }],
        regionGroups: [{ id: 'region-hk', name: 'HK', region: 'hk', type: 'url-test' }],
        cards: [{ cardId: 'openai', enabled: true }],
        groupMode: 'select',
        final: { kind: 'builtin', id: 'DIRECT' },
        output: 'full',
        dns: { mode: 'fake-ip' },
        modules: [],
      },
      overlay: [op],
    });
    expect(tpl.baseBody.regionGroups[0].region).toBe('HK');

    const pub = publicationSchema.parse({
      id: 'pub-1',
      slug: 'home-sub',
      templateId: 'tpl-1',
      clients: ['mihomo', 'surge'],
      access: 'token',
      output: 'minimal',
    });
    expect(pub.output).toBe('minimal');

    expect(
      publicationFormSchema.safeParse({
        slug: 'bad slug with spaces',
        templateId: 'tpl-1',
        clients: ['mihomo'],
        access: 'token',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid overlay ops inside version-2 backups via unified schema', () => {
    const result = backupSchema.safeParse({
      version: 2,
      settings: {},
      categories: [],
      templates: [
        {
          id: 'tpl-1',
          slug: 'std',
          name: 'Std',
          baseKind: 'builtin',
          baseBody: { cards: [] },
          overlay: [{ op: 'notARealOp' }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
