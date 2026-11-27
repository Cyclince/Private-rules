import type { TemplateClientId } from '../../shared/clients';
import type { AppCard, PolicyRef } from '../../shared/schemas/card';
import type {
  QuickCreatePreviewSummary,
  QuickCreateScenarioInput,
  WizardGroupMode,
  WizardRouteTarget,
  WizardScenarioId,
} from '../../shared/schemas/quick-create';
import type { RegionGroup, TemplateBody, TemplateCardRef } from '../../shared/schemas/template';
import { getRegionDefinition } from '../nodes/regions';
import { DEFAULT_HEALTH_CHECK } from './model';

export type WizardPresetTier = 'less' | 'recommended' | 'all';
export type LegacyWizardPresetTier = 'minimal' | 'light' | 'standard' | 'heavy';
export type AnyWizardPresetTier = WizardPresetTier | LegacyWizardPresetTier;

export function normalizeWizardPresetTier(tier: AnyWizardPresetTier): WizardPresetTier {
  if (tier === 'less' || tier === 'recommended' || tier === 'all') return tier;
  if (tier === 'minimal' || tier === 'light') return 'less';
  if (tier === 'standard') return 'recommended';
  return 'all';
}

export type WizardScenarioDefinition = {
  id: WizardScenarioId;
  defaultEnabled: boolean;
  configurableRoute: boolean;
  defaultRoute: WizardRouteTarget;
  cardIds: readonly string[];
};

/**
 * Exact scenario-to-built-in-card mapping from plan §4.6.
 */
export const WIZARD_SCENARIO_DEFINITIONS: readonly WizardScenarioDefinition[] = [
  {
    id: 'domestic-direct',
    defaultEnabled: true,
    configurableRoute: false,
    defaultRoute: 'direct',
    cardIds: ['lan-direct', 'custom-direct', 'domestic-direct'],
  },
  {
    id: 'ad-block',
    defaultEnabled: true,
    configurableRoute: false,
    defaultRoute: 'reject',
    cardIds: ['ad-block'],
  },
  {
    id: 'ai',
    defaultEnabled: true,
    configurableRoute: true,
    defaultRoute: 'auto',
    cardIds: ['openai', 'ai-services'],
  },
  {
    id: 'telegram',
    defaultEnabled: true,
    configurableRoute: true,
    defaultRoute: 'proxy',
    cardIds: ['telegram'],
  },
  {
    id: 'streaming',
    defaultEnabled: true,
    configurableRoute: true,
    defaultRoute: 'proxy',
    cardIds: ['youtube', 'netflix', 'disney-plus', 'spotify', 'tiktok'],
  },
  {
    id: 'bilibili-hkmt',
    defaultEnabled: false,
    configurableRoute: true,
    defaultRoute: 'proxy',
    cardIds: ['bilibili-hkmt'],
  },
  {
    id: 'social',
    defaultEnabled: false,
    configurableRoute: true,
    defaultRoute: 'proxy',
    cardIds: ['twitter', 'discord'],
  },
  {
    id: 'github',
    defaultEnabled: false,
    configurableRoute: true,
    defaultRoute: 'proxy',
    cardIds: ['github'],
  },
  {
    id: 'gaming',
    defaultEnabled: false,
    configurableRoute: true,
    defaultRoute: 'proxy',
    cardIds: ['steam', 'gaming-platforms'],
  },
  {
    id: 'apple-ms-google',
    defaultEnabled: false,
    configurableRoute: true,
    defaultRoute: 'proxy',
    cardIds: ['apple', 'microsoft', 'onedrive', 'google', 'google-fcm'],
  },
];

export const WIZARD_SCENARIO_MAP = new Map<WizardScenarioId, WizardScenarioDefinition>(
  WIZARD_SCENARIO_DEFINITIONS.map((def) => [def.id, def]),
);

/**
 * Always-enabled infrastructure & fallback cards (plan §4.6).
 * Not shown as toggleable switches in the wizard.
 */
export const ALWAYS_ENABLED_CARD_IDS: readonly string[] = [
  'auto-select',
  'proxy-select',
  'gfw-proxy',
  'proxy-ip',
  'non-standard-ports',
  'speedtest',
  'final-fallback',
];

/** Canonical 7-layer stage order of all built-in cards. */
export const CANONICAL_BUILTIN_CARD_ORDER: readonly string[] = [
  // Hidden core hubs
  'auto-select',
  'proxy-select',
  // Stage 1: pre-direct
  'lan-direct',
  'custom-direct',
  'ad-block',
  // Stage 2: app
  'openai',
  'ai-services',
  'telegram',
  'twitter',
  'discord',
  'youtube',
  'netflix',
  'disney-plus',
  'bilibili-hkmt',
  'spotify',
  'tiktok',
  'github',
  'google-fcm',
  'google',
  'apple',
  'onedrive',
  'microsoft',
  'steam',
  'gaming-platforms',
  'speedtest',
  // Stage 3: proxy-fallback
  'gfw-proxy',
  // Stage 4: ip
  'proxy-ip',
  // Stage 5: domestic
  'domestic-direct',
  // Stage 6: port
  'non-standard-ports',
  // Stage 7: final
  'final-fallback',
];

export const CORE_REGION_CODES: readonly string[] = ['HK', 'TW', 'JP', 'SG', 'US', 'KR'];

export function buildRegionGroupId(code: string): string {
  return `region-${code.trim().toLowerCase()}`;
}

export function buildRegionGroupForCode(code: string): RegionGroup | null {
  const normalized = code.trim().toUpperCase();
  const def = getRegionDefinition(normalized);
  if (!def) return null;
  return {
    id: buildRegionGroupId(def.code),
    name: `${def.flag} ${def.nameZh}节点`,
    region: def.code,
    type: 'url-test',
    slotId: 'slot-main',
    test: { ...DEFAULT_HEALTH_CHECK },
  };
}

export function buildCoreRegionGroups(): RegionGroup[] {
  return CORE_REGION_CODES.map((code) => buildRegionGroupForCode(code)).filter(
    (item): item is RegionGroup => item !== null,
  );
}

/**
 * Infers default route destination for a user ruleset based on its name (plan §4.2):
 *   - Contains Direct / 直连 -> 'direct'
 *   - Contains Reject / AD / 广告 / 拦截 -> 'reject'
 *   - Otherwise -> 'proxy'
 */
export function inferDefaultRouteForRulesetName(name: string): WizardRouteTarget {
  const trimmed = name.trim();
  if (!trimmed) return 'proxy';

  if (/(?:direct|直连|直連)/i.test(trimmed)) {
    return 'direct';
  }

  if (
    /(?:reject|广告|廣告|拦截|攔截|adblock|adguard)/i.test(trimmed) ||
    /(?:^|[^a-z])ad(?:s)?(?:$|[^a-z])/i.test(trimmed) ||
    /(?<![A-Z])AD(?![a-z])/.test(trimmed)
  ) {
    return 'reject';
  }

  return 'proxy';
}

const PRESET_ENABLED_SCENARIOS: Readonly<Record<WizardPresetTier, readonly WizardScenarioId[]>> = {
  less: ['domestic-direct', 'ai'],
  recommended: ['domestic-direct', 'ad-block', 'ai', 'telegram', 'streaming'],
  all: WIZARD_SCENARIO_DEFINITIONS.map((def) => def.id),
};

/**
 * Returns the scenario checkbox map for one of the 3 quick presets in wizard step 2 (D4, §5.2).
 * Accepts legacy 4-tier names (`minimal` / `light` / `standard` / `heavy`) for compatibility.
 */
export function getPresetScenarioSelection(tier: AnyWizardPresetTier): Record<WizardScenarioId, boolean> {
  const canonical = normalizeWizardPresetTier(tier);
  const enabledSet = new Set<WizardScenarioId>(PRESET_ENABLED_SCENARIOS[canonical]);
  const result = {} as Record<WizardScenarioId, boolean>;
  for (const def of WIZARD_SCENARIO_DEFINITIONS) {
    result[def.id] = enabledSet.has(def.id);
  }
  return result;
}

/**
 * Returns the matching preset tier if the current scenario checkbox map matches
 * one of the 3 presets exactly, otherwise `null`.
 */
export function detectMatchingPresetTier(
  selection: Readonly<Record<WizardScenarioId, boolean>>,
): WizardPresetTier | null {
  for (const tier of ['less', 'recommended', 'all'] as const) {
    const expected = getPresetScenarioSelection(tier);
    const matches = WIZARD_SCENARIO_DEFINITIONS.every((def) => Boolean(selection[def.id]) === expected[def.id]);
    if (matches) return tier;
  }
  return null;
}

export function getDefaultWizardScenarios(): QuickCreateScenarioInput[] {
  return WIZARD_SCENARIO_DEFINITIONS.map((def) => ({
    id: def.id,
    enabled: def.defaultEnabled,
    ...(def.configurableRoute ? { route: def.defaultRoute } : {}),
  }));
}

export type WizardClientOptionId =
  | 'clash-verge-rev'
  | 'flclash'
  | 'clash-party'
  | 'sing-box'
  | 'shadowrocket'
  | 'stash'
  | 'surge'
  | 'loon'
  | 'quantumult-x';

export type WizardClientOption = {
  id: WizardClientOptionId;
  client: TemplateClientId;
  displayName: string;
  shortDisplayNameZh: string;
  shortDisplayNameEn: string;
  groups: readonly ('desktop-android' | 'apple')[];
};

export const WIZARD_CLIENT_OPTIONS: readonly WizardClientOption[] = [
  {
    id: 'clash-verge-rev',
    client: 'mihomo',
    displayName: 'Clash Verge Rev',
    shortDisplayNameZh: 'Clash Verge Rev',
    shortDisplayNameEn: 'Clash Verge Rev',
    groups: ['desktop-android'],
  },
  {
    id: 'flclash',
    client: 'mihomo',
    displayName: 'FlClash',
    shortDisplayNameZh: 'FlClash',
    shortDisplayNameEn: 'FlClash',
    groups: ['desktop-android'],
  },
  {
    id: 'clash-party',
    client: 'mihomo',
    displayName: 'Clash Party',
    shortDisplayNameZh: 'Clash Party',
    shortDisplayNameEn: 'Clash Party',
    groups: ['desktop-android'],
  },
  {
    id: 'sing-box',
    client: 'sing-box',
    displayName: 'sing-box',
    shortDisplayNameZh: 'sing-box',
    shortDisplayNameEn: 'sing-box',
    groups: ['desktop-android', 'apple'],
  },
  {
    id: 'shadowrocket',
    client: 'shadowrocket',
    displayName: 'Shadowrocket',
    shortDisplayNameZh: '小火箭',
    shortDisplayNameEn: 'Shadowrocket',
    groups: ['apple'],
  },
  {
    id: 'stash',
    client: 'stash',
    displayName: 'Stash',
    shortDisplayNameZh: 'Stash',
    shortDisplayNameEn: 'Stash',
    groups: ['apple'],
  },
  {
    id: 'surge',
    client: 'surge',
    displayName: 'Surge',
    shortDisplayNameZh: 'Surge',
    shortDisplayNameEn: 'Surge',
    groups: ['apple'],
  },
  {
    id: 'loon',
    client: 'loon',
    displayName: 'Loon',
    shortDisplayNameZh: 'Loon',
    shortDisplayNameEn: 'Loon',
    groups: ['apple'],
  },
  {
    id: 'quantumult-x',
    client: 'quantumult-x',
    displayName: 'Quantumult X',
    shortDisplayNameZh: '圈X',
    shortDisplayNameEn: 'Quantumult X',
    groups: ['apple'],
  },
];

const WIZARD_CLIENT_OPTION_MAP = new Map<WizardClientOptionId, WizardClientOption>(
  WIZARD_CLIENT_OPTIONS.map((opt) => [opt.id, opt]),
);

/**
 * Maps selected wizard client option IDs into deduplicated `TEMPLATE_CLIENTS` IDs
 * while preserving user-facing display names (Clash Verge Rev / FlClash / Clash Party -> mihomo).
 */
export function mapWizardClientSelection(selectedIds: readonly WizardClientOptionId[]): {
  clients: TemplateClientId[];
  clientDisplayNames: string[];
  clientLabels: Partial<Record<TemplateClientId, string>>;
} {
  const seenOptions = new Set<WizardClientOptionId>();
  const clients: TemplateClientId[] = [];
  const seenClients = new Set<TemplateClientId>();
  const clientDisplayNames: string[] = [];
  const namesByClient = new Map<TemplateClientId, string[]>();

  for (const optId of selectedIds) {
    if (seenOptions.has(optId)) continue;
    const opt = WIZARD_CLIENT_OPTION_MAP.get(optId);
    if (!opt) continue;
    seenOptions.add(optId);
    clientDisplayNames.push(opt.displayName);
    if (!seenClients.has(opt.client)) {
      seenClients.add(opt.client);
      clients.push(opt.client);
    }
    const existingNames = namesByClient.get(opt.client) ?? [];
    existingNames.push(opt.displayName);
    namesByClient.set(opt.client, existingNames);
  }

  const clientLabels: Partial<Record<TemplateClientId, string>> = {};
  for (const [client, names] of namesByClient) {
    clientLabels[client] = names.join(' / ');
  }

  return { clients, clientDisplayNames, clientLabels };
}

function dedupePolicyRefs(refs: readonly PolicyRef[]): PolicyRef[] {
  const result: PolicyRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key =
      ref.kind === 'builtin'
        ? `builtin:${ref.id}`
        : ref.kind === 'card'
          ? `card:${ref.cardId}`
          : ref.kind === 'region'
            ? `region:${ref.regionGroupId}`
            : `slot:${ref.slotId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

export function extractRegionCodeFromRoute(route: WizardRouteTarget | undefined): string | null {
  if (!route || !route.startsWith('region:')) return null;
  const code = route.slice('region:'.length).trim().toUpperCase();
  return code || null;
}

/**
 * Resolves the template's `regionGroups` according to `groupMode` (plan §5):
 *   - `auto`: no region groups (except explicitly routed region targets)
 *   - `select`: no region groups (except explicitly routed region targets)
 *   - `region`: only regions present in subscription nodes, or `CORE_REGION_GROUPS` when no subscription
 */
export function resolveWizardRegionGroups(options: {
  groupMode: WizardGroupMode;
  hasSubscription: boolean;
  detectedRegions?: readonly string[];
  requiredRegionCodes?: readonly string[];
}): RegionGroup[] {
  const codes: string[] = [];
  const seen = new Set<string>();
  const addCode = (raw: string) => {
    const normalized = raw.trim().toUpperCase();
    if (!normalized || seen.has(normalized)) return;
    if (!getRegionDefinition(normalized)) return;
    seen.add(normalized);
    codes.push(normalized);
  };

  if (options.groupMode === 'region') {
    const validDetected = (options.detectedRegions ?? []).filter((code) => Boolean(getRegionDefinition(code)));
    if (options.hasSubscription && validDetected.length > 0) {
      for (const code of validDetected) addCode(code);
    } else {
      for (const code of CORE_REGION_CODES) addCode(code);
    }
  }

  for (const code of options.requiredRegionCodes ?? []) {
    addCode(code);
  }

  return codes.map((code) => buildRegionGroupForCode(code)).filter((item): item is RegionGroup => item !== null);
}

/**
 * Maps a wizard route destination (`proxy | auto | direct | reject | region:XX`)
 * to ordered `PolicyRef[]` candidates.
 */
export function buildRouteCandidates(
  route: WizardRouteTarget,
  options: {
    availableRegionGroupIds: readonly string[];
    groupMode: WizardGroupMode;
  },
): PolicyRef[] {
  const regionRefs: PolicyRef[] = options.availableRegionGroupIds.map((regionGroupId) => ({
    kind: 'region',
    regionGroupId,
  }));

  if (route === 'direct') {
    return dedupePolicyRefs([
      { kind: 'builtin', id: 'DIRECT' },
      { kind: 'card', cardId: options.groupMode === 'auto' ? 'auto-select' : 'proxy-select' },
    ]);
  }

  if (route === 'reject') {
    return dedupePolicyRefs([
      { kind: 'builtin', id: 'REJECT' },
      { kind: 'builtin', id: 'REJECT-DROP' },
      { kind: 'builtin', id: 'DIRECT' },
    ]);
  }

  if (route === 'auto') {
    return dedupePolicyRefs([
      { kind: 'card', cardId: 'auto-select' },
      { kind: 'card', cardId: 'proxy-select' },
      ...regionRefs,
      { kind: 'builtin', id: 'DIRECT' },
    ]);
  }

  if (route.startsWith('region:')) {
    const code = route.slice('region:'.length).toUpperCase();
    const regionGroupId = buildRegionGroupId(code);
    const hasRegion = options.availableRegionGroupIds.includes(regionGroupId);
    return dedupePolicyRefs([
      ...(hasRegion ? [{ kind: 'region' as const, regionGroupId }] : []),
      { kind: 'card', cardId: options.groupMode === 'auto' ? 'auto-select' : 'proxy-select' },
      { kind: 'card', cardId: 'auto-select' },
      { kind: 'card', cardId: 'proxy-select' },
      { kind: 'builtin', id: 'DIRECT' },
    ]);
  }

  // 'proxy'
  return dedupePolicyRefs([
    { kind: 'card', cardId: 'proxy-select' },
    { kind: 'card', cardId: 'auto-select' },
    ...regionRefs,
    { kind: 'builtin', id: 'DIRECT' },
  ]);
}

export type QuickCreateResolvedRuleset = {
  rulesetId: string;
  name: string;
  slug: string;
  route: WizardRouteTarget;
  cardId: string;
  cardSlug: string;
};

export type BuildQuickCreateTemplateBodyInput = {
  standardBaseBody: TemplateBody;
  builtinCards: readonly AppCard[];
  scenarios: readonly QuickCreateScenarioInput[];
  rulesets: readonly QuickCreateResolvedRuleset[];
  groupMode: WizardGroupMode;
  hasSubscription: boolean;
  detectedRegions?: readonly string[];
  clientDisplayNames?: readonly string[];
  clientLabels?: Partial<Record<TemplateClientId, string>>;
  previewSummary?: QuickCreatePreviewSummary;
};

export type BuildQuickCreateTemplateBodyResult = {
  body: TemplateBody;
  generatedCards: AppCard[];
  normalizedScenarios: QuickCreateScenarioInput[];
};

/**
 * Pure domain builder for `POST /api/templates/quick-create`:
 * starts from the built-in "标准模板", toggles scenarios per §4.6,
 * prepends user ruleset cards in exact input order, maps routes and `groupMode`,
 * and embeds `wizardMeta` for M2b simple-view editing.
 */
export function buildQuickCreateTemplateBody(
  input: BuildQuickCreateTemplateBodyInput,
): BuildQuickCreateTemplateBodyResult {
  const builtinCardMap = new Map<string, AppCard>(input.builtinCards.map((card) => [card.id, card]));

  // Normalize scenarios: start from §4.6 defaults and overlay user selections
  const scenarioOverrideMap = new Map<WizardScenarioId, QuickCreateScenarioInput>();
  for (const item of input.scenarios) {
    scenarioOverrideMap.set(item.id, item);
  }
  const normalizedScenarios: QuickCreateScenarioInput[] = WIZARD_SCENARIO_DEFINITIONS.map((def) => {
    const provided = scenarioOverrideMap.get(def.id);
    const enabled = provided ? provided.enabled : def.defaultEnabled;
    const route = def.configurableRoute ? (provided?.route ?? def.defaultRoute) : def.defaultRoute;
    return {
      id: def.id,
      enabled,
      ...(def.configurableRoute ? { route } : {}),
    };
  });

  // Collect any region codes explicitly referenced by enabled scenarios or rulesets
  const requiredRegionCodes: string[] = [];
  for (const sc of normalizedScenarios) {
    if (!sc.enabled) continue;
    const code = extractRegionCodeFromRoute(sc.route);
    if (code) requiredRegionCodes.push(code);
  }
  for (const rs of input.rulesets) {
    const code = extractRegionCodeFromRoute(rs.route);
    if (code) requiredRegionCodes.push(code);
  }

  const regionGroups = resolveWizardRegionGroups({
    groupMode: input.groupMode,
    hasSubscription: input.hasSubscription,
    detectedRegions: input.detectedRegions,
    requiredRegionCodes,
  });
  const availableRegionGroupIds = regionGroups.map((group) => group.id);
  const availableRegionSet = new Set(availableRegionGroupIds);
  const regionRefs: PolicyRef[] = availableRegionGroupIds.map((regionGroupId) => ({
    kind: 'region',
    regionGroupId,
  }));

  // 1. Build generated AppCard records for referenced rulesets (ordered as input)
  const generatedCards: AppCard[] = input.rulesets.map((rs) => ({
    id: rs.cardId,
    slug: rs.cardSlug,
    name: rs.name,
    category: 'other',
    stage: 'pre-direct',
    origin: 'user',
    group: {
      type: 'select',
      candidates: buildRouteCandidates(rs.route, {
        availableRegionGroupIds,
        groupMode: input.groupMode,
      }),
    },
    matchers: [{ kind: 'ruleset', ruleSetId: rs.rulesetId, updateIntervalSec: 1800 }],
  }));

  // 2. Determine enabled built-in cards and per-card route overrides
  const enabledBuiltinCardIds = new Set<string>(ALWAYS_ENABLED_CARD_IDS);
  const cardRouteOverride = new Map<string, WizardRouteTarget>();

  for (const sc of normalizedScenarios) {
    const def = WIZARD_SCENARIO_MAP.get(sc.id);
    if (!def) continue;
    if (!sc.enabled) continue;
    for (const cardId of def.cardIds) {
      enabledBuiltinCardIds.add(cardId);
      if (def.configurableRoute && sc.route) {
        cardRouteOverride.set(cardId, sc.route);
      }
    }
  }

  const filterExistingRegions = (candidates: readonly PolicyRef[]): PolicyRef[] =>
    candidates.filter((ref) => ref.kind !== 'region' || availableRegionSet.has(ref.regionGroupId));

  const buildProxySelectRef = (): TemplateCardRef => {
    const candidates: PolicyRef[] =
      input.groupMode === 'select'
        ? dedupePolicyRefs([
            { kind: 'slot', slotId: 'slot-main' },
            { kind: 'card', cardId: 'auto-select' },
            ...regionRefs,
            { kind: 'builtin', id: 'DIRECT' },
          ])
        : input.groupMode === 'region'
          ? dedupePolicyRefs([
              { kind: 'card', cardId: 'auto-select' },
              ...regionRefs,
              { kind: 'slot', slotId: 'slot-main' },
              { kind: 'builtin', id: 'DIRECT' },
            ])
          : dedupePolicyRefs([
              { kind: 'card', cardId: 'auto-select' },
              ...regionRefs,
              { kind: 'slot', slotId: 'slot-main' },
              { kind: 'builtin', id: 'DIRECT' },
            ]);
    return {
      cardId: 'proxy-select',
      enabled: true,
      overrides: {
        group: {
          type: 'select',
          candidates,
        },
      },
    };
  };

  // 3. Assemble final ordered cards:
  //    [auto-select, proxy-select] -> [user ruleset cards in input order] -> [enabled built-in cards in 7-layer order]
  const cards: TemplateCardRef[] = [
    { cardId: 'auto-select', enabled: true },
    buildProxySelectRef(),
    ...generatedCards.map((card): TemplateCardRef => ({ cardId: card.id, enabled: true })),
  ];

  for (const cardId of CANONICAL_BUILTIN_CARD_ORDER) {
    if (cardId === 'auto-select' || cardId === 'proxy-select') continue;
    if (!enabledBuiltinCardIds.has(cardId)) continue;
    const baseCard = builtinCardMap.get(cardId);
    if (!baseCard) continue;

    const explicitRoute = cardRouteOverride.get(cardId);
    if (explicitRoute) {
      cards.push({
        cardId,
        enabled: true,
        overrides: {
          group: {
            candidates: buildRouteCandidates(explicitRoute, {
              availableRegionGroupIds,
              groupMode: input.groupMode,
            }),
          },
        },
      });
      continue;
    }

    // Always-on routing cards: prefer auto-select in 'auto' mode and strip unavailable region refs
    if (cardId === 'gfw-proxy' || cardId === 'proxy-ip' || cardId === 'final-fallback') {
      const baseFiltered = filterExistingRegions(baseCard.group.candidates);
      const adjusted =
        input.groupMode === 'auto'
          ? dedupePolicyRefs([{ kind: 'card', cardId: 'auto-select' }, ...baseFiltered])
          : dedupePolicyRefs(baseFiltered);
      const changed = JSON.stringify(adjusted) !== JSON.stringify(baseCard.group.candidates);
      cards.push(
        changed
          ? {
              cardId,
              enabled: true,
              overrides: { group: { candidates: adjusted } },
            }
          : { cardId, enabled: true },
      );
      continue;
    }

    // Other non-configurable built-in cards (lan-direct, custom-direct, ad-block, domestic-direct, speedtest, non-standard-ports)
    const filtered = filterExistingRegions(baseCard.group.candidates);
    const changed = filtered.length !== baseCard.group.candidates.length;
    cards.push(
      changed
        ? {
            cardId,
            enabled: true,
            overrides: { group: { candidates: filtered } },
          }
        : { cardId, enabled: true },
    );
  }

  const baseBody = structuredClone(input.standardBaseBody);
  const body: TemplateBody = {
    ...baseBody,
    regionGroups,
    cards,
    groupMode: 'select',
    final: { kind: 'card', cardId: 'final-fallback' },
    output: 'full',
    wizardMeta: {
      createdByWizard: true,
      groupMode: input.groupMode,
      ...(input.clientDisplayNames && input.clientDisplayNames.length > 0
        ? { clientDisplayNames: [...input.clientDisplayNames] }
        : {}),
      ...(input.clientLabels && Object.keys(input.clientLabels).length > 0
        ? { clientLabels: { ...input.clientLabels } }
        : {}),
      scenarios: normalizedScenarios,
      rulesets: input.rulesets.map((rs) => ({ rulesetId: rs.rulesetId, route: rs.route })),
      ...(input.previewSummary ? { previewSummary: input.previewSummary } : {}),
    },
  };

  return { body, generatedCards, normalizedScenarios };
}
