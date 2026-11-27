import { describe, expect, it } from 'vitest';
import { BUILTIN_CARDS } from '../../../src/builtin/cards';
import { BUILTIN_CATALOG } from '../../../src/builtin/catalog';
import {
  buildComplexityStarterTemplate,
  buildStarterTemplate,
  STARTER_TEMPLATE_TIERS,
} from '../../../src/builtin/templates';
import {
  CLIENT_CAPABILITIES,
  compileSurge,
  isGroupTypeSupported,
  isRemoteFormatSupported,
  isRuleTypeSupported,
  quoteSurgeParam,
  sanitizeSurgeGroupName,
  sanitizeSurgeNodeName,
  sanitizeSurgeRulesetName,
  sanitizeSurgeUrl,
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
    intervalSec: 3600,
  },
};

const SAMPLE_RULESET_BEHAVIORS = new Map([['custom-direct', { domain: 12, classical: 2, ipcidr: 3 }]]);

function parseSurgeIniSections(content: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string | null = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) continue;
    const match = /^\[([^\]]+)\]$/.exec(line);
    if (match) {
      current = match[1]!;
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current) {
      sections.get(current)!.push(line);
    }
  }
  return sections;
}

describe('client capability matrix (Surge official docs audit)', () => {
  it('matches official Surge capabilities and helper predicates', () => {
    const surge = CLIENT_CAPABILITIES.surge;
    expect(surge.geosite).toBe('none');
    expect(surge.geoip).toBe('native');
    expect(surge.logicalRules).toBe(true);
    expect(surge.remoteRuleset).toBe(true);
    expect(surge.inlineRuleset).toBe(true);
    expect(surge.remoteNodes).toBe('provider');
    expect(surge.nodeRegexFilter).toBe(true);
    expect(surge.groupIcons).toBe(true);
    expect(surge.rejectDrop).toBe(true);
    expect(surge.remoteRulesetField).toBe('RULE-SET');
    expect(surge.remoteNodeField).toBe('policy-path');
    expect(surge.nodeFilterField).toBe('policy-regex-filter');
    expect(surge.nodeExcludeFilterField).toBeNull();
    expect(surge.groupIconField).toBe('icon-url');
    expect(surge.finalRuleKeyword).toBe('FINAL');
    expect(surge.ipV6RuleType).toBe('IP-CIDR6');
    expect(surge.ruleTypeAliases['DST-PORT']).toBe('DEST-PORT');
    expect(surge.ruleTypeAliases['SRC-IP-CIDR']).toBe('SRC-IP');
    expect(surge.supportsRespectRules).toBe(false);
    expect(surge.supportsDnsRedirHost).toBe(false);
    expect(surge.proxyProviderHeadersField).toBeNull();

    // 13 of 15 canonical rule types supported (GEOSITE and DOMAIN-REGEX unsupported; NETWORK maps to PROTOCOL)
    expect(surge.supportedRuleTypes.size).toBe(13);
    expect(isRuleTypeSupported('surge', 'DOMAIN-REGEX')).toBe(false);
    expect(isRuleTypeSupported('surge', 'GEOSITE')).toBe(false);
    expect(isRuleTypeSupported('surge', 'USER-AGENT')).toBe(true);
    expect(isRuleTypeSupported('surge', 'URL-REGEX')).toBe(true);
    expect(isRuleTypeSupported('surge', 'DST-PORT')).toBe(true);
    expect(isRuleTypeSupported('surge', 'SRC-PORT')).toBe(true);
    expect(isRuleTypeSupported('surge', 'SRC-IP-CIDR')).toBe(true);
    expect(isRuleTypeSupported('surge', 'NETWORK')).toBe(true);
    expect(isGroupTypeSupported('surge', 'select')).toBe(true);
    expect(isGroupTypeSupported('surge', 'url-test')).toBe(true);
    expect(isGroupTypeSupported('surge', 'fallback')).toBe(true);
    expect(isGroupTypeSupported('surge', 'load-balance')).toBe(true);
    expect(isRemoteFormatSupported('surge', 'text')).toBe(true);
    expect(isRemoteFormatSupported('surge', 'yaml')).toBe(false);
    expect(isRemoteFormatSupported('surge', 'mrs', 'domain')).toBe(false);
  });
});

describe('compileSurge — 4 starter tiers × (full/minimal) × (select/fallback) snapshots', () => {
  const outputs: readonly OutputProfile[] = ['full', 'minimal'];
  const groupModes: readonly TemplateGroupMode[] = ['select', 'fallback'];

  for (const tier of STARTER_TEMPLATE_TIERS) {
    for (const output of outputs) {
      for (const groupMode of groupModes) {
        it(`matches snapshot and invariants: ${tier} / ${output} / ${groupMode}`, () => {
          const tpl = buildStarterTemplate(tier, { groupMode, output });
          const compiled = compileSurge({
            body: tpl.baseBody,
            cards: BUILTIN_CARDS,
            templateName: tpl.name,
            generatedAt: FIXED_GENERATED_AT,
            catalogIndex: BUILTIN_CATALOG,
            rulesetBehaviors: SAMPLE_RULESET_BEHAVIORS,
            baseUrl: FIXED_BASE_URL,
            slotBindings: STANDARD_SLOT_BINDINGS,
          });

          expect(compiled.client).toBe('surge');
          expect(compiled.output).toBe(output);
          expect(compiled.extension).toBe('.conf');
          expect(compiled.contentType).toBe('text/plain; charset=utf-8');

          const sections = parseSurgeIniSections(compiled.content);
          expect(sections.has('Proxy Group')).toBe(true);
          expect(sections.has('Rule')).toBe(true);

          if (output === 'full') {
            expect(sections.has('General')).toBe(true);
            const generalLines = sections.get('General')!;
            expect(generalLines.some((l) => l.startsWith('dns-server ='))).toBe(true);
            expect(generalLines.some((l) => l.startsWith('proxy-test-url ='))).toBe(true);
          } else {
            expect(sections.has('General')).toBe(false);
            expect(compiled.report.items.some((i) => i.code === 'MINIMAL_OMITTED_SECTIONS')).toBe(true);
          }

          // Groups use policy-path, policy-regex-filter, external-policy-modifier="udp-relay=true"
          const groupLines = sections.get('Proxy Group')!;
          expect(groupLines.some((l) => l.includes('policy-path=https://sub.example.com/airport?token=demo'))).toBe(
            true,
          );
          expect(groupLines.some((l) => l.includes('policy-regex-filter='))).toBe(true);
          expect(groupLines.some((l) => l.includes('external-policy-modifier="udp-relay=true"'))).toBe(true);

          // Rules never contain raw GEOSITE, end with FINAL
          const ruleLines = sections.get('Rule')!;
          expect(ruleLines.some((l) => l.startsWith('GEOSITE,'))).toBe(false);
          expect(ruleLines[ruleLines.length - 1]?.startsWith('FINAL,')).toBe(true);

          // Starter templates convert GEOSITE to self-hosted text RULE-SET and report it
          expect(compiled.report.items.some((i) => i.code === 'GEOSITE_CONVERTED_TO_SELF_HOSTED')).toBe(true);

          expect(compiled.content).toMatchSnapshot();
        });
      }
    }
  }
});

describe('compileSurge — capability matrix coverage & compatibility reporting', () => {
  it('reports every unsupported Surge capability and emits [Proxy], [Ruleset], and multi-slot groups cleanly', () => {
    const customCards: AppCard[] = [
      {
        id: 'surge-compat-card',
        slug: 'surge-compat-card',
        name: 'Surge Compat',
        category: 'other',
        stage: 'app',
        group: {
          type: 'load-balance',
          candidates: [
            { kind: 'slot', slotId: 'slot-a', filter: { include: 'IPLC', exclude: '家宽' } },
            { kind: 'slot', slotId: 'slot-b' },
            { kind: 'slot', slotId: 'slot-inline' },
            { kind: 'builtin', id: 'REJECT-DROP' },
          ],
        },
        matchers: [
          { kind: 'geosite', name: 'openai' },
          { kind: 'remote', url: 'https://rules.example/bad.yaml', behavior: 'classical', format: 'yaml' },
          { kind: 'remote', url: 'https://rules.example/bad.mrs', behavior: 'domain', format: 'mrs' },
          { kind: 'remote', url: 'https://rules.example/good.list', behavior: 'ipcidr', format: 'text' },
          { kind: 'ruleset', ruleSetId: 'inline-rs' },
          {
            kind: 'inline',
            conditions: [
              { op: 'rule', rule: { type: 'DOMAIN-REGEX', value: '^api\\..*\\.example$' } },
              { op: 'rule', rule: { type: 'GEOSITE', value: 'youtube' } },
              { op: 'rule', rule: { type: 'DST-PORT', value: '443' } },
              { op: 'rule', rule: { type: 'SRC-PORT', value: '5353' } },
              { op: 'rule', rule: { type: 'SRC-IP-CIDR', value: '192.168.1.0/24', options: { noResolve: true } } },
              { op: 'rule', rule: { type: 'IP-CIDR', value: '2001:db8::/32', options: { noResolve: true } } },
              { op: 'rule', rule: { type: 'PROCESS-NAME', value: 'curl' } },
              { op: 'rule', rule: { type: 'USER-AGENT', value: 'MyApp, v1 "beta"' } },
              { op: 'rule', rule: { type: 'URL-REGEX', value: '^https://a\\.example/x,y$' } },
              {
                op: 'and',
                items: [
                  { op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'example.com' } },
                  { op: 'rule', rule: { type: 'DST-PORT', value: '8443' } },
                ],
              },
              {
                op: 'and',
                items: [
                  { op: 'rule', rule: { type: 'DOMAIN-REGEX', value: '^bad$' } },
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
        { id: 'slot-a', name: 'Slot A', excludeInfo: true, udp: true },
        { id: 'slot-b', name: 'Slot B', excludeInfo: true, udp: false },
        { id: 'slot-inline', name: 'Inline Slot', excludeInfo: false, udp: true },
        { id: 'slot-unbound', name: 'Unbound Slot', excludeInfo: false, udp: false },
      ],
      regionGroups: [
        {
          id: 'rg-hk',
          name: '🇭🇰 香港',
          region: 'HK',
          type: 'url-test',
          slotId: 'slot-a',
        },
      ],
      cards: [{ cardId: 'surge-compat-card', enabled: true }],
      groupMode: 'select',
      final: { kind: 'card', cardId: 'surge-compat-card' },
      output: 'full',
      dns: {
        mode: 'redir-host',
        respectRules: true,
        defaultNameserver: ['223.5.5.5'],
        nameserver: ['https://dns.alidns.com/dns-query'],
        fakeIpFilter: ['+.lan', '+.local'],
      },
      modules: [
        { id: 'ip-no-resolve', enabled: true },
        { id: 'dns-leak-guard', enabled: true },
      ],
      clientPatches: {
        surge: 'orphan-line-without-section = 1\n[MITM]\nskip-server-cert-verify = true',
      },
    };

    const compiled = compileSurge({
      body,
      cards: customCards,
      generatedAt: FIXED_GENERATED_AT,
      baseUrl: FIXED_BASE_URL,
      rulesetBehaviors: new Map([['inline-rs', { domain: 2 }]]),
      inlineRulePayloads: {
        'ruleset-inline-rs-domain': ['DOMAIN-SUFFIX,inline.example', 'DOMAIN,exact.inline.example'],
      },
      slotBindings: {
        'slot-a': {
          kind: 'http',
          url: 'https://a.example/sub',
          userAgent: 'CustomUA/1.0',
          proxy: 'JumpProxy',
        },
        'slot-b': {
          kind: 'file',
          path: 'local-nodes.list',
        },
        'slot-inline': {
          kind: 'inline',
          proxies: [
            { name: 'SS Node', type: 'ss', server: '1.1.1.1', port: 443, cipher: 'aes-128-gcm', password: 'pw' },
            { name: 'Trojan Node', type: 'trojan', server: '2.2.2.2', port: 443, password: 'tpw', sni: 't.example' },
            { name: 'Unsupported Node', type: 'wireguard-custom', server: '3.3.3.3', port: 51820 },
          ],
        },
      },
    });

    const sections = parseSurgeIniSections(compiled.content);
    const general = sections.get('General')!;
    const proxies = sections.get('Proxy')!;
    const groups = sections.get('Proxy Group')!;
    const rules = sections.get('Rule')!;
    const inlineRuleset = sections.get('Ruleset ruleset-inline-rs-domain')!;
    const mitm = sections.get('MITM')!;

    // 1. [General] converts +.lan -> *.lan, splits encrypted-dns-server
    expect(general).toContain('dns-server = 223.5.5.5, system');
    expect(general).toContain('encrypted-dns-server = https://dns.alidns.com/dns-query');
    expect(general).toContain('always-real-ip = *.lan, *.local');

    // 2. [Proxy] has SS & Trojan inline proxies (with udp-relay=true), skips unsupported protocol with report
    expect(proxies).toHaveLength(2);
    expect(proxies[0]).toBe('SS Node = ss, 1.1.1.1, 443, encrypt-method=aes-128-gcm, password=pw, udp-relay=true');
    expect(proxies[1]).toBe('Trojan Node = trojan, 2.2.2.2, 443, password=tpw, sni=t.example, udp-relay=true');

    // 3. [Proxy Group] handles multi-slot via hidden pool + include-other-group + persistent=true
    const mainGroupLine = groups.find((l) => l.startsWith('Surge Compat ='))!;
    expect(mainGroupLine).toContain('load-balance');
    expect(mainGroupLine).toContain('persistent=true');
    expect(mainGroupLine).toContain('include-other-group=');
    expect(groups.some((l) => l.includes('hidden=true, no-alert=true'))).toBe(true);

    // Verify combined regex filter on synthetic filtered slot group works accurately as RegExp
    const synthLine = groups.find((l) => l.startsWith('Surge Compat 节点 ='))!;
    const regexMatch = /policy-regex-filter="([^"]+)"/.exec(synthLine);
    expect(regexMatch).toBeTruthy();
    const unescapedRegex = regexMatch![1]!
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/^\(\?i\)/, '');
    const jsRe = new RegExp(unescapedRegex, 'i');
    expect(jsRe.test('🇭🇰 香港 IPLC 01')).toBe(true);
    expect(jsRe.test('🇭🇰 香港 IPLC 家宽 01')).toBe(false);
    expect(jsRe.test('剩余流量 IPLC 100GB')).toBe(false);
    expect(jsRe.test('🇭🇰 香港 BGP 01')).toBe(false);

    // 4. [Rule] renames DST-PORT -> DEST-PORT, SRC-IP-CIDR -> SRC-IP, IPv6 -> IP-CIDR6, quotes USER-AGENT/URL-REGEX
    expect(rules).toContain('DEST-PORT,443,Surge Compat');
    expect(rules).toContain('SRC-PORT,5353,Surge Compat');
    expect(rules).toContain('SRC-IP,192.168.1.0/24,Surge Compat');
    expect(rules).toContain('IP-CIDR6,2001:db8::/32,Surge Compat,no-resolve');
    expect(rules).toContain('PROCESS-NAME,curl,Surge Compat');
    expect(rules).toContain('USER-AGENT,"MyApp, v1 \\"beta\\"",Surge Compat');
    expect(rules).toContain('URL-REGEX,"^https://a\\\\.example/x,y$",Surge Compat');
    expect(rules).toContain('AND,((DOMAIN-SUFFIX,example.com),(DEST-PORT,8443)),Surge Compat');
    expect(rules).toContain('RULE-SET,https://rules.example/good.list,Surge Compat,no-resolve,update-interval=28800');
    expect(rules).toContain('RULE-SET,ruleset-inline-rs-domain,Surge Compat');
    expect(rules).toContain(
      'RULE-SET,https://rules.example.com/rules/geosite-openai-surge.list,Surge Compat,update-interval=28800',
    );
    expect(rules[rules.length - 1]).toBe('FINAL,Surge Compat,dns-failed');

    // 5. Inline [Ruleset] section emitted
    expect(inlineRuleset).toEqual(['DOMAIN-SUFFIX,inline.example', 'DOMAIN,exact.inline.example']);

    // 6. Client patch merged [MITM] and warned on orphan line
    expect(mitm).toEqual(['skip-server-cert-verify = true']);

    // 7. Every single unsupported capability is in the compatibility report
    const codes = new Set(compiled.report.items.map((i) => i.code));
    expect(codes.has('UNSUPPORTED_RULE_TYPE')).toBe(true);
    expect(codes.has('UNSUPPORTED_LOGICAL_RULE')).toBe(true);
    expect(codes.has('UNSUPPORTED_REMOTE_FORMAT')).toBe(true);
    expect(codes.has('UNSUPPORTED_PROVIDER_OPTION')).toBe(true);
    expect(codes.has('UNSUPPORTED_DNS_OPTION')).toBe(true);
    expect(codes.has('UNSUPPORTED_CLIENT_FEATURE')).toBe(true);
    expect(codes.has('GEOSITE_CONVERTED_TO_SELF_HOSTED')).toBe(true);
    expect(codes.has('UNBOUND_NODE_SLOT')).toBe(true);
    expect(codes.has('MODULE_SKIPPED')).toBe(true);
    expect(codes.has('INVALID_CLIENT_PATCH')).toBe(true);
    expect(compiled.report.stats.skippedRules).toBeGreaterThanOrEqual(5); // DOMAIN-REGEX, GEOSITE, bad AND, bad yaml, bad mrs
  });
});

describe('compileSurge — INI escaping & anti-injection defenses', () => {
  it('blocks [Section] injection, delimiter injection, comment injection, and quotes special parameter values', () => {
    expect(sanitizeSurgeGroupName('Grp = select, DIRECT\n[Rule]\nFINAL,DIRECT #x ;y //z')).not.toMatch(
      /[\r\n,=[\]"#;]/,
    );
    expect(sanitizeSurgeNodeName('Node[1]=a,b')).not.toMatch(/[\r\n,=[\]"]/);
    expect(sanitizeSurgeRulesetName('../../etc/passwd')).toBe('etc-passwd');
    expect(sanitizeSurgeUrl('https://sub.example/a,b?x=1&y="2"#frag;z\n[Rule]')).toBe(
      'https://sub.example/a%2Cb?x=1&y=%222%22%23frag%3Bz[Rule]',
    );
    expect(quoteSurgeParam('a\\b "c", d=e')).toBe('"a\\\\b \\"c\\", d=e"');

    const cards: AppCard[] = [
      {
        id: 'evil-card',
        slug: 'evil-card',
        name: 'Evil = select, DIRECT\n[MITM]\nhostname = * #pwn',
        category: 'other',
        stage: 'app',
        group: {
          type: 'select',
          candidates: [
            { kind: 'slot', slotId: 'slot-http' },
            { kind: 'slot', slotId: 'slot-inline' },
            { kind: 'card', cardId: 'collision-card' },
          ],
        },
        matchers: [
          {
            kind: 'inline',
            conditions: [
              { op: 'rule', rule: { type: 'DOMAIN', value: 'victim.com,DIRECT\nFINAL,DIRECT' } },
              { op: 'rule', rule: { type: 'USER-AGENT', value: 'UA, "quoted"\n[Rule]\nFINAL,DIRECT' } },
            ],
          },
        ],
      },
      {
        id: 'collision-card',
        slug: 'collision-card',
        name: 'REJECT-DROP',
        category: 'other',
        stage: 'app',
        group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
        matchers: [],
      },
    ];

    const body: TemplateBody = {
      slots: [
        { id: 'slot-http', name: 'Slot\n[General]', excludeInfo: false, udp: false },
        { id: 'slot-inline', name: 'Inline', excludeInfo: false, udp: false },
      ],
      regionGroups: [],
      cards: [
        { cardId: 'evil-card', enabled: true },
        { cardId: 'collision-card', enabled: true },
      ],
      groupMode: 'select',
      final: { kind: 'card', cardId: 'evil-card' },
      output: 'minimal',
      dns: { mode: 'fake-ip' },
      modules: [],
    };

    const compiled = compileSurge({
      body,
      cards,
      templateName: 'Tpl\n[General]\nallow-wifi-access = true',
      generatedAt: '2026-01-01\n[MITM]',
      slotBindings: {
        'slot-http': {
          kind: 'http',
          url: 'https://sub.example/p,1\n[Rule]\nFINAL,DIRECT',
        },
        'slot-inline': {
          kind: 'inline',
          proxies: [
            {
              name: 'Node=1,DIRECT\n[Rule]\nFINAL,DIRECT',
              type: 'ss',
              server: '1.2.3.4\n[MITM]',
              port: 443,
              cipher: 'aes-128-gcm',
              password: 'pw "with" \\slash, and=eq\n[Rule]',
            },
          ],
        },
      },
    });

    const sections = parseSurgeIniSections(compiled.content);

    // Strictly ONLY [Proxy], [Proxy Group], [Rule] sections — zero injected [General] or [MITM] sections!
    expect([...sections.keys()]).toEqual(['Proxy', 'Proxy Group', 'Rule']);

    // Builtin collision renamed
    const groupLines = sections.get('Proxy Group')!;
    expect(groupLines.some((l) => l.startsWith('REJECT-DROP 组 ='))).toBe(true);
    expect(groupLines.some((l) => l.startsWith('REJECT-DROP ='))).toBe(false);

    // Inline proxy password safely quoted & escaped, no injected lines
    const proxyLines = sections.get('Proxy')!;
    expect(proxyLines).toHaveLength(1);
    expect(proxyLines[0]).toContain('password="pw \\"with\\" \\\\slash, and=eq [Rule]"');

    // Exact rule count (2 inline + 1 FINAL) — no injected FINAL,DIRECT line!
    const ruleLines = sections.get('Rule')!;
    expect(ruleLines).toHaveLength(3);
    expect(ruleLines[0]?.startsWith('DOMAIN,victim.comDIRECT FINALDIRECT,')).toBe(true);
    expect(ruleLines[1]?.startsWith('USER-AGENT,"UA, \\"quoted\\" [Rule] FINAL,DIRECT",')).toBe(true);
    expect(ruleLines[2]?.startsWith('FINAL,')).toBe(true);
    expect(ruleLines[2]?.endsWith(',dns-failed')).toBe(true);

    expect(compiled.report.items.some((i) => i.code === 'GROUP_NAME_SANITIZED')).toBe(true);
  });
});

describe('compileSurge — simple complexity starter × (full/minimal) × (select/fallback) snapshots', () => {
  const outputs: readonly OutputProfile[] = ['full', 'minimal'];
  const groupModes: readonly TemplateGroupMode[] = ['select', 'fallback'];

  for (const output of outputs) {
    for (const groupMode of groupModes) {
      it(`matches snapshot and invariants: simple / ${output} / ${groupMode}`, () => {
        const tpl = buildComplexityStarterTemplate('simple', { groupMode, output });
        const compiled = compileSurge({
          body: tpl.baseBody,
          cards: BUILTIN_CARDS,
          templateName: tpl.name,
          generatedAt: FIXED_GENERATED_AT,
          catalogIndex: BUILTIN_CATALOG,
          rulesetBehaviors: SAMPLE_RULESET_BEHAVIORS,
          baseUrl: FIXED_BASE_URL,
          slotBindings: STANDARD_SLOT_BINDINGS,
        });

        expect(compiled.client).toBe('surge');
        expect(compiled.output).toBe(output);
        expect(compiled.extension).toBe('.conf');
        const sections = parseSurgeIniSections(compiled.content);
        expect(sections.has('Proxy Group')).toBe(true);
        expect(sections.has('Rule')).toBe(true);
        const ruleLines = sections.get('Rule')!;
        expect(ruleLines[ruleLines.length - 1]?.startsWith('FINAL,')).toBe(true);

        expect(compiled.content).toMatchSnapshot();
      });
    }
  }
});
