import { describe, expect, it } from 'vitest';
import { backupSchema, describeIssues } from '../../src/shared/schemas';

const minimal = { settings: {}, categories: [{ name: 'a', rules: [{ value: 'a.com', type: 'DOMAIN-SUFFIX' }] }] };

describe('backup schema', () => {
  it('accepts a minimal backup and fills defaults', () => {
    const parsed = backupSchema.parse(minimal);
    expect(parsed.categories[0].sources).toEqual([]);
    expect(parsed.categories[0].rules[0].enabled).toBe(true);
  });

  it('accepts null optional fields exported by older versions', () => {
    const parsed = backupSchema.parse({
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
    expect(parsed.categories[0].rules[0].enabled).toBe(false);
  });

  it.each([
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
      'duplicate ids',
      {
        settings: {},
        categories: [
          { id: 'x', name: 'a', rules: [] },
          { id: 'x', name: 'b', rules: [] },
        ],
      },
      'categories.1.id',
    ],
    ['missing settings', { categories: [] }, 'settings'],
  ])('rejects %s', (_label, input, path) => {
    const result = backupSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(describeIssues(result.error).join('\n')).toContain(path);
  });
});
