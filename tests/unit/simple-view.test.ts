import { describe, expect, it } from 'vitest';
import { BUILTIN_CARDS, buildStarterTemplate } from '../../src/builtin';
import {
  applySimpleTemplatePatch,
  buildQuickCreateTemplateBody,
  getDefaultWizardScenarios,
  mapTemplateToSimpleRouting,
  type SimpleRulesetRef,
} from '../../src/domain/templates';
import type { AppCard } from '../../src/shared/schemas/card';
import type { TemplateBody } from '../../src/shared/schemas/template';

function buildCardMap(extraCards: readonly AppCard[] = []): Map<string, AppCard> {
  const map = new Map<string, AppCard>();
  for (const card of BUILTIN_CARDS) map.set(card.id, card);
  for (const card of extraCards) map.set(card.id, card);
  return map;
}

describe('B3 domain simple-view mapping and patching', () => {
  const rulesetDirect: SimpleRulesetRef = { id: 'rs-emby', name: 'Emby_Direct', slug: 'emby-direct' };
  const rulesetReject: SimpleRulesetRef = { id: 'rs-ads', name: 'Custom_Ads', slug: 'custom-ads' };
  const rulesetMap = new Map<string, SimpleRulesetRef>([
    [rulesetDirect.id, rulesetDirect],
    [rulesetReject.id, rulesetReject],
  ]);

  it('round-trips a wizard-created template including scenarios, My Rules order, and groupMode', () => {
    const standardStarter = buildStarterTemplate('standard');
    const built = buildQuickCreateTemplateBody({
      standardBaseBody: standardStarter.baseBody,
      builtinCards: BUILTIN_CARDS,
      scenarios: getDefaultWizardScenarios(),
      rulesets: [
        {
          rulesetId: rulesetDirect.id,
          name: rulesetDirect.name,
          slug: rulesetDirect.slug,
          route: 'direct',
          cardId: 'card-rs-emby',
          cardSlug: 'ruleset-emby-direct',
        },
        {
          rulesetId: rulesetReject.id,
          name: rulesetReject.name,
          slug: rulesetReject.slug,
          route: 'reject',
          cardId: 'card-rs-ads',
          cardSlug: 'ruleset-custom-ads',
        },
      ],
      groupMode: 'region',
      hasSubscription: true,
      detectedRegions: ['HK', 'JP', 'US'],
    });

    const cardMap = buildCardMap(built.generatedCards);
    const simple = mapTemplateToSimpleRouting(built.body, cardMap, rulesetMap);

    expect(simple.hasCustomizations).toBe(false);
    expect(simple.customItems).toEqual([]);
    expect(simple.groupMode).toBe('region');
    expect(simple.availableRegions.map((r) => r.code)).toEqual(['HK', 'JP', 'US']);

    const ai = simple.scenarios.find((s) => s.id === 'ai');
    expect(ai).toMatchObject({ id: 'ai', enabled: true, route: 'auto', custom: false });

    const github = simple.scenarios.find((s) => s.id === 'github');
    expect(github).toMatchObject({ id: 'github', enabled: false, custom: false });

    expect(simple.rulesets.map((r) => ({ id: r.rulesetId, route: r.route }))).toEqual([
      { id: 'rs-emby', route: 'direct' },
      { id: 'rs-ads', route: 'reject' },
    ]);
  });

  it('maps beta.1 starter templates (standard and minimal) and patches scenarios cleanly', () => {
    const standard = buildStarterTemplate('standard');
    const cardMap = buildCardMap();
    const mappedStd = mapTemplateToSimpleRouting(standard.baseBody, cardMap, new Map());

    expect(mappedStd.scenarios.find((s) => s.id === 'domestic-direct')?.enabled).toBe(true);
    expect(mappedStd.scenarios.find((s) => s.id === 'ai')?.enabled).toBe(true);

    const patched = applySimpleTemplatePatch({
      currentBody: standard.baseBody,
      cardMap,
      builtinCards: BUILTIN_CARDS,
      rulesetMap,
      patch: {
        scenarios: mappedStd.scenarios.map((s) =>
          s.id === 'ai'
            ? { id: s.id, enabled: true, route: 'region:US' }
            : s.id === 'github'
              ? { id: s.id, enabled: true, route: 'proxy' }
              : { id: s.id, enabled: s.enabled, ...(s.configurableRoute ? { route: s.route } : {}) },
        ),
        rulesets: [
          {
            rulesetId: rulesetDirect.id,
            name: rulesetDirect.name,
            slug: rulesetDirect.slug,
            route: 'direct',
            cardId: 'card-new-emby',
            cardSlug: 'ruleset-emby-direct',
          },
        ],
        groupMode: 'select',
      },
      hasSubscription: true,
      detectedRegions: ['HK', 'US'],
    });

    const nextCardMap = buildCardMap(patched.generatedCards);
    const remapped = mapTemplateToSimpleRouting(patched.body, nextCardMap, rulesetMap);

    expect(remapped.scenarios.find((s) => s.id === 'ai')?.route).toBe('region:US');
    expect(remapped.scenarios.find((s) => s.id === 'github')).toMatchObject({ enabled: true, route: 'proxy' });
    expect(remapped.rulesets.map((r) => r.rulesetId)).toEqual(['rs-emby']);
    expect(remapped.groupMode).toBe('select');

    // My Rules card must precede common scenario cards like domestic-direct
    const embyIdx = patched.body.cards.findIndex((c) => c.cardId === 'card-new-emby');
    const openaiIdx = patched.body.cards.findIndex((c) => c.cardId === 'openai');
    expect(embyIdx).toBeGreaterThanOrEqual(0);
    expect(embyIdx).toBeLessThan(openaiIdx);

    // Minimal starter also maps without throwing
    const minimal = buildStarterTemplate('minimal');
    const mappedMin = mapTemplateToSimpleRouting(minimal.baseBody, cardMap, new Map());
    expect(mappedMin.scenarios.find((s) => s.id === 'domestic-direct')?.enabled).toBe(true);
    expect(mappedMin.scenarios.find((s) => s.id === 'streaming')?.enabled).toBe(false);
  });

  it('marks customized scenarios & non-standard cards as custom and preserves all custom parts verbatim after PATCH', () => {
    const standard = buildStarterTemplate('standard');
    const customCard: AppCard = {
      id: 'custom-corp-vpn',
      slug: 'custom-corp-vpn',
      name: '公司内网专线',
      category: 'other',
      stage: 'app',
      origin: 'user',
      group: {
        type: 'url-test',
        candidates: [{ kind: 'builtin', id: 'DIRECT' }],
        test: { url: 'http://corp.internal/ping', interval: 120, tolerance: 30 },
      },
      matchers: [{ kind: 'inline', conditions: [{ type: 'DOMAIN-SUFFIX', value: 'corp.internal' }] }],
    };

    const body: TemplateBody = structuredClone(standard.baseBody);
    // 1) Customize AI scenario: rename openai card + disable ai-services -> partial/overridden scenario
    body.cards = body.cards.map((ref) => {
      if (ref.cardId === 'openai') {
        return {
          ...ref,
          overrides: {
            name: '定制 OpenAI 组',
            group: {
              type: 'fallback',
              candidates: [{ kind: 'card', cardId: 'custom-corp-vpn' }],
            },
          },
        };
      }
      if (ref.cardId === 'ai-services') {
        return { ...ref, enabled: false };
      }
      return ref;
    });
    // 2) Insert custom card
    body.cards.unshift({ cardId: customCard.id, enabled: true });
    // 3) Add custom DNS, general, modules, clientPatches, extra slot
    body.dns = { ...body.dns, respectRules: true, nameserver: ['https://1.1.1.1/dns-query'] };
    body.general = { ...body.general, mixedPort: 8899 };
    body.modules = [{ id: 'mod-custom', name: 'Custom Module', enabled: true, config: { foo: 'bar' } }];
    body.clientPatches = { mihomo: 'tproxy-port: 7894\n' };
    body.slots = [...body.slots, { id: 'slot-backup', name: '备用机场', required: false }];

    const cardMap = buildCardMap([customCard]);
    const simple = mapTemplateToSimpleRouting(body, cardMap, rulesetMap);

    expect(simple.hasCustomizations).toBe(true);
    expect(simple.scenarios.find((s) => s.id === 'ai')?.custom).toBe(true);
    expect(simple.customItems).toEqual([
      expect.objectContaining({ id: 'custom-corp-vpn', name: '公司内网专线', kind: 'card' }),
    ]);

    // Attempt to patch BOTH a normal scenario (telegram -> direct) AND the custom scenario (ai -> disabled)
    const patched = applySimpleTemplatePatch({
      currentBody: body,
      cardMap,
      builtinCards: BUILTIN_CARDS,
      rulesetMap,
      patch: {
        scenarios: [
          { id: 'ai', enabled: false, route: 'direct' }, // MUST be ignored because ai is custom!
          { id: 'telegram', enabled: true, route: 'direct' }, // Normal scenario -> applied!
        ],
        rulesets: [
          {
            rulesetId: rulesetReject.id,
            name: rulesetReject.name,
            slug: rulesetReject.slug,
            route: 'reject',
            cardId: 'card-rs-ads',
            cardSlug: 'ruleset-custom-ads',
          },
          {
            rulesetId: rulesetDirect.id,
            name: rulesetDirect.name,
            slug: rulesetDirect.slug,
            route: 'direct',
            cardId: 'card-rs-emby',
            cardSlug: 'ruleset-emby-direct',
          },
        ],
      },
      hasSubscription: true,
    });

    // Verify custom scenario cards stayed 100% untouched
    const patchedOpenai = patched.body.cards.find((c) => c.cardId === 'openai');
    expect(patchedOpenai).toEqual({
      cardId: 'openai',
      enabled: true,
      overrides: {
        name: '定制 OpenAI 组',
        group: {
          type: 'fallback',
          candidates: [{ kind: 'card', cardId: 'custom-corp-vpn' }],
        },
      },
    });
    expect(patched.body.cards.find((c) => c.cardId === 'ai-services')?.enabled).toBe(false);

    // Verify custom card, DNS, general, modules, clientPatches, extra slot preserved verbatim
    expect(patched.body.cards.some((c) => c.cardId === 'custom-corp-vpn' && c.enabled)).toBe(true);
    expect(patched.body.dns.respectRules).toBe(true);
    expect(patched.body.dns.nameserver).toEqual(['https://1.1.1.1/dns-query']);
    expect(patched.body.general.mixedPort).toBe(8899);
    expect(patched.body.modules).toEqual(body.modules);
    expect(patched.body.clientPatches).toEqual(body.clientPatches);
    expect(patched.body.slots).toEqual(body.slots);

    // Verify normal scenario (telegram) and reordered My Rules were applied
    const nextCardMap = buildCardMap([customCard, ...patched.generatedCards]);
    const remapped = mapTemplateToSimpleRouting(patched.body, nextCardMap, rulesetMap);
    expect(remapped.scenarios.find((s) => s.id === 'telegram')?.route).toBe('direct');
    expect(remapped.rulesets.map((r) => r.rulesetId)).toEqual(['rs-ads', 'rs-emby']);
  });
});
