import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  findRuleConflictsLinear,
  RuleConflictIndex,
  type ConflictIndexedRule,
} from '../../../src/domain/rules/conflicts';
import type { DomainRuleType } from '../../../src/types/domain-rules';

function seededRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('RuleConflictIndex', () => {
  it('matches the linear reference implementation identically across all rule types (differential check)', () => {
    const existing: ConflictIndexedRule[] = [
      { id: 'r1', categoryId: 'c1', categoryName: 'Direct', type: 'DOMAIN', value: 'api.example.com' },
      { id: 'r2', categoryId: 'c1', categoryName: 'Direct', type: 'DOMAIN-SUFFIX', value: 'example.com' },
      { id: 'r3', categoryId: 'c2', categoryName: 'Proxy', type: 'DOMAIN-SUFFIX', value: 'sub.example.com' },
      { id: 'r4', categoryId: 'c2', categoryName: 'Proxy', type: 'DOMAIN', value: 'deep.sub.example.com' },
      { id: 'r5', categoryId: 'c2', categoryName: 'Proxy', type: 'DOMAIN-KEYWORD', value: 'openai' },
      { id: 'r6', categoryId: 'c2', categoryName: 'Proxy', type: 'DOMAIN-KEYWORD', value: 'ai' },
      { id: 'r7', categoryId: 'c1', categoryName: 'Direct', type: 'DOMAIN', value: 'chat.openai.com' },
      { id: 'r8', categoryId: 'c1', categoryName: 'Direct', type: 'IP-CIDR', value: '10.0.0.0/8' },
      { id: 'r9', categoryId: 'c2', categoryName: 'Proxy', type: 'IP-CIDR', value: '10.44.0.0/16' },
      { id: 'r10', categoryId: 'c2', categoryName: 'Proxy', type: 'IP-CIDR', value: '192.168.1.5/32' },
      { id: 'r11', categoryId: 'c2', categoryName: 'Proxy', type: 'IP-CIDR', value: '2001:db8::/32' },
      { id: 'r12', categoryId: 'c2', categoryName: 'Proxy', type: 'IP-CIDR', value: '2001:db8:abcd::/48' },
      { id: 'r13', categoryId: 'c1', categoryName: 'Direct', type: 'SRC-IP-CIDR', value: '172.16.0.0/12' },
      { id: 'r14', categoryId: 'c1', categoryName: 'Direct', type: 'SRC-IP-CIDR', value: 'fd00::/8' },
      { id: 'r15', categoryId: 'c1', categoryName: 'Direct', type: 'DST-PORT', value: '80-90' },
      { id: 'r16', categoryId: 'c2', categoryName: 'Proxy', type: 'DST-PORT', value: '443' },
      { id: 'r17', categoryId: 'c1', categoryName: 'Direct', type: 'SRC-PORT', value: '1000-2000' },
      { id: 'r18', categoryId: 'c2', categoryName: 'Proxy', type: 'IP-ASN', value: '13335' },
      { id: 'r19', categoryId: 'c2', categoryName: 'Proxy', type: 'GEOSITE', value: 'google' },
      { id: 'r20', categoryId: 'c2', categoryName: 'Proxy', type: 'GEOIP', value: 'cn' },
      { id: 'r21', categoryId: 'c2', categoryName: 'Proxy', type: 'DOMAIN', value: 'Example.Com' },
    ];

    const candidates: Array<{ type: DomainRuleType; value: string; exclude?: string }> = [
      { type: 'DOMAIN', value: 'api.example.com' },
      { type: 'DOMAIN', value: 'API.EXAMPLE.COM', exclude: 'r1' },
      { type: 'DOMAIN-SUFFIX', value: 'example.com' },
      { type: 'DOMAIN-SUFFIX', value: 'com' },
      { type: 'DOMAIN', value: 'leaf.deep.sub.example.com' },
      { type: 'DOMAIN', value: 'my-openai-service.net' },
      { type: 'DOMAIN-KEYWORD', value: 'example' },
      { type: 'DOMAIN-KEYWORD', value: 'ai' },
      { type: 'DOMAIN-KEYWORD', value: 'open' },
      { type: 'DOMAIN-KEYWORD', value: 'ex' },
      { type: 'DOMAIN-KEYWORD', value: 'nomatchkeyword' },
      { type: 'IP-CIDR', value: '10.44.8.0/24' },
      { type: 'IP-CIDR', value: '10.0.0.0/8' },
      { type: 'IP-CIDR', value: '0.0.0.0/0' },
      { type: 'IP-CIDR', value: '192.168.1.0/24' },
      { type: 'IP-CIDR', value: '2001:db8:abcd:1::/64' },
      { type: 'IP-CIDR', value: '2001:db8::/32' },
      { type: 'IP-CIDR', value: '2606:4700::/32' },
      { type: 'SRC-IP-CIDR', value: '172.20.1.0/24' },
      { type: 'SRC-IP-CIDR', value: '10.44.8.0/24' },
      { type: 'SRC-IP-CIDR', value: 'fd12:3456::/32' },
      { type: 'DST-PORT', value: '85' },
      { type: 'DST-PORT', value: '88-100' },
      { type: 'DST-PORT', value: '443' },
      { type: 'DST-PORT', value: '1500' },
      { type: 'SRC-PORT', value: '1500' },
      { type: 'SRC-PORT', value: '1999-2500' },
      { type: 'IP-ASN', value: '13335' },
      { type: 'IP-ASN', value: '15169' },
      { type: 'GEOSITE', value: 'google' },
      { type: 'GEOIP', value: 'CN' },
    ];

    const index = new RuleConflictIndex(existing);
    for (const candidate of candidates) {
      const actual = index.findConflicts({ type: candidate.type, value: candidate.value }, candidate.exclude);
      const expected = findRuleConflictsLinear(
        existing,
        { type: candidate.type, value: candidate.value },
        candidate.exclude,
      );
      expect(actual).toEqual(expected);
    }
  });

  it('matches linear scan identically on a randomized 500-rule corpus', () => {
    const rng = seededRng(20261126);
    const words = ['alpha', 'beta', 'gamma', 'delta', 'cloud', 'stream', 'edge', 'cdn', 'chat', 'mail'];
    const tlds = ['com', 'net', 'org', 'io'];
    const pick = <T>(items: readonly T[]) => items[Math.floor(rng() * items.length)];

    const existing: ConflictIndexedRule[] = [];
    for (let i = 0; i < 500; i += 1) {
      const mod = i % 10;
      let type: DomainRuleType;
      let value: string;
      if (mod < 3) {
        type = 'DOMAIN';
        value = `${pick(words)}${i % 25}.${pick(words)}.${pick(tlds)}`;
      } else if (mod < 5) {
        type = 'DOMAIN-SUFFIX';
        value = `${pick(words)}.${pick(tlds)}`;
      } else if (mod === 5) {
        type = 'DOMAIN-KEYWORD';
        value = i % 2 === 0 ? pick(words) : `${pick(words)}${i % 7}`;
      } else if (mod === 6) {
        type = 'IP-CIDR';
        value = `${10 + (i % 5)}.${(i * 7) % 256}.${(i * 13) % 256}.0/${[8, 16, 24][i % 3]}`;
      } else if (mod === 7) {
        type = 'IP-CIDR';
        value = `2001:db8:${(i % 16).toString(16)}::/${[32, 48, 64][i % 3]}`;
      } else if (mod === 8) {
        type = 'DST-PORT';
        const base = 100 + (i % 50) * 10;
        value = i % 2 === 0 ? `${base}` : `${base}-${base + 15}`;
      } else {
        type = 'SRC-PORT';
        const base = 1000 + (i % 40) * 20;
        value = `${base}-${base + 25}`;
      }
      existing.push({ id: `rand-${i}`, categoryId: `cat-${i % 4}`, categoryName: `Cat ${i % 4}`, type, value });
    }

    const index = new RuleConflictIndex(existing);
    for (let q = 0; q < 150; q += 1) {
      const sample = existing[(q * 3) % existing.length];
      const probe: { type: DomainRuleType; value: string } =
        q % 3 === 0
          ? { type: sample.type, value: sample.value }
          : q % 3 === 1
            ? { type: 'DOMAIN', value: `deep.${pick(words)}.${pick(tlds)}` }
            : { type: 'IP-CIDR', value: `${10 + (q % 5)}.${q % 256}.1.1/32` };
      expect(index.findConflicts(probe)).toEqual(findRuleConflictsLinear(existing, probe));
    }
  });

  it('handles 10,000 indexed rules with 1,000 queries well within performance budget', () => {
    const existing: ConflictIndexedRule[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      if (i < 5_000) {
        existing.push({
          id: `d-${i}`,
          categoryId: 'cat-1',
          categoryName: 'Domains',
          type: i % 3 === 0 ? 'DOMAIN-SUFFIX' : 'DOMAIN',
          value: `host-${i}.svc-${i % 100}.zone-${i % 20}.example`,
        });
      } else if (i < 8_500) {
        const a = 11 + ((i >> 8) % 200);
        const b = i & 0xff;
        existing.push({
          id: `ip4-${i}`,
          categoryId: 'cat-2',
          categoryName: 'IPv4',
          type: 'IP-CIDR',
          value: `${a}.${b}.0.0/16`,
        });
      } else if (i < 9_800) {
        existing.push({
          id: `ip6-${i}`,
          categoryId: 'cat-3',
          categoryName: 'IPv6',
          type: 'IP-CIDR',
          value: `2001:db8:${(i - 8_500).toString(16)}::/48`,
        });
      } else if (i < 9_950) {
        const port = 1000 + (i - 9_800) * 10;
        existing.push({
          id: `p-${i}`,
          categoryId: 'cat-4',
          categoryName: 'Ports',
          type: 'DST-PORT',
          value: `${port}-${port + 5}`,
        });
      } else {
        existing.push({
          id: `kw-${i}`,
          categoryId: 'cat-5',
          categoryName: 'Keywords',
          type: 'DOMAIN-KEYWORD',
          value: `keywordtoken${i}`,
        });
      }
    }

    const start = performance.now();
    const index = new RuleConflictIndex(existing);
    let totalMatches = 0;
    for (let q = 0; q < 1_000; q += 1) {
      const candidate =
        q % 4 === 0
          ? { type: 'DOMAIN' as const, value: `sub.host-${q * 3}.svc-${(q * 3) % 100}.zone-${(q * 3) % 20}.example` }
          : q % 4 === 1
            ? { type: 'IP-CIDR' as const, value: `${11 + ((q >> 4) % 200)}.${q & 0xff}.42.1/32` }
            : q % 4 === 2
              ? { type: 'IP-CIDR' as const, value: `2001:db8:${(q % 1000).toString(16)}:1::/64` }
              : { type: 'DST-PORT' as const, value: `${1000 + (q % 150) * 10 + 2}` };
      totalMatches += index.findConflicts(candidate).length;
    }
    const elapsedMs = performance.now() - start;

    expect(totalMatches).toBeGreaterThan(0);
    // Indexing 10,000 rules + 1,000 conflict queries must stay far below 1s (typically < 150ms)
    expect(elapsedMs).toBeLessThan(1_000);
  });
});
