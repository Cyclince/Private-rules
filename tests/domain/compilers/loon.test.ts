import { describe, expect, it } from 'vitest';
import { BUILTIN_CARDS } from '../../../src/builtin/cards';
import { BUILTIN_CATALOG } from '../../../src/builtin/catalog';
import { buildStarterTemplate, STARTER_TEMPLATE_TIERS } from '../../../src/builtin/templates';
import { CLIENT_REGEX_DIALECTS, compileClientNodeFilter } from '../../../src/domain/nodes';
import {
  CLIENT_CAPABILITIES,
  compileLoon,
  compileTemplate,
  isGroupTypeSupported,
  isRemoteFormatSupported,
  isRuleTypeSupported,
  quoteLoonParam,
  sanitizeLoonFilterName,
  sanitizeLoonGroupName,
  sanitizeLoonNodeName,
  sanitizeLoonRuleValue,
  sanitizeLoonUrl,
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

describe('client capability matrix (Loon official docs audit)', () => {
  it('matches official Loon capabilities and helper predicates', () => {
    const loon = CLIENT_CAPABILITIES.loon;
    expect(loon.geosite).toBe('none');
    expect(loon.geoip).toBe('native');
    expect(loon.logicalRules).toBe(true);
    expect(loon.remoteRuleset).toBe(true);
    expect(loon.inlineRuleset).toBe(false);
    expect(loon.localFirstRules).toBe(true);
    expect(loon.remoteNodes).toBe('client-managed');
    expect(loon.nodeRegexFilter).toBe(true);
    expect(loon.groupIcons).toBe(true);
    expect(loon.rejectDrop).toBe(true);
    expect(loon.remoteRulesetField).toBe('[Remote Rule]');
    expect(loon.remoteNodeField).toBe('[Remote Proxy]');
    expect(loon.nodeFilterField).toBe('NameRegex');
    expect(loon.nodeExcludeFilterField).toBeNull();
    expect(loon.groupIconField).toBe('img-url');
    expect(loon.finalRuleKeyword).toBe('FINAL');
    expect(loon.ipV6RuleType).toBe('IP-CIDR6');
    expect(loon.ruleTypeAliases['DST-PORT']).toBe('DEST-PORT');
    expect(CLIENT_REGEX_DIALECTS.loon).toMatchObject({
      engine: 'icu',
      supportsLookahead: true,
      supportsLookbehind: true,
    });

    // 11 of 14 canonical rule types supported
    expect(loon.supportedRuleTypes.size).toBe(11);
    expect(isRuleTypeSupported('loon', 'DST-PORT')).toBe(true);
    expect(isRuleTypeSupported('loon', 'SRC-PORT')).toBe(true);
    expect(isRuleTypeSupported('loon', 'PROCESS-NAME')).toBe(true);
    expect(isRuleTypeSupported('loon', 'USER-AGENT')).toBe(true);
    expect(isRuleTypeSupported('loon', 'URL-REGEX')).toBe(true);
    expect(isRuleTypeSupported('loon', 'DOMAIN-REGEX')).toBe(false);
    expect(isRuleTypeSupported('loon', 'SRC-IP-CIDR')).toBe(false);
    expect(isRuleTypeSupported('loon', 'GEOSITE')).toBe(false);

    expect(isGroupTypeSupported('loon', 'select')).toBe(true);
    expect(isGroupTypeSupported('loon', 'url-test')).toBe(true);
    expect(isGroupTypeSupported('loon', 'fallback')).toBe(true);
    expect(isGroupTypeSupported('loon', 'load-balance')).toBe(true);
    expect(isRemoteFormatSupported('loon', 'text')).toBe(true);
    expect(isRemoteFormatSupported('loon', 'yaml')).toBe(false);
    expect(isRemoteFormatSupported('loon', 'mrs', 'domain')).toBe(false);
  });
});

describe('compileLoon — 4 starter tiers × (full/minimal) snapshots', () => {
  const outputs: readonly OutputProfile[] = ['full', 'minimal'];

  for (const tier of STARTER_TEMPLATE_TIERS) {
    for (const output of outputs) {
      it(`matches snapshot for starter=${tier} output=${output} (safe rules-only default)`, () => {
        const tpl = buildStarterTemplate(tier, { output });
        const compiled = compileLoon({
          body: tpl.baseBody,
          cards: BUILTIN_CARDS,
          catalogIndex: BUILTIN_CATALOG,
          output,
          baseUrl: FIXED_BASE_URL,
          templateName: tpl.name,
          generatedAt: FIXED_GENERATED_AT,
        });

        expect(compiled.client).toBe('loon');
        expect(compiled.extension).toBe('.conf');
        expect(compiled.contentType).toBe('text/plain; charset=utf-8');
        expect(compiled.report.items.some((i) => i.code === 'RULES_ONLY_SAFE_DEFAULT')).toBe(true);
        expect(compiled.report.items.some((i) => i.code === 'EXPERIMENTAL_FULL_CONFIG_UNVERIFIED')).toBe(false);
        // Safe default never emits full-config sections that could overwrite user node subscriptions
        expect(compiled.content).not.toContain('[General]');
        expect(compiled.content).not.toContain('[Remote Proxy]');
        expect(compiled.content).not.toContain('[Proxy Group]');
        expect(compiled.content).toMatchSnapshot();
      });

      it(`matches snapshot for starter=${tier} output=${output} (experimental full config)`, () => {
        const tpl = buildStarterTemplate(tier, { output });
        const compiled = compileTemplate('loon', {
          body: tpl.baseBody,
          cards: BUILTIN_CARDS,
          catalogIndex: BUILTIN_CATALOG,
          output,
          baseUrl: FIXED_BASE_URL,
          templateName: tpl.name,
          generatedAt: FIXED_GENERATED_AT,
          experimentalFullConfig: true,
        });

        const sections = parseIniSections(compiled.content);
        if (output === 'full') {
          expect(sections.has('General')).toBe(true);
        } else {
          expect(sections.has('General')).toBe(false);
          expect(compiled.report.items.some((i) => i.code === 'MINIMAL_OMITTED_SECTIONS')).toBe(true);
        }
        expect(sections.has('Proxy Group')).toBe(true);
        expect(sections.has('Rule')).toBe(true);
        expect(sections.has('Remote Proxy')).toBe(false);

        const expWarning = compiled.report.items.find((i) => i.code === 'EXPERIMENTAL_FULL_CONFIG_UNVERIFIED');
        expect(expWarning).toBeDefined();
        expect(expWarning?.severity).toBe('warning');
        expect(expWarning?.message).toContain('未经真机验证');

        expect(compiled.content).toMatchSnapshot();
      });
    }
  }
});

describe('compileLoon — safe default vs experimental full config toggle', () => {
  it('defaults experimentalFullConfig to false (rules-only) and warns with "未经真机验证" when enabled', () => {
    const body = buildStarterTemplate('minimal').baseBody;

    const safeDefault = compileLoon({
      body,
      cards: BUILTIN_CARDS,
      catalogIndex: BUILTIN_CATALOG,
      baseUrl: FIXED_BASE_URL,
    });
    expect(safeDefault.report.stats.proxyGroups).toBe(0);
    expect(safeDefault.report.items.some((i) => i.code === 'RULES_ONLY_SAFE_DEFAULT')).toBe(true);
    expect(safeDefault.report.items.some((i) => i.code === 'EXPERIMENTAL_FULL_CONFIG_UNVERIFIED')).toBe(false);
    expect(safeDefault.content).not.toMatch(/^\[Proxy Group\]$/m);
    expect(safeDefault.content).not.toMatch(/^\[General\]$/m);

    const experimental = compileLoon({
      body,
      cards: BUILTIN_CARDS,
      catalogIndex: BUILTIN_CATALOG,
      baseUrl: FIXED_BASE_URL,
      experimentalFullConfig: true,
    });
    expect(experimental.report.stats.proxyGroups).toBeGreaterThan(0);
    expect(experimental.report.items.some((i) => i.code === 'RULES_ONLY_SAFE_DEFAULT')).toBe(false);
    const warning = experimental.report.items.find((i) => i.code === 'EXPERIMENTAL_FULL_CONFIG_UNVERIFIED');
    expect(warning).toMatchObject({
      code: 'EXPERIMENTAL_FULL_CONFIG_UNVERIFIED',
      severity: 'warning',
    });
    expect(warning?.message).toContain('未经真机验证');
    expect(experimental.content).toContain('[Proxy Group]');
    expect(experimental.content).toContain('[Rule]');
  });
});

describe('compileLoon — local-first priority inlining, rules, and regex degradation', () => {
  it('automatically inlines remote rule lists appearing before local rules and reports REMOTE_INLINED_FOR_LOCAL_FIRST_CLIENT', () => {
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
        id: 'local-inline',
        slug: 'local-inline',
        name: 'Local Inline',
        category: 'other',
        stage: 'app',
        group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
        matchers: [
          {
            kind: 'inline',
            conditions: [
              { op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'local.example' } },
              { op: 'rule', rule: { type: 'DST-PORT', value: '8443' } },
              { op: 'rule', rule: { type: 'PROCESS-NAME', value: 'curl' } },
              {
                op: 'and',
                items: [
                  { op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'corp.example' } },
                  { op: 'rule', rule: { type: 'DST-PORT', value: '443' } },
                ],
              },
              { op: 'rule', rule: { type: 'DOMAIN-REGEX', value: '^bad\\.' } },
            ],
          },
        ],
      },
      {
        id: 'late-remote',
        slug: 'late-remote',
        name: 'Late Remote',
        category: 'other',
        stage: 'fallback',
        group: { type: 'select', candidates: [{ kind: 'builtin', id: 'REJECT-DROP' }] },
        matchers: [
          {
            kind: 'remote',
            url: 'https://rules.example.com/late.list',
            behavior: 'classical',
            format: 'text',
          },
        ],
      },
    ];

    const body: TemplateBody = {
      slots: [],
      regionGroups: [],
      cards: [
        { cardId: 'early-remote', enabled: true },
        { cardId: 'local-inline', enabled: true },
        { cardId: 'late-remote', enabled: true },
      ],
      groupMode: 'select',
      final: { kind: 'builtin', id: 'DIRECT' },
      output: 'minimal',
      dns: { mode: 'fake-ip' },
      modules: [],
    };

    const withPayload = compileLoon({
      body,
      cards,
      baseUrl: FIXED_BASE_URL,
      experimentalFullConfig: true,
      inlineRulePayloads: {
        'remote-early-remote-classical': ['DOMAIN-SUFFIX,priority.example', 'IP-CIDR,198.51.100.0/24'],
      },
    });

    expect(withPayload.report.items.some((i) => i.code === 'REMOTE_INLINED_FOR_LOCAL_FIRST_CLIENT')).toBe(true);
    expect(withPayload.report.items.some((i) => i.code === 'UNSUPPORTED_RULE_TYPE')).toBe(true);
    expect(withPayload.report.items.some((i) => i.code === 'UNSUPPORTED_CLIENT_FEATURE')).toBe(true);
    expect(withPayload.report.stats.skippedRules).toBe(1);

    const sections = parseIniSections(withPayload.content);
    const ruleLines = sections.get('Rule') ?? [];
    const remoteRuleLines = sections.get('Remote Rule') ?? [];

    // Early remote payload is inlined BEFORE local rules inside [Rule]
    const priorityIdx = ruleLines.findIndex((l) => l.startsWith('DOMAIN-SUFFIX,priority.example,Early Remote'));
    const localIdx = ruleLines.findIndex((l) => l.startsWith('DOMAIN-SUFFIX,local.example,Local Inline'));
    expect(priorityIdx).toBeGreaterThanOrEqual(0);
    expect(localIdx).toBeGreaterThan(priorityIdx);
    expect(ruleLines).toContain('DEST-PORT,8443,Local Inline');
    expect(ruleLines).toContain('PROCESS-NAME,curl,Local Inline');
    expect(ruleLines).toContain('AND,((DOMAIN-SUFFIX,corp.example),(DEST-PORT,443)),Local Inline');
    // Late remote remains in [Remote Rule] (not inlined)
    expect(remoteRuleLines.some((l) => l.includes('https://rules.example.com/late.list'))).toBe(true);
    expect(remoteRuleLines.some((l) => l.includes('https://rules.example.com/early.list'))).toBe(false);

    // Without inline payload, emits a placeholder comment in [Rule]
    const withoutPayload = compileLoon({
      body,
      cards,
      baseUrl: FIXED_BASE_URL,
      experimentalFullConfig: true,
    });
    expect(withoutPayload.content).toContain('# [Inlined Remote Rule Required]');
  });

  it('degrades invalid regex node filters to two-stage NameKeyword and reports REGEX_DEGRADED_TWO_STAGE', () => {
    const degraded = compileClientNodeFilter({ include: '[unclosed-regex|HK', exclude: '过期|流量' }, 'loon', {
      excludeInfo: true,
    });
    expect(degraded.mode).toBe('two-stage');
    expect(degraded.includeKeywords.length).toBeGreaterThan(0);
    expect(degraded.excludeKeywords.length).toBeGreaterThan(0);

    const body: TemplateBody = {
      slots: [],
      regionGroups: [
        {
          id: 'reg-bad',
          name: 'Bad Regex Region',
          region: 'HK',
          type: 'url-test',
          extraInclude: '[broken-group',
          extraExclude: '家宽',
        },
      ],
      cards: [],
      groupMode: 'select',
      final: { kind: 'region', regionGroupId: 'reg-bad' },
      output: 'minimal',
      dns: { mode: 'fake-ip' },
      modules: [],
    };

    const compiled = compileLoon({
      body,
      cards: [],
      experimentalFullConfig: true,
    });
    expect(compiled.report.items.some((i) => i.code === 'REGEX_DEGRADED_TWO_STAGE')).toBe(true);
    expect(compiled.content).toContain('[Remote Filter]');
    expect(compiled.content).toContain('NameKeyword');
    expect(compiled.content).toContain('# Two-stage exclude (Filter-Bad Regex Region):');
  });
});

describe('compileLoon — INI escaping & anti-injection defenses', () => {
  it('blocks [Section] injection, delimiter breaks, comment injection, and builtin policy collisions', () => {
    expect(sanitizeLoonGroupName('Grp = select, DIRECT\n[Rule]\nFINAL,DIRECT #x ;y //z')).not.toMatch(/[\r\n,=[\]"#;]/);
    expect(sanitizeLoonNodeName('Node[1]=a,b')).not.toMatch(/[\r\n,=[\]"]/);
    expect(sanitizeLoonFilterName('Filter=1,2\n[General]')).not.toMatch(/[\r\n,=[\]"]/);
    expect(sanitizeLoonUrl('https://sub.example/a,b?x="1"#frag;z\n[Rule]')).toBe(
      'https://sub.example/a%2Cb?x=%221%22%23frag%3Bz[Rule]',
    );
    expect(sanitizeLoonRuleValue('evil.com,DIRECT\nFINAL,DIRECT #comment')).toBe('evil.comDIRECT FINALDIRECT comment');
    expect(quoteLoonParam('a\\b "c", d=e')).toBe('"a\\\\b \\"c\\", d=e"');

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
        name: 'REJECT-DROP',
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

    const compiled = compileLoon({
      body,
      cards,
      templateName: 'Tpl\n[General]\nallow-wifi-access = true',
      generatedAt: '2026-01-01\n[MITM]',
      experimentalFullConfig: true,
    });

    const sections = parseIniSections(compiled.content);
    expect([...sections.keys()]).toEqual(['Proxy Group', 'Rule']);

    const groupLines = sections.get('Proxy Group') ?? [];
    expect(groupLines.some((l) => l.startsWith('REJECT-DROP 组 ='))).toBe(true);
    expect(groupLines.some((l) => l.startsWith('REJECT-DROP ='))).toBe(false);

    const ruleLines = sections.get('Rule') ?? [];
    expect(ruleLines).toHaveLength(3);
    expect(ruleLines[0]?.startsWith('DOMAIN,victim.comDIRECT FINALDIRECT,')).toBe(true);
    expect(ruleLines[1]?.startsWith('USER-AGENT,UA "quoted" [Rule] FINALDIRECT,')).toBe(true);
    expect(ruleLines[2]?.startsWith('FINAL,')).toBe(true);

    expect(compiled.report.items.some((i) => i.code === 'GROUP_NAME_SANITIZED')).toBe(true);
  });
});
