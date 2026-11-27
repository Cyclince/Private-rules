import type { QuickCreateScenarioInput, WizardRouteTarget, WizardScenarioId } from './schemas/quick-create';

/**
 * Lightweight, zero-dependency mapping between wizard scenario IDs and built-in
 * card IDs so list and simple-detail routes do not pull in the full
 * quick-create / regions domain bundle.
 */
export const SCENARIO_CARD_IDS: Readonly<Record<WizardScenarioId, readonly string[]>> = {
  'domestic-direct': ['lan-direct', 'domestic-direct', 'custom-direct'],
  'ad-block': ['ad-block'],
  ai: ['openai', 'ai-services'],
  telegram: ['telegram'],
  streaming: ['youtube', 'netflix', 'disney-plus', 'tiktok', 'spotify'],
  'bilibili-hkmt': ['bilibili-hkmt'],
  social: ['twitter', 'discord'],
  github: ['github'],
  gaming: ['gaming'],
  'apple-ms-google': ['apple', 'microsoft', 'google', 'onedrive'],
};

export const CARD_TO_SCENARIO_ID: ReadonlyMap<string, WizardScenarioId> = new Map(
  (Object.entries(SCENARIO_CARD_IDS) as Array<[WizardScenarioId, readonly string[]]>).flatMap(([scenarioId, cardIds]) =>
    cardIds.map((cardId) => [cardId, scenarioId] as const),
  ),
);

export type SimplePresetTier = 'minimal' | 'light' | 'standard' | 'heavy';

type SimpleScenarioMeta = {
  id: WizardScenarioId;
  configurableRoute: boolean;
  defaultRoute: WizardRouteTarget;
  presetEnabled: Record<SimplePresetTier, boolean>;
};

export const SIMPLE_SCENARIO_METAS: readonly SimpleScenarioMeta[] = [
  {
    id: 'domestic-direct',
    configurableRoute: false,
    defaultRoute: 'direct',
    presetEnabled: { minimal: true, light: true, standard: true, heavy: true },
  },
  {
    id: 'ad-block',
    configurableRoute: false,
    defaultRoute: 'reject',
    presetEnabled: { minimal: false, light: true, standard: true, heavy: true },
  },
  {
    id: 'ai',
    configurableRoute: true,
    defaultRoute: 'proxy',
    presetEnabled: { minimal: false, light: true, standard: true, heavy: true },
  },
  {
    id: 'telegram',
    configurableRoute: true,
    defaultRoute: 'proxy',
    presetEnabled: { minimal: false, light: false, standard: true, heavy: true },
  },
  {
    id: 'streaming',
    configurableRoute: true,
    defaultRoute: 'proxy',
    presetEnabled: { minimal: false, light: false, standard: true, heavy: true },
  },
  {
    id: 'bilibili-hkmt',
    configurableRoute: true,
    defaultRoute: 'direct',
    presetEnabled: { minimal: false, light: false, standard: true, heavy: true },
  },
  {
    id: 'social',
    configurableRoute: true,
    defaultRoute: 'proxy',
    presetEnabled: { minimal: false, light: false, standard: true, heavy: true },
  },
  {
    id: 'github',
    configurableRoute: true,
    defaultRoute: 'proxy',
    presetEnabled: { minimal: false, light: false, standard: true, heavy: true },
  },
  {
    id: 'gaming',
    configurableRoute: true,
    defaultRoute: 'direct',
    presetEnabled: { minimal: false, light: false, standard: true, heavy: true },
  },
  {
    id: 'apple-ms-google',
    configurableRoute: true,
    defaultRoute: 'proxy',
    presetEnabled: { minimal: false, light: false, standard: false, heavy: true },
  },
];

export function getSimplePresetScenarios(tier: SimplePresetTier): QuickCreateScenarioInput[] {
  return SIMPLE_SCENARIO_METAS.map((meta) => ({
    id: meta.id,
    enabled: meta.presetEnabled[tier],
    route: meta.defaultRoute,
  }));
}

export function detectSimplePresetTier(
  scenarios: readonly Pick<QuickCreateScenarioInput, 'id' | 'enabled'>[],
): SimplePresetTier | null {
  const byId = new Map(scenarios.map((s) => [s.id, s.enabled]));
  for (const tier of ['minimal', 'light', 'standard', 'heavy'] as const) {
    const matches = SIMPLE_SCENARIO_METAS.every((meta) => Boolean(byId.get(meta.id)) === meta.presetEnabled[tier]);
    if (matches) return tier;
  }
  return null;
}

export function inferSimpleRulesetDefaultRoute(name: string): WizardRouteTarget {
  const lower = name.toLowerCase();
  if (/(direct|cn|china|domestic|local|lan|直连|国内|本地|白名单)/i.test(lower)) return 'direct';
  if (/(reject|block|ad|ads|privacy|track|拦截|去广告|广告|屏蔽)/i.test(lower)) return 'reject';
  return 'proxy';
}
