import { findRegionByQuery, getRegionDefinition } from '../../../../domain/nodes/regions';
import { ENHANCEMENT_MODULE_METADATA } from '../../../../domain/templates/modules/metadata';
import type { PrimaryCatalogCategory } from '../../../../shared/app-categories';
import { getApp, type AppDefinition } from '../../../../shared/apps';
import type { TemplateClientId } from '../../../../shared/clients';
import {
  MAX_TEMPLATE_SUBSCRIPTIONS,
  type ComplexityTier,
  type NodeCombineMode,
  type PreviewSubscriptionErrorCode,
  type QuickCreatePreviewSummary,
  type QuickCreateScenarioInput,
  type QuickCreateTemplateRequest,
  type WizardGroupMode,
  type WizardRouteTarget,
  type WizardScenarioId,
} from '../../../../shared/schemas/quick-create';
import {
  APP_PICKER_RECOMMENDATIONS,
  guessAppPickerPlatform,
  readStoredAppPickerPlatform,
  type AppPickerPlatform,
} from '../../apps/AppPicker';
import { readStoredSelectedAppId } from '../../apps/app-selection';

export type WizardStepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type WizardStep = WizardStepNumber | 'done';
export type WizardDirection = 'forward' | 'backward';
export type WizardStepStatus = 'active' | 'completed' | 'skipped' | 'pending';

export const WIZARD_STEPS: readonly WizardStepNumber[] = [1, 2, 3, 4, 5, 6, 7, 8];
export const TOTAL_WIZARD_STEPS = 8;

export const WIZARD_CORE_REGION_CODES = ['HK', 'TW', 'JP', 'SG', 'US', 'KR'] as const;
export const WIZARD_ALL_REGION_CODES = [
  'HK',
  'TW',
  'JP',
  'SG',
  'US',
  'KR',
  'GB',
  'DE',
  'FR',
  'NL',
  'CA',
  'AU',
] as const;

export type WizardSubscriptionRow = {
  id: string;
  name: string;
  url: string;
  preview: {
    nodeCount: number;
    regions: Array<{ code: string; name: string; emoji: string; count: number }>;
    regionCounts: Record<string, number>;
    checkedAt: string;
  } | null;
  errorCode: PreviewSubscriptionErrorCode | null;
  lastCheckedUrl: string;
};

export type WizardComplexityCardDef = {
  id: ComplexityTier;
  icon: string;
  recommended: boolean;
};

export const WIZARD_COMPLEXITY_CARDS: readonly WizardComplexityCardDef[] = [
  { id: 'simple', icon: '🌱', recommended: true },
  { id: 'advanced', icon: '🌿', recommended: false },
  { id: 'pro', icon: '🌳', recommended: false },
];

export type WizardScenarioCardDef = {
  id: WizardScenarioId;
  category: PrimaryCatalogCategory;
  icon: string;
  defaultEnabled: boolean;
  configurableRoute: boolean;
  defaultRoute: WizardRouteTarget;
};

export const WIZARD_SCENARIO_CATALOG: readonly WizardScenarioCardDef[] = [
  {
    id: 'ai',
    category: 'ai',
    icon: '🤖',
    defaultEnabled: true,
    configurableRoute: true,
    defaultRoute: 'auto',
  },
  {
    id: 'telegram',
    category: 'social',
    icon: '✈️',
    defaultEnabled: true,
    configurableRoute: true,
    defaultRoute: 'proxy',
  },
  {
    id: 'social',
    category: 'social',
    icon: '💬',
    defaultEnabled: false,
    configurableRoute: true,
    defaultRoute: 'proxy',
  },
  {
    id: 'streaming',
    category: 'streaming',
    icon: '🎬',
    defaultEnabled: true,
    configurableRoute: true,
    defaultRoute: 'proxy',
  },
  {
    id: 'bilibili-hkmt',
    category: 'regional-streaming',
    icon: '📺',
    defaultEnabled: false,
    configurableRoute: true,
    defaultRoute: 'proxy',
  },
  {
    id: 'gaming',
    category: 'gaming',
    icon: '🎮',
    defaultEnabled: false,
    configurableRoute: true,
    defaultRoute: 'proxy',
  },
  {
    id: 'github',
    category: 'developer',
    icon: '🛠️',
    defaultEnabled: false,
    configurableRoute: true,
    defaultRoute: 'proxy',
  },
  {
    id: 'apple-ms-google',
    category: 'cloud-office',
    icon: '☁️',
    defaultEnabled: false,
    configurableRoute: true,
    defaultRoute: 'proxy',
  },
  {
    id: 'ad-block',
    category: 'privacy',
    icon: '🛡️',
    defaultEnabled: true,
    configurableRoute: false,
    defaultRoute: 'reject',
  },
  {
    id: 'domestic-direct',
    category: 'domestic',
    icon: '🏠',
    defaultEnabled: true,
    configurableRoute: false,
    defaultRoute: 'direct',
  },
];

export type WizardTraitPoolPreset = {
  id: 'pool-trait-low-rate' | 'pool-trait-residential' | 'pool-trait-dedicated' | 'pool-trait-gaming';
  icon: string;
};

export const WIZARD_TRAIT_POOL_PRESETS: readonly WizardTraitPoolPreset[] = [
  { id: 'pool-trait-low-rate', icon: '🏷️' },
  { id: 'pool-trait-residential', icon: '🏠' },
  { id: 'pool-trait-dedicated', icon: '🚄' },
  { id: 'pool-trait-gaming', icon: '🎮' },
];

export type WizardState = {
  step: WizardStep;
  direction: WizardDirection;
  maxReachedStep: WizardStepNumber;
  selectedAppIds: string[];
  subscriptions: WizardSubscriptionRow[];
  skipSubscription: boolean;
  combineMode: NodeCombineMode;
  complexity: ComplexityTier;
  scenarios: QuickCreateScenarioInput[];
  scenariosTouched: boolean;
  selectedRulesetIds: string[];
  rulesetRoutes: Record<string, WizardRouteTarget>;
  groupMode: WizardGroupMode;
  selectedRegions: string[];
  regionsTouched: boolean;
  includeProviderPools: boolean;
  selectedTraitPoolIds: string[];
  modules: Record<string, boolean>;
  modulesTouched: boolean;
  templateName: string;
};

/** Returns true when a step is intentionally skipped for the selected complexity tier. */
export function isStepSkippedForTier(step: WizardStepNumber, complexity: ComplexityTier): boolean {
  if (complexity === 'simple') {
    return step === 4 || step === 6 || step === 7;
  }
  return false;
}

/** Advances to the next non-skipped wizard step, or null after step 8. */
export function getNextWizardStep(current: WizardStepNumber, complexity: ComplexityTier): WizardStepNumber | null {
  for (let next = current + 1; next <= TOTAL_WIZARD_STEPS; next += 1) {
    const candidate = next as WizardStepNumber;
    if (!isStepSkippedForTier(candidate, complexity)) return candidate;
  }
  return null;
}

/** Moves back to the previous non-skipped wizard step, or null before step 1. */
export function getPrevWizardStep(current: WizardStepNumber, complexity: ComplexityTier): WizardStepNumber | null {
  for (let prev = current - 1; prev >= 1; prev -= 1) {
    const candidate = prev as WizardStepNumber;
    if (!isStepSkippedForTier(candidate, complexity)) return candidate;
  }
  return null;
}

export function getStepStatuses(
  currentStep: WizardStep,
  complexity: ComplexityTier,
): Array<{ step: WizardStepNumber; status: WizardStepStatus; skipped: boolean }> {
  return WIZARD_STEPS.map((step) => {
    const skipped = isStepSkippedForTier(step, complexity);
    if (skipped) {
      return { step, status: 'skipped', skipped: true };
    }
    if (currentStep === 'done' || step < currentStep) {
      return { step, status: 'completed', skipped: false };
    }
    if (step === currentStep) {
      return { step, status: 'active', skipped: false };
    }
    return { step, status: 'pending', skipped: false };
  });
}

export function getDefaultSelectedAppIds(options?: {
  rememberedAppId?: string | null;
  platform?: AppPickerPlatform;
}): string[] {
  const remembered = options?.rememberedAppId ?? readStoredSelectedAppId();
  if (remembered) {
    const def = getApp(remembered);
    if (def && def.status === 'ready') return [def.id];
  }
  const platform =
    options?.platform ??
    readStoredAppPickerPlatform() ??
    (typeof navigator !== 'undefined'
      ? guessAppPickerPlatform(navigator.userAgent ?? '', navigator.maxTouchPoints ?? 0)
      : 'mac');
  const candidates = APP_PICKER_RECOMMENDATIONS[platform] ?? ['clash-verge-rev'];
  for (const id of candidates) {
    const def = getApp(id);
    if (def && def.status === 'ready') return [def.id];
  }
  return ['clash-verge-rev'];
}

export function createSubscriptionRow(index: number, id?: string): WizardSubscriptionRow {
  return {
    id: id ?? `sub-${index + 1}`,
    name: `机场 ${index + 1}`,
    url: '',
    preview: null,
    errorCode: null,
    lastCheckedUrl: '',
  };
}

export function getDefaultScenariosForTier(tier: ComplexityTier): QuickCreateScenarioInput[] {
  return WIZARD_SCENARIO_CATALOG.map((def) => ({
    id: def.id,
    enabled: tier === 'pro' ? true : def.defaultEnabled,
    ...(def.configurableRoute ? { route: def.defaultRoute } : {}),
  }));
}

export function applyScenarioPreset(
  current: readonly QuickCreateScenarioInput[],
  preset: 'recommended' | 'all' | 'clear',
): QuickCreateScenarioInput[] {
  const currentMap = new Map(current.map((item) => [item.id, item]));
  return WIZARD_SCENARIO_CATALOG.map((def) => {
    const prev = currentMap.get(def.id);
    const enabled = preset === 'all' ? true : preset === 'clear' ? false : def.defaultEnabled;
    return {
      id: def.id,
      enabled,
      ...(def.configurableRoute ? { route: prev?.route ?? def.defaultRoute } : {}),
    };
  });
}

export function buildDefaultModuleStateForTier(complexity: ComplexityTier): Record<string, boolean> {
  const ordered = [...ENHANCEMENT_MODULE_METADATA].sort(
    (a, b) => Number(b.defaultEnabled) - Number(a.defaultEnabled) || a.order - b.order,
  );
  const enabledSet = new Set<string>();
  for (const mod of ordered) {
    if (!mod.tierDefaults[complexity]) continue;
    const conflictsDirect = (mod.conflictsWith ?? []).some((id) => enabledSet.has(id));
    if (conflictsDirect) continue;
    const conflictsReverse = [...enabledSet].some((acceptedId) => {
      const accepted = ordered.find((item) => item.id === acceptedId);
      return accepted?.conflictsWith?.includes(mod.id);
    });
    if (!conflictsReverse) {
      enabledSet.add(mod.id);
    }
  }
  const map: Record<string, boolean> = {};
  for (const mod of ENHANCEMENT_MODULE_METADATA) {
    map[mod.id] = enabledSet.has(mod.id);
  }
  return map;
}

export function createInitialWizardState(options?: {
  defaultTemplateName?: string;
  rememberedAppId?: string | null;
  platform?: AppPickerPlatform;
}): WizardState {
  return {
    step: 1,
    direction: 'forward',
    maxReachedStep: 1,
    selectedAppIds: getDefaultSelectedAppIds({
      rememberedAppId: options?.rememberedAppId,
      platform: options?.platform,
    }),
    subscriptions: [createSubscriptionRow(0)],
    skipSubscription: false,
    combineMode: 'merge',
    complexity: 'simple',
    scenarios: getDefaultScenariosForTier('advanced'),
    scenariosTouched: false,
    selectedRulesetIds: [],
    rulesetRoutes: {},
    groupMode: 'region',
    selectedRegions: [...WIZARD_CORE_REGION_CODES],
    regionsTouched: false,
    includeProviderPools: true,
    selectedTraitPoolIds: WIZARD_TRAIT_POOL_PRESETS.map((p) => p.id),
    modules: buildDefaultModuleStateForTier('pro'),
    modulesTouched: false,
    templateName: options?.defaultTemplateName ?? '我的配置',
  };
}

/** Infers default route destination for a user ruleset based on its name. */
export function inferRulesetDefaultRoute(name: string): WizardRouteTarget {
  const trimmed = name.trim();
  if (!trimmed) return 'proxy';
  if (/(?:direct|直连|直連)/i.test(trimmed)) return 'direct';
  if (
    /(?:reject|广告|廣告|拦截|攔截|adblock|adguard)/i.test(trimmed) ||
    /(?:^|[^a-z])ad(?:s)?(?:$|[^a-z])/i.test(trimmed) ||
    /(?<![A-Z])AD(?![a-z])/.test(trimmed)
  ) {
    return 'reject';
  }
  return 'proxy';
}

export function clampRouteForTier(route: WizardRouteTarget, complexity: ComplexityTier): WizardRouteTarget {
  if (complexity === 'simple') {
    if (route === 'direct' || route === 'reject') return route;
    return 'proxy';
  }
  return route;
}

export type MappedClientSelection = {
  selectedApps: AppDefinition[];
  clients: TemplateClientId[];
  clientDisplayNames: string[];
  clientLabels: Partial<Record<TemplateClientId, string>>;
};

export function mapSelectedAppsToClients(selectedAppIds: readonly string[]): MappedClientSelection {
  const seenApps = new Set<string>();
  const selectedApps: AppDefinition[] = [];
  const seenClients = new Set<TemplateClientId>();
  const clients: TemplateClientId[] = [];
  const clientDisplayNames: string[] = [];
  const namesByClient = new Map<TemplateClientId, string[]>();

  for (const appId of selectedAppIds) {
    if (seenApps.has(appId)) continue;
    const app = getApp(appId);
    if (!app || app.status !== 'ready' || !app.templateClientId) continue;
    seenApps.add(appId);
    selectedApps.push(app);
    clientDisplayNames.push(app.name);
    if (!seenClients.has(app.templateClientId)) {
      seenClients.add(app.templateClientId);
      clients.push(app.templateClientId);
    }
    const existing = namesByClient.get(app.templateClientId) ?? [];
    existing.push(app.name);
    namesByClient.set(app.templateClientId, existing);
  }

  const clientLabels: Partial<Record<TemplateClientId, string>> = {};
  for (const [client, names] of namesByClient) {
    clientLabels[client] = names.join(' / ');
  }

  return { selectedApps, clients, clientDisplayNames, clientLabels };
}

export type DetectedRegionStat = {
  code: string;
  name: string;
  emoji: string;
  count: number;
};

export function aggregateDetectedRegions(
  rows: readonly WizardSubscriptionRow[],
  skipSubscription: boolean,
): DetectedRegionStat[] {
  if (skipSubscription) return [];
  const countMap = new Map<string, number>();
  for (const row of rows) {
    if (!row.url.trim() || !row.preview) continue;
    for (const [rawCode, count] of Object.entries(row.preview.regionCounts)) {
      const def = getRegionDefinition(rawCode) ?? findRegionByQuery(rawCode);
      if (!def || !Number.isFinite(count) || count <= 0) continue;
      countMap.set(def.code, (countMap.get(def.code) ?? 0) + count);
    }
  }
  const result: DetectedRegionStat[] = [];
  for (const [code, count] of countMap) {
    const def = getRegionDefinition(code);
    if (!def) continue;
    result.push({ code, name: def.nameZh, emoji: def.flag, count });
  }
  result.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  return result;
}

export function getCandidateRegionList(
  rows: readonly WizardSubscriptionRow[],
  skipSubscription: boolean,
  complexity: ComplexityTier,
): Array<{ code: string; name: string; emoji: string; count?: number }> {
  const detected = aggregateDetectedRegions(rows, skipSubscription);
  const detectedSet = new Set(detected.map((item) => item.code));
  const extraCodes =
    complexity === 'pro' ? WIZARD_ALL_REGION_CODES : detected.length === 0 ? WIZARD_CORE_REGION_CODES : [];

  const list: Array<{ code: string; name: string; emoji: string; count?: number }> = [...detected];
  for (const code of extraCodes) {
    if (detectedSet.has(code)) continue;
    const def = getRegionDefinition(code);
    if (!def) continue;
    list.push({ code, name: def.nameZh, emoji: def.flag });
  }
  return list;
}

export type ModuleSupportEvaluation = {
  status: 'supported' | 'partial' | 'unsupported';
  supportingAppNames: string[];
  unsupportedAppNames: string[];
};

export function evaluateModuleSupport(
  mod: { supportedClients: readonly TemplateClientId[] },
  selectedAppIds: readonly string[],
): ModuleSupportEvaluation {
  const { selectedApps } = mapSelectedAppsToClients(selectedAppIds);
  if (selectedApps.length === 0) {
    return { status: 'supported', supportingAppNames: [], unsupportedAppNames: [] };
  }
  const supportingAppNames: string[] = [];
  const unsupportedAppNames: string[] = [];
  const supportedSet = new Set<TemplateClientId>(mod.supportedClients);
  for (const app of selectedApps) {
    if (app.templateClientId && supportedSet.has(app.templateClientId)) {
      supportingAppNames.push(app.name);
    } else {
      unsupportedAppNames.push(app.name);
    }
  }
  if (supportingAppNames.length === 0) {
    return { status: 'unsupported', supportingAppNames, unsupportedAppNames };
  }
  if (unsupportedAppNames.length > 0) {
    return { status: 'partial', supportingAppNames, unsupportedAppNames };
  }
  return { status: 'supported', supportingAppNames, unsupportedAppNames };
}

export function toggleModuleWithConflicts(
  current: Readonly<Record<string, boolean>>,
  moduleId: string,
  nextEnabled: boolean,
): { next: Record<string, boolean>; disabledPeers: string[] } {
  const next: Record<string, boolean> = { ...current, [moduleId]: nextEnabled };
  const disabledPeers: string[] = [];
  if (nextEnabled) {
    const target = ENHANCEMENT_MODULE_METADATA.find((item) => item.id === moduleId);
    const conflictIds = new Set<string>(target?.conflictsWith ?? []);
    for (const mod of ENHANCEMENT_MODULE_METADATA) {
      if (mod.conflictsWith?.includes(moduleId)) {
        conflictIds.add(mod.id);
      }
    }
    for (const peerId of conflictIds) {
      if (next[peerId]) {
        next[peerId] = false;
        disabledPeers.push(peerId);
      }
    }
  }
  return { next, disabledPeers };
}

export function normalizeActiveSubscriptionRows(
  rows: readonly WizardSubscriptionRow[],
  skipSubscription: boolean,
): Array<{
  name: string;
  url: string;
  previewSummary?: QuickCreatePreviewSummary;
}> {
  if (skipSubscription) return [];
  const result: Array<{ name: string; url: string; previewSummary?: QuickCreatePreviewSummary }> = [];
  for (let i = 0; i < rows.length && result.length < MAX_TEMPLATE_SUBSCRIPTIONS; i += 1) {
    const row = rows[i];
    const url = row.url.trim();
    if (!url) continue;
    const name = row.name.trim() || `机场 ${result.length + 1}`;
    const previewSummary: QuickCreatePreviewSummary | undefined = row.preview
      ? {
          nodeCount: row.preview.nodeCount,
          regions: { ...row.preview.regionCounts },
          status: 'ok',
          checkedAt: row.preview.checkedAt,
        }
      : row.errorCode
        ? { nodeCount: 0, regions: {}, status: 'error' }
        : undefined;
    result.push({
      name,
      url,
      ...(previewSummary ? { previewSummary } : {}),
    });
  }
  return result;
}

export function isValidHttpSubscriptionUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function buildQuickCreatePayload(
  state: WizardState,
  availableRulesets: ReadonlyArray<{ id: string; name: string }>,
): QuickCreateTemplateRequest {
  const mappedClients = mapSelectedAppsToClients(state.selectedAppIds);
  const clients: TemplateClientId[] = mappedClients.clients.length > 0 ? mappedClients.clients : ['mihomo'];
  const activeSubs = normalizeActiveSubscriptionRows(state.subscriptions, state.skipSubscription);
  const rulesetMap = new Map(availableRulesets.map((rs) => [rs.id, rs]));
  const rulesets = state.selectedRulesetIds
    .filter((id) => rulesetMap.has(id))
    .map((id) => {
      const rs = rulesetMap.get(id)!;
      const rawRoute = state.rulesetRoutes[id] ?? inferRulesetDefaultRoute(rs.name);
      return {
        rulesetId: id,
        route: clampRouteForTier(rawRoute, state.complexity),
      };
    });

  const combineMode: NodeCombineMode =
    state.complexity === 'simple' || activeSubs.length <= 1 ? 'merge' : state.combineMode;

  if (state.complexity === 'simple') {
    return {
      name: state.templateName.trim() || '我的配置',
      complexity: 'simple',
      clients,
      ...(mappedClients.clientDisplayNames.length > 0 ? { clientDisplayNames: mappedClients.clientDisplayNames } : {}),
      ...(Object.keys(mappedClients.clientLabels).length > 0 ? { clientLabels: mappedClients.clientLabels } : {}),
      scenarios: [
        { id: 'domestic-direct', enabled: true },
        { id: 'ad-block', enabled: true },
      ],
      rulesets,
      groupMode: 'auto',
      combineMode,
      ...(activeSubs.length > 0 ? { subscriptions: activeSubs } : {}),
    };
  }

  const detectedRegionStats = aggregateDetectedRegions(state.subscriptions, state.skipSubscription);
  const detectedRegionCodes = detectedRegionStats.map((item) => item.code);
  const effectiveGroupMode: WizardGroupMode = state.groupMode;
  const selectedRegions = effectiveGroupMode === 'region' || state.complexity === 'pro' ? state.selectedRegions : [];

  const modules =
    state.complexity === 'pro'
      ? ENHANCEMENT_MODULE_METADATA.map((mod) => {
          const support = evaluateModuleSupport(mod, state.selectedAppIds);
          return {
            id: mod.id,
            enabled: support.status === 'unsupported' ? false : Boolean(state.modules[mod.id]),
          };
        })
      : undefined;

  return {
    name: state.templateName.trim() || '我的配置',
    complexity: state.complexity,
    clients,
    ...(mappedClients.clientDisplayNames.length > 0 ? { clientDisplayNames: mappedClients.clientDisplayNames } : {}),
    ...(Object.keys(mappedClients.clientLabels).length > 0 ? { clientLabels: mappedClients.clientLabels } : {}),
    scenarios: state.scenarios.map((sc) => ({
      id: sc.id,
      enabled: sc.enabled,
      ...(sc.route ? { route: sc.route } : {}),
    })),
    rulesets,
    groupMode: effectiveGroupMode,
    combineMode,
    ...(activeSubs.length > 0 ? { subscriptions: activeSubs } : {}),
    ...(detectedRegionCodes.length > 0 ? { detectedRegions: detectedRegionCodes } : {}),
    nodePoolOptions: {
      selectedRegions,
      ...(state.complexity === 'pro'
        ? {
            includeProviderPools: state.includeProviderPools,
            traitPoolIds: [...state.selectedTraitPoolIds],
          }
        : {}),
    },
    ...(modules ? { modules } : {}),
  };
}
