import { describe, expect, it } from 'vitest';
import {
  describeRuleFriendly,
  formatRawRuleLine,
  getAllRuleTypeOptions,
  isIpCidrRuleType,
  previewRuleInputFriendly,
} from '../../../src/domain/rules/friendly';
import { RULE_TYPES } from '../../../src/domain/rules/rule-types';
import type { DomainRuleType } from '../../../src/types/domain-rules';
import { en } from '../../../src/web/i18n/en';
import { zhCNPages } from '../../../src/web/i18n/zh-CN.pages';

describe('domain/rules/friendly', () => {
  it('covers all 14 rule types with typeKey, descriptionKey, and inlineKey', () => {
    expect(RULE_TYPES).toHaveLength(14);
    const options = getAllRuleTypeOptions();
    expect(options).toHaveLength(14);
    expect(options.map((item) => item.type)).toEqual(RULE_TYPES);

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
      expect(descriptor.typeKey).toBe(`ruleType.${type}`);
      expect(descriptor.descriptionKey).toBe(`ruleTypeDesc.${type}`);
      expect(descriptor.params.value).toBe(value);
      expect(descriptor.params.displayValue).toBe(value);

      if (type === 'DOMAIN-SUFFIX') {
        expect(descriptor.inlineKey).toBe('ruleInline.domainSuffix');
      } else if (type === 'DOMAIN-KEYWORD') {
        expect(descriptor.inlineKey).toBe('ruleInline.domainKeyword');
      } else {
        expect(descriptor.inlineKey).toBe('ruleInline.typedValue');
      }

      // Verify i18n keys exist in zh-CN and en dictionaries
      expect(zhCNPages[descriptor.typeKey]).toBeTruthy();
      expect(en[descriptor.typeKey]).toBeTruthy();
      expect(zhCNPages[descriptor.descriptionKey]).toBeTruthy();
      expect(en[descriptor.descriptionKey]).toBeTruthy();
      expect(zhCNPages[descriptor.inlineKey]).toBeTruthy();
      expect(en[descriptor.inlineKey]).toBeTruthy();
    }
  });

  it('maps single-host IPv4 /32 and IPv6 /128 IP-CIDR rules to single IP descriptor', () => {
    const v4 = describeRuleFriendly({ type: 'IP-CIDR', value: '1.1.1.1/32' });
    expect(v4.typeKey).toBe('ruleType.IP-CIDR-SINGLE');
    expect(v4.inlineKey).toBe('ruleInline.singleIp');
    expect(v4.params).toEqual({ value: '1.1.1.1/32', displayValue: '1.1.1.1' });

    const v6 = describeRuleFriendly({ type: 'IP-CIDR', value: '2001:db8::1/128' });
    expect(v6.typeKey).toBe('ruleType.IP-CIDR-SINGLE');
    expect(v6.inlineKey).toBe('ruleInline.singleIp');
    expect(v6.params).toEqual({ value: '2001:db8::1/128', displayValue: '2001:db8::1' });

    const cidr = describeRuleFriendly({ type: 'IP-CIDR', value: '198.51.100.0/24' });
    expect(cidr.typeKey).toBe('ruleType.IP-CIDR');
    expect(cidr.inlineKey).toBe('ruleInline.typedValue');
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
      expect(ip.friendly.typeKey).toBe('ruleType.IP-CIDR');
    }

    const singleIp = previewRuleInputFriendly('8.8.8.8');
    expect(singleIp?.ok).toBe(true);
    if (singleIp?.ok) {
      expect(singleIp.type).toBe('IP-CIDR');
      expect(singleIp.value).toBe('8.8.8.8/32');
      expect(singleIp.isIpType).toBe(true);
      expect(singleIp.friendly.typeKey).toBe('ruleType.IP-CIDR-SINGLE');
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
