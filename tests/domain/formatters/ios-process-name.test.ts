import { describe, expect, it } from 'vitest';
import { listWithReport, quantumultXWithReport } from '../../../src/domain/formatters';
import type { DomainRule, RuleCategory, RulesData } from '../../../src/types/domain-rules';

const at = '2026-11-27T00:00:00.000Z';

function rule(id: string, type: DomainRule['type'], value: string): DomainRule {
  return { id, type, value, enabled: true, createdAt: at, updatedAt: at };
}

const category: RuleCategory = {
  id: 'cat-ios',
  name: 'iOS Check',
  slug: 'iOS-Check',
  updatedAt: at,
  rules: [
    rule('r1', 'DOMAIN-SUFFIX', 'example.com'),
    rule('r2', 'PROCESS-NAME', 'Telegram.exe'),
    rule('r3', 'IP-CIDR', '203.0.113.0/24'),
  ],
};

const data = { version: 1, settings: { policyName: 'PROXY' } } as unknown as RulesData;

describe('PROCESS-NAME on iOS clients (Loon, Quantumult X)', () => {
  it('omits PROCESS-NAME from the Loon rule file without a comment line, but reports it as skipped', () => {
    const { body, skipped } = listWithReport(category, true);
    expect(body).not.toContain('PROCESS-NAME');
    expect(body).not.toContain('Telegram.exe');
    expect(body).toContain('DOMAIN-SUFFIX,example.com');
    expect(skipped).toEqual([expect.objectContaining({ type: 'PROCESS-NAME', value: 'Telegram.exe' })]);
  });

  it('omits PROCESS-NAME from the Quantumult X rule file without a comment line, but reports it as skipped', () => {
    const { body, skipped } = quantumultXWithReport(category, data);
    expect(body).not.toContain('PROCESS-NAME');
    expect(body).not.toContain('Telegram.exe');
    expect(body).toContain('HOST-SUFFIX,example.com,PROXY');
    expect(skipped).toEqual([expect.objectContaining({ type: 'PROCESS-NAME', value: 'Telegram.exe' })]);
  });

  it('keeps PROCESS-NAME in the generic list used by desktop-capable clients', () => {
    expect(listWithReport(category, false).body).toContain('PROCESS-NAME,Telegram.exe');
  });
});
