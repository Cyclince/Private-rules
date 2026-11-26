import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  BEHAVIOR_SPLIT_ORDER,
  classifyRuleBehavior,
  domainYaml,
  ipcidrYaml,
  splitRulesetByBehavior,
  summarizeRulesetBehaviors,
  yaml as legacyYaml,
  type BehaviorSplitRule,
} from '../../../src/domain/formatters';
import type { DomainRule, RuleCategory } from '../../../src/types/domain-rules';

function makeRule(
  type: BehaviorSplitRule['type'],
  value: string,
  extra?: Partial<BehaviorSplitRule>,
): BehaviorSplitRule {
  return {
    type,
    value,
    enabled: true,
    ...extra,
  };
}

describe('behavior-split deterministic formatter (design §9.5)', () => {
  it('classifies all 14 rule types into disjoint domain / classical / ipcidr buckets', () => {
    expect(classifyRuleBehavior({ type: 'DOMAIN' })).toBe('domain');
    expect(classifyRuleBehavior({ type: 'DOMAIN-SUFFIX' })).toBe('domain');
    expect(classifyRuleBehavior({ type: 'IP-CIDR' })).toBe('ipcidr');

    const classicalTypes: BehaviorSplitRule['type'][] = [
      'DOMAIN-KEYWORD',
      'DOMAIN-REGEX',
      'SRC-IP-CIDR',
      'IP-ASN',
      'DST-PORT',
      'SRC-PORT',
      'GEOSITE',
      'GEOIP',
      'PROCESS-NAME',
      'USER-AGENT',
      'URL-REGEX',
    ];
    for (const type of classicalTypes) {
      expect(classifyRuleBehavior({ type })).toBe('classical');
    }
  });

  it('outputs files in strict domain -> classical -> ipcidr order with standardized headers', () => {
    const result = splitRulesetByBehavior(
      {
        name: 'My Mixed Set',
        slug: 'my-mixed',
        updatedAt: '2026-06-01T12:00:00.000Z',
        rules: [
          makeRule('IP-CIDR', '10.0.0.0/8'),
          makeRule('IP-CIDR', 'fd00::/8'),
          makeRule('DOMAIN-KEYWORD', 'openai'),
          makeRule('SRC-IP-CIDR', '192.168.1.0/24', { options: { noResolve: true } }),
          makeRule('GEOIP', 'CN', { options: { noResolve: true } }),
          makeRule('DOMAIN', 'api.example.com'),
          makeRule('DOMAIN-SUFFIX', 'example.com'),
          makeRule('DOMAIN', 'disabled.example.com', { enabled: false }),
        ],
      },
      { source: 'https://rules.example.com/my-mixed' },
    );

    expect(result.order).toEqual(BEHAVIOR_SPLIT_ORDER);
    expect(result.files.map((file) => file.behavior)).toEqual(['domain', 'classical', 'ipcidr']);
    expect(result.counts).toEqual({ domain: 2, classical: 3, ipcidr: 2 });
    expect(result.total).toBe(7);

    // Domain file
    const domainFile = result.files[0]!;
    expect(domainFile.fileName).toBe('my-mixed_domain.yaml');
    expect(domainFile.textFileName).toBe('my-mixed_domain.list');
    expect(domainFile.yaml).toContain('# NAME: My Mixed Set (domain)\n');
    expect(domainFile.yaml).toContain('# SOURCE: https://rules.example.com/my-mixed\n');
    expect(domainFile.yaml).toContain('# TOTAL: 2\n');
    expect(domainFile.yaml).toContain('# UPDATED: 2026-06-01T12:00:00.000Z\n');
    expect(parseYaml(domainFile.yaml)).toEqual({
      payload: ['api.example.com', '+.example.com'],
    });

    // Classical file: SRC-IP-CIDR stays in classical WITHOUT invalid no-resolve, GEOIP keeps no-resolve
    const classicalFile = result.files[1]!;
    expect(parseYaml(classicalFile.yaml)).toEqual({
      payload: ['DOMAIN-KEYWORD,openai', 'SRC-IP-CIDR,192.168.1.0/24', 'GEOIP,CN,no-resolve'],
    });

    // IP-CIDR file: IPv4 sorted before IPv6
    const ipFile = result.files[2]!;
    expect(parseYaml(ipFile.yaml)).toEqual({
      payload: ['10.0.0.0/8', 'fd00::/8'],
    });
  });

  it('produces byte-for-byte identical output regardless of input rule permutation', () => {
    const rulesA: BehaviorSplitRule[] = [
      makeRule('DOMAIN', 'z.example.com'),
      makeRule('DOMAIN-SUFFIX', 'a.example.com'),
      makeRule('DOMAIN', 'a.example.com'),
      makeRule('IP-CIDR', '10.10.0.0/16'),
      makeRule('IP-CIDR', '10.2.0.0/16'),
      makeRule('IP-CIDR', '2001:db8::/32'),
      makeRule('IP-CIDR', '1.1.1.1/32'),
      makeRule('DST-PORT', '443'),
      makeRule('DOMAIN-KEYWORD', 'beta'),
      makeRule('DOMAIN-KEYWORD', 'alpha'),
    ];
    const rulesB = [...rulesA].reverse();

    const outA = splitRulesetByBehavior({ name: 'Perm', slug: 'perm', updatedAt: '2026-01-01', rules: rulesA });
    const outB = splitRulesetByBehavior({ name: 'Perm', slug: 'perm', updatedAt: '2026-01-01', rules: rulesB });

    expect(outA.files).toEqual(outB.files);
    // Numeric CIDR sorting: 1.1.1.1/32 < 10.2.0.0/16 < 10.10.0.0/16 < 2001:db8::/32
    expect(outA.buckets.ipcidr).toEqual(['1.1.1.1/32', '10.2.0.0/16', '10.10.0.0/16', '2001:db8::/32']);
  });

  it('omits empty buckets and supports optional coverage deduplication', () => {
    const rules = [makeRule('DOMAIN-SUFFIX', 'example.com'), makeRule('DOMAIN', 'sub.example.com')];

    const withoutDedup = splitRulesetByBehavior({
      name: 'OnlyDomain',
      slug: 'only-domain',
      updatedAt: '2026-01-01',
      rules,
    });
    expect(withoutDedup.files.map((f) => f.behavior)).toEqual(['domain']);
    expect(withoutDedup.counts).toEqual({ domain: 2, classical: 0, ipcidr: 0 });

    const withDedup = splitRulesetByBehavior(
      { name: 'OnlyDomain', slug: 'only-domain', updatedAt: '2026-01-01', rules },
      { coverageDedup: true },
    );
    expect(withDedup.counts).toEqual({ domain: 1, classical: 0, ipcidr: 0 });
    expect(withDedup.buckets.domain).toEqual(['+.example.com']);
    expect(summarizeRulesetBehaviors(rules, { coverageDedup: true })).toEqual({ domain: 1, classical: 0, ipcidr: 0 });
  });

  it('sanitizes newline injection in header metadata and rule scalars', () => {
    const result = splitRulesetByBehavior(
      {
        name: 'Safe\npayload:\n  - injected.evil',
        slug: 'safe',
        updatedAt: '2026-01-01\r\nMATCH,DIRECT',
        rules: [makeRule('DOMAIN', 'good.com')],
      },
      { source: 'src\nkey: value' },
    );

    const parsed = parseYaml(result.files[0]!.yaml) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['payload']);
    expect(parsed.payload).toEqual(['good.com']);
  });

  it('does not alter legacy 1.0.x subscription formatter outputs', () => {
    const makeLegacyRule = (id: string, type: DomainRule['type'], value: string): DomainRule => ({
      id,
      type,
      value,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const category: RuleCategory = {
      id: 'cat_1',
      name: 'Legacy Direct',
      slug: 'legacy-direct',
      updatedAt: '2026-01-01T00:00:00.000Z',
      rules: [
        makeLegacyRule('1', 'DOMAIN-SUFFIX', 'example.com'),
        makeLegacyRule('2', 'DOMAIN', 'a.example.com'),
        makeLegacyRule('3', 'DST-PORT', '443'),
        makeLegacyRule('4', 'IP-CIDR', '10.0.0.0/8'),
      ],
    };

    expect(legacyYaml(category)).toContain('# Generated for Legacy Direct by Private Rules\n');
    expect(domainYaml(category)).toContain("  - '+.example.com'\n  - 'a.example.com'\n");
    expect(ipcidrYaml(category)).toContain('  - DST-PORT,443\n  - IP-CIDR,10.0.0.0/8,no-resolve\n');
  });
});
