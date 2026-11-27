import { describe, expect, it } from 'vitest';
import { BUILTIN_CARDS, buildStarterTemplate } from '../../src/builtin';
import {
  ALWAYS_ENABLED_CARD_IDS,
  buildQuickCreateTemplateBody,
  buildRouteCandidates,
  CORE_REGION_CODES,
  detectMatchingPresetTier,
  getDefaultWizardScenarios,
  getPresetScenarioSelection,
  inferDefaultRouteForRulesetName,
  mapWizardClientSelection,
  resolveWizardRegionGroups,
  WIZARD_SCENARIO_DEFINITIONS,
} from '../../src/domain/templates/quick-create';
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
    it('matches the 4 tiers (minimal ⊂ light ⊂ standard ⊂ heavy)', () => {
      const minimal = getPresetScenarioSelection('minimal');
      const light = getPresetScenarioSelection('light');
      const standard = getPresetScenarioSelection('standard');
      const heavy = getPresetScenarioSelection('heavy');

      expect(minimal['domestic-direct']).toBe(true);
      expect(minimal['ad-block']).toBe(false);
      expect(minimal.ai).toBe(false);

      expect(light['domestic-direct']).toBe(true);
      expect(light['ad-block']).toBe(true);
      expect(light.ai).toBe(true);
      expect(light.streaming).toBe(false);

      expect(standard['domestic-direct']).toBe(true);
      expect(standard['ad-block']).toBe(true);
      expect(standard.ai).toBe(true);
      expect(standard.telegram).toBe(true);
      expect(standard.streaming).toBe(true);
      expect(standard.social).toBe(false);
      expect(standard.github).toBe(false);

      for (const def of WIZARD_SCENARIO_DEFINITIONS) {
        expect(heavy[def.id]).toBe(true);
      }

      expect(detectMatchingPresetTier(minimal)).toBe('minimal');
      expect(detectMatchingPresetTier(light)).toBe('light');
      expect(detectMatchingPresetTier(standard)).toBe('standard');
      expect(detectMatchingPresetTier(heavy)).toBe('heavy');

      const custom: Record<WizardScenarioId, boolean> = { ...standard, github: true };
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
      expect(body.regionGroups.map((g) => g.id)).toContain('region-jp');

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
  });
});
