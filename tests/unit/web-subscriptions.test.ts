import { describe, expect, it } from 'vitest';
import { linksForCategory } from '../../src/lib/links';
import type { RuleCategory, RulesData } from '../../src/types/domain-rules';
import {
  accessPolicyToPatch,
  buildSubscriptionFormatGroups,
  getEnabledRuleCount,
  nextSortDirection,
  resolveAccessPolicy,
  sortSubscriptionCategories,
} from '../../src/web/components/subscriptions/subscription-helpers';

const baseData: RulesData = {
  version: 1,
  settings: {
    baseUrl: 'https://rules.example.com',
    policyName: 'PROXY',
    githubMirrorUrl: '',
    publicLinksEnabled: true,
    tokenLinksEnabled: true,
    customIconPackUrls: [],
    customIconPackNames: {},
    iconPackAutoUpdate: true,
    iconPackUpdateIntervalHours: 24,
  },
  categories: [],
  updatedAt: '2026-11-27T00:00:00.000Z',
};

function makeCategory(overrides: Partial<RuleCategory>): RuleCategory {
  return {
    id: 'cat-1',
    name: 'Alpha',
    slug: 'alpha',
    rules: [],
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('M1a subscription center helpers', () => {
  it('resolves access policy with exact 1.0.7 precedence (token -> public -> disabled)', () => {
    expect(resolveAccessPolicy({ tokenLinksEnabled: undefined, publicLinksEnabled: undefined })).toBe('token');
    expect(resolveAccessPolicy({ tokenLinksEnabled: true, publicLinksEnabled: true })).toBe('token');
    expect(resolveAccessPolicy({ tokenLinksEnabled: true, publicLinksEnabled: false })).toBe('token');
    expect(resolveAccessPolicy({ tokenLinksEnabled: false, publicLinksEnabled: true })).toBe('public');
    expect(resolveAccessPolicy({ tokenLinksEnabled: false, publicLinksEnabled: undefined })).toBe('public');
    expect(resolveAccessPolicy({ tokenLinksEnabled: false, publicLinksEnabled: false })).toBe('disabled');
  });

  it('maps access policy to exact PATCH payload matching 1.0.7', () => {
    expect(accessPolicyToPatch('token')).toEqual({ tokenLinksEnabled: true, publicLinksEnabled: false });
    expect(accessPolicyToPatch('public')).toEqual({ tokenLinksEnabled: false, publicLinksEnabled: true });
    expect(accessPolicyToPatch('disabled')).toEqual({ tokenLinksEnabled: false, publicLinksEnabled: false });
  });

  it('sorts categories by alpha, count, created, and modified in both directions', () => {
    const list = [
      makeCategory({
        id: 'b',
        name: 'Beta',
        ruleCount: 2,
        createdAt: '2026-11-22T00:00:00.000Z',
        updatedAt: '2026-11-26T00:00:00.000Z',
      }),
      makeCategory({
        id: 'a',
        name: 'Alpha',
        ruleCount: 10,
        createdAt: '2026-11-20T00:00:00.000Z',
        updatedAt: '2026-11-24T00:00:00.000Z',
      }),
      makeCategory({
        id: 'c',
        name: 'Gamma',
        ruleCount: 5,
        createdAt: '2026-11-25T00:00:00.000Z',
        updatedAt: '2026-11-25T00:00:00.000Z',
      }),
    ];

    expect(sortSubscriptionCategories(list, 'alpha', 'asc').map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(sortSubscriptionCategories(list, 'alpha', 'desc').map((c) => c.id)).toEqual(['c', 'b', 'a']);
    expect(sortSubscriptionCategories(list, 'count', 'desc').map((c) => c.id)).toEqual(['a', 'c', 'b']);
    expect(sortSubscriptionCategories(list, 'created', 'desc').map((c) => c.id)).toEqual(['c', 'b', 'a']);
    expect(sortSubscriptionCategories(list, 'modified', 'desc').map((c) => c.id)).toEqual(['b', 'c', 'a']);

    expect(nextSortDirection('alpha', 'asc', 'alpha')).toBe('desc');
    expect(nextSortDirection('alpha', 'desc', 'alpha')).toBe('asc');
    expect(nextSortDirection('alpha', 'asc', 'count')).toBe('desc');
    expect(nextSortDirection('count', 'desc', 'alpha')).toBe('asc');
  });

  it('groups all summary client links into YAML / LIST / JSON / TXT families without dropping any link', () => {
    const category = makeCategory({
      id: 'pub',
      name: 'Public Direct',
      slug: 'public-direct',
      tokenLinksEnabled: false,
      publicLinksEnabled: true,
      enabledRuleCount: 7,
    });
    expect(getEnabledRuleCount(category)).toBe(7);

    const links = linksForCategory(category, baseData, 'https://rules.example.com/api/rulesets', 'secret-token');
    const groups = buildSubscriptionFormatGroups(links);

    expect(groups.map((g) => g.id)).toEqual(['yaml', 'list', 'json', 'txt']);
    expect(groups[0].formats.map((f) => f.id)).toContain('yaml-classical');
    expect(groups[0].formats.map((f) => f.id)).toContain('mihomo');
    expect(groups[1].formats.map((f) => f.id)).toEqual(
      expect.arrayContaining(['general', 'loon', 'quantumult-x', 'shadowrocket', 'surge']),
    );
    expect(groups[2].formats.map((f) => f.id)).toEqual(['json', 'sing-box']);
    expect(groups[3].formats.map((f) => f.id)).toEqual(['url']);

    const totalGrouped = groups.reduce((sum, g) => sum + g.formats.length, 0);
    expect(totalGrouped).toBe(links.length);
  });
});
