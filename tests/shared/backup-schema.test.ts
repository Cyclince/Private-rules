import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT_VERSION, backupSchema, describeIssues } from '../../src/shared/schemas';

const minimal = { settings: {}, categories: [{ name: 'a', rules: [{ value: 'a.com', type: 'DOMAIN-SUFFIX' }] }] };

describe('backup schema', () => {
  it('accepts a minimal 1.0.x backup and leaves 1.1.0 sections undefined', () => {
    const parsed = backupSchema.parse(minimal);
    expect(parsed.categories[0].sources).toEqual([]);
    expect(parsed.categories[0].rules[0].enabled).toBe(true);
    expect(parsed.cards).toBeUndefined();
    expect(parsed.templates).toBeUndefined();
    expect(parsed.publications).toBeUndefined();
  });

  it('accepts null optional fields exported by older versions', () => {
    const parsed = backupSchema.parse({
      version: 1,
      settings: {},
      categories: [
        {
          name: 'a',
          note: null,
          rules: [{ value: 'a.com', type: 'DOMAIN', note: null, enabled: false }],
          sources: null,
        },
      ],
    });
    expect(parsed.version).toBe(1);
    expect(parsed.categories[0].rules[0].enabled).toBe(false);
  });

  it('accepts version 2 backups with cards, current templates, and publications without node bindings', () => {
    const parsed = backupSchema.parse({
      version: BACKUP_FORMAT_VERSION,
      settings: {},
      categories: [],
      cards: [{ id: 'card_1', slug: 'ai', name: 'AI', category: 'ai', body: { group: { type: 'select' } } }],
      templates: [
        {
          id: 'tpl_1',
          slug: 'standard',
          name: 'Standard',
          baseKind: 'builtin',
          baseBody: { cards: [] },
          output: 'full',
          versions: [{ version: 1 }],
        },
      ],
      publications: [
        {
          id: 'pub_1',
          slug: 'home',
          templateId: 'tpl_1',
          clients: ['mihomo', 'surge'],
          access: 'token',
          output: 'minimal',
          nodeBindings: [{ slotId: 'a', url: 'https://secret.example/sub' }],
        },
      ],
    });

    expect(parsed.version).toBe(2);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.templates?.[0]).not.toHaveProperty('versions');
    expect(parsed.templates?.[0].overlay).toEqual([]);
    expect(parsed.publications?.[0].output).toBe('minimal');
    expect(parsed.publications?.[0]).not.toHaveProperty('nodeBindings');
  });

  it('normalizes IP-CIDR6 rules inside backups to IP-CIDR and preserves options', () => {
    const parsed = backupSchema.parse({
      version: 2,
      settings: {},
      categories: [
        {
          name: 'ip',
          rules: [{ value: '2001:db8::/32', type: 'IP-CIDR6', options: { noResolve: true } }],
        },
      ],
    });
    expect(parsed.categories[0].rules[0].type).toBe('IP-CIDR');
    expect(parsed.categories[0].rules[0].options).toEqual({ noResolve: true });
  });

  it.each([
    ['unsupported version', { version: 3, settings: {}, categories: [] }, 'version'],
    ['missing rules', { settings: {}, categories: [{ name: 'a' }] }, 'categories.0.rules'],
    [
      'bad rule type',
      { settings: {}, categories: [{ name: 'a', rules: [{ value: 'a', type: 'NOPE' }] }] },
      'categories.0.rules.0.type',
    ],
    ['empty name', { settings: {}, categories: [{ name: ' ', rules: [] }] }, 'categories.0.name'],
    [
      'url source without url',
      { settings: {}, categories: [{ name: 'a', rules: [], sources: [{ sourceType: 'url' }] }] },
      'categories.0.sources.0.url',
    ],
    [
      'duplicate category ids',
      {
        settings: {},
        categories: [
          { id: 'x', name: 'a', rules: [] },
          { id: 'x', name: 'b', rules: [] },
        ],
      },
      'categories.1.id',
    ],
    [
      'duplicate template slugs',
      {
        version: 2,
        settings: {},
        categories: [],
        templates: [
          { slug: 'dup', name: 'A', baseKind: 'blank', baseBody: {} },
          { slug: 'dup', name: 'B', baseKind: 'blank', baseBody: {} },
        ],
      },
      'templates.1.slug',
    ],
    [
      'publication with unknown client',
      {
        version: 2,
        settings: {},
        categories: [],
        publications: [{ slug: 'p', templateId: 't', clients: ['unknown'], access: 'token' }],
      },
      'publications.0.clients.0',
    ],
    ['missing settings', { categories: [] }, 'settings'],
  ])('rejects %s', (_label, input, path) => {
    const result = backupSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(describeIssues(result.error).join('\n')).toContain(path);
  });
});
