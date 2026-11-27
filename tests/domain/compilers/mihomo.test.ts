import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { BUILTIN_CARDS } from '../../../src/builtin/cards';
import { BUILTIN_CATALOG } from '../../../src/builtin/catalog';
import {
  buildComplexityStarterTemplate,
  buildStarterTemplate,
  STARTER_TEMPLATE_TIERS,
} from '../../../src/builtin/templates';
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
    expect(isRuleTypeSupported('mihomo', 'NETWORK')).toBe(true);
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

describe('compileMihomo — 3 starter tiers × (full/minimal) × (select/fallback) snapshots', () => {
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

          if (tier === 'all') {
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

describe('compileMihomo — beta.3 reference template features (T1)', () => {
  it('adds additional-prefix, hidden per-airport groups, and hidden all-nodes group only when multiple slots exist', () => {
    // Single slot: NO additional-prefix and NO airport / all-nodes helper groups
    const singleTpl = buildStarterTemplate('recommended', { output: 'full' });
    const singleCompiled = compileMihomo({
      body: singleTpl.baseBody,
      cards: BUILTIN_CARDS,
      catalogIndex: BUILTIN_CATALOG,
      baseUrl: FIXED_BASE_URL,
      slotBindings: STANDARD_SLOT_BINDINGS,
    });
    const singleDoc = parseYaml(singleCompiled.content) as Record<string, unknown>;
    const singleProviders = singleDoc['proxy-providers'] as Record<string, Record<string, unknown>>;
    expect(
      (singleProviders['slot-main']?.override as Record<string, unknown> | undefined)?.['additional-prefix'],
    ).toBeUndefined();
    const singleGroups = singleDoc['proxy-groups'] as Array<Record<string, unknown>>;
    expect(singleGroups.some((g) => g.name === '🌐 全部节点')).toBe(false);

    // Multiple slots: additional-prefix, hidden per-airport groups, hidden 全部节点, and region/auto spanning all providers
    const multiTpl = buildStarterTemplate('all', { output: 'full' });
    multiTpl.baseBody.slots = [
      { id: 'slot-main', name: '主力机场', excludeInfo: true },
      { id: 'slot-backup', name: '备用机场', excludeInfo: true },
    ];
    const multiCompiled = compileMihomo({
      body: multiTpl.baseBody,
      cards: BUILTIN_CARDS,
      catalogIndex: BUILTIN_CATALOG,
      baseUrl: FIXED_BASE_URL,
      slotBindings: {
        'slot-main': { kind: 'http', url: 'https://example.com/sub/main' },
        'slot-backup': { kind: 'http', url: 'https://example.com/sub/backup' },
      },
    });
    const multiDoc = parseYaml(multiCompiled.content) as Record<string, unknown>;
    const providers = multiDoc['proxy-providers'] as Record<string, Record<string, unknown>>;
    expect((providers['slot-main']?.override as Record<string, unknown>)?.['additional-prefix']).toBe('主力机场 · ');
    expect((providers['slot-backup']?.override as Record<string, unknown>)?.['additional-prefix']).toBe('备用机场 · ');

    const groups = multiDoc['proxy-groups'] as Array<Record<string, unknown>>;
    const mainAirportGroup = groups.find((g) => g.name === '主力机场');
    const backupAirportGroup = groups.find((g) => g.name === '备用机场');
    const allNodesGroup = groups.find((g) => g.name === '🌐 全部节点');
    expect(mainAirportGroup).toMatchObject({
      type: 'url-test',
      hidden: true,
      use: ['slot-main'],
      lazy: true,
      timeout: 5000,
      'expected-status': 204,
    });
    expect(backupAirportGroup).toMatchObject({
      type: 'url-test',
      hidden: true,
      use: ['slot-backup'],
      lazy: true,
      timeout: 5000,
      'expected-status': 204,
    });
    expect(allNodesGroup).toMatchObject({
      type: 'select',
      hidden: true,
      use: ['slot-main', 'slot-backup'],
    });

    const proxySelect = groups.find((g) => g.name === '🚀 节点选择');
    expect(proxySelect?.proxies).toContain('主力机场');
    expect(proxySelect?.proxies).toContain('备用机场');
    expect(proxySelect?.proxies).toContain('🌐 全部节点');

    const autoSelect = groups.find((g) => g.name === '⚡ 自动选择');
    expect(autoSelect?.use).toEqual(['slot-main', 'slot-backup']);

    const hkRegion = groups.find((g) => g.name === '🇭🇰 香港节点');
    expect(hkRegion?.use).toEqual(['slot-main', 'slot-backup']);
    expect(hkRegion?.hidden).toBe(true);
  });

  it('injects default QureColor icons for recognized groups, honors custom iconPack & mirror, and omits icon for unrecognized groups', () => {
    const customCard: AppCard = {
      id: 'mystery-custom-group',
      slug: 'mystery-custom-group',
      name: '🛸 未知神秘分组',
      category: 'other',
      stage: 'app',
      group: { type: 'select', candidates: [{ kind: 'card', cardId: 'proxy-select' }] },
      matchers: [],
    };
    const tpl = buildStarterTemplate('less', { output: 'minimal' });
    tpl.baseBody.cards.push({ cardId: 'mystery-custom-group', enabled: true });

    const compiled = compileMihomo({
      body: tpl.baseBody,
      cards: [...BUILTIN_CARDS, customCard],
      catalogIndex: BUILTIN_CATALOG,
      baseUrl: FIXED_BASE_URL,
      githubMirrorUrl: 'https://ghproxy.example.com',
      slotBindings: STANDARD_SLOT_BINDINGS,
    });

    const doc = parseYaml(compiled.content) as Record<string, unknown>;
    const groups = doc['proxy-groups'] as Array<Record<string, unknown>>;

    const proxySelect = groups.find((g) => g.name === '🚀 节点选择');
    expect(String(proxySelect?.icon)).toMatch(
      /^https:\/\/ghproxy\.example\.com\/https:\/\/raw\.githubusercontent\.com\/Koolson\/Qure\/master\/IconSet\/Color\/Proxy\.png$/,
    );

    const openaiGroup = groups.find((g) => g.name === '🤖 OpenAI / ChatGPT');
    expect(String(openaiGroup?.icon)).toContain('Bot.png');

    // Unrecognized custom group MUST NOT emit icon
    const mysteryGroup = groups.find((g) => g.name === '🛸 未知神秘分组');
    expect(mysteryGroup).toBeDefined();
    expect(mysteryGroup?.icon).toBeUndefined();

    // Custom iconPack overrides default icons
    const customCompiled = compileMihomo({
      body: tpl.baseBody,
      cards: [...BUILTIN_CARDS, customCard],
      catalogIndex: BUILTIN_CATALOG,
      baseUrl: FIXED_BASE_URL,
      slotBindings: STANDARD_SLOT_BINDINGS,
      iconPack: [{ name: 'Proxy', url: 'https://cdn.example.com/icons/custom-proxy.png' }],
    });
    const customDoc = parseYaml(customCompiled.content) as Record<string, unknown>;
    const customGroups = customDoc['proxy-groups'] as Array<Record<string, unknown>>;
    expect(customGroups.find((g) => g.name === '🚀 节点选择')?.icon).toBe(
      'https://cdn.example.com/icons/custom-proxy.png',
    );
  });

  it('keeps recommended tier visible groups around 8-12, hides auxiliary/region groups, and reveals region groups when groupMode=region', () => {
    const recTpl = buildStarterTemplate('recommended', { output: 'full' });
    const recCompiled = compileMihomo({
      body: recTpl.baseBody,
      cards: BUILTIN_CARDS,
      catalogIndex: BUILTIN_CATALOG,
      baseUrl: FIXED_BASE_URL,
      slotBindings: STANDARD_SLOT_BINDINGS,
    });
    const recDoc = parseYaml(recCompiled.content) as Record<string, unknown>;
    const recGroups = recDoc['proxy-groups'] as Array<Record<string, unknown>>;
    const visibleRecGroups = recGroups.filter((g) => g.hidden !== true);
    expect(visibleRecGroups.length).toBeGreaterThanOrEqual(8);
    expect(visibleRecGroups.length).toBeLessThanOrEqual(12);
    expect(recGroups.find((g) => g.name === '🏠 局域网直连')?.hidden).toBe(true);
    expect(recGroups.find((g) => g.name === '🇨🇳 国内直连')?.hidden).toBe(true);
    expect(recGroups.find((g) => g.name === '🐟 漏网之鱼')?.hidden).toBeUndefined();

    // groupMode=region reveals region groups
    const regionTpl = buildStarterTemplate('all', { output: 'full' });
    regionTpl.baseBody.wizardMeta = {
      clients: ['mihomo'],
      clientDisplayNames: ['Clash Verge Rev'],
      groupMode: 'region',
      hasSubscription: true,
    };
    const regionCompiled = compileMihomo({
      body: regionTpl.baseBody,
      cards: BUILTIN_CARDS,
      catalogIndex: BUILTIN_CATALOG,
      baseUrl: FIXED_BASE_URL,
      slotBindings: STANDARD_SLOT_BINDINGS,
    });
    const regionDoc = parseYaml(regionCompiled.content) as Record<string, unknown>;
    const regionGroups = regionDoc['proxy-groups'] as Array<Record<string, unknown>>;
    expect(regionGroups.find((g) => g.name === '🇭🇰 香港节点')?.hidden).toBeUndefined();
    expect(regionGroups.find((g) => g.name === '🇺🇸 美国节点')?.hidden).toBeUndefined();
  });

  it('emits modern mihomo DNS (nameserver-policy, proxy-server-nameserver, respect-rules, no fallback), sniffer, profile, and health-check defaults', () => {
    const tpl = buildStarterTemplate('recommended', { output: 'full', groupMode: 'fallback' });
    const compiled = compileMihomo({
      body: tpl.baseBody,
      cards: BUILTIN_CARDS,
      catalogIndex: BUILTIN_CATALOG,
      baseUrl: FIXED_BASE_URL,
      slotBindings: STANDARD_SLOT_BINDINGS,
    });
    const doc = parseYaml(compiled.content) as Record<string, unknown>;

    expect(doc['mixed-port']).toBe(7890);
    expect(doc['external-controller']).toBeUndefined();
    expect(doc.secret).toBeUndefined();
    expect(doc.profile).toEqual({ 'store-selected': true, 'store-fake-ip': true });

    const dns = doc.dns as Record<string, unknown>;
    expect(dns.enable).toBe(true);
    expect(dns['enhanced-mode']).toBe('fake-ip');
    expect(dns['respect-rules']).toBe(true);
    expect(dns['proxy-server-nameserver']).toEqual(['https://dns.alidns.com/dns-query', 'https://doh.pub/dns-query']);
    expect(dns['nameserver-policy']).toEqual({
      'geosite:cn': ['https://dns.alidns.com/dns-query', 'https://doh.pub/dns-query'],
      'geosite:private': ['https://dns.alidns.com/dns-query', 'https://doh.pub/dns-query'],
    });
    expect(dns.fallback).toBeUndefined();
    expect(dns['fallback-filter']).toBeUndefined();

    const sniffer = doc.sniffer as Record<string, unknown>;
    expect(sniffer.enable).toBe(true);
    expect((sniffer.sniff as Record<string, unknown>).HTTP).toBeDefined();
    expect((sniffer.sniff as Record<string, unknown>).TLS).toBeDefined();
    expect((sniffer.sniff as Record<string, unknown>).QUIC).toBeDefined();
    expect(sniffer['skip-domain']).toContain('+.push.apple.com');
    expect(sniffer['skip-domain']).toContain('+.lan');

    const providers = doc['proxy-providers'] as Record<string, Record<string, unknown>>;
    expect(providers['slot-main']?.['health-check']).toMatchObject({
      enable: true,
      lazy: true,
      timeout: 5000,
      'expected-status': 204,
    });

    const groups = doc['proxy-groups'] as Array<Record<string, unknown>>;
    const urlTestOrFallback = groups.filter((g) => g.type === 'url-test' || g.type === 'fallback');
    expect(urlTestOrFallback.length).toBeGreaterThan(0);
    for (const g of urlTestOrFallback) {
      expect(g.lazy).toBe(true);
      expect(g.timeout).toBe(5000);
      expect(g['expected-status']).toBe(204);
    }
  });

  it('compiles built-in geosite/geoip to MetaCubeX .mrs rule-providers with mirror support, falls back for unknown entries & legacyGeodata mode, and keeps user rulesets as yaml', () => {
    const mixedCard: AppCard = {
      id: 'mixed-geo-test',
      slug: 'mixed-geo-test',
      name: '🧪 规则来源测试',
      category: 'other',
      stage: 'app',
      group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
      matchers: [
        { kind: 'geosite', name: 'openai' },
        { kind: 'geosite', name: 'unknown-custom-site' },
        { kind: 'geoip', name: 'cn', noResolve: true },
        { kind: 'geoip', name: 'unknown-region-ip', noResolve: true },
        { kind: 'ruleset', ruleSetId: 'my-own-rules' },
      ],
    };

    const baseBody: TemplateBody = {
      slots: [],
      regionGroups: [],
      cards: [{ cardId: 'mixed-geo-test', enabled: true }],
      groupMode: 'select',
      final: { kind: 'builtin', id: 'DIRECT' },
      output: 'minimal',
      dns: { mode: 'fake-ip' },
      modules: [],
    };

    // Default mode: built-in geosite/geoip -> MetaCubeX .mrs with GitHub mirror; unknown -> GEOSITE/GEOIP; user ruleset -> self-hosted yaml
    const compiled = compileMihomo({
      body: baseBody,
      cards: [mixedCard],
      baseUrl: FIXED_BASE_URL,
      githubMirrorUrl: 'https://ghproxy.example.com',
      rulesetBehaviors: new Map([['my-own-rules', { domain: 0, classical: 4, ipcidr: 0 }]]),
    });
    const doc = parseYaml(compiled.content) as Record<string, unknown>;
    const ruleProviders = doc['rule-providers'] as Record<string, Record<string, unknown>>;
    const rules = doc.rules as string[];

    expect(ruleProviders['geosite-openai']).toMatchObject({
      type: 'http',
      behavior: 'domain',
      format: 'mrs',
      url: 'https://ghproxy.example.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/openai.mrs',
    });
    expect(ruleProviders['geoip-cn']).toMatchObject({
      type: 'http',
      behavior: 'ipcidr',
      format: 'mrs',
      url: 'https://ghproxy.example.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/cn.mrs',
    });
    // User's own ruleset stays self-hosted yaml classical (NOT rewritten by GitHub mirror)
    expect(ruleProviders['ruleset-my-own-rules-classical']).toMatchObject({
      type: 'http',
      behavior: 'classical',
      format: 'yaml',
      url: 'https://rules.example.com/sub/my-own-rules/clash-classical',
    });

    expect(rules).toContain('RULE-SET,geosite-openai,🧪 规则来源测试');
    expect(rules).toContain('GEOSITE,unknown-custom-site,🧪 规则来源测试');
    expect(rules).toContain('RULE-SET,geoip-cn,🧪 规则来源测试,no-resolve');
    expect(rules).toContain('GEOIP,UNKNOWN-REGION-IP,🧪 规则来源测试,no-resolve');
    expect(rules).toContain('RULE-SET,ruleset-my-own-rules-classical,🧪 规则来源测试');

    // Compatibility mode (legacyGeodata: true): all geosite/geoip fall back to GEOSITE/GEOIP
    const legacyCompiled = compileMihomo({
      body: { ...baseBody, legacyGeodata: true },
      cards: [mixedCard],
      baseUrl: FIXED_BASE_URL,
      githubMirrorUrl: 'https://ghproxy.example.com',
      rulesetBehaviors: new Map([['my-own-rules', { domain: 0, classical: 4, ipcidr: 0 }]]),
    });
    const legacyDoc = parseYaml(legacyCompiled.content) as Record<string, unknown>;
    const legacyProviders = legacyDoc['rule-providers'] as Record<string, Record<string, unknown>>;
    const legacyRules = legacyDoc.rules as string[];

    expect(legacyProviders['geosite-openai']).toBeUndefined();
    expect(legacyProviders['geoip-cn']).toBeUndefined();
    expect(legacyProviders['ruleset-my-own-rules-classical']).toBeDefined();
    expect(legacyRules).toContain('GEOSITE,openai,🧪 规则来源测试');
    expect(legacyRules).toContain('GEOSITE,unknown-custom-site,🧪 规则来源测试');
    expect(legacyRules).toContain('GEOIP,CN,🧪 规则来源测试,no-resolve');
    expect(legacyRules).toContain('GEOIP,UNKNOWN-REGION-IP,🧪 规则来源测试,no-resolve');
  });

  it('reveals per-airport groups and all-nodes group when combineMode=perProvider and compiles cleanly with zero slots', () => {
    const multiTpl = buildStarterTemplate('standard', { output: 'minimal' });
    multiTpl.baseBody.combineMode = 'perProvider';
    multiTpl.baseBody.slots = [
      { id: 'slot-main', name: '主力机场', excludeInfo: true, udp: true },
      { id: 'slot-2', name: '备用机场', excludeInfo: true, udp: true },
    ];
    const perProviderCompiled = compileMihomo({
      body: multiTpl.baseBody,
      cards: BUILTIN_CARDS,
      catalogIndex: BUILTIN_CATALOG,
      baseUrl: FIXED_BASE_URL,
      slotBindings: {
        'slot-main': { kind: 'http', url: 'https://airport-a.example.com/sub' },
        'slot-2': { kind: 'http', url: 'https://airport-b.example.com/sub' },
      },
    });
    const perProviderDoc = parseYaml(perProviderCompiled.content) as Record<string, unknown>;
    const groups = perProviderDoc['proxy-groups'] as Array<Record<string, unknown>>;
    expect(groups.find((g) => g.name === '主力机场')?.hidden).toBeUndefined();
    expect(groups.find((g) => g.name === '备用机场')?.hidden).toBeUndefined();
    expect(groups.find((g) => g.name === '🌐 全部节点')?.hidden).toBeUndefined();

    // Deleting the last slot leaves template compilable without throwing
    const emptyTpl = buildStarterTemplate('standard', { output: 'full' });
    emptyTpl.baseBody.slots = [];
    const emptyCompiled = compileMihomo({
      body: emptyTpl.baseBody,
      cards: BUILTIN_CARDS,
      catalogIndex: BUILTIN_CATALOG,
      baseUrl: FIXED_BASE_URL,
    });
    const emptyDoc = parseYaml(emptyCompiled.content) as Record<string, unknown>;
    expect(emptyDoc['proxy-providers']).toBeUndefined();
    expect(Array.isArray(emptyDoc['proxy-groups'])).toBe(true);
    expect(Array.isArray(emptyDoc.rules)).toBe(true);
  });
});

describe('compileMihomo — simple complexity starter × (full/minimal) × (select/fallback) snapshots', () => {
  const outputs: readonly OutputProfile[] = ['full', 'minimal'];
  const groupModes: readonly TemplateGroupMode[] = ['select', 'fallback'];

  for (const output of outputs) {
    for (const groupMode of groupModes) {
      it(`matches snapshot and 3-visible-group invariants: simple / ${output} / ${groupMode}`, () => {
        const tpl = buildComplexityStarterTemplate('simple', { groupMode, output });
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
        const proxyGroups = doc['proxy-groups'] as Array<Record<string, unknown>>;
        const visibleGroups = proxyGroups.filter((g) => g.hidden !== true);
        expect(visibleGroups.map((g) => g.name)).toEqual(['🚀 代理', '🎯 直连', '🚫 拦截']);

        const rules = doc.rules as string[];
        expect(rules[rules.length - 1]?.startsWith('MATCH,')).toBe(true);
        const lanIdx = rules.findIndex((r) => r.includes('lan') || r.includes('private'));
        const adIdx = rules.findIndex((r) => r.includes('ads'));
        const cnIdx = rules.findIndex((r) => r.includes('geoip-cn') || r.includes('GEOIP,CN'));
        expect(lanIdx).toBeGreaterThanOrEqual(0);
        expect(adIdx).toBeGreaterThan(lanIdx);
        expect(cnIdx).toBeGreaterThan(adIdx);

        expect(compiled.content).toMatchSnapshot();
      });
    }
  }

  it('keeps DIRECT and REJECT out of all speed-test groups in pro/advanced/simple default compilations', () => {
    const forbidden = new Set(['DIRECT', 'REJECT', 'REJECT-DROP']);
    const speedTestTypes = new Set(['url-test', 'fallback', 'load-balance']);

    for (const complexity of ['simple', 'advanced', 'pro'] as const) {
      const tpl = buildComplexityStarterTemplate(complexity);
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

      const doc = parseYaml(compiled.content) as Record<string, unknown>;
      const proxyGroups = doc['proxy-groups'] as Array<Record<string, unknown>>;
      for (const group of proxyGroups) {
        if (speedTestTypes.has(String(group.type))) {
          const members = Array.isArray(group.proxies) ? group.proxies.map(String) : [];
          for (const member of members) {
            expect(forbidden.has(member), `${complexity} group ${group.name} contains ${member}`).toBe(false);
          }
          expect(group['empty-fallback']).toBeUndefined();
        }
      }
    }
  });
});
