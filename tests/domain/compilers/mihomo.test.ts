import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { BUILTIN_CARDS } from '../../../src/builtin/cards';
import { BUILTIN_CATALOG } from '../../../src/builtin/catalog';
import { buildStarterTemplate, STARTER_TEMPLATE_TIERS } from '../../../src/builtin/templates';
import {
  CLIENT_CAPABILITIES,
  compileMihomo,
  isGroupTypeSupported,
  isRemoteFormatSupported,
  isRuleTypeSupported,
  sanitizeMihomoGroupName,
  sanitizeMihomoNodeName,
  sanitizeMihomoProviderKey,
  type AppCard,
  type TemplateBody,
} from '../../../src/domain/templates';
import type { OutputProfile } from '../../../src/shared/clients';
import type { TemplateGroupMode } from '../../../src/shared/schemas/template';

const FIXED_GENERATED_AT = '2026-01-01T00:00:00.000Z';
const FIXED_BASE_URL = 'https://rules.example.com';

const STANDARD_SLOT_BINDINGS = {
  'slot-main': {
    kind: 'http' as const,
    url: 'https://sub.example.com/airport?token=demo',
    userAgent: 'clash-verge/v2.5.1',
    intervalSec: 3600,
  },
};

const SAMPLE_RULESET_BEHAVIORS = new Map([['custom-direct', { domain: 12, classical: 2, ipcidr: 3 }]]);

describe('client capability matrix (mihomo official fields)', () => {
  it('matches official mihomo field semantics and helper predicates', () => {
    const mihomo = CLIENT_CAPABILITIES.mihomo;
    expect(mihomo.geosite).toBe('native');
    expect(mihomo.geoip).toBe('native');
    expect(mihomo.logicalRules).toBe(true);
    expect(mihomo.remoteRuleset).toBe(true);
    expect(mihomo.inlineRuleset).toBe(true);
    expect(mihomo.remoteNodes).toBe('provider');
    expect(mihomo.emptyFallback).toBe(false);
    expect(mihomo.emptyFallbackMechanism).toBe('compatible-builtin');
    expect(mihomo.rejectDrop).toBe(true);
    expect(mihomo.remoteRulesetField).toBe('rule-providers');
    expect(mihomo.remoteNodeField).toBe('proxy-providers');
    expect(mihomo.nodeFilterField).toBe('filter');
    expect(mihomo.nodeExcludeFilterField).toBe('exclude-filter');
    expect(mihomo.finalRuleKeyword).toBe('MATCH');
    expect(mihomo.ipV6RuleType).toBe('IP-CIDR6');
    expect(mihomo.noResolveRuleTypes.has('IP-CIDR')).toBe(true);
    expect(mihomo.noResolveRuleTypes.has('GEOIP')).toBe(true);
    expect(mihomo.noResolveRuleTypes.has('SRC-IP-CIDR')).toBe(false);
    expect(mihomo.supportsRespectRules).toBe(true);
    expect(mihomo.requiresProxyServerNameserverWithRespectRules).toBe(true);
    expect(mihomo.supportsProxyProviderExcludeFilter).toBe(true);
    expect(mihomo.supportsProxyProviderOverrideUdp).toBe(true);

    expect(isRuleTypeSupported('mihomo', 'DOMAIN-SUFFIX')).toBe(true);
    expect(isRuleTypeSupported('mihomo', 'USER-AGENT')).toBe(false);
    expect(isRuleTypeSupported('mihomo', 'URL-REGEX')).toBe(false);
    expect(isGroupTypeSupported('mihomo', 'fallback')).toBe(true);
    expect(isGroupTypeSupported('sing-box', 'fallback')).toBe(false);
    expect(isRemoteFormatSupported('mihomo', 'mrs', 'domain')).toBe(true);
    expect(isRemoteFormatSupported('mihomo', 'mrs', 'ipcidr')).toBe(true);
    expect(isRemoteFormatSupported('mihomo', 'mrs', 'classical')).toBe(false);
    expect(isRemoteFormatSupported('mihomo', 'yaml', 'classical')).toBe(true);
  });
});

describe('compileMihomo — 4 starter tiers × (full/minimal) × (select/fallback) snapshots', () => {
  const outputs: readonly OutputProfile[] = ['full', 'minimal'];
  const groupModes: readonly TemplateGroupMode[] = ['select', 'fallback'];

  for (const tier of STARTER_TEMPLATE_TIERS) {
    for (const output of outputs) {
      for (const groupMode of groupModes) {
        it(`matches snapshot and invariants: ${tier} / ${output} / ${groupMode}`, () => {
          const tpl = buildStarterTemplate(tier, { groupMode, output });
          const compiled = compileMihomo({
            body: tpl.baseBody,
            cards: BUILTIN_CARDS,
            templateName: tpl.name,
            generatedAt: FIXED_GENERATED_AT,
            catalogIndex: BUILTIN_CATALOG,
            rulesetBehaviors: SAMPLE_RULESET_BEHAVIORS,
            baseUrl: FIXED_BASE_URL,
            slotBindings: STANDARD_SLOT_BINDINGS,
          });

          expect(compiled.client).toBe('mihomo');
          expect(compiled.output).toBe(output);
          expect(compiled.extension).toBe('.yaml');

          const doc = parseYaml(compiled.content) as Record<string, unknown>;
          expect(doc).toBeTruthy();

          if (output === 'full') {
            expect(doc['mixed-port']).toBe(7890);
            expect(doc.dns).toBeTruthy();
          } else {
            expect(doc['mixed-port']).toBeUndefined();
            expect(doc.dns).toBeUndefined();
          }

          const proxyProviders = (doc['proxy-providers'] ?? {}) as Record<string, Record<string, unknown>>;
          const proxyProviderKeys = new Set(Object.keys(proxyProviders));
          expect(proxyProviderKeys.has('slot-main')).toBe(true);
          expect(proxyProviders['slot-main']?.['exclude-filter']).toBeTypeOf('string');
          expect(proxyProviders['slot-main']?.header).toEqual({ 'User-Agent': ['clash-verge/v2.5.1'] });

          const proxyGroups = doc['proxy-groups'] as Array<Record<string, unknown>>;
          expect(Array.isArray(proxyGroups)).toBe(true);
          expect(proxyGroups.length).toBeGreaterThan(0);

          for (const group of proxyGroups) {
            const hasProxies = Array.isArray(group.proxies) && group.proxies.length > 0;
            const hasUse = Array.isArray(group.use) && group.use.length > 0;
            expect(hasProxies || hasUse).toBe(true);
            if (Array.isArray(group.use)) {
              for (const providerRef of group.use) {
                expect(proxyProviderKeys.has(String(providerRef))).toBe(true);
              }
            }
          }

          // Verify groupMode toggle effect on business groups (e.g. openai / youtube) vs terminal groups
          const adBlock = proxyGroups.find((g) => String(g.name).includes('广告'));
          if (adBlock) expect(adBlock.type).toBe('select');
          const youtube = proxyGroups.find((g) => String(g.name).includes('YouTube'));
          if (youtube) expect(youtube.type).toBe(groupMode);

          const ruleProviders = (doc['rule-providers'] ?? {}) as Record<string, Record<string, unknown>>;
          const ruleProviderKeys = new Set(Object.keys(ruleProviders));

          const rules = doc.rules as string[];
          expect(Array.isArray(rules)).toBe(true);
          expect(rules[rules.length - 1]?.startsWith('MATCH,')).toBe(true);

          for (const rule of rules) {
            if (rule.startsWith('RULE-SET,')) {
              const providerKey = rule.split(',')[1]!;
              expect(ruleProviderKeys.has(providerKey)).toBe(true);
            }
          }

          if (tier === 'heavy') {
            expect(rules.some((line) => line.startsWith('NOT,((OR,((DST-PORT,80),(DST-PORT,443)))),'))).toBe(true);
          }

          expect(compiled.content).toMatchSnapshot();
        });
      }
    }
  }
});

describe('compileMihomo — NodeSlot, excludeInfo, behavior split, modules, and compatibility report', () => {
  it('omits exclude-filter when excludeInfo is false and warns on unbound slots', () => {
    const tpl = buildStarterTemplate('minimal', { output: 'minimal' });
    tpl.baseBody.slots[0]!.excludeInfo = false;

    const compiled = compileMihomo({
      body: tpl.baseBody,
      cards: BUILTIN_CARDS,
      catalogIndex: BUILTIN_CATALOG,
    });

    const doc = parseYaml(compiled.content) as Record<string, unknown>;
    const providers = doc['proxy-providers'] as Record<string, Record<string, unknown>>;
    expect(providers['slot-main']?.['exclude-filter']).toBeUndefined();
    expect(compiled.report.items.some((item) => item.code === 'UNBOUND_NODE_SLOT')).toBe(true);
  });

  it('compiles dns-leak-guard module with respect-rules and proxy-server-nameserver (stripping internal metadata)', () => {
    const tpl = buildStarterTemplate('light', { output: 'full' });
    tpl.baseBody.modules = tpl.baseBody.modules.map((mod) =>
      mod.id === 'dns-leak-guard' ? { ...mod, enabled: true } : mod,
    );

    const compiled = compileMihomo({
      body: tpl.baseBody,
      cards: BUILTIN_CARDS,
      catalogIndex: BUILTIN_CATALOG,
      slotBindings: STANDARD_SLOT_BINDINGS,
    });

    const doc = parseYaml(compiled.content) as Record<string, unknown>;
    const dns = doc.dns as Record<string, unknown>;
    expect(dns['respect-rules']).toBe(true);
    expect(Array.isArray(dns['proxy-server-nameserver'])).toBe(true);
    expect((dns['proxy-server-nameserver'] as string[]).length).toBeGreaterThan(0);
    expect(dns.dnsLeakGuard).toBeUndefined();
    expect(dns.proxyServerNameserver).toBeUndefined();

    const rules = doc.rules as string[];
    expect(rules[rules.length - 1]).toBe('MATCH,🔒 防泄漏兜底');
  });

  it('reports unsupported rule types, downgrades mrs+classical, emits IP-CIDR6, and orders split rulesets domain -> classical -> ipcidr', () => {
    const customCard: AppCard = {
      id: 'custom-test',
      slug: 'custom-test',
      name: 'Custom Test',
      category: 'other',
      stage: 'app',
      group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
      matchers: [
        { kind: 'ruleset', ruleSetId: 'my-set' },
        { kind: 'remote', url: 'https://example.com/classic.mrs', behavior: 'classical', format: 'mrs' },
        {
          kind: 'inline',
          conditions: [
            { op: 'rule', rule: { type: 'IP-CIDR', value: '2001:db8::/32', options: { noResolve: true } } },
            { op: 'rule', rule: { type: 'SRC-IP-CIDR', value: '192.168.1.0/24', options: { noResolve: true } } },
            { op: 'rule', rule: { type: 'USER-AGENT', value: '*Bot*' } },
            { op: 'rule', rule: { type: 'URL-REGEX', value: '^https://ads\\.' } },
          ],
        },
      ],
    };

    const body: TemplateBody = {
      slots: [],
      regionGroups: [],
      cards: [{ cardId: 'custom-test', enabled: true }],
      groupMode: 'select',
      final: { kind: 'builtin', id: 'DIRECT' },
      output: 'minimal',
      dns: { mode: 'fake-ip' },
      modules: [{ id: 'ip-no-resolve', enabled: true }],
    };

    const compiled = compileMihomo({
      body,
      cards: [customCard],
      baseUrl: FIXED_BASE_URL,
      rulesetBehaviors: new Map([['my-set', { domain: 5, classical: 2, ipcidr: 3 }]]),
    });

    const doc = parseYaml(compiled.content) as Record<string, unknown>;
    const rules = doc.rules as string[];
    const ruleProviders = doc['rule-providers'] as Record<string, Record<string, unknown>>;

    // Strict domain -> classical -> ipcidr evaluation order with no-resolve only on ipcidr
    const idxDomain = rules.indexOf('RULE-SET,ruleset-my-set-domain,Custom Test');
    const idxClassical = rules.indexOf('RULE-SET,ruleset-my-set-classical,Custom Test');
    const idxIp = rules.indexOf('RULE-SET,ruleset-my-set-ipcidr,Custom Test,no-resolve');
    expect(idxDomain).toBeGreaterThanOrEqual(0);
    expect(idxDomain).toBeLessThan(idxClassical);
    expect(idxClassical).toBeLessThan(idxIp);

    // IPv6 uses IP-CIDR6 with trailing no-resolve; SRC-IP-CIDR does not append no-resolve
    expect(rules).toContain('IP-CIDR6,2001:db8::/32,Custom Test,no-resolve');
    expect(rules).toContain('SRC-IP-CIDR,192.168.1.0/24,Custom Test');

    // mrs + classical downgraded to yaml
    const downgradedProvider = Object.values(ruleProviders).find((p) => p.url === 'https://example.com/classic.mrs');
    expect(downgradedProvider?.format).toBe('yaml');
    expect(compiled.report.items.some((item) => item.code === 'MRS_CLASSICAL_DOWNGRADED')).toBe(true);

    // Unsupported USER-AGENT & URL-REGEX skipped and recorded in compatibility report
    expect(compiled.report.stats.skippedRules).toBe(2);
    expect(compiled.report.items.filter((item) => item.code === 'UNSUPPORTED_RULE_TYPE')).toHaveLength(2);
  });
});

describe('compileMihomo — escaping & anti-YAML-injection security', () => {
  it('sanitizes helper functions against newlines, commas, and path traversal', () => {
    expect(sanitizeMihomoGroupName('Group\nrules:\n  - MATCH,DIRECT')).toBe('Group rules:   - MATCH，DIRECT');
    expect(sanitizeMihomoNodeName('HK,01\r\nDIRECT')).toBe('HK，01 DIRECT');
    expect(sanitizeMihomoProviderKey('../../etc/passwd')).toBe('etc-passwd');
  });

  it('prevents YAML structure injection, anchor abuse, and rule-comma injection across group names, node names, slots, and headers', () => {
    const evilGroupName = 'Evil,DIRECT\nrules:\n  - MATCH,REJECT\n*anchor &alias {a: 1}';
    const yamlScalarTrapName = 'true';
    const builtinCollisionName = 'DIRECT';

    const cards: AppCard[] = [
      {
        id: 'evil-card',
        slug: 'evil-card',
        name: evilGroupName,
        category: 'other',
        stage: 'app',
        group: {
          type: 'select',
          candidates: [
            { kind: 'slot', slotId: '../../evil-slot' },
            { kind: 'card', cardId: 'trap-card' },
            { kind: 'card', cardId: 'collision-card' },
          ],
        },
        matchers: [
          {
            kind: 'inline',
            conditions: [{ op: 'rule', rule: { type: 'DOMAIN', value: 'victim.com,DIRECT\n  - MATCH,DIRECT' } }],
          },
        ],
      },
      {
        id: 'trap-card',
        slug: 'trap-card',
        name: yamlScalarTrapName,
        category: 'other',
        stage: 'app',
        group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
        matchers: [],
      },
      {
        id: 'collision-card',
        slug: 'collision-card',
        name: builtinCollisionName,
        category: 'other',
        stage: 'app',
        group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
        matchers: [],
      },
    ];

    const body: TemplateBody = {
      slots: [
        {
          id: '../../evil-slot',
          name: 'Slot\nproxies: []',
          excludeInfo: true,
        },
      ],
      regionGroups: [],
      cards: [
        { cardId: 'evil-card', enabled: true },
        { cardId: 'trap-card', enabled: true },
        { cardId: 'collision-card', enabled: true },
      ],
      groupMode: 'select',
      final: { kind: 'card', cardId: 'evil-card' },
      output: 'minimal',
      dns: { mode: 'fake-ip' },
      modules: [],
    };

    const compiled = compileMihomo({
      body,
      cards,
      templateName: 'Tpl\nallow-lan: true',
      generatedAt: '2026-01-01\nmode: global',
      slotBindings: {
        '../../evil-slot': {
          kind: 'inline',
          proxies: [
            {
              name: 'Node,DIRECT\n- {name: Pwned, type: direct}',
              type: 'ss',
              server: '1.2.3.4\nport: 1',
              port: 443,
              cipher: 'aes-128-gcm',
              password: 'pass: *x &y !!str #comment',
            },
            {
              name: 'null',
              type: 'ss',
              server: '1.2.3.5',
              port: 443,
              cipher: 'aes-128-gcm',
              password: 'secret',
            },
          ],
        },
      },
    });

    const parsed = parseYaml(compiled.content) as Record<string, unknown>;

    // No injected top-level keys
    expect(Object.keys(parsed).sort()).toEqual(['proxy-groups', 'proxy-providers', 'rules']);

    // Provider key sanitized (no path traversal)
    const proxyProviders = parsed['proxy-providers'] as Record<string, Record<string, unknown>>;
    expect(Object.keys(proxyProviders)).toEqual(['evil-slot']);

    // Inline node names are safe strings with no commas or newlines
    const payload = proxyProviders['evil-slot']?.payload as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(2);
    expect(typeof payload[0]?.name).toBe('string');
    expect(String(payload[0]?.name)).not.toMatch(/[\r\n,]/);
    expect(payload[1]?.name).toBe('null'); // YAML scalar string, NOT JS null!

    // Group names sanitized, YAML boolean string preserved as string, builtin collision renamed
    const proxyGroups = parsed['proxy-groups'] as Array<Record<string, unknown>>;
    const groupNames = proxyGroups.map((g) => g.name);
    expect(groupNames.every((n) => typeof n === 'string' && !/[\r\n,]/.test(String(n)))).toBe(true);
    expect(groupNames).toContain('true');
    expect(groupNames).toContain('DIRECT 组');
    expect(groupNames).not.toContain('DIRECT');

    // Rules have exact expected count (1 inline + 1 MATCH) and exact 3 comma-separated fields
    const rules = parsed.rules as string[];
    expect(rules).toHaveLength(2);
    expect(rules[0]?.split(',')).toHaveLength(3);
    expect(rules[0]?.startsWith('DOMAIN,victim.comDIRECT   - MATCHDIRECT,')).toBe(true);
    expect(rules[1]?.split(',')).toHaveLength(2);
    expect(rules[1]?.startsWith('MATCH,')).toBe(true);

    // Compatibility report recorded the sanitized group names
    expect(compiled.report.items.some((item) => item.code === 'GROUP_NAME_SANITIZED')).toBe(true);
  });
});
