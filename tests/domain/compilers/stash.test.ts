import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { BUILTIN_CARDS } from '../../../src/builtin/cards';
import { BUILTIN_CATALOG } from '../../../src/builtin/catalog';
import { buildStarterTemplate, STARTER_TEMPLATE_TIERS } from '../../../src/builtin/templates';
import {
  CLIENT_CAPABILITIES,
  compileStash,
  isGroupTypeSupported,
  isRemoteFormatSupported,
  isRuleTypeSupported,
  sanitizeStashGroupName,
  sanitizeStashNodeName,
  sanitizeStashProviderKey,
  sanitizeStashRuleValue,
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
    userAgent: 'Stash/3.7.0',
    intervalSec: 3600,
  },
};

const SAMPLE_RULESET_BEHAVIORS = new Map([['custom-direct', { domain: 12, classical: 2, ipcidr: 3 }]]);

describe('client capability matrix (Stash official docs audit)', () => {
  it('matches official Stash capabilities and helper predicates', () => {
    const stash = CLIENT_CAPABILITIES.stash;
    expect(stash.geosite).toBe('partial');
    expect(stash.geoip).toBe('native');
    expect(stash.logicalRules).toBe(true);
    expect(stash.remoteRuleset).toBe(true);
    expect(stash.inlineRuleset).toBe(true);
    expect(stash.remoteNodes).toBe('provider');
    expect(stash.nodeRegexFilter).toBe(true);
    expect(stash.groupIcons).toBe(true);
    expect(stash.rejectDrop).toBe(true);
    expect(stash.remoteRulesetField).toBe('rule-providers');
    expect(stash.remoteNodeField).toBe('proxy-providers');
    expect(stash.nodeFilterField).toBe('filter');
    expect(stash.nodeExcludeFilterField).toBeNull();
    expect(stash.groupIconField).toBe('icon');
    expect(stash.finalRuleKeyword).toBe('MATCH');
    expect(stash.ipV6RuleType).toBe('IP-CIDR6');
    expect(stash.ruleTypeAliases['SRC-IP-CIDR']).toBe('SRC-IP');
    expect(stash.supportsRespectRules).toBe(true);
    expect(stash.requiresProxyServerNameserverWithRespectRules).toBe(true);
    expect(stash.supportsDnsRedirHost).toBe(false);
    expect(stash.proxyProviderHeadersField).toBe('headers');
    expect(stash.supportsProxyProviderExcludeFilter).toBe(false);
    expect(stash.supportsProxyProviderOverrideUdp).toBe(false);

    // All 14 canonical rule types supported
    expect(stash.supportedRuleTypes.size).toBe(14);
    expect(isRuleTypeSupported('stash', 'USER-AGENT')).toBe(true);
    expect(isRuleTypeSupported('stash', 'URL-REGEX')).toBe(true);
    expect(isRuleTypeSupported('stash', 'SRC-IP-CIDR')).toBe(true);
    expect(isRuleTypeSupported('stash', 'SRC-PORT')).toBe(true);
    expect(isGroupTypeSupported('stash', 'select')).toBe(true);
    expect(isGroupTypeSupported('stash', 'url-test')).toBe(true);
    expect(isGroupTypeSupported('stash', 'fallback')).toBe(true);
    expect(isGroupTypeSupported('stash', 'load-balance')).toBe(true);
    expect(isRemoteFormatSupported('stash', 'yaml', 'classical')).toBe(true);
    expect(isRemoteFormatSupported('stash', 'text', 'domain')).toBe(true);
    expect(isRemoteFormatSupported('stash', 'mrs', 'domain')).toBe(true);
    expect(isRemoteFormatSupported('stash', 'mrs', 'ipcidr')).toBe(true);
    expect(isRemoteFormatSupported('stash', 'mrs', 'classical')).toBe(false);
  });
});

describe('compileStash — 4 starter tiers × (full/minimal) × (select/fallback) snapshots', () => {
  const outputs: readonly OutputProfile[] = ['full', 'minimal'];
  const groupModes: readonly TemplateGroupMode[] = ['select', 'fallback'];

  for (const tier of STARTER_TEMPLATE_TIERS) {
    for (const output of outputs) {
      for (const groupMode of groupModes) {
        it(`matches snapshot and invariants: ${tier} / ${output} / ${groupMode}`, () => {
          const tpl = buildStarterTemplate(tier, { groupMode, output });
          const compiled = compileStash({
            body: tpl.baseBody,
            cards: BUILTIN_CARDS,
            templateName: tpl.name,
            generatedAt: FIXED_GENERATED_AT,
            catalogIndex: BUILTIN_CATALOG,
            rulesetBehaviors: SAMPLE_RULESET_BEHAVIORS,
            baseUrl: FIXED_BASE_URL,
            slotBindings: STANDARD_SLOT_BINDINGS,
          });

          expect(compiled.client).toBe('stash');
          expect(compiled.output).toBe(output);
          expect(compiled.extension).toBe('.yaml');

          const doc = parseYaml(compiled.content) as Record<string, unknown>;
          expect(Array.isArray(doc['proxy-groups'])).toBe(true);
          expect(Array.isArray(doc.rules)).toBe(true);
          expect(doc['proxy-providers']).toBeDefined();

          // Stash uses plural `headers` and ICU negative-lookahead `filter` (never `exclude-filter` or `override`)
          const providers = doc['proxy-providers'] as Record<string, Record<string, unknown>>;
          const mainProvider = providers['slot-main'];
          expect(mainProvider?.headers).toEqual({ 'User-Agent': 'Stash/3.7.0' });
          expect(mainProvider?.header).toBeUndefined();
          expect(mainProvider?.['exclude-filter']).toBeUndefined();
          expect(mainProvider?.override).toBeUndefined();
          expect(typeof mainProvider?.filter).toBe('string');

          if (output === 'full') {
            expect(doc.mode).toBe('rule');
            expect(doc.dns).toBeDefined();
            expect(doc['mixed-port']).toBeUndefined();
          } else {
            expect(doc.mode).toBeUndefined();
            expect(doc.dns).toBeUndefined();
            expect(compiled.report.items.some((i) => i.code === 'MINIMAL_OMITTED_SECTIONS')).toBe(true);
          }

          // Final rule must always be MATCH
          const rules = doc.rules as string[];
          expect(rules[rules.length - 1]?.startsWith('MATCH,')).toBe(true);

          // Health-checked groups use `benchmark-url` (Stash official key)
          const groups = doc['proxy-groups'] as Array<Record<string, unknown>>;
          for (const group of groups) {
            if (group.type === 'url-test' || group.type === 'fallback' || group.type === 'load-balance') {
              expect(typeof group['benchmark-url']).toBe('string');
              expect(group.url).toBeUndefined();
            }
          }

          expect(compiled.content).toMatchSnapshot();
        });
      }
    }
  }
});

describe('compileStash — capability matrix coverage & compatibility reporting', () => {
  it('reports every unsupported or partial Stash capability without silent drops', () => {
    const customCards: AppCard[] = [
      {
        id: 'stash-compat-card',
        slug: 'stash-compat-card',
        name: 'Stash Compat',
        category: 'other',
        stage: 'app',
        group: {
          type: 'load-balance',
          candidates: [
            { kind: 'slot', slotId: 'slot-http', filter: { include: 'IPLC', exclude: '过期' } },
            { kind: 'slot', slotId: 'slot-inline', filter: { regions: ['HK'] } },
            { kind: 'builtin', id: 'REJECT-DROP' },
          ],
        },
        matchers: [
          { kind: 'geosite', name: 'openai' },
          { kind: 'remote', url: 'https://rules.example/classical.mrs', behavior: 'classical', format: 'mrs' },
          { kind: 'ruleset', ruleSetId: 'my-inline-rs' },
          {
            kind: 'inline',
            conditions: [
              { op: 'rule', rule: { type: 'SRC-IP-CIDR', value: '192.168.1.0/24', options: { noResolve: true } } },
              { op: 'rule', rule: { type: 'IP-CIDR', value: '2001:db8::/32', options: { noResolve: true } } },
              { op: 'rule', rule: { type: 'SRC-PORT', value: '5353' } },
              { op: 'rule', rule: { type: 'USER-AGENT', value: 'MicroMessenger*' } },
              { op: 'rule', rule: { type: 'URL-REGEX', value: '^https://api\\.example\\.com/v1' } },
              {
                op: 'and',
                items: [
                  { op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'example.com' } },
                  { op: 'rule', rule: { type: 'DST-PORT', value: '443' } },
                ],
              },
            ],
          },
        ],
      },
    ];

    const body: TemplateBody = {
      slots: [
        {
          id: 'slot-http',
          name: 'HTTP Slot',
          excludeInfo: true,
          udp: true,
          healthCheck: { url: 'http://www.gstatic.com/generate_204', intervalSec: 180 },
        },
        {
          id: 'slot-inline',
          name: 'Inline Slot',
          excludeInfo: true,
          udp: true,
        },
        {
          id: 'slot-unbound',
          name: 'Unbound Slot',
          excludeInfo: false,
          udp: false,
        },
      ],
      regionGroups: [],
      cards: [{ cardId: 'stash-compat-card', enabled: true }],
      groupMode: 'select',
      final: { kind: 'card', cardId: 'stash-compat-card' },
      output: 'full',
      dns: {
        mode: 'redir-host',
        respectRules: true,
        defaultNameserver: ['223.5.5.5'],
        nameserver: ['https://dns.alidns.com/dns-query'],
      },
      modules: [{ id: 'dns-leak-guard', enabled: true }],
      clientPatches: {
        stash: 'invalid: [yaml',
      },
    };

    const compiled = compileStash({
      body,
      cards: customCards,
      generatedAt: FIXED_GENERATED_AT,
      baseUrl: FIXED_BASE_URL,
      rulesetBehaviors: new Map([['my-inline-rs', { domain: 2 }]]),
      inlineRulePayloads: {
        'ruleset-my-inline-rs-domain': ['+.inline.example', 'exact.inline.example'],
      },
      slotBindings: {
        'slot-http': {
          kind: 'http',
          url: 'https://airport.example/sub',
          userAgent: 'Stash/3.7',
          proxy: 'CustomRelay',
        },
        'slot-inline': {
          kind: 'inline',
          proxies: [
            { name: '🇭🇰 香港 IEPL 01', type: 'ss', server: '1.1.1.1', port: 443, cipher: 'aes-128-gcm', password: 'p' },
            { name: '🇺🇸 美国 01', type: 'ss', server: '2.2.2.2', port: 443, cipher: 'aes-128-gcm', password: 'p' },
          ],
        },
      },
    });

    const doc = parseYaml(compiled.content) as Record<string, unknown>;
    const rules = doc.rules as string[];
    const dns = doc.dns as Record<string, unknown>;
    const ruleProviders = doc['rule-providers'] as Record<string, Record<string, unknown>>;
    const proxies = doc.proxies as Array<Record<string, unknown>>;
    const groups = doc['proxy-groups'] as Array<Record<string, unknown>>;

    // 1. Rule conversions & all 14 rule types emitted cleanly
    expect(rules).toContain('GEOSITE,openai,Stash Compat');
    expect(rules).toContain('SRC-IP,192.168.1.0/24,Stash Compat'); // SRC-IP-CIDR -> SRC-IP without no-resolve
    expect(rules).toContain('IP-CIDR6,2001:db8::/32,Stash Compat,no-resolve');
    expect(rules).toContain('SRC-PORT,5353,Stash Compat');
    expect(rules).toContain('USER-AGENT,MicroMessenger*,Stash Compat');
    expect(rules).toContain('URL-REGEX,^https://api\\.example\\.com/v1,Stash Compat');
    expect(rules).toContain('AND,((DOMAIN-SUFFIX,example.com),(DST-PORT,443)),Stash Compat');

    // 2. DNS redir-host warned, follow-rule enabled, proxy-server-nameserver inferred
    expect(dns['follow-rule']).toBe(true);
    expect(dns['proxy-server-nameserver']).toEqual(['223.5.5.5']);
    expect(dns['enhanced-mode']).toBeUndefined();

    // 3. Inline slot emitted in top-level proxies: (not proxy-providers), filtered to HK in group
    expect(proxies).toHaveLength(2);
    expect(proxies[0]?.udp).toBe(true);
    expect(groups[0]?.proxies).toContain('🇭🇰 香港 IEPL 01');
    expect(groups[0]?.proxies).not.toContain('🇺🇸 美国 01');
    expect(groups[0]?.proxies).toContain('REJECT-DROP');
    expect(groups[0]?.filter).toBe('(?i)^(?!.*(?:过期)).*(?:IPLC)');

    // 4. Inline rule-provider emitted with type: inline; mrs classical downgraded to yaml
    expect(ruleProviders['ruleset-my-inline-rs-domain']).toEqual({
      type: 'inline',
      behavior: 'domain',
      payload: ['+.inline.example', 'exact.inline.example'],
    });
    const mrsDowngraded = Object.values(ruleProviders).find((p) => p.url === 'https://rules.example/classical.mrs');
    expect(mrsDowngraded?.format).toBe('yaml');

    // 5. Every single unsupported/partial capability is explicitly reported
    const codes = new Set(compiled.report.items.map((i) => i.code));
    expect(codes.has('UNSUPPORTED_DNS_OPTION')).toBe(true);
    expect(codes.has('PROXY_SERVER_NAMESERVER_INFERRED')).toBe(true);
    expect(codes.has('UNSUPPORTED_PROVIDER_OPTION')).toBe(true);
    expect(codes.has('UNBOUND_NODE_SLOT')).toBe(true);
    expect(codes.has('MRS_CLASSICAL_DOWNGRADED')).toBe(true);
    expect(codes.has('PARTIAL_GEOSITE_SUPPORT')).toBe(true);
    expect(codes.has('MODULE_SKIPPED')).toBe(true);
    expect(codes.has('INVALID_CLIENT_PATCH')).toBe(true);

    // Specifically verify proxy fetch routing, override.udp, healthCheck, and inline provider notices
    const providerMessages = compiled.report.items
      .filter((i) => i.code === 'UNSUPPORTED_PROVIDER_OPTION')
      .map((i) => i.message)
      .join('\n');
    expect(providerMessages).toContain('override.udp');
    expect(providerMessages).toContain('health-check');
    expect(providerMessages).toContain('proxy');
    expect(providerMessages).toContain('type: inline');
  });
});

describe('compileStash — escaping & anti-injection defenses', () => {
  it('sanitizes control chars, commas, YAML traps, path traversal keys, and malicious rule/node/header inputs', () => {
    expect(sanitizeStashGroupName('Group,DIRECT\nrules:\n  - MATCH,DIRECT')).toBe(
      'Group，DIRECT rules:   - MATCH，DIRECT',
    );
    expect(sanitizeStashNodeName('HK,01\r\nEvil')).toBe('HK，01 Evil');
    expect(sanitizeStashProviderKey('../../etc/passwd')).toBe('etc-passwd');
    expect(sanitizeStashRuleValue('evil.com,DIRECT\nMATCH,DIRECT')).toBe('evil.comDIRECT MATCHDIRECT');

    const cards: AppCard[] = [
      {
        id: 'evil-card',
        slug: 'evil-card',
        name: 'Evil,DIRECT\nallow-lan: true #injected',
        category: 'other',
        stage: 'app',
        group: {
          type: 'select',
          candidates: [
            { kind: 'slot', slotId: '../../evil-http' },
            { kind: 'slot', slotId: '../../evil-inline' },
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
        name: 'true',
        category: 'other',
        stage: 'app',
        group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
        matchers: [],
      },
      {
        id: 'collision-card',
        slug: 'collision-card',
        name: 'DIRECT',
        category: 'other',
        stage: 'app',
        group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
        matchers: [],
      },
    ];

    const body: TemplateBody = {
      slots: [
        { id: '../../evil-http', name: 'HTTP\nmode: global', excludeInfo: false, udp: false },
        { id: '../../evil-inline', name: 'Inline\nproxies: []', excludeInfo: false, udp: false },
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

    const compiled = compileStash({
      body,
      cards,
      templateName: 'Tpl\nallow-lan: true',
      generatedAt: '2026-01-01\nmode: global',
      slotBindings: {
        '../../evil-http': {
          kind: 'http',
          url: 'https://sub.example/a\nEvil: true',
          userAgent: 'Stash/3.7\r\nX-Injected: pwn',
        },
        '../../evil-inline': {
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

    // No injected top-level keys (minimal has only proxies, proxy-providers, proxy-groups, rules)
    expect(Object.keys(parsed).sort()).toEqual(['proxies', 'proxy-groups', 'proxy-providers', 'rules']);

    // Provider key sanitized (no path traversal) & header sanitized (no CRLF)
    const proxyProviders = parsed['proxy-providers'] as Record<string, Record<string, unknown>>;
    expect(Object.keys(proxyProviders)).toEqual(['evil-http']);
    const headers = proxyProviders['evil-http']?.headers as Record<string, string>;
    expect(headers['User-Agent']).not.toMatch(/[\r\n]/);

    // Inline nodes are safe strings with no commas or newlines; 'null' remains string
    const proxies = parsed.proxies as Array<Record<string, unknown>>;
    expect(proxies).toHaveLength(2);
    expect(String(proxies[0]?.name)).not.toMatch(/[\r\n,]/);
    expect(proxies[1]?.name).toBe('null');

    // Group names sanitized, YAML boolean string preserved, builtin collision renamed
    const proxyGroups = parsed['proxy-groups'] as Array<Record<string, unknown>>;
    const groupNames = proxyGroups.map((g) => g.name);
    expect(groupNames.every((n) => typeof n === 'string' && !/[\r\n,]/.test(String(n)))).toBe(true);
    expect(groupNames).toContain('true');
    expect(groupNames).toContain('DIRECT 组');
    expect(groupNames).not.toContain('DIRECT');

    // Rules have exact expected count (1 inline + 1 MATCH) and exact comma field counts
    const rules = parsed.rules as string[];
    expect(rules).toHaveLength(2);
    expect(rules[0]?.split(',')).toHaveLength(3);
    expect(rules[1]?.split(',')).toHaveLength(2);
    expect(rules[1]?.startsWith('MATCH,')).toBe(true);

    expect(compiled.report.items.some((i) => i.code === 'GROUP_NAME_SANITIZED')).toBe(true);
  });
});
