import { describe, expect, it } from 'vitest';
import { BUILTIN_CARDS } from '../../../src/builtin/cards';
import { BUILTIN_CATALOG } from '../../../src/builtin/catalog';
import {
  buildComplexityStarterTemplate,
  buildStarterTemplate,
  STARTER_TEMPLATE_TIERS,
} from '../../../src/builtin/templates';
import { CLIENT_REGEX_DIALECTS, compileClientNodeFilter } from '../../../src/domain/nodes';
import {
  CLIENT_CAPABILITIES,
  compileShadowrocket,
  compileTemplate,
  isGroupTypeSupported,
  isRemoteFormatSupported,
  isRuleTypeSupported,
  quoteShadowrocketParam,
  sanitizeShadowrocketGroupName,
  sanitizeShadowrocketNodeName,
  sanitizeShadowrocketRuleValue,
  sanitizeShadowrocketUrl,
  type AppCard,
  type TemplateBody,
} from '../../../src/domain/templates';
import type { OutputProfile } from '../../../src/shared/clients';

const FIXED_GENERATED_AT = '2026-01-01T00:00:00.000Z';
const FIXED_BASE_URL = 'https://rules.example.com';

function parseIniSections(content: string): Map<string, string[]> {
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

describe('client capability matrix (Shadowrocket official docs audit)', () => {
  it('matches official Shadowrocket capabilities and helper predicates', () => {
    const sr = CLIENT_CAPABILITIES.shadowrocket;
    expect(sr.geosite).toBe('none');
    expect(sr.geoip).toBe('native');
    expect(sr.logicalRules).toBe(true);
    expect(sr.remoteRuleset).toBe(true);
    expect(sr.inlineRuleset).toBe(false);
    expect(sr.localFirstRules).toBe(false);
    expect(sr.remoteNodes).toBe('client-managed');
    expect(sr.nodeRegexFilter).toBe(true);
    expect(sr.groupIcons).toBe(false);
    expect(sr.rejectDrop).toBe(true);
    expect(sr.remoteRulesetField).toBe('RULE-SET');
    expect(sr.nodeFilterField).toBe('policy-regex-filter');
    expect(sr.groupIconField).toBeNull();
    expect(sr.finalRuleKeyword).toBe('FINAL');
    expect(sr.ipV6RuleType).toBe('IP-CIDR');
    expect(CLIENT_REGEX_DIALECTS.shadowrocket).toMatchObject({
      engine: 'icu',
      supportsLookahead: true,
      supportsLookbehind: false,
    });

    // 10 of 15 canonical rule types supported (NETWORK emits as PROTOCOL inside AND/OR/NOT logical rules)
    expect(sr.supportedRuleTypes.size).toBe(10);
    expect(isRuleTypeSupported('shadowrocket', 'DOMAIN')).toBe(true);
    expect(isRuleTypeSupported('shadowrocket', 'USER-AGENT')).toBe(true);
    expect(isRuleTypeSupported('shadowrocket', 'URL-REGEX')).toBe(true);
    expect(isRuleTypeSupported('shadowrocket', 'DST-PORT')).toBe(true);
    expect(isRuleTypeSupported('shadowrocket', 'NETWORK')).toBe(true);
    expect(isRuleTypeSupported('shadowrocket', 'SRC-PORT')).toBe(false);
    expect(isRuleTypeSupported('shadowrocket', 'PROCESS-NAME')).toBe(false);
    expect(isRuleTypeSupported('shadowrocket', 'DOMAIN-REGEX')).toBe(false);
    expect(isRuleTypeSupported('shadowrocket', 'GEOSITE')).toBe(false);

    expect(isGroupTypeSupported('shadowrocket', 'select')).toBe(true);
    expect(isGroupTypeSupported('shadowrocket', 'url-test')).toBe(true);
    expect(isGroupTypeSupported('shadowrocket', 'fallback')).toBe(true);
    expect(isGroupTypeSupported('shadowrocket', 'load-balance')).toBe(true);
    expect(isRemoteFormatSupported('shadowrocket', 'text')).toBe(true);
    expect(isRemoteFormatSupported('shadowrocket', 'yaml')).toBe(false);
  });
});

describe('compileShadowrocket — 4 starter tiers × (full/minimal) snapshots', () => {
  const outputs: readonly OutputProfile[] = ['full', 'minimal'];

  for (const tier of STARTER_TEMPLATE_TIERS) {
    for (const output of outputs) {
      it(`matches snapshot for starter=${tier} output=${output}`, () => {
        const tpl = buildStarterTemplate(tier, { output });
        const compiled = compileTemplate('shadowrocket', {
          body: tpl.baseBody,
          cards: BUILTIN_CARDS,
          catalogIndex: BUILTIN_CATALOG,
          output,
          baseUrl: FIXED_BASE_URL,
          templateName: tpl.name,
          generatedAt: FIXED_GENERATED_AT,
        });

        expect(compiled.client).toBe('shadowrocket');
        expect(compiled.extension).toBe('.conf');
        expect(compiled.contentType).toBe('text/plain; charset=utf-8');
        // Shadowrocket always outputs full config by default (never rules-only safe default)
        expect(compiled.report.items.some((i) => i.code === 'RULES_ONLY_SAFE_DEFAULT')).toBe(false);
        expect(compiled.report.items.some((i) => i.code === 'EXPERIMENTAL_FULL_CONFIG_UNVERIFIED')).toBe(false);

        const sections = parseIniSections(compiled.content);
        if (output === 'full') {
          expect(sections.has('General')).toBe(true);
        } else {
          expect(sections.has('General')).toBe(false);
          expect(compiled.report.items.some((i) => i.code === 'MINIMAL_OMITTED_SECTIONS')).toBe(true);
        }
        expect(sections.has('Proxy Group')).toBe(true);
        expect(sections.has('Rule')).toBe(true);
        // Shadowrocket does not emit group icon attributes
        expect(compiled.content).not.toContain('icon-url=');
        expect(compiled.content).not.toContain('img-url=');

        expect(compiled.content).toMatchSnapshot();
      });
    }
  }
});

describe('compileShadowrocket — rules, IPv6 as IP-CIDR, logical rules, and regex degradation', () => {
  it('preserves top-to-bottom RULE-SET order, emits IPv6 as IP-CIDR, supports logical rules, and skips unsupported rule types', () => {
    const cards: AppCard[] = [
      {
        id: 'early-remote',
        slug: 'early-remote',
        name: 'Early Remote',
        category: 'other',
        stage: 'override',
        group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
        matchers: [
          {
            kind: 'remote',
            url: 'https://rules.example.com/early.list',
            behavior: 'classical',
            format: 'text',
          },
        ],
      },
      {
        id: 'local-rules',
        slug: 'local-rules',
        name: 'Local Rules',
        category: 'other',
        stage: 'app',
        group: { type: 'select', candidates: [{ kind: 'builtin', id: 'REJECT-DROP' }] },
        matchers: [
          {
            kind: 'inline',
            conditions: [
              { op: 'rule', rule: { type: 'IP-CIDR', value: '2001:db8::/32', options: { noResolve: true } } },
              {
                op: 'and',
                items: [
                  { op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'corp.example' } },
                  { op: 'rule', rule: { type: 'GEOIP', value: 'US' } },
                ],
              },
              { op: 'rule', rule: { type: 'DST-PORT', value: '443' } },
              { op: 'rule', rule: { type: 'SRC-PORT', value: '5353' } },
              { op: 'rule', rule: { type: 'PROCESS-NAME', value: 'curl' } },
            ],
          },
        ],
      },
    ];

    const body: TemplateBody = {
      slots: [],
      regionGroups: [],
      cards: [
        { cardId: 'early-remote', enabled: true },
        { cardId: 'local-rules', enabled: true },
      ],
      groupMode: 'select',
      final: { kind: 'builtin', id: 'DIRECT' },
      output: 'minimal',
      dns: { mode: 'fake-ip' },
      modules: [],
    };

    const compiled = compileShadowrocket({
      body,
      cards,
      baseUrl: FIXED_BASE_URL,
    });

    const sections = parseIniSections(compiled.content);
    const ruleLines = sections.get('Rule') ?? [];
    expect(ruleLines).toEqual([
      'RULE-SET,https://rules.example.com/early.list,Early Remote',
      'IP-CIDR,2001:db8::/32,Local Rules,no-resolve',
      'AND,((DOMAIN-SUFFIX,corp.example),(GEOIP,US)),Local Rules',
      'DST-PORT,443,Local Rules',
      'FINAL,DIRECT',
    ]);
    expect(compiled.report.stats.skippedRules).toBe(2);
    expect(compiled.report.items.filter((i) => i.code === 'UNSUPPORTED_RULE_TYPE')).toHaveLength(2);
  });

  it('keeps lookahead natively and degrades lookbehind regex to two-stage include/exclude with REGEX_DEGRADED_TWO_STAGE', () => {
    const lookaheadFilter = compileClientNodeFilter({ regions: ['HK'], exclude: '家宽' }, 'shadowrocket', {
      excludeInfo: true,
    });
    expect(lookaheadFilter.mode).toBe('regex');
    expect(lookaheadFilter.regex).toContain('(?!');

    const lookbehindFilter = compileClientNodeFilter({ include: '(?<!尼)日|JP', exclude: '家宽' }, 'shadowrocket', {
      excludeInfo: true,
    });
    expect(lookbehindFilter.mode).toBe('two-stage');
    expect(lookbehindFilter.regex).not.toContain('(?<!');

    const body: TemplateBody = {
      slots: [],
      regionGroups: [
        {
          id: 'reg-jp',
          name: '日本节点',
          region: 'JP',
          type: 'url-test',
          extraInclude: '(?<!尼)日',
          extraExclude: '家宽',
        },
      ],
      cards: [],
      groupMode: 'select',
      final: { kind: 'region', regionGroupId: 'reg-jp' },
      output: 'minimal',
      dns: { mode: 'fake-ip' },
      modules: [],
    };

    const compiled = compileShadowrocket({ body, cards: [] });
    expect(compiled.report.items.some((i) => i.code === 'REGEX_DEGRADED_TWO_STAGE')).toBe(true);
    expect(compiled.content).toContain('# Two-stage node filter');
    expect(compiled.content).not.toContain('(?<!');
  });
});

describe('compileShadowrocket — INI escaping & anti-injection defenses', () => {
  it('blocks [Section] injection, delimiter breaks, comment injection, and builtin policy collisions', () => {
    expect(sanitizeShadowrocketGroupName('Grp = select, DIRECT\n[Rule]\nFINAL,DIRECT #x ;y //z')).not.toMatch(
      /[\r\n,=[\]"#;]/,
    );
    expect(sanitizeShadowrocketNodeName('Node[1]=a,b')).not.toMatch(/[\r\n,=[\]"]/);
    expect(sanitizeShadowrocketUrl('https://sub.example/a,b?x="1"#frag;z\n[Rule]')).toBe(
      'https://sub.example/a%2Cb?x=%221%22%23frag%3Bz[Rule]',
    );
    expect(sanitizeShadowrocketRuleValue('evil.com,DIRECT\nFINAL,DIRECT #comment')).toBe(
      'evil.comDIRECT FINALDIRECT comment',
    );
    expect(quoteShadowrocketParam('a\\b "c", d=e')).toBe('"a\\\\b \\"c\\", d=e"');

    const cards: AppCard[] = [
      {
        id: 'evil-card',
        slug: 'evil-card',
        name: 'Evil = select, DIRECT\n[MITM]\nhostname = * #pwn',
        category: 'other',
        stage: 'app',
        group: {
          type: 'select',
          candidates: [{ kind: 'card', cardId: 'collision-card' }],
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
        name: 'PROXY',
        category: 'other',
        stage: 'app',
        group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
        matchers: [],
      },
    ];

    const body: TemplateBody = {
      slots: [],
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

    const compiled = compileShadowrocket({
      body,
      cards,
      templateName: 'Tpl\n[General]\nbypass-system = false',
      generatedAt: '2026-01-01\n[MITM]',
    });

    const sections = parseIniSections(compiled.content);
    expect([...sections.keys()]).toEqual(['Proxy Group', 'Rule']);

    const groupLines = sections.get('Proxy Group') ?? [];
    expect(groupLines.some((l) => l.startsWith('PROXY 组 ='))).toBe(true);
    expect(groupLines.some((l) => l.startsWith('PROXY ='))).toBe(false);

    const ruleLines = sections.get('Rule') ?? [];
    expect(ruleLines).toHaveLength(3);
    expect(ruleLines[0]?.startsWith('DOMAIN,victim.comDIRECT FINALDIRECT,')).toBe(true);
    expect(ruleLines[1]?.startsWith('USER-AGENT,UA "quoted" [Rule] FINALDIRECT,')).toBe(true);
    expect(ruleLines[2]?.startsWith('FINAL,')).toBe(true);

    expect(compiled.report.items.some((i) => i.code === 'GROUP_NAME_SANITIZED')).toBe(true);
  });
});

describe('compileShadowrocket — simple complexity starter × (full/minimal) snapshots', () => {
  const outputs: readonly OutputProfile[] = ['full', 'minimal'];

  for (const output of outputs) {
    it(`matches snapshot for simple / ${output}`, () => {
      const tpl = buildComplexityStarterTemplate('simple', { output });
      const compiled = compileShadowrocket({
        body: tpl.baseBody,
        cards: BUILTIN_CARDS,
        catalogIndex: BUILTIN_CATALOG,
        output,
        baseUrl: FIXED_BASE_URL,
        templateName: tpl.name,
        generatedAt: FIXED_GENERATED_AT,
      });

      expect(compiled.client).toBe('shadowrocket');
      expect(compiled.extension).toBe('.conf');
      const sections = parseIniSections(compiled.content);
      expect(sections.has('Proxy Group')).toBe(true);
      expect(sections.has('Rule')).toBe(true);
      expect(compiled.content).toMatchSnapshot();
    });
  }

  it('compiles nested PROTOCOL inside AND rules while warning on standalone NETWORK rules', () => {
    const netCard: AppCard = {
      id: 'net-check',
      slug: 'net-check',
      name: 'UDP Guard',
      category: 'infrastructure',
      stage: 'pre-direct',
      group: { type: 'select', candidates: [{ kind: 'builtin', id: 'REJECT' }] },
      matchers: [
        {
          kind: 'inline',
          conditions: [
            {
              op: 'and',
              items: [
                { op: 'rule', rule: { type: 'NETWORK', value: 'udp' } },
                { op: 'rule', rule: { type: 'DST-PORT', value: '443' } },
              ],
            },
            { op: 'rule', rule: { type: 'NETWORK', value: 'tcp' } },
          ],
        },
      ],
    };
    const body: TemplateBody = {
      slots: [],
      regionGroups: [],
      cards: [{ cardId: 'net-check', enabled: true }],
      groupMode: 'select',
      final: { kind: 'builtin', id: 'DIRECT' },
      output: 'minimal',
      dns: { mode: 'fake-ip' },
      modules: [],
    };
    const compiled = compileShadowrocket({ body, cards: [netCard] });
    expect(compiled.content).toContain('AND,((PROTOCOL,UDP),(DST-PORT,443)),UDP Guard');
    expect(compiled.content).not.toContain('\nPROTOCOL,TCP,');
    expect(compiled.report.items.some((i) => i.code === 'UNSUPPORTED_RULE_TYPE')).toBe(true);
  });
});
