import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { BUILTIN_CARDS, BUILTIN_CATALOG, buildStarterTemplate } from '../../src/builtin';
import {
  allocateSubscriptionSlotId,
  ALWAYS_ENABLED_CARD_IDS,
  buildNormalizedQuickCreateSlots,
  buildQuickCreateTemplateBody,
  buildRouteCandidates,
  compileMihomo,
  compileTemplate,
  CORE_REGION_CODES,
  detectMatchingPresetTier,
  getDefaultWizardScenarios,
  getPresetScenarioSelection,
  inferDefaultRouteForRulesetName,
  lintTemplate,
  mapWizardClientSelection,
  normalizeSubscriptionName,
  resolveWizardRegionGroups,
  validateModuleCombination,
  WIZARD_SCENARIO_DEFINITIONS,
} from '../../src/domain/templates';
import { TEMPLATE_CLIENT_IDS } from '../../src/shared/clients';
import type { AppCard } from '../../src/shared/schemas/card';
import type { WizardScenarioId } from '../../src/shared/schemas/quick-create';

describe('M2a quick-create pure domain logic', () => {
  describe('inferDefaultRouteForRulesetName', () => {
    it('routes Direct / 直连 names to direct', () => {
      expect(inferDefaultRouteForRulesetName('Emby_Direct')).toBe('direct');
      expect(inferDefaultRouteForRulesetName('direct-list')).toBe('direct');
      expect(inferDefaultRouteForRulesetName('国内直连补充')).toBe('direct');
      expect(inferDefaultRouteForRulesetName('白名單直連')).toBe('direct');
    });

    it('routes Reject / AD / 广告 / 拦截 names to reject', () => {
      expect(inferDefaultRouteForRulesetName('AD_Block')).toBe('reject');
      expect(inferDefaultRouteForRulesetName('MyReject')).toBe('reject');
      expect(inferDefaultRouteForRulesetName('隐私广告')).toBe('reject');
      expect(inferDefaultRouteForRulesetName('追踪拦截')).toBe('reject');
      expect(inferDefaultRouteForRulesetName('AdGuard')).toBe('reject');
      expect(inferDefaultRouteForRulesetName('my-ads')).toBe('reject');
    });

    it('defaults all other names (including false-positive words containing "ad") to proxy', () => {
      expect(inferDefaultRouteForRulesetName('Download')).toBe('proxy');
      expect(inferDefaultRouteForRulesetName('Shadowrocket_Extra')).toBe('proxy');
      expect(inferDefaultRouteForRulesetName('AI_Services')).toBe('proxy');
      expect(inferDefaultRouteForRulesetName('Media')).toBe('proxy');
      expect(inferDefaultRouteForRulesetName('')).toBe('proxy');
    });
  });

  describe('presets -> scenario checkboxes mapping', () => {
    it('matches the 3 canonical tiers (less ⊂ recommended ⊂ all) and supports legacy tier aliases', () => {
      const less = getPresetScenarioSelection('less');
      const recommended = getPresetScenarioSelection('recommended');
      const all = getPresetScenarioSelection('all');

      expect(less['domestic-direct']).toBe(true);
      expect(less.ai).toBe(true);
      expect(less['ad-block']).toBe(false);
      expect(less.streaming).toBe(false);

      expect(recommended['domestic-direct']).toBe(true);
      expect(recommended['ad-block']).toBe(true);
      expect(recommended.ai).toBe(true);
      expect(recommended.telegram).toBe(true);
      expect(recommended.streaming).toBe(true);
      expect(recommended.social).toBe(false);
      expect(recommended.github).toBe(false);

      for (const def of WIZARD_SCENARIO_DEFINITIONS) {
        expect(all[def.id]).toBe(true);
      }

      expect(detectMatchingPresetTier(less)).toBe('less');
      expect(detectMatchingPresetTier(recommended)).toBe('recommended');
      expect(detectMatchingPresetTier(all)).toBe('all');

      // Legacy tier aliases map cleanly to canonical presets
      expect(getPresetScenarioSelection('minimal')).toEqual(less);
      expect(getPresetScenarioSelection('light')).toEqual(less);
      expect(getPresetScenarioSelection('standard')).toEqual(recommended);
      expect(getPresetScenarioSelection('heavy')).toEqual(all);

      const custom: Record<WizardScenarioId, boolean> = { ...recommended, github: true };
      expect(detectMatchingPresetTier(custom)).toBeNull();
    });
  });

  describe('client selection deduplication and display names', () => {
    it('maps Clash Verge Rev / FlClash / Clash Party into deduplicated mihomo while preserving labels', () => {
      const result = mapWizardClientSelection([
        'clash-verge-rev',
        'flclash',
        'clash-party',
        'shadowrocket',
        'sing-box',
        'sing-box',
      ]);

      expect(result.clients).toEqual(['mihomo', 'shadowrocket', 'sing-box']);
      expect(result.clientDisplayNames).toEqual([
        'Clash Verge Rev',
        'FlClash',
        'Clash Party',
        'Shadowrocket',
        'sing-box',
      ]);
      expect(result.clientLabels).toEqual({
        mihomo: 'Clash Verge Rev / FlClash / Clash Party',
        shadowrocket: 'Shadowrocket',
        'sing-box': 'sing-box',
      });
    });
  });

  describe('route -> policy candidates mapping', () => {
    it('maps proxy, auto, direct, reject, and region routes cleanly', () => {
      const opts = { availableRegionGroupIds: ['region-hk', 'region-jp'], groupMode: 'region' as const };

      expect(buildRouteCandidates('proxy', opts)[0]).toEqual({ kind: 'card', cardId: 'proxy-select' });
      expect(buildRouteCandidates('auto', opts)[0]).toEqual({ kind: 'card', cardId: 'auto-select' });
      expect(buildRouteCandidates('direct', opts)[0]).toEqual({ kind: 'builtin', id: 'DIRECT' });
      expect(buildRouteCandidates('reject', opts)[0]).toEqual({ kind: 'builtin', id: 'REJECT' });
      expect(buildRouteCandidates('region:JP', opts)[0]).toEqual({ kind: 'region', regionGroupId: 'region-jp' });
      // Unavailable region falls back cleanly to proxy/auto without dangling ref
      expect(buildRouteCandidates('region:US', opts).some((c) => c.kind === 'region')).toBe(false);
    });
  });

  describe('groupMode -> regionGroups resolution', () => {
    it('generates no region groups for auto and select modes unless explicitly routed', () => {
      expect(
        resolveWizardRegionGroups({ groupMode: 'auto', hasSubscription: true, detectedRegions: ['HK', 'JP'] }),
      ).toEqual([]);
      expect(
        resolveWizardRegionGroups({ groupMode: 'select', hasSubscription: true, detectedRegions: ['HK', 'JP'] }),
      ).toEqual([]);
      const withExplicit = resolveWizardRegionGroups({
        groupMode: 'auto',
        hasSubscription: false,
        requiredRegionCodes: ['JP'],
      });
      expect(withExplicit.map((g) => g.region)).toEqual(['JP']);
    });

    it('generates only detected regions when subscription exists, or CORE_REGION_GROUPS when absent', () => {
      const withSub = resolveWizardRegionGroups({
        groupMode: 'region',
        hasSubscription: true,
        detectedRegions: ['HK', 'JP', 'US'],
      });
      expect(withSub.map((g) => g.region)).toEqual(['HK', 'JP', 'US']);

      const withoutSub = resolveWizardRegionGroups({
        groupMode: 'region',
        hasSubscription: false,
      });
      expect(withoutSub.map((g) => g.region)).toEqual([...CORE_REGION_CODES]);
    });
  });

  describe('buildQuickCreateTemplateBody scenario->card mapping & ruleset ordering', () => {
    const standardBaseBody = buildStarterTemplate('standard').baseBody;

    it('includes all always-enabled cards, enables/removes §4.6 scenario cards accurately, and puts rulesets first', () => {
      const scenarios = getDefaultWizardScenarios().map((sc) => {
        if (sc.id === 'streaming') return { ...sc, enabled: false };
        if (sc.id === 'github') return { ...sc, enabled: true, route: 'region:JP' as const };
        return sc;
      });

      const { body, generatedCards } = buildQuickCreateTemplateBody({
        standardBaseBody,
        builtinCards: BUILTIN_CARDS,
        complexity: 'advanced',
        scenarios,
        rulesets: [
          {
            rulesetId: 'rs-1',
            name: 'Emby_Direct',
            slug: 'emby-direct',
            route: 'direct',
            cardId: 'c-1',
            cardSlug: 'rs-emby',
          },
          {
            rulesetId: 'rs-2',
            name: 'Work_Reject',
            slug: 'work-reject',
            route: 'reject',
            cardId: 'c-2',
            cardSlug: 'rs-work',
          },
        ],
        groupMode: 'auto',
        hasSubscription: false,
        clientDisplayNames: ['Clash Verge'],
      });

      const cardIds = body.cards.map((c) => c.cardId);

      // Always-enabled cards must be present
      for (const alwaysId of ALWAYS_ENABLED_CARD_IDS) {
        expect(cardIds).toContain(alwaysId);
      }

      // Disabled streaming cards must be removed
      for (const id of ['youtube', 'netflix', 'disney-plus', 'spotify', 'tiktok']) {
        expect(cardIds).not.toContain(id);
      }

      // Enabled github card must be present with region:JP override & region-jp generated
      const githubRef = body.cards.find((c) => c.cardId === 'github');
      expect(githubRef?.overrides?.group?.candidates?.[0]).toEqual({ kind: 'region', regionGroupId: 'region-jp' });
      expect((body.regionGroups ?? []).map((g) => g.id)).toContain('region-jp');

      // Generated ruleset cards appear FIRST right after hidden auto-select & proxy-select in exact input order
      expect(cardIds.slice(0, 4)).toEqual(['auto-select', 'proxy-select', 'c-1', 'c-2']);
      expect(generatedCards[0].matchers).toEqual([{ kind: 'ruleset', ruleSetId: 'rs-1', updateIntervalSec: 1800 }]);
      expect(generatedCards[0].group.candidates[0]).toEqual({ kind: 'builtin', id: 'DIRECT' });
      expect(generatedCards[1].group.candidates[0]).toEqual({ kind: 'builtin', id: 'REJECT' });

      // Wizard metadata is embedded
      expect(body.wizardMeta?.createdByWizard).toBe(true);
      expect(body.wizardMeta?.groupMode).toBe('auto');
      expect(body.wizardMeta?.clientDisplayNames).toEqual(['Clash Verge']);
    });

    it('allocates stable slot IDs (slot-main first, then slot-2..), defaults names to 机场 N with dedup, and wires combineMode', () => {
      const usedNames = new Set<string>();
      expect(normalizeSubscriptionName(undefined, 0, usedNames)).toBe('机场 1');
      expect(normalizeSubscriptionName('  ', 1, usedNames)).toBe('机场 2');
      expect(normalizeSubscriptionName('主力机场', 2, usedNames)).toBe('主力机场');
      expect(normalizeSubscriptionName('主力机场', 3, usedNames)).toBe('主力机场 (2)');

      const usedIds = new Set<string>();
      expect(allocateSubscriptionSlotId(usedIds)).toBe('slot-main');
      expect(allocateSubscriptionSlotId(usedIds)).toBe('slot-2');
      expect(allocateSubscriptionSlotId(usedIds)).toBe('slot-3');

      const slots = buildNormalizedQuickCreateSlots([{ name: '主力' }, { name: '主力' }, {}]);
      expect(slots.map((s) => ({ id: s.id, name: s.name }))).toEqual([
        { id: 'slot-main', name: '主力' },
        { id: 'slot-2', name: '主力 (2)' },
        { id: 'slot-3', name: '机场 3' },
      ]);

      const { body } = buildQuickCreateTemplateBody({
        standardBaseBody,
        builtinCards: BUILTIN_CARDS,
        complexity: 'advanced',
        scenarios: getDefaultWizardScenarios(),
        rulesets: [],
        groupMode: 'region',
        combineMode: 'perProvider',
        slots,
        hasSubscription: true,
        detectedRegions: ['HK', 'JP'],
      });

      expect(body.combineMode).toBe('perProvider');
      expect(body.wizardMeta?.combineMode).toBe('perProvider');
      expect(body.slots.map((s) => s.id)).toEqual(['slot-main', 'slot-2', 'slot-3']);
      // Multi-slot region groups omit slotId so they span all airports
      expect((body.regionGroups ?? []).every((rg) => rg.slotId === undefined)).toBe(true);
      const autoCard = body.cards.find((c) => c.cardId === 'auto-select');
      expect(autoCard?.overrides?.group?.candidates).toEqual([
        { kind: 'slot', slotId: 'slot-main' },
        { kind: 'slot', slotId: 'slot-2' },
        { kind: 'slot', slotId: 'slot-3' },
      ]);
    });
  });

  describe('N2 complexity tiers (simple / advanced / pro) & cross-client simple validation', () => {
    const standardBaseBody = buildStarterTemplate('recommended').baseBody;

    it('defaults omitted complexity to simple with ALL_AUTO_POOL, 3 visible groups, user rulesets first, and tierDefaults modules', () => {
      const { body, generatedCards } = buildQuickCreateTemplateBody({
        standardBaseBody,
        builtinCards: BUILTIN_CARDS,
        scenarios: getDefaultWizardScenarios(),
        rulesets: [
          {
            rulesetId: 'rs-direct',
            name: 'Emby_Direct',
            slug: 'emby-direct',
            route: 'direct',
            cardId: 'c-direct',
            cardSlug: 'rs-emby',
          },
          {
            rulesetId: 'rs-reject',
            name: 'Ad_Reject',
            slug: 'ad-reject',
            route: 'reject',
            cardId: 'c-reject',
            cardSlug: 'rs-ad',
          },
          {
            rulesetId: 'rs-proxy',
            name: 'Work_Proxy',
            slug: 'work-proxy',
            route: 'proxy',
            cardId: 'c-proxy',
            cardSlug: 'rs-work',
          },
        ],
        groupMode: 'region',
        hasSubscription: true,
        detectedRegions: ['HK', 'JP'],
      });

      expect(body.complexity).toBe('simple');
      expect(body.wizardMeta?.complexity).toBe('simple');
      expect(body.pools?.map((p) => p.id)).toEqual(['pool-all-auto']);
      expect(body.pools?.[0]?.hidden).toBe(true);
      expect(body.cards.map((c) => c.cardId)).toEqual([
        'proxy-select',
        'direct-select',
        'c-direct',
        'c-reject',
        'c-proxy',
        'lan-direct',
        'ad-block',
        'domestic-direct',
      ]);

      expect(body.modules.filter((m) => m.enabled)).toEqual([
        { id: 'domestic-apps-direct', enabled: true },
        { id: 'dns-leak-guard', enabled: true },
        { id: 'ip-no-resolve', enabled: true },
      ]);
      expect(validateModuleCombination(body.modules).ok).toBe(true);

      // Compiles cleanly in mihomo with strictly 3 visible groups and user rulesets before lan/ad/cn
      const allCards: AppCard[] = [...BUILTIN_CARDS, ...generatedCards];
      const compiled = compileMihomo({
        body,
        cards: allCards,
        templateName: 'Simple Test',
        catalogIndex: BUILTIN_CATALOG,
        baseUrl: 'https://rules.example.com',
        slotBindings: {
          'slot-main': { kind: 'http', url: 'https://example.com/sub' },
        },
        rulesetBehaviors: new Map([
          ['rs-direct', { domain: 2, classical: 0, ipcidr: 0 }],
          ['rs-reject', { domain: 1, classical: 0, ipcidr: 0 }],
          ['rs-proxy', { domain: 1, classical: 0, ipcidr: 0 }],
        ]),
      });
      const doc = parseYaml(compiled.content) as Record<string, unknown>;
      const proxyGroups = doc['proxy-groups'] as Array<Record<string, unknown>>;
      const visibleGroups = proxyGroups.filter((g) => g.hidden !== true);
      expect(visibleGroups.map((g) => g.name)).toEqual(['🚀 代理', '🎯 直连', '🚫 拦截']);

      const rules = doc.rules as string[];
      const embyIdx = rules.findIndex((r) => r.includes('rs-direct'));
      const rejectIdx = rules.findIndex((r) => r.includes('rs-reject'));
      const workIdx = rules.findIndex((r) => r.includes('rs-proxy'));
      const lanIdx = rules.findIndex((r) => r.includes('private'));
      const adIdx = rules.findIndex((r) => r.includes('category-ads-all'));
      const cnIdx = rules.findIndex((r) => r.includes('geosite-cn'));
      expect(embyIdx).toBe(0);
      expect(rejectIdx).toBeGreaterThan(embyIdx);
      expect(workIdx).toBeGreaterThan(rejectIdx);
      expect(lanIdx).toBeGreaterThan(workIdx);
      expect(adIdx).toBeGreaterThan(lanIdx);
      expect(cnIdx).toBeGreaterThan(adIdx);
      expect(rules[rules.length - 1]).toBe('MATCH,🔒 防泄漏兜底');
    });

    it('generates pro complexity with region + trait + provider + stability pools and conflict-free tierDefaults modules', () => {
      const slots = buildNormalizedQuickCreateSlots([{ name: '主力机场' }, { name: '备用机场' }]);
      const { body } = buildQuickCreateTemplateBody({
        standardBaseBody,
        builtinCards: BUILTIN_CARDS,
        complexity: 'pro',
        scenarios: getDefaultWizardScenarios(),
        rulesets: [],
        groupMode: 'region',
        combineMode: 'perProvider',
        slots,
        hasSubscription: true,
        detectedRegions: ['HK', 'JP', 'US'],
      });

      expect(body.complexity).toBe('pro');
      const poolIds = (body.pools ?? []).map((p) => p.id);
      expect(poolIds).toContain('pool-all-auto');
      expect(poolIds).toContain('pool-stability-fallback');
      expect(poolIds).toContain('pool-trait-low-rate');
      expect(poolIds).toContain('pool-trait-residential');
      expect(poolIds).toContain('pool-trait-dedicated');
      expect(poolIds).toContain('pool-trait-gaming');
      expect(poolIds).toContain('pool-provider-slot-main');
      expect(poolIds).toContain('pool-provider-slot-2');
      expect(poolIds).toContain('region-hk');
      expect((body.pools ?? []).filter((p) => p.kind === 'trait').every((p) => p.hidden === true)).toBe(true);

      const modValidation = validateModuleCombination(body.modules);
      expect(modValidation.ok).toBe(true);
      expect(body.modules.find((m) => m.id === 'game-download-direct')?.enabled).toBe(true);
      expect(body.modules.find((m) => m.id === 'tunnel-direct')?.enabled).toBe(true);
    });

    it('applies explicit nodePoolOptions (selectedRegions, includeProviderPools, traitPoolIds) and pro module overrides', () => {
      const slots = buildNormalizedQuickCreateSlots([{ name: '主力机场' }, { name: '备用机场' }]);
      const { body } = buildQuickCreateTemplateBody({
        standardBaseBody,
        builtinCards: BUILTIN_CARDS,
        complexity: 'pro',
        scenarios: getDefaultWizardScenarios(),
        rulesets: [],
        groupMode: 'region',
        combineMode: 'perProvider',
        slots,
        hasSubscription: true,
        detectedRegions: ['HK', 'JP', 'US'],
        nodePoolOptions: {
          selectedRegions: ['HK', 'US'],
          includeProviderPools: false,
          traitPoolIds: ['pool-trait-low-rate'],
        },
        modules: [
          { id: 'dns-leak-guard', enabled: false },
          { id: 'block-encrypted-dns', enabled: true },
          { id: 'game-download-direct', enabled: false },
        ],
      });

      const poolIds = (body.pools ?? []).map((p) => p.id);
      expect(poolIds).toContain('region-hk');
      expect(poolIds).toContain('region-us');
      expect(poolIds).not.toContain('region-jp');
      expect(poolIds).toContain('pool-trait-low-rate');
      expect(poolIds).not.toContain('pool-trait-gaming');
      expect(poolIds.some((id) => id.startsWith('pool-provider-'))).toBe(false);

      expect(validateModuleCombination(body.modules).ok).toBe(true);
      expect(body.modules.find((m) => m.id === 'dns-leak-guard')?.enabled).toBe(false);
      expect(body.modules.find((m) => m.id === 'block-encrypted-dns')?.enabled).toBe(true);
      expect(body.modules.find((m) => m.id === 'game-download-direct')?.enabled).toBe(false);
    });

    it.each(TEMPLATE_CLIENT_IDS)('compiles and lints quick-create simple body cleanly for %s', (client) => {
      const { body, generatedCards } = buildQuickCreateTemplateBody({
        standardBaseBody,
        builtinCards: BUILTIN_CARDS,
        complexity: 'simple',
        scenarios: getDefaultWizardScenarios(),
        rulesets: [
          {
            rulesetId: 'rs-1',
            name: 'Direct_Custom',
            slug: 'direct-custom',
            route: 'direct',
            cardId: 'c-1',
            cardSlug: 'rs-direct-custom',
          },
        ],
        groupMode: 'auto',
        hasSubscription: true,
      });

      const allCards = [...BUILTIN_CARDS, ...generatedCards];
      const lint = lintTemplate({ body, cards: allCards, clients: [client], catalogIndex: BUILTIN_CATALOG });
      expect(lint.issues.filter((i) => i.severity === 'error')).toEqual([]);

      const compiled = compileTemplate(client, {
        body,
        cards: allCards,
        templateName: 'Simple Client Check',
        catalogIndex: BUILTIN_CATALOG,
        baseUrl: 'https://rules.example.com',
        experimentalFullConfig: true,
        rulesetBehaviors: new Map([['direct-custom', { domain: 1, classical: 0, ipcidr: 0 }]]),
        slotBindings: {
          'slot-main': {
            kind: 'inline',
            proxies: [
              {
                name: '🇭🇰 HK 01',
                type: 'ss',
                server: 'hk.example.com',
                port: 443,
                cipher: 'aes-128-gcm',
                password: 'pw',
              },
            ],
          },
        },
      });
      expect(compiled.content.length).toBeGreaterThan(0);
    });
  });
});
