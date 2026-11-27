import { describe, expect, it } from 'vitest';
import {
  buildSimpleTierCards,
  describeModuleAvailability,
  DETAIL_TAB_IDS,
  groupRoutingCards,
  isDetailTab,
  isTierDowngrade,
  routesForTier,
  SCENARIO_CATEGORY,
  tierRank,
  tierShowsRegex,
  tierSupportsCustomPools,
  tierSupportsRegionPools,
} from '../../src/web/components/templates/detail/template-detail-data';
import { checkModuleToggleConflict } from '../../src/web/lib/module-checks';
import { appendOverlayOp } from '../../src/web/lib/overlay-ops';
import { CATALOG_CATEGORY_VALUES } from '../../src/shared/app-categories';
import type { SimpleTemplateView } from '../../src/application/templates';
import type { TemplateModuleBinding } from '../../src/shared/schemas/template';

type Scenario = SimpleTemplateView['routing']['scenarios'][number];

function scenario(overrides: Partial<Scenario> & Pick<Scenario, 'id'>): Scenario {
  return {
    id: overrides.id,
    enabled: true,
    configurableRoute: true,
    route: 'proxy',
    custom: false,
    cardIds: [`${overrides.id}-card`],
    ...overrides,
  };
}

describe('template detail tab + tier data', () => {
  it('exposes exactly four tabs and validates deep links', () => {
    expect([...DETAIL_TAB_IDS]).toEqual(['routing', 'nodes', 'modules', 'output']);
    for (const tab of DETAIL_TAB_IDS) expect(isDetailTab(tab)).toBe(true);
    expect(isDetailTab('patches')).toBe(false);
    expect(isDetailTab(undefined)).toBe(false);
  });

  it('ranks tiers and only warns when a switch is a downgrade', () => {
    expect(tierRank('simple')).toBeLessThan(tierRank('advanced'));
    expect(tierRank('advanced')).toBeLessThan(tierRank('pro'));
    expect(isTierDowngrade('pro', 'advanced')).toBe(true);
    expect(isTierDowngrade('pro', 'simple')).toBe(true);
    expect(isTierDowngrade('advanced', 'pro')).toBe(false);
    expect(isTierDowngrade('simple', 'simple')).toBe(false);

    expect(tierSupportsRegionPools('simple')).toBe(false);
    expect(tierSupportsRegionPools('advanced')).toBe(true);
    expect(tierSupportsCustomPools('advanced')).toBe(false);
    expect(tierSupportsCustomPools('pro')).toBe(true);
    expect(tierShowsRegex('advanced')).toBe(false);
    expect(tierShowsRegex('pro')).toBe(true);
  });

  it('limits the simple tier to proxy / direct / reject destinations', () => {
    expect(routesForTier('simple')).toEqual(['proxy', 'direct', 'reject']);
    expect(routesForTier('advanced')).toContain('auto');
    expect(routesForTier('pro')).toContain('auto');
  });
});

describe('routing tab category mapping', () => {
  it('returns all 15 categories in the canonical order', () => {
    const groups = groupRoutingCards({ scenarios: [], customItems: [] });
    expect(groups).toHaveLength(15);
    expect(groups.map((group) => group.category)).toEqual([...CATALOG_CATEGORY_VALUES]);
    expect(groups.every((group) => group.cards.length === 0)).toBe(true);
  });

  it('places each scenario in its declared category', () => {
    const scenarios = [
      scenario({ id: 'ai', route: 'region:US' }),
      scenario({ id: 'ad-block', enabled: false, configurableRoute: false, route: 'reject' }),
      scenario({ id: 'telegram' }),
      scenario({ id: 'gaming' }),
    ];
    const groups = groupRoutingCards({ scenarios, customItems: [] });
    const byCategory = new Map(groups.map((group) => [group.category, group.cards]));

    expect(byCategory.get('ai')?.map((card) => card.id)).toEqual(['ai']);
    expect(byCategory.get('privacy')?.map((card) => card.id)).toEqual(['ad-block']);
    expect(byCategory.get('social')?.map((card) => card.id)).toEqual(['telegram']);
    expect(byCategory.get('gaming')?.map((card) => card.id)).toEqual(['gaming']);

    const aiCard = byCategory.get('ai')![0];
    expect(aiCard.titleKey).toBe('wizard.scenario.ai');
    expect(aiCard.route).toBe('region:US');
    expect(aiCard.testId).toBe('simple-scenario-row-ai');
    expect(SCENARIO_CATEGORY['ad-block']).toBe('privacy');
  });

  it('uses card metadata for custom cards and sorts enabled cards first', () => {
    const groups = groupRoutingCards({
      scenarios: [scenario({ id: 'streaming', enabled: false })],
      customItems: [{ id: 'my-card', name: '我的自定义组', kind: 'card' }],
      cardMeta: new Map([['my-card', { icon: '🎬', category: 'advertising' }]]),
    });
    const privacy = groups.find((group) => group.category === 'privacy')!;
    expect(privacy.cards).toHaveLength(1);
    expect(privacy.cards[0]).toMatchObject({ id: 'my-card', title: '我的自定义组', icon: '🎬', custom: true });

    const streaming = groups.find((group) => group.category === 'streaming')!;
    expect(streaming.cards[0].enabled).toBe(false);
  });

  it('keeps the simple tier at exactly three destination cards', () => {
    const cards = buildSimpleTierCards([
      scenario({ id: 'domestic-direct', enabled: true, configurableRoute: false, route: 'direct' }),
      scenario({ id: 'ad-block', enabled: false, configurableRoute: false, route: 'reject' }),
    ]);
    expect(cards.map((card) => card.id)).toEqual(['proxy', 'direct', 'reject']);
    expect(cards.map((card) => card.icon)).toEqual(['🚀', '🎯', '🚫']);
    expect(cards[1].enabled).toBe(true);
    expect(cards[2].enabled).toBe(false);
    expect(cards[2].route).toBe('reject');
  });
});

describe('modules tab availability and conflicts', () => {
  const mihomoOnly = ['mihomo'];

  it('greys out a module when none of the chosen apps support it', () => {
    const availability = describeModuleAvailability(['mihomo', 'sing-box'], ['surge']);
    expect(availability.supported).toBe(false);
    expect(availability.unsupportedClients).toEqual(['surge']);
  });

  it('keeps a module available when at least one app supports it', () => {
    expect(describeModuleAvailability(['mihomo', 'sing-box'], ['mihomo', 'surge'])).toEqual({
      supported: true,
      unsupportedClients: ['surge'],
    });
  });

  it('does not grey out anything before any app is chosen, or for modules without a list', () => {
    expect(describeModuleAvailability(['mihomo'], [])).toEqual({ supported: true, unsupportedClients: [] });
    expect(describeModuleAvailability(undefined, ['surge'])).toEqual({ supported: true, unsupportedClients: [] });
    expect(describeModuleAvailability(['mihomo'], mihomoOnly).supported).toBe(true);
  });

  it('blocks enabling two conflicting modules and explains why', () => {
    const modules: TemplateModuleBinding[] = [
      { id: 'dns-leak-guard', enabled: true },
      { id: 'block-encrypted-dns', enabled: false },
    ];
    const blocked = checkModuleToggleConflict(modules, 'block-encrypted-dns', true);
    expect(blocked.allowed).toBe(false);
    expect(blocked.conflictWith).toBe('dns-leak-guard');
    expect(blocked.reason).toContain('DNS');

    expect(checkModuleToggleConflict(modules, 'block-encrypted-dns', false).allowed).toBe(true);
    expect(checkModuleToggleConflict(modules, 'sniffer', true).allowed).toBe(true);
  });

  it('appends and replaces module overlay ops in place', () => {
    const first = appendOverlayOp([], { op: 'setModule', moduleId: 'sniffer', enabled: true });
    const second = appendOverlayOp(first, { op: 'setModule', moduleId: 'sniffer', enabled: false });
    expect(second).toEqual([{ op: 'setModule', moduleId: 'sniffer', enabled: false }]);
    const withPool = appendOverlayOp(second, { op: 'removePool', poolId: 'region-jp' });
    expect(withPool).toHaveLength(2);
  });
});
