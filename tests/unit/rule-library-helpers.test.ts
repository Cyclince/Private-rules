import { describe, expect, it } from 'vitest';
import type { DomainRuleType } from '../../src/types/domain-rules';
import { formatRuleResolveHint } from '../../src/web/components/rulesets/rule-library-helpers';
import { en } from '../../src/web/i18n/en';
import { zhCN } from '../../src/web/i18n/zh-CN';
import { zhTW } from '../../src/web/i18n/zh-TW';

const ipTypes: DomainRuleType[] = ['IP-CIDR', 'SRC-IP-CIDR', 'IP-ASN', 'GEOIP'];

describe('friendly rule DNS subtitles', () => {
  it.each(ipTypes)('%s shows no extra words with noResolve enabled', (type) => {
    expect(formatRuleResolveHint({ type, options: { noResolve: true } }, (key) => zhCN[key])).toBe('');
  });

  it.each(ipTypes)('%s only explains DNS resolution when noResolve is off or absent', (type) => {
    for (const options of [{ noResolve: false }, undefined]) {
      expect(formatRuleResolveHint({ type, options }, (key) => zhCN[key])).toBe('会解析域名');
    }
  });

  it('localizes the hint and never leaks the raw no-resolve token', () => {
    expect(formatRuleResolveHint({ type: 'IP-CIDR' }, (key) => en[key])).toBe('Resolves domain names');
    expect(formatRuleResolveHint({ type: 'IP-CIDR' }, (key) => zhTW[key])).toBe('會解析域名');
    for (const noResolve of [true, false]) {
      expect(formatRuleResolveHint({ type: 'DOMAIN-SUFFIX', options: { noResolve } }, (key) => zhCN[key])).toBe('');
    }
  });
});
