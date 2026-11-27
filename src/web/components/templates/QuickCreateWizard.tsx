import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  PreviewSubscriptionBatchResult,
  PreviewSubscriptionResult,
  QuickCreateTemplateResult,
} from '../../../application/templates/quick-create';
import { ENHANCEMENT_MODULE_METADATA } from '../../../domain/templates/modules/metadata';
import type {
  ComplexityTier,
  NodeCombineMode,
  PreviewSubscriptionErrorCode,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { WizardDoneLinks } from './WizardDoneLinks';
import { WizardProgress } from './wizard/WizardProgress';
import { WizardStepApps } from './wizard/WizardStepApps';
import { WizardStepComplexity } from './wizard/WizardStepComplexity';
import { WizardStepModules } from './wizard/WizardStepModules';
import { WizardStepMyRules } from './wizard/WizardStepMyRules';
import { WizardStepNodePools } from './wizard/WizardStepNodePools';
import { WizardStepPolicyGroups } from './wizard/WizardStepPolicyGroups';
import { WizardStepSubscriptions } from './wizard/WizardStepSubscriptions';
import { WizardStepSummary } from './wizard/WizardStepSummary';
import './wizard/wizard-motion.css';
import {
  aggregateDetectedRegions,
  applyScenarioPreset,
  buildDefaultModuleStateForTier,
  buildQuickCreatePayload,
  createInitialWizardState,
  createSubscriptionRow,
  getCandidateRegionList,
  getDefaultScenariosForTier,
  getNextWizardStep,
  getPrevWizardStep,
  inferRulesetDefaultRoute,
  isValidHttpSubscriptionUrl,
  mapSelectedAppsToClients,
  normalizeActiveSubscriptionRows,
  toggleModuleWithConflicts,
  WIZARD_CORE_REGION_CODES,
  type WizardState,
  type WizardStep,
  type WizardStepNumber,
} from './wizard/wizard-state';

function extractPreviewErrorCode(error: unknown): PreviewSubscriptionErrorCode {
  if (error instanceof ApiClientError && error.details && typeof error.details === 'object') {
    const code = (error.details as { previewErrorCode?: unknown }).previewErrorCode;
    if (code === 'LINK_INVALID' || code === 'NEEDS_USER_AGENT' || code === 'NOT_SUBSCRIPTION' || code === 'TIMEOUT') {
      return code;
    }
  }
  return 'LINK_INVALID';
}

function normalizePreviewPayload(
  raw: PreviewSubscriptionResult | PreviewSubscriptionBatchResult,
):
  | { ok: true; preview: NonNullable<WizardState['subscriptions'][number]['preview']> }
  | { ok: false; errorCode: PreviewSubscriptionErrorCode } {
  if ('items' in raw) {
    const first = raw.items[0];
    if (!first) return { ok: false, errorCode: 'LINK_INVALID' };
    if (!first.ok) {
      return { ok: false, errorCode: first.errorCode ?? 'LINK_INVALID' };
    }
    return {
      ok: true,
      preview: {
        nodeCount: first.nodeCount,
        regions: first.regions,
        regionCounts: first.regionCounts,
        checkedAt: new Date().toISOString(),
      },
    };
  }
  return {
    ok: true,
    preview: {
      nodeCount: raw.nodeCount,
      regions: raw.regions,
      regionCounts: raw.regionCounts,
      checkedAt: raw.checkedAt,
    },
  };
}

export function QuickCreateWizard() {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const authQuery = useQuery(authMeQueryOptions());
  const inTelegram = isTelegramSession(authQuery.data);
  const rulesetsQuery = useQuery(rulesetsListQueryOptions());

  const [state, setState] = useState<WizardState>(() =>
    createInitialWizardState({ defaultTemplateName: t('wizard.defaultTemplateName') }),
  );
  const [nameTouched, setNameTouched] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [checkingRowId, setCheckingRowId] = useState<string | null>(null);
  const [moduleConflictNotice, setModuleConflictNotice] = useState<string | null>(null);
  const [createdResult, setCreatedResult] = useState<QuickCreateTemplateResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const urlCodeRefs = useRef<Map<string, HTMLElement>>(new Map());
  const nextSubSeq = useRef(2);

  useEffect(() => {
    if (!nameTouched) {
      setState((prev) => ({ ...prev, templateName: t('wizard.defaultTemplateName') }));
    }
  }, [locale, nameTouched, t]);

  const categories = useMemo(() => rulesetsQuery.data?.data.categories ?? [], [rulesetsQuery.data]);

  useEffect(() => {
    if (categories.length === 0) return;
    setState((prev) => {
      let changed = false;
      const nextRoutes = { ...prev.rulesetRoutes };
      for (const cat of categories) {
        if (!nextRoutes[cat.id]) {
          nextRoutes[cat.id] = inferRulesetDefaultRoute(cat.name);
          changed = true;
        }
      }
      return changed ? { ...prev, rulesetRoutes: nextRoutes } : prev;
    });
  }, [categories]);

  const candidateRegionCodes = useMemo(
    () =>
      getCandidateRegionList(state.subscriptions, state.skipSubscription, state.complexity).map((item) => item.code),
    [state.subscriptions, state.skipSubscription, state.complexity],
  );

  const navigateStep = (target: WizardStep, explicitDirection?: 'forward' | 'backward') => {
    setStepError(null);
    setState((prev) => {
      const current = prev.step;
      const direction =
        explicitDirection ??
        (target === 'done' ? 'forward' : current === 'done' ? 'backward' : target >= current ? 'forward' : 'backward');
      const maxReachedStep =
        typeof target === 'number' && target > prev.maxReachedStep ? (target as WizardStepNumber) : prev.maxReachedStep;
      return { ...prev, step: target, direction, maxReachedStep };
    });
  };

  const handleCheckSubscriptionRow = async (rowId: string, explicitClick: boolean) => {
    const targetRow = state.subscriptions.find((row) => row.id === rowId);
    if (!targetRow || state.skipSubscription) return;
    const trimmedUrl = targetRow.url.trim();
    if (!trimmedUrl) return;
    if (!explicitClick && trimmedUrl === targetRow.lastCheckedUrl) return;

    if (!isValidHttpSubscriptionUrl(trimmedUrl)) {
      if (explicitClick) {
        setState((prev) => ({
          ...prev,
          subscriptions: prev.subscriptions.map((row) =>
            row.id === rowId ? { ...row, preview: null, errorCode: 'LINK_INVALID', lastCheckedUrl: trimmedUrl } : row,
          ),
        }));
      }
      return;
    }

    setCheckingRowId(rowId);
    try {
      const response = await api.api.templates['preview-subscription'].$post({
        json: { subscriptionUrl: trimmedUrl, name: targetRow.name.trim() || undefined },
      });
      const json = await readApiJson<PreviewSubscriptionResult | PreviewSubscriptionBatchResult>(response);
      const parsed = normalizePreviewPayload(json);

      setState((prev) => {
        const nextSubs = prev.subscriptions.map((row) =>
          row.id === rowId
            ? parsed.ok
              ? { ...row, preview: parsed.preview, errorCode: null, lastCheckedUrl: trimmedUrl }
              : { ...row, preview: null, errorCode: parsed.errorCode, lastCheckedUrl: trimmedUrl }
            : row,
        );
        const detected = aggregateDetectedRegions(nextSubs, prev.skipSubscription);
        const nextRegions =
          !prev.regionsTouched && detected.length > 0
            ? detected.map((item) => item.code)
            : prev.regionsTouched
              ? prev.selectedRegions
              : [...WIZARD_CORE_REGION_CODES];

        return {
          ...prev,
          subscriptions: nextSubs,
          selectedRegions: nextRegions,
        };
      });
    } catch (error) {
      const errorCode = extractPreviewErrorCode(error);
      setState((prev) => ({
        ...prev,
        subscriptions: prev.subscriptions.map((row) =>
          row.id === rowId ? { ...row, preview: null, errorCode, lastCheckedUrl: trimmedUrl } : row,
        ),
      }));
    } finally {
      setCheckingRowId((current) => (current === rowId ? null : current));
    }
  };

  const quickCreateMutation = useMutation({
    mutationFn: async () => {
      const payload = buildQuickCreatePayload(state, categories);
      return readApiJson<QuickCreateTemplateResult>(
        await api.api.templates['quick-create'].$post({
          json: payload,
        }),
      );
    },
    onSuccess: async (data) => {
      setCreatedResult(data);
      navigateStep('done', 'forward');
      await Promise.all([invalidateTemplates(queryClient), invalidatePublications(queryClient)]);
    },
    onError: (error) => {
      const message = formatApiError(error, locale);
      setStepError(message);
      notify({ title: message, variant: 'danger' });
    },
  });

  const handleBack = () => {
    if (state.step === 'done') return;
    const prev = getPrevWizardStep(state.step, state.complexity);
    if (prev) navigateStep(prev, 'backward');
  };

  const handleNext = () => {
    if (state.step === 'done') return;
    if (state.step === 1) {
      const mapped = mapSelectedAppsToClients(state.selectedAppIds);
      if (mapped.clients.length === 0) {
        setStepError(t('wizard.clientRequiredError'));
        return;
      }
    }
    if (state.step === 2 && !state.skipSubscription) {
      const invalidRow = state.subscriptions.find(
        (row) => row.url.trim().length > 0 && !isValidHttpSubscriptionUrl(row.url),
      );
      if (invalidRow) {
        setStepError(t('wizard.subInvalidUrlError'));
        return;
      }
    }
    const next = getNextWizardStep(state.step, state.complexity);
    if (next) navigateStep(next, 'forward');
  };

  const handleChangeComplexity = (tier: ComplexityTier) => {
    setModuleConflictNotice(null);
    setState((prev) => ({
      ...prev,
      complexity: tier,
      scenarios: prev.scenariosTouched ? prev.scenarios : getDefaultScenariosForTier(tier),
      modules: prev.modulesTouched ? prev.modules : buildDefaultModuleStateForTier(tier),
    }));
  };

  const handleCopyDoneUrl = async (id: string, url: string) => {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      const el = urlCodeRefs.current.get(id);
      if (el && window.getSelection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      notify({ title: t('common.copied') });
      return;
    }
    setCopiedKey(id);
    notify({ title: t('templates.copiedLinkToast'), variant: 'success' });
    setTimeout(() => {
      setCopiedKey((current) => (current === id ? null : current));
    }, 1800);
  };

  if (inTelegram) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 py-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-warning" />
              <span>{t('wizard.telegramReadOnlyTitle')}</span>
            </CardTitle>
            <CardDescription>{t('wizard.telegramReadOnlyDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              to="/templates"
              className="inline-flex h-9 items-center justify-center rounded-[var(--radius-md)] border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-surface-muted"
            >
              {t('wizard.backToList')}
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-2" data-testid="quick-create-wizard">
      <Card className="p-4">
        <WizardProgress
          step={state.step}
          complexity={state.complexity}
          maxReachedStep={state.maxReachedStep}
          onJumpStep={(target) => navigateStep(target)}
        />
      </Card>

      <div
        key={String(state.step)}
        data-testid="wizard-step-panel"
        data-direction={state.direction}
        className="wizard-step-panel"
      >
        {state.step === 1 ? (
          <WizardStepApps
            selectedAppIds={state.selectedAppIds}
            validationError={stepError}
            onChange={(nextAppIds) => {
              setStepError(null);
              setState((prev) => ({ ...prev, selectedAppIds: nextAppIds }));
            }}
            onNext={handleNext}
          />
        ) : null}

        {state.step === 2 ? (
          <WizardStepSubscriptions
            rows={state.subscriptions}
            skipSubscription={state.skipSubscription}
            combineMode={state.combineMode}
            checkingRowId={checkingRowId}
            validationError={stepError}
            onAddRow={() => {
              const idx = state.subscriptions.length;
              const newId = `sub-${nextSubSeq.current}`;
              nextSubSeq.current += 1;
              setState((prev) => ({
                ...prev,
                subscriptions: [...prev.subscriptions, createSubscriptionRow(idx, newId)],
              }));
            }}
            onRemoveRow={(rowId) => {
              setStepError(null);
              setState((prev) => {
                const filtered = prev.subscriptions.filter((row) => row.id !== rowId);
                const nextSubs = filtered.length > 0 ? filtered : [createSubscriptionRow(0)];
                const detected = aggregateDetectedRegions(nextSubs, prev.skipSubscription);
                const nextRegions = prev.regionsTouched
                  ? prev.selectedRegions
                  : detected.length > 0
                    ? detected.map((item) => item.code)
                    : [...WIZARD_CORE_REGION_CODES];
                return {
                  ...prev,
                  subscriptions: nextSubs,
                  selectedRegions: nextRegions,
                };
              });
            }}
            onUpdateRow={(rowId, patch) => {
              setStepError(null);
              setState((prev) => {
                const nextSubs = prev.subscriptions.map((row) =>
                  row.id === rowId
                    ? {
                        ...row,
                        ...patch,
                        ...(patch.url !== undefined ? { preview: null, errorCode: null } : {}),
                      }
                    : row,
                );
                const detected = aggregateDetectedRegions(nextSubs, prev.skipSubscription);
                const nextRegions = prev.regionsTouched
                  ? prev.selectedRegions
                  : detected.length > 0
                    ? detected.map((item) => item.code)
                    : [...WIZARD_CORE_REGION_CODES];
                return {
                  ...prev,
                  subscriptions: nextSubs,
                  selectedRegions: nextRegions,
                };
              });
            }}
            onCheckRow={(rowId, explicitClick) => {
              void handleCheckSubscriptionRow(rowId, explicitClick);
            }}
            onToggleSkip={(skip) => {
              setStepError(null);
              setState((prev) => {
                const detected = aggregateDetectedRegions(prev.subscriptions, skip);
                const nextRegions = prev.regionsTouched
                  ? prev.selectedRegions
                  : detected.length > 0
                    ? detected.map((item) => item.code)
                    : [...WIZARD_CORE_REGION_CODES];
                return {
                  ...prev,
                  skipSubscription: skip,
                  selectedRegions: nextRegions,
                };
              });
            }}
            onChangeCombineMode={(mode: NodeCombineMode) => {
              setState((prev) => ({ ...prev, combineMode: mode }));
            }}
            onBack={handleBack}
            onNext={handleNext}
          />
        ) : null}

        {state.step === 3 ? (
          <WizardStepComplexity
            complexity={state.complexity}
            onChangeComplexity={handleChangeComplexity}
            onBack={handleBack}
            onNext={handleNext}
          />
        ) : null}

        {state.step === 4 ? (
          <WizardStepPolicyGroups
            scenarios={state.scenarios}
            regionCodes={candidateRegionCodes}
            onApplyPreset={(preset) => {
              setState((prev) => ({
                ...prev,
                scenarios: applyScenarioPreset(prev.scenarios, preset),
                scenariosTouched: true,
              }));
            }}
            onToggleScenario={(id: WizardScenarioId, enabled: boolean) => {
              setState((prev) => ({
                ...prev,
                scenariosTouched: true,
                scenarios: prev.scenarios.map((sc) => (sc.id === id ? { ...sc, enabled } : sc)),
              }));
            }}
            onChangeScenarioRoute={(id: WizardScenarioId, route: WizardRouteTarget) => {
              setState((prev) => ({
                ...prev,
                scenariosTouched: true,
                scenarios: prev.scenarios.map((sc) => (sc.id === id ? { ...sc, route } : sc)),
              }));
            }}
            onBack={handleBack}
            onNext={handleNext}
          />
        ) : null}

        {state.step === 5 ? (
          <WizardStepMyRules
            complexity={state.complexity}
            rulesets={categories}
            selectedRulesetIds={state.selectedRulesetIds}
            rulesetRoutes={state.rulesetRoutes}
            regionCodes={candidateRegionCodes}
            onToggleRuleset={(rulesetId, _name, checked) => {
              setState((prev) => ({
                ...prev,
                selectedRulesetIds: checked
                  ? prev.selectedRulesetIds.includes(rulesetId)
                    ? prev.selectedRulesetIds
                    : [...prev.selectedRulesetIds, rulesetId]
                  : prev.selectedRulesetIds.filter((id) => id !== rulesetId),
              }));
            }}
            onChangeRoute={(rulesetId, route) => {
              setState((prev) => ({
                ...prev,
                rulesetRoutes: { ...prev.rulesetRoutes, [rulesetId]: route },
              }));
            }}
            onBack={handleBack}
            onNext={handleNext}
          />
        ) : null}

        {state.step === 6 ? (
          <WizardStepNodePools
            complexity={state.complexity}
            groupMode={state.groupMode}
            selectedRegions={state.selectedRegions}
            includeProviderPools={state.includeProviderPools}
            selectedTraitPoolIds={state.selectedTraitPoolIds}
            subscriptions={state.subscriptions}
            skipSubscription={state.skipSubscription}
            onChangeGroupMode={(mode: WizardGroupMode) => {
              setState((prev) => ({ ...prev, groupMode: mode }));
            }}
            onToggleRegion={(code) => {
              setState((prev) => ({
                ...prev,
                regionsTouched: true,
                selectedRegions: prev.selectedRegions.includes(code)
                  ? prev.selectedRegions.filter((item) => item !== code)
                  : [...prev.selectedRegions, code],
              }));
            }}
            onToggleProviderPools={(enabled) => {
              setState((prev) => ({ ...prev, includeProviderPools: enabled }));
            }}
            onToggleTraitPool={(presetId) => {
              setState((prev) => ({
                ...prev,
                selectedTraitPoolIds: prev.selectedTraitPoolIds.includes(presetId)
                  ? prev.selectedTraitPoolIds.filter((item) => item !== presetId)
                  : [...prev.selectedTraitPoolIds, presetId],
              }));
            }}
            onBack={handleBack}
            onNext={handleNext}
          />
        ) : null}

        {state.step === 7 ? (
          <WizardStepModules
            complexity={state.complexity}
            selectedAppIds={state.selectedAppIds}
            modules={state.modules}
            conflictNotice={moduleConflictNotice}
            onToggleModule={(moduleId, enabled) => {
              const result = toggleModuleWithConflicts(state.modules, moduleId, enabled);
              if (result.disabledPeers.length > 0) {
                const peerNames = result.disabledPeers
                  .map((peerId) => {
                    const mod = ENHANCEMENT_MODULE_METADATA.find((item) => item.id === peerId);
                    return mod ? t(`wizard.module.${mod.id}.name` as MessageKey) : peerId;
                  })
                  .join('、');
                setModuleConflictNotice(t('wizard.moduleConflictNotice').replace('{peer}', peerNames));
              } else {
                setModuleConflictNotice(null);
              }
              setState((prev) => ({
                ...prev,
                modulesTouched: true,
                modules: result.next,
              }));
            }}
            onBack={handleBack}
            onNext={handleNext}
          />
        ) : null}

        {state.step === 8 ? (
          <WizardStepSummary
            state={state}
            availableRulesets={categories}
            nameError={stepError && !state.templateName.trim() ? stepError : null}
            submitError={stepError && state.templateName.trim() ? stepError : null}
            isSubmitting={quickCreateMutation.isPending}
            onChangeName={(name) => {
              setNameTouched(true);
              setStepError(null);
              setState((prev) => ({ ...prev, templateName: name }));
            }}
            onJumpStep={(target) => navigateStep(target, 'backward')}
            onBack={handleBack}
            onSubmit={() => {
              if (!state.templateName.trim()) {
                setStepError(t('wizard.nameRequiredError'));
                return;
              }
              setStepError(null);
              quickCreateMutation.mutate();
            }}
          />
        ) : null}

        {state.step === 'done' && createdResult ? (
          <Card data-testid="wizard-done">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <CheckCircle2 className="motion-success-icon h-5 w-5 text-success" />
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
                selectedAppIds={state.selectedAppIds}
                subscriptionNames={normalizeActiveSubscriptionRows(state.subscriptions, state.skipSubscription).map(
                  (sub) => sub.name,
                )}
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
    </div>
  );
}
