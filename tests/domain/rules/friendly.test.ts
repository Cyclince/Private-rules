import { describe, expect, it } from 'vitest';
import {
  describeIpCidr,
  describeRuleFriendly,
  formatRawRuleLine,
  getAllRuleTypeOptions,
  getGroupedRuleTypeOptions,
  getRuleTypeDescriptionKey,
  isIpCidrRuleType,
  previewRuleInputFriendly,
} from '../../../src/domain/rules/friendly';
import { RULE_TYPES } from '../../../src/domain/rules/rule-types';
import type { DomainRuleType } from '../../../src/types/domain-rules';
import {
  formatFriendlyRuleInline,
  formatFriendlyRuleType,
} from '../../../src/web/components/rulesets/rule-library-helpers';
import { en } from '../../../src/web/i18n/en';
import { zhCNPages } from '../../../src/web/i18n/zh-CN.pages';
import { zhTW } from '../../../src/web/i18n/zh-TW';

function makeTranslator(dict: Record<string, string>) {
  return (key: string, params?: Record<string, string | number>): string => {
    let text = dict[key] ?? key;
    if (params) {
      for (const [paramKey, paramValue] of Object.entries(params)) {
        text = text.replaceAll(`{${paramKey}}`, String(paramValue));
      }
    }
    return text;
  };
}

function formatFullSubtitle(descriptor: ReturnType<typeof describeRuleFriendly>, t: (key: string) => string): string {
  return `${formatFriendlyRuleType(descriptor, t)} · ${formatFriendlyRuleInline(descriptor, t)}`;
}

describe('domain/rules/friendly', () => {
  const tZhCN = makeTranslator(zhCNPages);
  const tEn = makeTranslator(en);

  it('converts IPv4 and IPv6 addresses/CIDRs into plain-language host or range metadata', () => {
    // IPv4 /32 and bare IPv4
    expect(describeIpCidr('1.2.3.4/32')).toEqual({
      kind: 'single',
      version: 4,
      address: '1.2.3.4',
      prefix: 32,
      count: 1,
    });
    expect(describeIpCidr('1.2.3.4')).toEqual({
      kind: 'single',
      version: 4,
      address: '1.2.3.4',
      prefix: 32,
      count: 1,
    });

    // IPv4 /24
    expect(describeIpCidr('198.51.100.0/24')).toEqual({
      kind: 'ipv4-range',
      version: 4,
      start: '198.51.100.0',
      end: '198.51.100.255',
      prefix: 24,
      count: 256,
      countScale: 'exact',
      zhCount: '256',
      enCount: '256',
    });

    // IPv4 /16 (normalizes non-zero host bits)
    expect(describeIpCidr('198.51.42.9/16')).toEqual({
      kind: 'ipv4-range',
      version: 4,
      start: '198.51.0.0',
      end: '198.51.255.255',
      prefix: 16,
      count: 65536,
      countScale: 'exact',
      zhCount: '65,536',
      enCount: '65,536',
    });

    // IPv4 /8 (16,777,216 -> 约 1677 万个)
    expect(describeIpCidr('10.0.0.0/8')).toEqual({
      kind: 'ipv4-range',
      version: 4,
      start: '10.0.0.0',
      end: '10.255.255.255',
      prefix: 8,
      count: 16777216,
      countScale: 'tenThousands',
      zhCount: '1677',
      enCount: '16.7M',
    });

    // IPv4 /0 (4,294,967,296 -> 约 42.9 亿个)
    expect(describeIpCidr('0.0.0.0/0')).toEqual({
      kind: 'ipv4-range',
      version: 4,
      start: '0.0.0.0',
      end: '255.255.255.255',
      prefix: 0,
      count: 4294967296,
      countScale: 'hundredMillions',
      zhCount: '42.9',
      enCount: '4.29B',
    });

    // IPv6 /128 and bare IPv6
    expect(describeIpCidr('2001:db8::1/128')).toEqual({
      kind: 'single',
      version: 6,
      address: '2001:db8::1',
      prefix: 128,
      count: 1,
    });
    expect(describeIpCidr('2001:0db8:0000:0000:0000:0000:0000:0001')).toEqual({
      kind: 'single',
      version: 6,
      address: '2001:db8::1',
      prefix: 128,
      count: 1,
    });

    // IPv6 /64 and /32
    expect(describeIpCidr('2001:db8::/64')).toEqual({
      kind: 'ipv6-range',
      version: 6,
      prefixAddress: '2001:db8::',
      prefix: 64,
    });
    expect(describeIpCidr('2001:db8:abcd::1/32')).toEqual({
      kind: 'ipv6-range',
      version: 6,
      prefixAddress: '2001:db8::',
      prefix: 32,
    });

    // Invalid inputs
    expect(describeIpCidr('')).toBeNull();
    expect(describeIpCidr('999.1.1.1/24')).toBeNull();
    expect(describeIpCidr('1.2.3.4/33')).toBeNull();
    expect(describeIpCidr('2001:db8::/129')).toBeNull();
    expect(describeIpCidr('not-an-ip')).toBeNull();
  });

  it('formats IP-CIDR and SRC-IP-CIDR rules in plain language without duplicate labels', () => {
    expect(formatFullSubtitle(describeRuleFriendly({ type: 'IP-CIDR', value: '1.2.3.4/32' }), tZhCN)).toBe(
      'IP 地址 · 1.2.3.4',
    );
    expect(formatFullSubtitle(describeRuleFriendly({ type: 'IP-CIDR', value: '1.2.3.4' }), tZhCN)).toBe(
      'IP 地址 · 1.2.3.4',
    );
    expect(formatFullSubtitle(describeRuleFriendly({ type: 'IP-CIDR', value: '198.51.100.0/24' }), tZhCN)).toBe(
      'IP 段 · 198.51.100.0 – 198.51.100.255（共 256 个地址）',
    );
    expect(formatFullSubtitle(describeRuleFriendly({ type: 'IP-CIDR', value: '198.51.0.0/16' }), tZhCN)).toBe(
      'IP 段 · 198.51.0.0 – 198.51.255.255（共 65,536 个地址）',
    );
    expect(formatFullSubtitle(describeRuleFriendly({ type: 'IP-CIDR', value: '10.0.0.0/8' }), tZhCN)).toBe(
      'IP 段 · 10.0.0.0 – 10.255.255.255（约 1677 万个地址）',
    );
    expect(formatFullSubtitle(describeRuleFriendly({ type: 'IP-CIDR', value: '0.0.0.0/0' }), tZhCN)).toBe(
      'IP 段 · 0.0.0.0 – 255.255.255.255（约 42.9 亿个地址）',
    );
    expect(formatFullSubtitle(describeRuleFriendly({ type: 'IP-CIDR', value: '2001:db8::1/128' }), tZhCN)).toBe(
      'IP 地址 · 2001:db8::1',
    );
    expect(formatFullSubtitle(describeRuleFriendly({ type: 'IP-CIDR', value: '2001:db8::/64' }), tZhCN)).toBe(
      'IP 段 · 以 2001:db8:: 开头的地址',
    );
    expect(formatFullSubtitle(describeRuleFriendly({ type: 'IP-CIDR', value: '2001:db8:abcd::/32' }), tZhCN)).toBe(
      'IP 段 · 以 2001:db8:: 开头的地址',
    );

    // SRC-IP-CIDR uses 设备 IP / 设备 IP 段
    expect(formatFullSubtitle(describeRuleFriendly({ type: 'SRC-IP-CIDR', value: '192.168.1.20/32' }), tZhCN)).toBe(
      '设备 IP · 192.168.1.20',
    );
    expect(formatFullSubtitle(describeRuleFriendly({ type: 'SRC-IP-CIDR', value: '192.168.1.0/24' }), tZhCN)).toBe(
      '设备 IP 段 · 192.168.1.0 – 192.168.1.255（共 256 个地址）',
    );
    expect(formatFullSubtitle(describeRuleFriendly({ type: 'SRC-IP-CIDR', value: 'fd00::/64' }), tZhCN)).toBe(
      '设备 IP 段 · 以 fd00:: 开头的地址',
    );

    // English formatting also works cleanly
    expect(formatFullSubtitle(describeRuleFriendly({ type: 'IP-CIDR', value: '198.51.100.0/24' }), tEn)).toBe(
      'IP range · 198.51.100.0 – 198.51.100.255 (256 addresses)',
    );
    expect(formatFullSubtitle(describeRuleFriendly({ type: 'IP-CIDR', value: '10.0.0.0/8' }), tEn)).toBe(
      'IP range · 10.0.0.0 – 10.255.255.255 (~16.7M addresses)',
    );
  });

  it('covers all 14 rule types plus AUTO with grouped options and localized descriptions', () => {
    expect(RULE_TYPES).toHaveLength(14);
    const options = getAllRuleTypeOptions();
    expect(options).toHaveLength(14);
    expect(options.map((item) => item.type)).toEqual(RULE_TYPES);

    const grouped = getGroupedRuleTypeOptions();
    expect(grouped.common.map((item) => item.type)).toEqual([
      'DOMAIN-SUFFIX',
      'DOMAIN',
      'DOMAIN-KEYWORD',
      'IP-CIDR',
      'PROCESS-NAME',
    ]);
    expect(grouped.advanced).toHaveLength(9);
    expect(new Set([...grouped.common, ...grouped.advanced].map((item) => item.type)).size).toBe(14);

    // AUTO description key exists in all 3 locales
    const autoDescKey = getRuleTypeDescriptionKey('AUTO');
    expect(autoDescKey).toBe('ruleTypeDesc.AUTO');
    expect(zhCNPages[autoDescKey]).toBeTruthy();
    expect(zhTW[autoDescKey]).toBeTruthy();
    expect(en[autoDescKey]).toBeTruthy();

    const samples: Record<DomainRuleType, string> = {
      DOMAIN: 'direct.example.com',
      'DOMAIN-SUFFIX': 'chatgpt.com',
      'DOMAIN-KEYWORD': 'localcorp',
      'DOMAIN-REGEX': '^api\\..*\\.example\\.com$',
      'IP-CIDR': '10.0.0.0/8',
      'SRC-IP-CIDR': '192.168.1.0/24',
      'IP-ASN': '13335',
      'DST-PORT': '443',
      'SRC-PORT': '41641',
      GEOSITE: 'telegram',
      GEOIP: 'cn',
      'PROCESS-NAME': 'curl',
      'USER-AGENT': 'Mozilla/*',
      'URL-REGEX': '^https://example\\.com/api',
    };

    for (const type of RULE_TYPES) {
      const value = samples[type];
      const descriptor = describeRuleFriendly({ type, value });
      const descKey = getRuleTypeDescriptionKey(type);
      expect(descriptor.descriptionKey).toBe(descKey);
      expect(descriptor.params.value).toBe(value);

      // Verify i18n keys exist in zh-CN, zh-TW, and en dictionaries
      expect(zhCNPages[descriptor.typeKey]).toBeTruthy();
      expect(zhTW[descriptor.typeKey]).toBeTruthy();
      expect(en[descriptor.typeKey]).toBeTruthy();
      expect(zhCNPages[descriptor.descriptionKey]).toBeTruthy();
      expect(zhTW[descriptor.descriptionKey]).toBeTruthy();
      expect(en[descriptor.descriptionKey]).toBeTruthy();
      expect(zhCNPages[descriptor.inlineKey]).toBeTruthy();
      expect(zhTW[descriptor.inlineKey]).toBeTruthy();
      expect(en[descriptor.inlineKey]).toBeTruthy();
    }

    // Dropdown option labels exist across locales (including DOMAIN-SUFFIX-OPTION)
    for (const option of options) {
      expect(zhCNPages[option.optionLabelKey]).toBeTruthy();
      expect(zhTW[option.optionLabelKey]).toBeTruthy();
      expect(en[option.optionLabelKey]).toBeTruthy();
    }
  });

  it('previews live user input using existing AUTO parser rules', () => {
    expect(previewRuleInputFriendly('   ')).toBeNull();

    const domain = previewRuleInputFriendly('chatgpt.com');
    expect(domain?.ok).toBe(true);
    if (domain?.ok) {
      expect(domain.type).toBe('DOMAIN-SUFFIX');
      expect(domain.value).toBe('chatgpt.com');
      expect(domain.isIpType).toBe(false);
      expect(domain.friendly.inlineKey).toBe('ruleInline.domainSuffix');
    }

    const ip = previewRuleInputFriendly('127.0.0.0/8');
    expect(ip?.ok).toBe(true);
    if (ip?.ok) {
      expect(ip.type).toBe('IP-CIDR');
      expect(ip.isIpType).toBe(true);
      expect(ip.friendly.typeKey).toBe('ruleType.IP-CIDR-RANGE');
      expect(ip.friendly.inlineKey).toBe('ruleInline.ipv4RangeTenThousands');
    }

    const singleIp = previewRuleInputFriendly('1.2.3.4');
    expect(singleIp?.ok).toBe(true);
    if (singleIp?.ok) {
      expect(singleIp.type).toBe('IP-CIDR');
      expect(singleIp.value).toBe('1.2.3.4/32');
      expect(singleIp.isIpType).toBe(true);
      expect(singleIp.friendly.typeKey).toBe('ruleType.IP-CIDR-SINGLE');
      expect(singleIp.friendly.params.displayValue).toBe('1.2.3.4');
      expect(formatFullSubtitle(singleIp.friendly, tZhCN)).toBe('IP 地址 · 1.2.3.4');
    }

    const singleIpv6 = previewRuleInputFriendly('2001:db8::1');
    expect(singleIpv6?.ok).toBe(true);
    if (singleIpv6?.ok) {
      expect(singleIpv6.type).toBe('IP-CIDR');
      expect(singleIpv6.value).toBe('2001:db8::1/128');
      expect(singleIpv6.isIpType).toBe(true);
      expect(singleIpv6.friendly.typeKey).toBe('ruleType.IP-CIDR-SINGLE');
      expect(formatFullSubtitle(singleIpv6.friendly, tZhCN)).toBe('IP 地址 · 2001:db8::1');
    }

    const port = previewRuleInputFriendly('1-79');
    expect(port?.ok).toBe(true);
    if (port?.ok) {
      expect(port.type).toBe('DST-PORT');
      expect(port.value).toBe('1-79');
    }

    const professional = previewRuleInputFriendly('IP-CIDR6,fd00::/8,no-resolve');
    expect(professional?.ok).toBe(true);
    if (professional?.ok) {
      expect(professional.type).toBe('IP-CIDR');
      expect(professional.value).toBe('fd00::/8');
      expect(professional.hasNoResolve).toBe(true);
      expect(professional.friendly.inlineKey).toBe('ruleInline.ipv6Range');
    }

    const forced = previewRuleInputFriendly('example.com', 'DOMAIN');
    expect(forced?.ok).toBe(true);
    if (forced?.ok) {
      expect(forced.type).toBe('DOMAIN');
      expect(forced.friendly.typeKey).toBe('ruleType.DOMAIN');
    }

    const invalid = previewRuleInputFriendly('# comment');
    expect(invalid?.ok).toBe(false);
  });

  it('formats canonical raw rule lines and identifies IP CIDR rule types', () => {
    expect(formatRawRuleLine({ type: 'DOMAIN-SUFFIX', value: 'chatgpt.com' })).toBe('DOMAIN-SUFFIX,chatgpt.com');
    expect(formatRawRuleLine({ type: 'IP-CIDR', value: '198.51.100.0/24', options: { noResolve: true } })).toBe(
      'IP-CIDR,198.51.100.0/24,no-resolve',
    );
    expect(isIpCidrRuleType('IP-CIDR')).toBe(true);
    expect(isIpCidrRuleType('IP-CIDR6')).toBe(true);
    expect(isIpCidrRuleType('SRC-IP-CIDR')).toBe(true);
    expect(isIpCidrRuleType('DOMAIN-SUFFIX')).toBe(false);
    expect(isIpCidrRuleType('AUTO')).toBe(false);
  });
});
