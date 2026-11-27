import { describe, expect, it } from 'vitest';
import { RULE_INPUT_TYPE_VALUES, RULE_TYPE_VALUES, ruleSchema, ruleTypeSchema } from '../../src/shared/schemas';

describe('rule schema', () => {
  it('keeps SRC-PORT and includes all 1.1.0 canonical rule types', () => {
    expect(RULE_TYPE_VALUES).toContain('SRC-PORT');
    expect(RULE_TYPE_VALUES).toContain('NETWORK');
    expect(RULE_TYPE_VALUES).toContain('DOMAIN-REGEX');
    expect(RULE_TYPE_VALUES).toContain('PROCESS-NAME');
    expect(RULE_TYPE_VALUES).toContain('USER-AGENT');
    expect(RULE_TYPE_VALUES).toContain('URL-REGEX');
    expect(RULE_TYPE_VALUES).not.toContain('IP-CIDR6');
    expect(RULE_INPUT_TYPE_VALUES).toContain('IP-CIDR6');
  });

  it('normalizes IP-CIDR6 inputs to IP-CIDR on parse', () => {
    expect(ruleTypeSchema.parse('IP-CIDR6')).toBe('IP-CIDR');
    const parsed = ruleSchema.parse({ value: '2400:3200::/32', type: 'IP-CIDR6' });
    expect(parsed.type).toBe('IP-CIDR');
    expect(parsed.enabled).toBe(true);
  });

  it('preserves rule options such as noResolve and omits empty options', () => {
    const withOption = ruleSchema.parse({
      value: '10.0.0.0/8',
      type: 'IP-CIDR',
      options: { noResolve: true },
    });
    expect(withOption.options).toEqual({ noResolve: true });

    const withEmpty = ruleSchema.parse({ value: '10.0.0.0/8', type: 'IP-CIDR', options: {} });
    expect(withEmpty.options).toBeUndefined();

    const withNull = ruleSchema.parse({ value: '10.0.0.0/8', type: 'IP-CIDR', options: null });
    expect(withNull.options).toBeUndefined();
  });

  it('rejects unknown rule types', () => {
    expect(ruleSchema.safeParse({ value: 'a.com', type: 'UNKNOWN' }).success).toBe(false);
  });
});
