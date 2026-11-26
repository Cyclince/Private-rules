import { describe, expect, it } from 'vitest';
import {
  deduplicateCoveredRules,
  mergeRulesetWithCoverageDedup,
  type CoverageRuleLike,
} from '../../../src/domain/rules/coverage-dedup';

function r(type: CoverageRuleLike['type'], value: string, enabled = true): CoverageRuleLike {
  return { type, value, enabled };
}

describe('coverage-dedup (design §9.3.1)', () => {
  it('removes DOMAIN and narrower DOMAIN-SUFFIX entries covered by broader DOMAIN-SUFFIX', () => {
    const input = [
      r('DOMAIN', 'a.example.com'),
      r('DOMAIN', 'example.com'),
      r('DOMAIN-SUFFIX', 'sub.example.com'),
      r('DOMAIN-SUFFIX', 'example.com'),
      r('DOMAIN', 'other.org'),
      r('DOMAIN-SUFFIX', 'notexample.com'),
    ];

    const result = deduplicateCoveredRules(input);
    expect(result.rules.map((item) => `${item.type},${item.value}`)).toEqual([
      'DOMAIN-SUFFIX,example.com',
      'DOMAIN,other.org',
      'DOMAIN-SUFFIX,notexample.com',
    ]);
    expect(result.originalCount).toBe(6);
    expect(result.keptCount).toBe(3);
    expect(result.removedCount).toBe(3);
    expect(result.coveredRemovedCount).toBe(3);
    expect(result.duplicateRemovedCount).toBe(0);
    expect(result.samples).toHaveLength(3);
    expect(result.samples.every((s) => s.reason === 'domain-suffix-covered')).toBe(true);
    expect(result.samples.every((s) => s.coveredBy.value === 'example.com')).toBe(true);
  });

  it('normalizes domain case, leading dots, and trailing dots without confusing DOMAIN for DOMAIN-SUFFIX', () => {
    const input = [
      r('DOMAIN', 'API.Example.COM.'),
      r('DOMAIN-SUFFIX', '+.EXAMPLE.com'),
      r('DOMAIN', 'keep.io'),
      r('DOMAIN', 'sub.keep.io'),
    ];

    const result = deduplicateCoveredRules(input);
    expect(result.rules.map((item) => `${item.type},${item.value}`)).toEqual([
      'DOMAIN-SUFFIX,+.EXAMPLE.com',
      'DOMAIN,keep.io',
      'DOMAIN,sub.keep.io',
    ]);
    expect(result.coveredRemovedCount).toBe(1);
  });

  it('removes narrower IPv4 and IPv6 IP-CIDR entries covered by broader CIDRs', () => {
    const input = [
      r('IP-CIDR', '10.1.2.3/32'),
      r('IP-CIDR', '10.1.0.0/16'),
      r('IP-CIDR', '10.0.0.0/8'),
      r('IP-CIDR', '192.168.1.0/24'),
      r('IP-CIDR', '2001:db8:1::/48'),
      r('IP-CIDR', '2001:db8::/32'),
      r('IP-CIDR', 'fd00::/8'),
    ];

    const result = deduplicateCoveredRules(input);
    expect(result.rules.map((item) => item.value)).toEqual([
      '10.0.0.0/8',
      '192.168.1.0/24',
      '2001:db8::/32',
      'fd00::/8',
    ]);
    expect(result.coveredRemovedCount).toBe(3);
    expect(result.samples.every((s) => s.reason === 'cidr-covered')).toBe(true);
  });

  it('keeps SRC-IP-CIDR and IP-CIDR coverage domains strictly separate', () => {
    const input = [r('IP-CIDR', '10.0.0.0/8'), r('SRC-IP-CIDR', '10.1.0.0/16'), r('SRC-IP-CIDR', '10.0.0.0/8')];

    const result = deduplicateCoveredRules(input);
    expect(result.rules.map((item) => `${item.type},${item.value}`)).toEqual([
      'IP-CIDR,10.0.0.0/8',
      'SRC-IP-CIDR,10.0.0.0/8',
    ]);
    expect(result.coveredRemovedCount).toBe(1);
  });

  it('tracks exact duplicates separately from coverage removals and prioritizes coverage samples', () => {
    const input = [
      r('DOMAIN', 'dup.org'),
      r('DOMAIN', 'DUP.ORG'),
      r('IP-CIDR', '2001:0db8::/32'),
      r('IP-CIDR', '2001:db8::/32'),
      r('DOMAIN-SUFFIX', 'example.com'),
      r('DOMAIN', 'a.example.com'),
    ];

    const result = deduplicateCoveredRules(input, { sampleLimit: 2 });
    expect(result.duplicateRemovedCount).toBe(2);
    expect(result.coveredRemovedCount).toBe(1);
    expect(result.removedCount).toBe(3);
    expect(result.samples).toHaveLength(2);
    expect(result.samples[0]?.reason).toBe('domain-suffix-covered');
    expect(result.samples[1]?.reason).toBe('exact-duplicate');
  });

  it('acts as a pure no-op when enabled is false (per-source opt-out / 1.0.x compat)', () => {
    const input = [
      r('DOMAIN-SUFFIX', 'example.com'),
      r('DOMAIN', 'a.example.com'),
      r('IP-CIDR', '10.0.0.0/8'),
      r('IP-CIDR', '10.1.0.0/16'),
    ];

    const result = deduplicateCoveredRules(input, { enabled: false });
    expect(result.rules.map((item) => `${item.type},${item.value}`)).toEqual([
      'DOMAIN-SUFFIX,example.com',
      'DOMAIN,a.example.com',
      'IP-CIDR,10.0.0.0/8',
      'IP-CIDR,10.1.0.0/16',
    ]);
    expect(result.removedCount).toBe(0);
    expect(result.coveredRemovedCount).toBe(0);
    expect(result.duplicateRemovedCount).toBe(0);
    expect(result.samples).toEqual([]);
  });

  it('respects existingCoveringRules without mutating or returning them', () => {
    const existing = [r('DOMAIN-SUFFIX', 'google.com'), r('IP-CIDR', '172.16.0.0/12')];
    const incoming = [r('DOMAIN', 'mail.google.com'), r('DOMAIN', 'github.com'), r('IP-CIDR', '172.16.5.0/24')];

    const result = deduplicateCoveredRules(incoming, { existingCoveringRules: existing });
    expect(result.rules.map((item) => item.value)).toEqual(['github.com']);
    expect(result.coveredRemovedCount).toBe(2);
  });

  it('ignores disabled rules as covering entries and preserves them untouched', () => {
    const input = [r('DOMAIN-SUFFIX', 'example.com', false), r('DOMAIN', 'a.example.com', true)];

    const result = deduplicateCoveredRules(input);
    expect(result.rules).toHaveLength(2);
    expect(result.removedCount).toBe(0);
  });

  it('merges manual rules and multiple sources with per-source coverageDedup toggle', () => {
    const merged = mergeRulesetWithCoverageDedup({
      manualRules: [r('DOMAIN-SUFFIX', 'manual.dev')],
      sources: [
        {
          id: 'src-dedup-on',
          coverageDedup: true,
          rules: [r('DOMAIN', 'api.manual.dev'), r('DOMAIN', 'sub.shared.com'), r('IP-CIDR', '10.1.0.0/16')],
        },
        {
          id: 'src-legacy-off',
          coverageDedup: false,
          rules: [
            r('DOMAIN-SUFFIX', 'shared.com'),
            r('DOMAIN', 'keep-even-if-covered.shared.com'),
            r('IP-CIDR', '10.0.0.0/8'),
          ],
        },
      ],
    });

    expect(merged.perSource['src-dedup-on']).toEqual({
      originalCount: 3,
      keptCount: 0,
      removedCount: 3,
      coveredRemovedCount: 3,
      duplicateRemovedCount: 0,
      coverageDedup: true,
    });
    expect(merged.perSource['src-legacy-off']).toEqual({
      originalCount: 3,
      keptCount: 3,
      removedCount: 0,
      coveredRemovedCount: 0,
      duplicateRemovedCount: 0,
      coverageDedup: false,
    });
    expect(merged.rules.map((item) => `${item.type},${item.value}`)).toEqual([
      'DOMAIN-SUFFIX,manual.dev',
      'DOMAIN-SUFFIX,shared.com',
      'DOMAIN,keep-even-if-covered.shared.com',
      'IP-CIDR,10.0.0.0/8',
    ]);
  });

  it('deduplicates 10,000 rules quickly in O(n log n)', () => {
    const rules: CoverageRuleLike[] = [r('DOMAIN-SUFFIX', 'corp.example'), r('IP-CIDR', '10.0.0.0/8')];
    for (let i = 0; i < 5000; i += 1) {
      rules.push(r('DOMAIN', `svc-${i}.corp.example`));
      rules.push(r('IP-CIDR', `10.${Math.floor(i / 256)}.${i % 256}.0/24`));
    }

    const start = performance.now();
    const result = deduplicateCoveredRules(rules);
    const elapsedMs = performance.now() - start;

    expect(result.keptCount).toBe(2);
    expect(result.coveredRemovedCount).toBe(10000);
    expect(elapsedMs).toBeLessThan(500);
  });
});
