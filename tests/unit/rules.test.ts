import { describe, expect, it } from 'vitest';
import { formatters } from '../../src/lib/formatters';
import { parseBulkImport, parseRuleInput } from '../../src/lib/parser';
import { RULE_TYPES } from '../../src/lib/rule-types';
import { isSourceDue } from '../../src/lib/sync';
import { compactRules } from '../../src/lib/rule-compactor';
import { linksForCategory } from '../../src/lib/links';
import { normalizeUserAgent } from '../../src/lib/db';
import type { RuleCategory, RulesData } from '../../src/types/domain-rules';

describe('rule parsing and subscriptions', () => {
  it('normalizes input, rejects invalid lines, and removes duplicates', () => {
    const preview = parseBulkImport('example.com\n+.example.org\nDOMAIN-SUFFIX,example.org\nnot a domain', []);
    expect(preview.rules.map((rule) => `${rule.type},${rule.value}`)).toEqual(['DOMAIN-SUFFIX,example.com', 'DOMAIN-SUFFIX,example.org']);
    expect(preview.duplicateValues).toContain('example.org');
    expect(preview.invalidValues).toContain('not a domain');
  });

  it('generates deterministic YAML, LIST, TXT, and JSON while omitting disabled duplicates', () => {
    const category: RuleCategory = { id: 'cat', name: 'Test', slug: 'test', updatedAt: '2026-01-01T00:00:00.000Z', rules: [
      { id: '1', value: 'b.example', type: 'DOMAIN-SUFFIX', enabled: true, createdAt: '', updatedAt: '' },
      { id: '2', value: 'b.example', type: 'DOMAIN-SUFFIX', enabled: true, createdAt: '', updatedAt: '' },
      { id: '3', value: 'a.example', type: 'DOMAIN', enabled: false, createdAt: '', updatedAt: '' },
    ] };
    const data = { settings: { policyName: '', baseUrl: '', githubMirrorUrl: '', publicLinksEnabled: true, tokenLinksEnabled: true, customIconPackUrls: [], customIconPackNames: {} } } as RulesData;
    for (const formatter of [formatters.yaml, formatters.general, formatters.url, formatters.json]) {
      const output = formatter.format(category, data);
      expect(output.match(/b\.example/g)).toHaveLength(1);
      expect(output).not.toContain('a.example');
    }
  });

  it('supports destination ports between ASN and site collections', () => {
    const preview = parseBulkImport('DST-PORT,1-79\nDST-PORT,81-442\nDST-PORT,444-65535', []);
    expect(preview.rules.map((rule) => `${rule.type},${rule.value}`)).toEqual([
      'DST-PORT,1-79',
      'DST-PORT,81-442',
      'DST-PORT,444-65535',
    ]);
    expect(RULE_TYPES.slice(RULE_TYPES.indexOf('IP-ASN'), RULE_TYPES.indexOf('GEOSITE') + 1)).toEqual(['IP-ASN', 'DST-PORT', 'GEOSITE']);
  });

  it('auto-detects and validates destination port ranges', () => {
    expect(parseRuleInput('443').type).toBe('DST-PORT');
    expect(parseRuleInput('1-79').type).toBe('DST-PORT');
    expect(() => parseRuleInput('0', 'DST-PORT')).toThrow('目标端口格式不正确');
    expect(() => parseRuleInput('80-79', 'DST-PORT')).toThrow('目标端口格式不正确');
    expect(() => parseRuleInput('65536', 'DST-PORT')).toThrow('目标端口格式不正确');
  });

  it('keeps destination port types in formatted subscriptions', () => {
    const category: RuleCategory = { id: 'ports', name: 'Ports', slug: 'ports', updatedAt: '2026-01-01T00:00:00.000Z', rules: [
      { id: 'port-1', value: '1-79', type: 'DST-PORT', enabled: true, createdAt: '', updatedAt: '' },
    ] };
    const data = { settings: { policyName: '', baseUrl: '', githubMirrorUrl: '', publicLinksEnabled: true, tokenLinksEnabled: true, customIconPackUrls: [], customIconPackNames: {} } } as RulesData;
    expect(formatters.yaml.format(category, data)).toContain('DST-PORT,1-79');
    expect(formatters.general.format(category, data)).toContain('DST-PORT,1-79');
    expect(formatters.json.format(category, data)).toContain('"type": "DST-PORT"');
  });
});

describe('sync due calculation', () => {
  it('uses the injected time and source interval', () => {
    const now = Date.parse('2026-01-01T01:00:00.000Z');
    expect(isSourceDue({ last_synced_at: '2026-01-01T00:30:01.000Z', sync_interval_minutes: 30 }, false, now)).toBe(false);
    expect(isSourceDue({ last_synced_at: '2026-01-01T00:30:00.000Z', sync_interval_minutes: 30 }, false, now)).toBe(true);
    expect(isSourceDue({ last_synced_at: null, sync_interval_minutes: 60 }, false, now)).toBe(true);
  });
});

describe('upstream User-Agent', () => {
  it('uses the Clash Verge default and validates custom values', () => {
    expect(normalizeUserAgent()).toBe('clash-verge/v2.5.1');
    expect(normalizeUserAgent(' clash.meta/1.19.20 ')).toBe('clash.meta/1.19.20');
    expect(() => normalizeUserAgent('Clash\r\nX-Test: invalid')).toThrow('User-Agent 格式不正确');
  });
});

describe('upstream compaction levels', () => {
  it('uses keywords and broader suffixes in aggressive mode', () => {
    const lines = [
      ...Array.from({ length: 12 }, (_, index) => `DOMAIN,speedtest-${index}.carrier${index}.example`),
      'DOMAIN,server-a.ookla.com',
      'DOMAIN,server-b.ookla.com',
      ...['a', 'b', 'c', 'd'].map((host) => `DOMAIN,${host}.node.provider.example`),
      ...Array.from({ length: 8 }, (_, index) => `DOMAIN,test.gateway${index}.example`),
      'DOMAIN,unrelated.example.org',
      'IP-CIDR,10.20.30.42/32',
      'IP-CIDR,10.20.30.0/24',
    ].join('\n');
    const input = parseBulkImport(lines, []).rules;
    const result = compactRules(input, 'aggressive');
    const values = new Set(result.rules.map((rule) => `${rule.type},${rule.value}`));

    expect(values).toContain('DOMAIN-KEYWORD,speedtest');
    expect(values).toContain('DOMAIN-SUFFIX,ookla.com');
    expect(values).toContain('DOMAIN-SUFFIX,node.provider.example');
    expect(values).toContain('DOMAIN,unrelated.example.org');
    expect(values).toContain('IP-CIDR,10.20.30.0/24');
    expect(values).not.toContain('IP-CIDR,10.20.30.42/32');
    expect(values).not.toContain('DOMAIN-KEYWORD,test');
    expect(values).not.toContain('DOMAIN-KEYWORD,speed');
    expect(result.compactedCount).toBeLessThan(result.originalCount);
  });

  it('uses only four-label-or-deeper generated suffixes in conservative mode', () => {
    const lines = [
      ...['a', 'b', 'c', 'd'].map((host) => `DOMAIN,${host}.speed.vodafone.co.uk`),
      ...Array.from({ length: 8 }, (_, index) => `DOMAIN,speedtest-${index}.carrier${index}.example`),
      'DOMAIN-SUFFIX,existing.example.com',
      'DOMAIN,child.existing.example.com',
    ].join('\n');
    const result = compactRules(parseBulkImport(lines, []).rules, 'conservative');
    const generated = result.rules.filter((rule) => rule.note === '保守精简自动生成');

    expect(generated).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'DOMAIN-SUFFIX', value: 'speed.vodafone.co.uk' }),
    ]));
    expect(generated.every((rule) => rule.type === 'DOMAIN-SUFFIX' && rule.value.split('.').length >= 4)).toBe(true);
    expect(result.rules.some((rule) => rule.type === 'DOMAIN-KEYWORD')).toBe(false);
    expect(result.rules.some((rule) => rule.value === 'vodafone.co.uk')).toBe(false);
    expect(result.rules.some((rule) => rule.value === 'child.existing.example.com')).toBe(false);
  });

  it('does not alter small unrelated rule sets', () => {
    const input = parseBulkImport('DOMAIN,one.example.com\nDOMAIN,two.example.net\nDST-PORT,443', []).rules;
    const result = compactRules(input, 'conservative');
    expect(result.rules.map((rule) => `${rule.type},${rule.value}`)).toEqual(input.map((rule) => `${rule.type},${rule.value}`));
  });
});

describe('subscription link protocol', () => {
  it('upgrades configured HTTP links when the console request uses HTTPS', () => {
    const category: RuleCategory = { id: 'secure', name: 'Secure', slug: 'secure', updatedAt: '', tokenLinksEnabled: false, publicLinksEnabled: true, rules: [] };
    const data = {
      settings: { baseUrl: 'http://rules.example.com', policyName: '', githubMirrorUrl: '', publicLinksEnabled: true, tokenLinksEnabled: true, customIconPackUrls: [], customIconPackNames: {} },
    } as RulesData;
    const links = linksForCategory(category, data, 'https://console.example.com/api/categories');
    expect(links.every((link) => link.publicUrl.startsWith('https://rules.example.com/'))).toBe(true);
  });
});
