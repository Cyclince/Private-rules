import { describe, expect, it } from 'vitest';
import { formatters } from '../../src/lib/formatters';
import { parseBulkImport, parseRuleInput } from '../../src/lib/parser';
import { RULE_TYPES } from '../../src/lib/rule-types';
import { isSourceDue } from '../../src/lib/sync';
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
    const data = { settings: { policyName: '', baseUrl: '', publicLinksEnabled: true, tokenLinksEnabled: true, customIconPackUrls: [], customIconPackNames: {} } } as RulesData;
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
    const data = { settings: { policyName: '', baseUrl: '', publicLinksEnabled: true, tokenLinksEnabled: true, customIconPackUrls: [], customIconPackNames: {} } } as RulesData;
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
