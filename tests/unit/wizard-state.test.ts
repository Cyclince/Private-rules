import { describe, expect, it } from 'vitest';
import { ENHANCEMENT_MODULE_METADATA } from '../../src/domain/templates/modules/metadata';
import {
  aggregateDetectedRegions,
  applyScenarioPreset,
  buildDefaultModuleStateForTier,
  buildQuickCreatePayload,
  clampRouteForTier,
  createInitialWizardState,
  createSubscriptionRow,
  evaluateModuleSupport,
  getCandidateRegionList,
  getDefaultScenariosForTier,
  getNextWizardStep,
  getPrevWizardStep,
  getStepStatuses,
  inferRulesetDefaultRoute,
  isStepSkippedForTier,
  mapSelectedAppsToClients,
  toggleModuleWithConflicts,
  WIZARD_CORE_REGION_CODES,
  WIZARD_TRAIT_POOL_PRESETS,
} from '../../src/web/components/templates/wizard/wizard-state';

describe('R4a 8-step wizard state, tier skip logic & payload mapping', () => {
  it('provides recommended defaults for every step in initial wizard state', () => {
    const state = createInitialWizardState({ platform: 'mac' });
    expect(state.step).toBe(1);
    expect(state.direction).toBe('forward');
    expect(state.maxReachedStep).toBe(1);
    expect(state.selectedAppIds).toEqual(['clash-verge-rev']);
    expect(state.subscriptions).toHaveLength(1);
    expect(state.subscriptions[0]).toMatchObject({ id: 'sub-1', name: '机场 1', url: '' });
    expect(state.skipSubscription).toBe(false);
    expect(state.combineMode).toBe('merge');
    expect(state.complexity).toBe('simple');
    expect(state.groupMode).toBe('region');
    expect(state.selectedRegions).toEqual([...WIZARD_CORE_REGION_CODES]);
    expect(state.includeProviderPools).toBe(true);
    expect(state.selectedTraitPoolIds).toEqual(WIZARD_TRAIT_POOL_PRESETS.map((p) => p.id));
    expect(state.templateName).toBe('我的配置');

    const proModules = buildDefaultModuleStateForTier('pro');
    expect(state.modules).toEqual(proModules);
    // Conflict guard: dns-leak-guard wins over block-encrypted-dns by default
    expect(state.modules['dns-leak-guard']).toBe(true);
    expect(state.modules['block-encrypted-dns']).toBe(false);
  });

  it('skips steps 4, 6, 7 for simple tier and walks all 8 steps for advanced and pro', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((s) => isStepSkippedForTier(s as 1, 'simple'))).toEqual([
      false,
      false,
      false,
      true,
      false,
      true,
      true,
      false,
    ]);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((s) => isStepSkippedForTier(s as 1, 'advanced'))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);

    // Simple forward path: 1 -> 2 -> 3 -> 5 -> 8 -> null
    const simpleForward: number[] = [1];
    let cur: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | null = 1;
    while ((cur = getNextWizardStep(cur, 'simple')) !== null) {
      simpleForward.push(cur);
    }
    expect(simpleForward).toEqual([1, 2, 3, 5, 8]);

    // Simple backward path: 8 -> 5 -> 3 -> 2 -> 1 -> null
    const simpleBackward: number[] = [8];
    cur = 8;
    while ((cur = getPrevWizardStep(cur, 'simple')) !== null) {
      simpleBackward.push(cur);
    }
    expect(simpleBackward).toEqual([8, 5, 3, 2, 1]);

    // Advanced & pro visit all 8 steps
    for (const tier of ['advanced', 'pro'] as const) {
      const forward: number[] = [1];
      let step: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | null = 1;
      while ((step = getNextWizardStep(step, tier)) !== null) {
        forward.push(step);
      }
      expect(forward).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    }

    // Progress statuses mark skipped steps cleanly even when viewing step 5 or 8
    const statuses = getStepStatuses(5, 'simple');
    expect(statuses.map((s) => [s.step, s.status, s.skipped])).toEqual([
      [1, 'completed', false],
      [2, 'completed', false],
      [3, 'completed', false],
      [4, 'skipped', true],
      [5, 'active', false],
      [6, 'skipped', true],
      [7, 'skipped', true],
      [8, 'pending', false],
    ]);
  });

  it('preserves user inputs across summary jump-back, clamps routes for simple, and resolves module conflicts', () => {
    expect(inferRulesetDefaultRoute('Emby_Direct')).toBe('direct');
    expect(inferRulesetDefaultRoute('AD_Reject')).toBe('reject');
    expect(inferRulesetDefaultRoute('My_Custom')).toBe('proxy');

    expect(clampRouteForTier('auto', 'simple')).toBe('proxy');
    expect(clampRouteForTier('region:HK', 'simple')).toBe('proxy');
    expect(clampRouteForTier('direct', 'simple')).toBe('direct');
    expect(clampRouteForTier('reject', 'simple')).toBe('reject');
    expect(clampRouteForTier('region:HK', 'advanced')).toBe('region:HK');

    // Enabling block-encrypted-dns automatically disables dns-leak-guard and vice versa
    const baseModules = buildDefaultModuleStateForTier('pro');
    const toggledBlock = toggleModuleWithConflicts(baseModules, 'block-encrypted-dns', true);
    expect(toggledBlock.next['block-encrypted-dns']).toBe(true);
    expect(toggledBlock.next['dns-leak-guard']).toBe(false);
    expect(toggledBlock.disabledPeers).toEqual(['dns-leak-guard']);

    const toggledLeak = toggleModuleWithConflicts(toggledBlock.next, 'dns-leak-guard', true);
    expect(toggledLeak.next['dns-leak-guard']).toBe(true);
    expect(toggledLeak.next['block-encrypted-dns']).toBe(false);
    expect(toggledLeak.disabledPeers).toEqual(['block-encrypted-dns']);

    // Evaluate module support against Apple-only selection
    const snifferMod = ENHANCEMENT_MODULE_METADATA.find((m) => m.id === 'sniffer')!;
    expect(evaluateModuleSupport(snifferMod, ['shadowrocket']).status).toBe('unsupported');
    expect(evaluateModuleSupport(snifferMod, ['clash-verge-rev', 'shadowrocket']).status).toBe('partial');
    expect(evaluateModuleSupport(snifferMod, ['clash-verge-rev']).status).toBe('supported');
  });

  it('aggregates detected regions across multiple subscriptions and excludes skipped rows', () => {
    const sub1 = {
      ...createSubscriptionRow(0, 'sub-1'),
      name: '主力机场',
      url: 'https://a.example/sub',
      preview: {
        nodeCount: 30,
        regions: [
          { code: 'HK', name: '香港', emoji: '🇭🇰', count: 12 },
          { code: 'JP', name: '日本', emoji: '🇯🇵', count: 8 },
        ],
        regionCounts: { HK: 12, JP: 8 },
        checkedAt: '2026-11-28T00:00:00.000Z',
      },
    };
    const sub2 = {
      ...createSubscriptionRow(1, 'sub-2'),
      name: '备用机场',
      url: 'https://b.example/sub',
      preview: {
        nodeCount: 20,
        regions: [
          { code: 'JP', name: '日本', emoji: '🇯🇵', count: 10 },
          { code: 'US', name: '美国', emoji: '🇺🇸', count: 5 },
        ],
        regionCounts: { JP: 10, US: 5 },
        checkedAt: '2026-11-28T00:00:00.000Z',
      },
    };

    const stats = aggregateDetectedRegions([sub1, sub2], false);
    expect(stats.map((s) => [s.code, s.count])).toEqual([
      ['JP', 18],
      ['HK', 12],
      ['US', 5],
    ]);
    expect(aggregateDetectedRegions([sub1, sub2], true)).toEqual([]);

    const advCandidates = getCandidateRegionList([sub1, sub2], false, 'advanced');
    expect(advCandidates.map((c) => c.code)).toEqual(['JP', 'HK', 'US']);

    const proCandidates = getCandidateRegionList([sub1, sub2], false, 'pro');
    expect(proCandidates.slice(0, 3).map((c) => c.code)).toEqual(['JP', 'HK', 'US']);
    expect(proCandidates.length).toBeGreaterThan(3);
  });

  it('maps quick-create payload accurately for simple, advanced, and pro tiers', () => {
    const rulesets = [
      { id: 'rs-direct', name: 'Emby_Direct' },
      { id: 'rs-ai', name: 'My_AI' },
    ];

    // 1. Simple payload: clamps routes to proxy/direct/reject, forces combineMode merge, omits pools & modules
    const simpleState = createInitialWizardState({ platform: 'mac' });
    simpleState.selectedAppIds = ['clash-verge-rev', 'flclash'];
    simpleState.subscriptions = [
      { ...createSubscriptionRow(0, 'sub-1'), name: '机场 A', url: 'https://a.example/sub' },
      { ...createSubscriptionRow(1, 'sub-2'), name: '', url: 'https://b.example/sub' },
    ];
    simpleState.combineMode = 'perProvider';
    simpleState.selectedRulesetIds = ['rs-direct', 'rs-ai'];
    simpleState.rulesetRoutes = { 'rs-direct': 'direct', 'rs-ai': 'region:JP' };
    simpleState.templateName = '小白配置';

    const simplePayload = buildQuickCreatePayload(simpleState, rulesets);
    expect(simplePayload.complexity).toBe('simple');
    expect(simplePayload.clients).toEqual(['mihomo']);
    expect(simplePayload.clientDisplayNames).toEqual(['Clash Verge Rev', 'FlClash']);
    expect(simplePayload.combineMode).toBe('merge');
    expect(simplePayload.groupMode).toBe('auto');
    expect(simplePayload.scenarios).toEqual([
      { id: 'domestic-direct', enabled: true },
      { id: 'ad-block', enabled: true },
    ]);
    expect(simplePayload.rulesets).toEqual([
      { rulesetId: 'rs-direct', route: 'direct' },
      { rulesetId: 'rs-ai', route: 'proxy' },
    ]);
    expect(simplePayload.subscriptions).toEqual([
      { name: '机场 A', url: 'https://a.example/sub' },
      { name: '机场 2', url: 'https://b.example/sub' },
    ]);
    expect(simplePayload.nodePoolOptions).toBeUndefined();
    expect(simplePayload.modules).toBeUndefined();

    // 2. Advanced payload: preserves scenario routes, region selection, combineMode, ruleset region routes
    const advState = createInitialWizardState({ platform: 'mac' });
    advState.complexity = 'advanced';
    advState.selectedAppIds = ['clash-verge-rev', 'shadowrocket'];
    advState.subscriptions = [
      {
        ...createSubscriptionRow(0, 'sub-1'),
        name: '主力',
        url: 'https://a.example/sub',
        preview: {
          nodeCount: 10,
          regions: [{ code: 'HK', name: '香港', emoji: '🇭🇰', count: 10 }],
          regionCounts: { HK: 10 },
          checkedAt: '2026-11-28T00:00:00.000Z',
        },
      },
      {
        ...createSubscriptionRow(1, 'sub-2'),
        name: '备用',
        url: 'https://b.example/sub',
        preview: {
          nodeCount: 5,
          regions: [{ code: 'JP', name: '日本', emoji: '🇯🇵', count: 5 }],
          regionCounts: { JP: 5 },
          checkedAt: '2026-11-28T00:00:00.000Z',
        },
      },
    ];
    advState.combineMode = 'perProvider';
    advState.scenarios = applyScenarioPreset(getDefaultScenariosForTier('advanced'), 'recommended').map((s) =>
      s.id === 'ai' ? { ...s, enabled: true, route: 'region:JP' } : s,
    );
    advState.selectedRulesetIds = ['rs-ai'];
    advState.rulesetRoutes = { 'rs-ai': 'region:HK' };
    advState.groupMode = 'region';
    advState.selectedRegions = ['HK', 'JP'];

    const advPayload = buildQuickCreatePayload(advState, rulesets);
    expect(advPayload.complexity).toBe('advanced');
    expect(advPayload.clients).toEqual(['mihomo', 'shadowrocket']);
    expect(advPayload.combineMode).toBe('perProvider');
    expect(advPayload.detectedRegions).toEqual(['HK', 'JP']);
    expect(advPayload.rulesets).toEqual([{ rulesetId: 'rs-ai', route: 'region:HK' }]);
    expect(advPayload.nodePoolOptions).toEqual({ selectedRegions: ['HK', 'JP'] });
    expect(advPayload.modules).toBeUndefined();

    // 3. Pro payload: maps provider pools, trait pools, and disables modules unsupported by selected apps
    const proState = createInitialWizardState({ platform: 'iphone' });
    proState.complexity = 'pro';
    proState.selectedAppIds = ['shadowrocket'];
    proState.includeProviderPools = false;
    proState.selectedTraitPoolIds = ['pool-trait-low-rate', 'pool-trait-gaming'];
    proState.selectedRegions = ['HK', 'SG'];
    proState.modules = {
      ...buildDefaultModuleStateForTier('pro'),
      sniffer: true, // mihomo-only -> must be forced false when only shadowrocket is selected
      'dns-leak-guard': true, // mihomo/sing-box only -> must be forced false
      'bt-direct': true, // supported by shadowrocket -> stays true
    };

    const proPayload = buildQuickCreatePayload(proState, rulesets);
    expect(proPayload.complexity).toBe('pro');
    expect(proPayload.nodePoolOptions).toEqual({
      selectedRegions: ['HK', 'SG'],
      includeProviderPools: false,
      traitPoolIds: ['pool-trait-low-rate', 'pool-trait-gaming'],
    });
    const modMap = new Map((proPayload.modules ?? []).map((m) => [m.id, m.enabled]));
    expect(modMap.get('sniffer')).toBe(false);
    expect(modMap.get('dns-leak-guard')).toBe(false);
    expect(modMap.get('bt-direct')).toBe(true);

    // mapSelectedAppsToClients filters out rules-only apps
    expect(mapSelectedAppsToClients(['karing', 'clash-verge-rev']).clients).toEqual(['mihomo']);
  });
});
