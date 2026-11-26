import { describe, expect, it } from 'vitest';
import { BUILTIN_CARDS } from '../../../src/builtin/cards';
import { BUILTIN_CATALOG } from '../../../src/builtin/catalog';
import { buildStarterTemplate, STARTER_TEMPLATE_TIERS } from '../../../src/builtin/templates';
import { CLIENT_REGEX_DIALECTS, compileClientNodeFilter } from '../../../src/domain/nodes';
import {
  CLIENT_CAPABILITIES,
  compileQuanx,
  compileTemplate,
  isGroupTypeSupported,
  isRemoteFormatSupported,
  isRuleTypeSupported,
  sanitizeQuanxGroupName,
  sanitizeQuanxNodeName,
  sanitizeQuanxRuleValue,
  sanitizeQuanxUrl,
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

describe('client capability matrix (Quantumult X official docs audit)', () => {
  it('matches official Quantumult X capabilities and helper predicates', () => {
    const qx = CLIENT_CAPABILITIES['quantumult-x'];
    expect(qx.geosite).toBe('none');
    expect(qx.geoip).toBe('native');
    expect(qx.logicalRules).toBe(false);
    expect(qx.remoteRuleset).toBe(true);
    expect(qx.inlineRuleset).toBe(false);
    expect(qx.localFirstRules).toBe(true);
    expect(qx.remoteNodes).toBe('client-managed');
    expect(qx.nodeRegexFilter).toBe(true);
    expect(qx.groupIcons).toBe(true);
    expect(qx.rejectDrop).toBe(false);
    expect(qx.remoteRulesetField).toBe('[filter_remote]');
    expect(qx.remoteNodeField).toBe('[server_remote]');
    expect(qx.nodeFilterField).toBe('server-tag-regex');
    expect(qx.groupIconField).toBe('img-url');
    expect(qx.finalRuleKeyword).toBe('final');
    expect(qx.ipV6RuleType).toBe('ip6-cidr');
    expect(CLIENT_REGEX_DIALECTS['quantumult-x']).toMatchObject({
      engine: 're2-safe',
      supportsLookahead: false,
      supportsLookbehind: false,
    });

    expect(qx.ruleTypeAliases).toMatchObject({
      DOMAIN: 'host',
      'DOMAIN-SUFFIX': 'host-suffix',
      'DOMAIN-KEYWORD': 'host-keyword',
      'IP-CIDR': 'ip-cidr',
      'IP-ASN': 'ip-asn',
      GEOIP: 'geoip',
      'USER-AGENT': 'user-agent',
    });

    // 7 of 14 canonical rule types supported
    expect(qx.supportedRuleTypes.size).toBe(7);
    expect(isRuleTypeSupported('quantumult-x', 'DOMAIN')).toBe(true);
    expect(isRuleTypeSupported('quantumult-x', 'USER-AGENT')).toBe(true);
    expect(isRuleTypeSupported('quantumult-x', 'DST-PORT')).toBe(false);
    expect(isRuleTypeSupported('quantumult-x', 'PROCESS-NAME')).toBe(false);
    expect(isRuleTypeSupported('quantumult-x', 'URL-REGEX')).toBe(false);
    expect(isRuleTypeSupported('quantumult-x', 'DOMAIN-REGEX')).toBe(false);
    expect(isRuleTypeSupported('quantumult-x', 'GEOSITE')).toBe(false);

    expect(isGroupTypeSupported('quantumult-x', 'select')).toBe(true);
    expect(isGroupTypeSupported('quantumult-x', 'url-test')).toBe(true);
    expect(isGroupTypeSupported('quantumult-x', 'fallback')).toBe(true);
    expect(isGroupTypeSupported('quantumult-x', 'load-balance')).toBe(true);
    expect(isRemoteFormatSupported('quantumult-x', 'text')).toBe(true);
    expect(isRemoteFormatSupported('quantumult-x', 'yaml')).toBe(false);
  });
});

describe('compileQuanx — 4 starter tiers × (full/minimal) snapshots', () => {
  const outputs: readonly OutputProfile[] = ['full', 'minimal'];

  for (const tier of STARTER_TEMPLATE_TIERS) {
    for (const output of outputs) {
      it(`matches snapshot for starter=${tier} output=${output} (safe filter_remote default)`, () => {
        const tpl = buildStarterTemplate(tier, { output });
        const compiled = compileQuanx({
          body: tpl.baseBody,
          cards: BUILTIN_CARDS,
          catalogIndex: BUILTIN_CATALOG,
          output,
          baseUrl: FIXED_BASE_URL,
          templateName: tpl.name,
          generatedAt: FIXED_GENERATED_AT,
        });

        expect(compiled.client).toBe('quantumult-x');
        expect(compiled.extension).toBe('.conf');
        expect(compiled.contentType).toBe('text/plain; charset=utf-8');
        expect(compiled.report.items.some((i) => i.code === 'RULES_ONLY_SAFE_DEFAULT')).toBe(true);
        expect(compiled.report.items.some((i) => i.code === 'EXPERIMENTAL_FULL_CONFIG_UNVERIFIED')).toBe(false);
        expect(compiled.content).not.toContain('[general]');
        expect(compiled.content).not.toContain('[policy]');
        expect(compiled.content).not.toContain('[server_remote]');
        expect(compiled.content).toMatchSnapshot();
      });

      it(`matches snapshot for starter=${tier} output=${output} (experimental full config)`, () => {
        const tpl = buildStarterTemplate(tier, { output });
        const compiled = compileTemplate('quantumult-x', {
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
          expect(sections.has('general')).toBe(true);
          expect(sections.has('dns')).toBe(true);
        } else {
          expect(sections.has('general')).toBe(false);
          expect(sections.has('dns')).toBe(false);
          expect(compiled.report.items.some((i) => i.code === 'MINIMAL_OMITTED_SECTIONS')).toBe(true);
        }
        expect(sections.has('policy')).toBe(true);
        expect(sections.has('filter_local')).toBe(true);
        expect(sections.has('server_remote')).toBe(false);

        const expWarning = compiled.report.items.find((i) => i.code === 'EXPERIMENTAL_FULL_CONFIG_UNVERIFIED');
        expect(expWarning).toBeDefined();
        expect(expWarning?.severity).toBe('warning');
        expect(expWarning?.message).toContain('未经真机验证');

        expect(compiled.content).toMatchSnapshot();
      });
    }
  }
});

describe('compileQuanx — logical rules skip, local-first inlining, and regex two-stage degradation', () => {
  it('skips AND/OR/NOT logical rules and unsupported rule types, maps REJECT-DROP to reject, and reports everything', () => {
    const cards: AppCard[] = [
      {
        id: 'early-remote',
        slug: 'early-remote',
        name: 'Early Remote',
        category: 'other',
        stage: 'override',
        group: { type: 'select', candidates: [{ kind: 'builtin', id: 'REJECT-DROP' }] },
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
        id: 'mixed-rules',
        slug: 'mixed-rules',
        name: 'Mixed Rules',
        category: 'other',
        stage: 'app',
        group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
        matchers: [
          {
            kind: 'inline',
            conditions: [
              { op: 'rule', rule: { type: 'DOMAIN', value: 'chat.example.com' } },
              { op: 'rule', rule: { type: 'IP-CIDR', value: '2001:db8::/32', options: { noResolve: true } } },
              {
                op: 'and',
                items: [
                  { op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'corp.example' } },
                  { op: 'rule', rule: { type: 'IP-CIDR', value: '10.0.0.0/8' } },
                ],
              },
              {
                op: 'or',
                items: [
                  { op: 'rule', rule: { type: 'DOMAIN', value: 'a.example' } },
                  { op: 'rule', rule: { type: 'DOMAIN', value: 'b.example' } },
                ],
              },
              {
                op: 'not',
                item: { op: 'rule', rule: { type: 'GEOIP', value: 'CN' } },
              },
              { op: 'rule', rule: { type: 'DST-PORT', value: '443' } },
              { op: 'rule', rule: { type: 'PROCESS-NAME', value: 'curl' } },
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
        group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
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
        { cardId: 'mixed-rules', enabled: true },
        { cardId: 'late-remote', enabled: true },
      ],
      groupMode: 'select',
      final: { kind: 'builtin', id: 'REJECT-DROP' },
      output: 'minimal',
      dns: { mode: 'fake-ip' },
      modules: [],
    };

    const compiled = compileQuanx({
      body,
      cards,
      baseUrl: FIXED_BASE_URL,
      experimentalFullConfig: true,
      inlineRulePayloads: {
        'remote-early-remote-classical': ['DOMAIN-SUFFIX,first.example', 'IP-CIDR,2001:db8:1::/48,no-resolve'],
      },
    });

    const logicalWarnings = compiled.report.items.filter((i) => i.code === 'UNSUPPORTED_LOGICAL_RULE');
    const unsupportedTypeWarnings = compiled.report.items.filter((i) => i.code === 'UNSUPPORTED_RULE_TYPE');
    expect(logicalWarnings).toHaveLength(3); // AND, OR, NOT
    expect(unsupportedTypeWarnings).toHaveLength(2); // DST-PORT, PROCESS-NAME
    expect(compiled.report.stats.skippedRules).toBe(5);
    expect(compiled.report.items.some((i) => i.code === 'REMOTE_INLINED_FOR_LOCAL_FIRST_CLIENT')).toBe(true);
    expect(compiled.report.items.some((i) => i.code === 'UNSUPPORTED_CLIENT_FEATURE')).toBe(true);

    const sections = parseIniSections(compiled.content);
    const localFilters = sections.get('filter_local') ?? [];
    const remoteFilters = sections.get('filter_remote') ?? [];

    // Inlined early remote appears BEFORE local inline rules, with lowercase QX syntax & ip6-cidr without no-resolve
    const firstIdx = localFilters.findIndex((l) => l === 'host-suffix, first.example, Early Remote');
    const chatIdx = localFilters.findIndex((l) => l === 'host, chat.example.com, Mixed Rules');
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(chatIdx).toBeGreaterThan(firstIdx);
    expect(localFilters).toContain('ip6-cidr, 2001:db8:1::/48, Early Remote');
    expect(localFilters).toContain('ip6-cidr, 2001:db8::/32, Mixed Rules');
    expect(localFilters.some((l) => l.includes('no-resolve'))).toBe(false);
    expect(localFilters.at(-1)).toBe('final, reject');

    // Late remote stays in [filter_remote]
    expect(remoteFilters.some((l) => l.includes('https://rules.example.com/late.list'))).toBe(true);
    expect(remoteFilters.some((l) => l.includes('https://rules.example.com/early.list'))).toBe(false);
  });

  it('degrades lookahead/exclude region filters to two-stage include/exclude on re2-safe QX and reports REGEX_DEGRADED_TWO_STAGE', () => {
    const filterResult = compileClientNodeFilter({ regions: ['HK'], exclude: '家宽|IPLC' }, 'quantumult-x', {
      excludeInfo: true,
    });
    expect(filterResult.mode).toBe('two-stage');
    expect(filterResult.regex).not.toContain('(?!');
    expect(filterResult.regex).not.toContain('(?<!');
    expect(filterResult.excludePattern).toBeTruthy();

    const body: TemplateBody = {
      slots: [],
      regionGroups: [
        {
          id: 'reg-hk',
          name: '香港节点',
          region: 'HK',
          type: 'url-test',
          extraExclude: '家宽',
        },
      ],
      cards: [],
      groupMode: 'select',
      final: { kind: 'region', regionGroupId: 'reg-hk' },
      output: 'minimal',
      dns: { mode: 'fake-ip' },
      modules: [],
    };

    const compiled = compileQuanx({
      body,
      cards: [],
      experimentalFullConfig: true,
    });

    expect(compiled.report.items.some((i) => i.code === 'REGEX_DEGRADED_TWO_STAGE')).toBe(true);
    expect(compiled.content).toContain('# Two-stage node filter');
    expect(compiled.content).toContain('server-tag-regex=');
    expect(compiled.content).not.toContain('(?!');
  });
});

describe('compileQuanx — INI escaping & anti-injection defenses', () => {
  it('blocks [Section] injection, delimiter breaks, comment injection, and builtin policy collisions', () => {
    expect(sanitizeQuanxGroupName('Grp = static, direct\n[filter_local]\nfinal, direct #x ;y //z')).not.toMatch(
      /[\r\n,=[\]"#;]/,
    );
    expect(sanitizeQuanxNodeName('Node[1]=a,b')).not.toMatch(/[\r\n,=[\]"]/);
    expect(sanitizeQuanxUrl('https://sub.example/a,b?x="1"#frag;z\n[policy]')).toBe(
      'https://sub.example/a%2Cb?x=%221%22%23frag%3Bz[policy]',
    );
    expect(sanitizeQuanxRuleValue('evil.com, direct\nfinal, direct #comment')).toBe(
      'evil.com direct final direct comment',
    );

    const cards: AppCard[] = [
      {
        id: 'evil-card',
        slug: 'evil-card',
        name: 'Evil = static, direct\n[mitm]\nhostname = * #pwn',
        category: 'other',
        stage: 'app',
        group: {
          type: 'select',
          candidates: [{ kind: 'card', cardId: 'collision-card' }],
        },
        matchers: [
          {
            kind: 'inline',
            conditions: [{ op: 'rule', rule: { type: 'DOMAIN', value: 'victim.com, direct\nfinal, direct' } }],
          },
        ],
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

    const compiled = compileQuanx({
      body,
      cards,
      templateName: 'Tpl\n[general]\nnetwork_check_url=http://evil',
      generatedAt: '2026-01-01\n[mitm]',
      experimentalFullConfig: true,
    });

    const sections = parseIniSections(compiled.content);
    expect([...sections.keys()]).toEqual(['policy', 'filter_local']);

    const policyLines = sections.get('policy') ?? [];
    expect(policyLines.some((l) => l.startsWith('static=DIRECT 组,'))).toBe(true);
    expect(policyLines.some((l) => l.startsWith('static=DIRECT,'))).toBe(false);

    const filterLines = sections.get('filter_local') ?? [];
    expect(filterLines).toHaveLength(2);
    expect(filterLines[0]?.startsWith('host, victim.com direct final direct,')).toBe(true);
    expect(filterLines[1]?.startsWith('final, ')).toBe(true);

    expect(compiled.report.items.some((i) => i.code === 'GROUP_NAME_SANITIZED')).toBe(true);
  });
});
