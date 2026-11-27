import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Loader2,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PreviewSubscriptionResult, QuickCreateTemplateResult } from '../../../application/templates/quick-create';
import { getRegionDefinition } from '../../../domain/nodes/regions';
import {
  CORE_REGION_CODES,
  detectMatchingPresetTier,
  getDefaultWizardScenarios,
  getPresetScenarioSelection,
  inferDefaultRouteForRulesetName,
  mapWizardClientSelection,
  WIZARD_CLIENT_OPTIONS,
  WIZARD_SCENARIO_DEFINITIONS,
  type WizardClientOption,
  type WizardClientOptionId,
  type WizardPresetTier,
} from '../../../domain/templates/quick-create';
import type {
  PreviewSubscriptionErrorCode,
  QuickCreateScenarioInput,
  WizardGroupMode,
  WizardRouteTarget,
  WizardScenarioId,
} from '../../../shared/schemas/quick-create';
import { useI18n, type MessageKey } from '../../i18n';
import { api, ApiClientError, formatApiError, readApiJson } from '../../lib/api';
import { isTelegramSession } from '../../lib/auth-guard';
import {
  authMeQueryOptions,
  invalidatePublications,
  invalidateTemplates,
  rulesetsListQueryOptions,
} from '../../lib/query';
import { useToast } from '../../lib/toast';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { WizardDoneLinks } from './WizardDoneLinks';

type WizardStep = 1 | 2 | 3 | 'done';

const PRESET_TIERS: readonly WizardPresetTier[] = ['less', 'recommended', 'all'];
const GROUP_MODES: readonly WizardGroupMode[] = ['auto', 'select', 'region'];

function scenarioTitleKey(id: WizardScenarioId): MessageKey {
  return `wizard.scenario.${id}` as MessageKey;
}

function scenarioDescKey(id: WizardScenarioId): MessageKey {
  return `wizard.scenarioDesc.${id}` as MessageKey;
}

function clientDescKey(id: WizardClientOptionId): MessageKey {
  return `wizard.clientDesc.${id}` as MessageKey;
}

function formatClientDisplayName(option: WizardClientOption, locale: string): string {
  if (locale === 'en') return option.displayName;
  if (option.id === 'shadowrocket') return `${option.displayName}（小火箭）`;
  if (option.id === 'quantumult-x') return `${option.displayName}（圈X）`;
  return option.displayName;
}

function extractPreviewErrorCode(error: unknown): PreviewSubscriptionErrorCode {
  if (error instanceof ApiClientError && error.details && typeof error.details === 'object') {
    const code = (error.details as { previewErrorCode?: unknown }).previewErrorCode;
    if (code === 'LINK_INVALID' || code === 'NEEDS_USER_AGENT' || code === 'NOT_SUBSCRIPTION' || code === 'TIMEOUT') {
      return code;
    }
  }
  return 'LINK_INVALID';
}

export function QuickCreateWizard() {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const authQuery = useQuery(authMeQueryOptions());
  const inTelegram = isTelegramSession(authQuery.data);
  const rulesetsQuery = useQuery(rulesetsListQueryOptions());

  const [step, setStep] = useState<WizardStep>(1);

  // Step 1 state: selected client option IDs
  const [selectedClientIds, setSelectedClientIds] = useState<WizardClientOptionId[]>([]);
  const [unsureOpen, setUnsureOpen] = useState(false);

  // Step 2 state: scenarios, ruleset selections, groupMode
  const [scenarios, setScenarios] = useState<QuickCreateScenarioInput[]>(() => getDefaultWizardScenarios());
  const [selectedRulesetIds, setSelectedRulesetIds] = useState<string[]>([]);
  const [rulesetRoutes, setRulesetRoutes] = useState<Record<string, WizardRouteTarget>>({});
  const [groupMode, setGroupMode] = useState<WizardGroupMode>('auto');

  // Step 3 state: subscription URL, preview state, skip toggle, template name
  const [subscriptionUrl, setSubscriptionUrl] = useState('');
  const [skipSubscription, setSkipSubscription] = useState(false);
  const [templateName, setTemplateName] = useState(() => t('wizard.defaultTemplateName'));
  const [nameTouched, setNameTouched] = useState(false);
  const [lastCheckedUrl, setLastCheckedUrl] = useState('');
  const [previewResult, setPreviewResult] = useState<PreviewSubscriptionResult | null>(null);
  const [previewErrorCode, setPreviewErrorCode] = useState<PreviewSubscriptionErrorCode | null>(null);

  // Done state
  const [createdResult, setCreatedResult] = useState<QuickCreateTemplateResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const urlCodeRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Sync default template name if locale switches before user edits
  useEffect(() => {
    if (!nameTouched) {
      setTemplateName(t('wizard.defaultTemplateName'));
    }
  }, [locale, nameTouched, t]);

  const categories = useMemo(() => rulesetsQuery.data?.data.categories ?? [], [rulesetsQuery.data]);

  // Pre-populate default route per ruleset based on name
  useEffect(() => {
    if (categories.length === 0) return;
    setRulesetRoutes((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const cat of categories) {
        if (!next[cat.id]) {
          next[cat.id] = inferDefaultRouteForRulesetName(cat.name);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [categories]);

  const desktopAndroidClients = useMemo(
    () => WIZARD_CLIENT_OPTIONS.filter((opt) => opt.groups.includes('desktop-android')),
    [],
  );
  const appleClients = useMemo(() => WIZARD_CLIENT_OPTIONS.filter((opt) => opt.groups.includes('apple')), []);

  const activePreset = useMemo(() => {
    const map = {} as Record<WizardScenarioId, boolean>;
    for (const sc of scenarios) {
      map[sc.id] = sc.enabled;
    }
    return detectMatchingPresetTier(map);
  }, [scenarios]);

  // Route dropdown region choices: detected regions from preview if available, else CORE_REGION_CODES
  const regionDropdownOptions = useMemo(() => {
    if (previewResult && previewResult.regions.length > 0) {
      return previewResult.regions.map((item) => ({
        value: `region:${item.code}` as WizardRouteTarget,
        label: `${item.emoji} ${item.name}`,
      }));
    }
    return CORE_REGION_CODES.map((code) => {
      const def = getRegionDefinition(code);
      return {
        value: `region:${code}` as WizardRouteTarget,
        label: def ? `${def.flag} ${locale === 'en' ? def.nameEn : def.nameZh}` : code,
      };
    });
  }, [previewResult, locale]);

  const routeOptions = useMemo(
    () => [
      { value: 'proxy' as WizardRouteTarget, label: t('wizard.route.proxy') },
      { value: 'auto' as WizardRouteTarget, label: t('wizard.route.auto') },
      { value: 'direct' as WizardRouteTarget, label: t('wizard.route.direct') },
      { value: 'reject' as WizardRouteTarget, label: t('wizard.route.reject') },
      ...regionDropdownOptions,
    ],
    [regionDropdownOptions, t],
  );

  const previewMutation = useMutation({
    mutationFn: async (rawUrl: string) =>
      readApiJson<PreviewSubscriptionResult>(
        await api.api.templates['preview-subscription'].$post({
          json: { subscriptionUrl: rawUrl },
        }),
      ),
    onSuccess: (data, rawUrl) => {
      setLastCheckedUrl(rawUrl);
      setPreviewResult(data);
      setPreviewErrorCode(null);
    },
    onError: (error, rawUrl) => {
      setLastCheckedUrl(rawUrl);
      setPreviewResult(null);
      setPreviewErrorCode(extractPreviewErrorCode(error));
    },
  });

  const quickCreateMutation = useMutation({
    mutationFn: async () => {
      const mappedClients = mapWizardClientSelection(selectedClientIds);
      const effectiveSubUrl = skipSubscription ? undefined : subscriptionUrl.trim() || undefined;
      const trimmedName = templateName.trim() || t('wizard.defaultTemplateName');

      const rulesetsPayload = selectedRulesetIds.map((rulesetId) => ({
        rulesetId,
        route: rulesetRoutes[rulesetId] ?? 'proxy',
      }));

      const detectedRegions =
        effectiveSubUrl && previewResult && previewResult.regions.length > 0
          ? previewResult.regions.map((r) => r.code)
          : undefined;

      const previewSummary = effectiveSubUrl
        ? previewResult
          ? {
              nodeCount: previewResult.nodeCount,
              regions: previewResult.regionCounts,
              status: 'ok' as const,
              checkedAt: previewResult.checkedAt,
            }
          : previewErrorCode
            ? {
                nodeCount: 0,
                regions: {},
                status: 'error' as const,
                checkedAt: new Date().toISOString(),
              }
            : undefined
        : undefined;

      // Preserve short display names for cards when in zh locale
      const clientDisplayNames = selectedClientIds
        .map((optId) => WIZARD_CLIENT_OPTIONS.find((o) => o.id === optId))
        .filter((o): o is WizardClientOption => Boolean(o))
        .map((o) => (locale === 'en' ? o.shortDisplayNameEn : o.shortDisplayNameZh));

      return readApiJson<QuickCreateTemplateResult>(
        await api.api.templates['quick-create'].$post({
          json: {
            name: trimmedName,
            clients: mappedClients.clients,
            clientDisplayNames,
            clientLabels: mappedClients.clientLabels,
            scenarios,
            rulesets: rulesetsPayload,
            groupMode,
            subscriptionUrl: effectiveSubUrl,
            detectedRegions,
            previewSummary,
          },
        }),
      );
    },
    onSuccess: async (data) => {
      setCreatedResult(data);
      setStep('done');
      await Promise.all([invalidateTemplates(queryClient), invalidatePublications(queryClient)]);
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const toggleClient = (optionId: WizardClientOptionId) => {
    setSelectedClientIds((prev) =>
      prev.includes(optionId) ? prev.filter((item) => item !== optionId) : [...prev, optionId],
    );
  };

  const applyPreset = (tier: WizardPresetTier) => {
    const presetMap = getPresetScenarioSelection(tier);
    setScenarios((prev) =>
      prev.map((sc) => ({
        ...sc,
        enabled: presetMap[sc.id] ?? false,
      })),
    );
    if (tier === 'all') {
      setGroupMode('region');
    } else if (groupMode === 'region') {
      setGroupMode('auto');
    }
  };

  const toggleScenario = (scenarioId: WizardScenarioId) => {
    setScenarios((prev) => prev.map((sc) => (sc.id === scenarioId ? { ...sc, enabled: !sc.enabled } : sc)));
  };

  const updateScenarioRoute = (scenarioId: WizardScenarioId, route: WizardRouteTarget) => {
    setScenarios((prev) => prev.map((sc) => (sc.id === scenarioId ? { ...sc, route } : sc)));
  };

  const toggleRuleset = (rulesetId: string) => {
    setSelectedRulesetIds((prev) =>
      prev.includes(rulesetId) ? prev.filter((item) => item !== rulesetId) : [...prev, rulesetId],
    );
  };

  const updateRulesetRoute = (rulesetId: string, route: WizardRouteTarget) => {
    setRulesetRoutes((prev) => ({ ...prev, [rulesetId]: route }));
  };

  const triggerPreviewCheck = (force = false) => {
    if (skipSubscription) return;
    const trimmed = subscriptionUrl.trim();
    if (!trimmed) {
      setPreviewResult(null);
      setPreviewErrorCode(null);
      setLastCheckedUrl('');
      return;
    }
    if (!force && trimmed === lastCheckedUrl && (previewResult || previewErrorCode)) return;
    previewMutation.mutate(trimmed);
  };

  const handleCopyDoneUrl = async (key: string, url: string) => {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      notify({ title: t('templates.copiedLinkToast'), variant: 'success' });
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2000);
    } catch {
      const codeEl = urlCodeRefs.current.get(key);
      if (codeEl && typeof window !== 'undefined' && typeof document !== 'undefined') {
        const range = document.createRange();
        range.selectNodeContents(codeEl);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      notify({ title: t('subscriptions.copyFailed'), variant: 'danger' });
    }
  };

  if (inTelegram) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4" data-testid="wizard-telegram-readonly">
        <Link
          to="/templates"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{t('wizard.backToList')}</span>
        </Link>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-warning" />
              <span>{t('wizard.telegramReadOnlyTitle')}</span>
            </CardTitle>
            <CardDescription>{t('wizard.telegramReadOnlyDesc')}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5" data-testid="quick-create-wizard">
      {step !== 'done' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              to="/templates"
              data-testid="wizard-back-to-list"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted transition-colors hover:text-text"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>{t('wizard.backToList')}</span>
            </Link>
            <span
              data-testid="wizard-step-indicator"
              className="rounded-full bg-surface-muted px-3 py-1 text-xs font-medium text-text-muted"
            >
              {t('wizard.stepIndicator').replace('{step}', String(step))}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2" aria-hidden="true">
            {([1, 2, 3] as const).map((s) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-colors ${s <= step ? 'bg-primary' : 'bg-surface-muted'}`}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* STEP 1: Choose clients */}
      {step === 1 ? (
        <Card data-testid="wizard-step-1">
          <CardHeader>
            <CardTitle className="text-lg">{t('wizard.step1Title')}</CardTitle>
            <CardDescription>{t('wizard.step1Desc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t('wizard.groupDesktopAndroid')}
              </h2>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {desktopAndroidClients.map((option) => {
                  const selected = selectedClientIds.includes(option.id);
                  return (
                    <button
                      key={`desktop-${option.id}`}
                      type="button"
                      data-testid={`wizard-client-${option.id}`}
                      aria-pressed={selected}
                      onClick={() => toggleClient(option.id)}
                      className={`motion-card flex cursor-pointer items-start justify-between gap-3 rounded-[var(--radius-md)] border p-3.5 text-left ${
                        selected
                          ? 'border-primary bg-primary/8 ring-1 ring-primary/30'
                          : 'border-border bg-surface hover:border-primary/40 hover:bg-surface-muted/50'
                      }`}
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="text-sm font-semibold text-text">
                          {formatClientDisplayName(option, locale)}
                        </span>
                        <span className="text-xs leading-relaxed text-text-muted">{t(clientDescKey(option.id))}</span>
                      </div>
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface'
                        }`}
                      >
                        {selected ? <Check className="h-3 w-3" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t('wizard.groupApple')}
              </h2>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {appleClients.map((option) => {
                  const selected = selectedClientIds.includes(option.id);
                  const testId =
                    option.id === 'sing-box' ? 'wizard-client-sing-box-apple' : `wizard-client-${option.id}`;
                  return (
                    <button
                      key={`apple-${option.id}`}
                      type="button"
                      data-testid={testId}
                      aria-pressed={selected}
                      onClick={() => toggleClient(option.id)}
                      className={`motion-card flex cursor-pointer items-start justify-between gap-3 rounded-[var(--radius-md)] border p-3.5 text-left ${
                        selected
                          ? 'border-primary bg-primary/8 ring-1 ring-primary/30'
                          : 'border-border bg-surface hover:border-primary/40 hover:bg-surface-muted/50'
                      }`}
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="text-sm font-semibold text-text">
                          {formatClientDisplayName(option, locale)}
                        </span>
                        <span className="text-xs leading-relaxed text-text-muted">{t(clientDescKey(option.id))}</span>
                      </div>
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface'
                        }`}
                      >
                        {selected ? <Check className="h-3 w-3" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[var(--radius-md)] border border-border bg-surface-muted/40">
              <button
                type="button"
                data-testid="wizard-unsure-toggle"
                onClick={() => setUnsureOpen((prev) => !prev)}
                className="flex w-full cursor-pointer items-center justify-between gap-2 px-3.5 py-2.5 text-left text-xs font-medium text-text"
              >
                <span className="inline-flex items-center gap-1.5">
                  <HelpCircle className="h-3.5 w-3.5 text-primary" />
                  {t('wizard.unsureToggle')}
                </span>
                {unsureOpen ? (
                  <ChevronUp className="h-4 w-4 text-text-muted" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-text-muted" />
                )}
              </button>
              {unsureOpen ? (
                <div className="border-t border-border/70 px-3.5 py-2.5 text-xs leading-relaxed text-text-muted">
                  {t('wizard.unsureBody')}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              <span className="text-xs text-text-muted">
                {selectedClientIds.length === 0 ? t('wizard.clientRequiredError') : ''}
              </span>
              <Button
                type="button"
                data-testid="wizard-next-btn"
                disabled={selectedClientIds.length === 0}
                onClick={() => setStep(2)}
              >
                <span>{t('wizard.nextBtn')}</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* STEP 2: Choose scenarios, my rules, node selection mode */}
      {step === 2 ? (
        <Card data-testid="wizard-step-2">
          <CardHeader>
            <CardTitle className="text-lg">{t('wizard.step2Title')}</CardTitle>
            <CardDescription>{t('wizard.step2Desc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {/* Quick presets (D5=A) */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-text-muted">{t('wizard.presetsLabel')}</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {PRESET_TIERS.map((tier) => {
                  const isActive = activePreset === tier;
                  const label =
                    tier === 'recommended'
                      ? t('wizard.preset.recommendedDefault')
                      : t(`wizard.preset.${tier}` as MessageKey);
                  return (
                    <button
                      key={tier}
                      type="button"
                      data-testid={`wizard-preset-${tier}`}
                      onClick={() => applyPreset(tier)}
                      className={`motion-card cursor-pointer rounded-[var(--radius-md)] border px-3 py-2 text-xs font-medium ${
                        isActive
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-surface text-text hover:bg-surface-muted'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Common scenarios (§4.6) */}
            <div className="flex flex-col gap-2.5">
              <h2 className="text-sm font-semibold text-text">{t('wizard.commonScenariosTitle')}</h2>
              <div className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
                {WIZARD_SCENARIO_DEFINITIONS.map((def) => {
                  const current = scenarios.find((item) => item.id === def.id);
                  const enabled = current?.enabled ?? def.defaultEnabled;
                  const route = current?.route ?? def.defaultRoute;
                  return (
                    <div
                      key={def.id}
                      data-testid={`wizard-scenario-row-${def.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5"
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={enabled}
                          data-testid={`wizard-scenario-toggle-${def.id}`}
                          onChange={() => toggleScenario(def.id)}
                          className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
                        />
                        <div className="flex min-w-0 flex-col">
                          <span className="flex items-center gap-1.5 text-sm font-medium text-text">
                            <span>{t(scenarioTitleKey(def.id))}</span>
                            {def.id === 'domestic-direct' ? (
                              <Badge variant="default" className="text-[10px]">
                                {t('wizard.recommendedBadge')}
                              </Badge>
                            ) : null}
                          </span>
                          <span className="text-xs text-text-muted">{t(scenarioDescKey(def.id))}</span>
                        </div>
                      </label>

                      {def.configurableRoute ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-text-muted">{t('wizard.routePrefix')}</span>
                          <select
                            aria-label={`${t(scenarioTitleKey(def.id))} ${t('wizard.routePrefix')}`}
                            data-testid={`wizard-scenario-route-${def.id}`}
                            disabled={!enabled}
                            value={route}
                            onChange={(e) => updateScenarioRoute(def.id, e.target.value as WizardRouteTarget)}
                            className="h-8 rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-xs text-text disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {routeOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* My Rules (from Rules module) */}
            <div className="flex flex-col gap-2.5" data-testid="wizard-my-rules">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-sm font-semibold text-text">{t('wizard.myRulesTitle')}</h2>
                <p className="text-xs text-text-muted">{t('wizard.myRulesPriorityNote')}</p>
              </div>

              {categories.length === 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-dashed border-border bg-surface-muted/40 px-3.5 py-3 text-xs text-text-muted">
                  <span>{t('wizard.myRulesEmpty')}</span>
                  <Link to="/rules" className="font-medium text-primary hover:underline">
                    {t('wizard.myRulesGoCreate')}
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
                  {categories.map((cat) => {
                    const checked = selectedRulesetIds.includes(cat.id);
                    const route = rulesetRoutes[cat.id] ?? inferDefaultRouteForRulesetName(cat.name);
                    return (
                      <div
                        key={cat.id}
                        data-testid={`wizard-ruleset-row-${cat.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5"
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            data-testid={`wizard-ruleset-toggle-${cat.id}`}
                            onChange={() => toggleRuleset(cat.id)}
                            className="h-4 w-4 rounded border-border accent-primary"
                          />
                          <span className="truncate text-sm font-medium text-text">{cat.name}</span>
                        </label>

                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-text-muted">{t('wizard.routePrefix')}</span>
                          <select
                            aria-label={`${cat.name} ${t('wizard.routePrefix')}`}
                            data-testid={`wizard-ruleset-route-${cat.id}`}
                            value={route}
                            onChange={(e) => updateRulesetRoute(cat.id, e.target.value as WizardRouteTarget)}
                            className="h-8 rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-xs text-text"
                          >
                            {routeOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Node selection strategy */}
            <div className="flex flex-col gap-2.5">
              <h2 className="text-sm font-semibold text-text">{t('wizard.groupModeTitle')}</h2>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                {GROUP_MODES.map((mode) => {
                  const selected = groupMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      data-testid={`wizard-group-mode-${mode}`}
                      aria-pressed={selected}
                      onClick={() => setGroupMode(mode)}
                      className={`motion-card flex cursor-pointer flex-col gap-1 rounded-[var(--radius-md)] border p-3 text-left ${
                        selected
                          ? 'border-primary bg-primary/8 ring-1 ring-primary/30'
                          : 'border-border bg-surface hover:border-primary/40 hover:bg-surface-muted/50'
                      }`}
                    >
                      <span className="text-sm font-semibold text-text">
                        {t(`wizard.groupMode.${mode}` as MessageKey)}
                      </span>
                      <span className="text-xs leading-relaxed text-text-muted">
                        {t(`wizard.groupModeDesc.${mode}` as MessageKey)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              <Button type="button" variant="outline" data-testid="wizard-back-btn" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4" />
                <span>{t('wizard.backBtn')}</span>
              </Button>
              <Button type="button" data-testid="wizard-next-btn" onClick={() => setStep(3)}>
                <span>{t('wizard.nextBtn')}</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* STEP 3: Provider subscription & template name */}
      {step === 3 ? (
        <Card data-testid="wizard-step-3">
          <CardHeader>
            <CardTitle className="text-lg">{t('wizard.step3Title')}</CardTitle>
            <CardDescription>{t('wizard.step3Desc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="wizard-sub-input" className="text-sm font-medium text-text">
                {t('wizard.subLabel')}
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="wizard-sub-input"
                  type="url"
                  disabled={skipSubscription}
                  value={subscriptionUrl}
                  onChange={(e) => {
                    setSubscriptionUrl(e.target.value);
                    if (previewResult || previewErrorCode) {
                      setPreviewResult(null);
                      setPreviewErrorCode(null);
                    }
                  }}
                  onBlur={() => triggerPreviewCheck(false)}
                  placeholder={t('wizard.subPlaceholder')}
                  data-testid="wizard-sub-input"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  data-testid="wizard-sub-check-btn"
                  disabled={skipSubscription || !subscriptionUrl.trim() || previewMutation.isPending}
                  onClick={() => triggerPreviewCheck(true)}
                >
                  {previewMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{t('wizard.checkingSubBtn')}</span>
                    </>
                  ) : (
                    <span>{t('wizard.checkSubBtn')}</span>
                  )}
                </Button>
              </div>
              <p className="text-xs text-text-muted">{t('wizard.subSecurityHint')}</p>

              {/* Preview success */}
              {!skipSubscription && previewResult ? (
                <div
                  data-testid="wizard-sub-preview-ok"
                  className="flex items-start gap-2 rounded-[var(--radius-md)] border border-success/40 bg-success/8 px-3 py-2 text-xs text-text"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <span>
                    {previewResult.regions.length > 0
                      ? t('wizard.subDetectedSummary')
                          .replace('{count}', String(previewResult.nodeCount))
                          .replace(
                            '{regions}',
                            previewResult.regions
                              .slice(0, 6)
                              .map((r) => `${r.name} ${r.count}`)
                              .join(' · ') + (previewResult.regions.length > 6 ? ' …' : ''),
                          )
                      : t('wizard.subDetectedSummaryNoRegions').replace('{count}', String(previewResult.nodeCount))}
                  </span>
                </div>
              ) : null}

              {/* Preview error (non-blocking) */}
              {!skipSubscription && previewErrorCode ? (
                <div
                  data-testid="wizard-sub-preview-error"
                  className="flex items-start gap-2 rounded-[var(--radius-md)] border border-warning bg-surface-muted px-3 py-2 text-xs text-text"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <span>
                    {t('wizard.subErrorPrefix')}
                    {t(`wizard.subError.${previewErrorCode}` as MessageKey)}
                  </span>
                </div>
              ) : null}

              <label className="mt-1 inline-flex cursor-pointer items-center gap-2 text-xs text-text">
                <input
                  type="checkbox"
                  checked={skipSubscription}
                  data-testid="wizard-skip-sub"
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSkipSubscription(checked);
                    if (checked) {
                      setPreviewResult(null);
                      setPreviewErrorCode(null);
                    }
                  }}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span>{t('wizard.skipSubLabel')}</span>
              </label>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="wizard-name-input" className="text-sm font-medium text-text">
                {t('wizard.nameLabel')}
              </label>
              <Input
                id="wizard-name-input"
                value={templateName}
                onChange={(e) => {
                  setNameTouched(true);
                  setTemplateName(e.target.value);
                }}
                placeholder={t('wizard.namePlaceholder')}
                data-testid="wizard-name-input"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              <Button type="button" variant="outline" data-testid="wizard-back-btn" onClick={() => setStep(2)}>
                <ArrowLeft className="h-4 w-4" />
                <span>{t('wizard.backBtn')}</span>
              </Button>
              <Button
                type="button"
                data-testid="wizard-generate-btn"
                disabled={quickCreateMutation.isPending || !templateName.trim()}
                onClick={() => quickCreateMutation.mutate()}
              >
                {quickCreateMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t('wizard.generatingBtn')}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    <span>{t('wizard.generateBtn')}</span>
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* COMPLETION PAGE */}
      {step === 'done' && createdResult ? (
        <Card data-testid="wizard-done">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <span>{t('wizard.doneTitle')}</span>
            </CardTitle>
            <CardDescription>{t('wizard.doneSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!createdResult.hasSubscription ? (
              <div
                data-testid="wizard-done-no-sub"
                className="flex items-start gap-2 rounded-[var(--radius-md)] border border-warning bg-surface-muted px-3.5 py-2.5 text-xs text-text"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>{t('wizard.doneNoSubWarning')}</span>
              </div>
            ) : null}

            {!createdResult.ruleTokenConfigured ? (
              <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-warning bg-surface-muted px-3.5 py-2.5 text-xs text-text">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>{t('wizard.doneNoTokenWarning')}</span>
              </div>
            ) : null}

            <WizardDoneLinks
              publications={createdResult.publications}
              name={createdResult.template.name}
              copiedKey={copiedKey}
              onCopy={(id, url) => void handleCopyDoneUrl(id, url)}
              onUrlElement={(id, element) => {
                if (element) urlCodeRefs.current.set(id, element);
                else urlCodeRefs.current.delete(id);
              }}
            />

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
              <Link
                to="/templates/$id"
                params={{ id: createdResult.template.id }}
                data-testid="wizard-done-view-btn"
                className="inline-flex h-9 items-center justify-center rounded-[var(--radius-md)] border border-border bg-surface px-4 text-sm font-medium text-text transition-colors hover:bg-surface-muted"
              >
                {t('wizard.viewTemplateBtn')}
              </Link>
              <Link
                to="/templates"
                data-testid="wizard-done-finish-btn"
                className="inline-flex h-9 items-center justify-center rounded-[var(--radius-md)] bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                {t('wizard.doneBtn')}
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
