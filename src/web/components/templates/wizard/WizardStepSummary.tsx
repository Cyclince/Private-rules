import { ArrowLeft, Loader2, Pencil, Sparkles } from 'lucide-react';
import { ENHANCEMENT_MODULE_METADATA } from '../../../../domain/templates/modules/metadata';
import { useI18n, type MessageKey } from '../../../i18n';
import { Button } from '../../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Input } from '../../ui/input';
import {
  evaluateModuleSupport,
  isStepSkippedForTier,
  mapSelectedAppsToClients,
  normalizeActiveSubscriptionRows,
  WIZARD_COMPLEXITY_CARDS,
  type WizardState,
  type WizardStepNumber,
} from './wizard-state';

type WizardStepSummaryProps = {
  state: WizardState;
  availableRulesets: ReadonlyArray<{ id: string; name: string }>;
  nameError: string | null;
  submitError: string | null;
  isSubmitting: boolean;
  onChangeName: (name: string) => void;
  onJumpStep: (step: WizardStepNumber) => void;
  onBack: () => void;
  onSubmit: () => void;
};

type SummaryRow = {
  step: WizardStepNumber;
  label: string;
  value: string;
  skipped: boolean;
};

export function WizardStepSummary({
  state,
  availableRulesets,
  nameError,
  submitError,
  isSubmitting,
  onChangeName,
  onJumpStep,
  onBack,
  onSubmit,
}: WizardStepSummaryProps) {
  const { t } = useI18n();
  const { selectedApps } = mapSelectedAppsToClients(state.selectedAppIds);
  const activeSubs = normalizeActiveSubscriptionRows(state.subscriptions, state.skipSubscription);
  const complexityCard = WIZARD_COMPLEXITY_CARDS.find((card) => card.id === state.complexity);
  const rulesetMap = new Map(availableRulesets.map((rs) => [rs.id, rs.name]));
  const selectedRulesCount = state.selectedRulesetIds.filter((id) => rulesetMap.has(id)).length;
  const enabledScenariosCount = state.scenarios.filter((sc) => sc.enabled).length;
  const enabledModulesCount =
    state.complexity === 'pro'
      ? ENHANCEMENT_MODULE_METADATA.filter(
          (mod) =>
            evaluateModuleSupport(mod, state.selectedAppIds).status !== 'unsupported' && Boolean(state.modules[mod.id]),
        ).length
      : ENHANCEMENT_MODULE_METADATA.filter((mod) => mod.tierDefaults[state.complexity]).length;

  const poolSummary = isStepSkippedForTier(6, state.complexity)
    ? t('wizard.summary.poolsSkipped')
    : state.groupMode === 'region' || state.complexity === 'pro'
      ? t('wizard.summary.poolsRegionSummary').replace('{count}', String(state.selectedRegions.length))
      : t(`wizard.groupMode.${state.groupMode}` as MessageKey);

  const summaryRows: SummaryRow[] = [
    {
      step: 1,
      label: t('wizard.summary.apps'),
      value: selectedApps.map((app) => app.name).join('、'),
      skipped: false,
    },
    {
      step: 2,
      label: t('wizard.summary.subscriptions'),
      value:
        activeSubs.length > 0
          ? t('wizard.summary.subCount')
              .replace('{count}', String(activeSubs.length))
              .replace('{names}', activeSubs.map((sub) => sub.name).join('、'))
          : t('wizard.summary.subSkipped'),
      skipped: false,
    },
    {
      step: 3,
      label: t('wizard.summary.complexity'),
      value: `${complexityCard?.icon ?? ''} ${t(`wizard.tier.${state.complexity}.title` as MessageKey)}`.trim(),
      skipped: false,
    },
    {
      step: 4,
      label: t('wizard.summary.scenarios'),
      value: isStepSkippedForTier(4, state.complexity)
        ? t('wizard.summary.scenariosSkipped')
        : enabledScenariosCount > 0
          ? t('wizard.summary.scenariosCount').replace('{count}', String(enabledScenariosCount))
          : t('wizard.summary.scenariosNone'),
      skipped: isStepSkippedForTier(4, state.complexity),
    },
    {
      step: 5,
      label: t('wizard.summary.myRules'),
      value:
        selectedRulesCount > 0
          ? t('wizard.summary.myRulesCount').replace('{count}', String(selectedRulesCount))
          : t('wizard.summary.myRulesNone'),
      skipped: false,
    },
    {
      step: 6,
      label: t('wizard.summary.pools'),
      value: poolSummary,
      skipped: isStepSkippedForTier(6, state.complexity),
    },
    {
      step: 7,
      label: t('wizard.summary.modules'),
      value: isStepSkippedForTier(7, state.complexity)
        ? t('wizard.summary.modulesSkipped')
        : t('wizard.summary.modulesCount').replace('{count}', String(enabledModulesCount)),
      skipped: isStepSkippedForTier(7, state.complexity),
    },
  ];

  return (
    <Card data-testid="wizard-step-8">
      <CardHeader>
        <CardTitle className="text-lg">{t('wizard.step8Title')}</CardTitle>
        <CardDescription>{t('wizard.step8Desc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="wizard-name-input" className="text-sm font-medium text-text">
            {t('wizard.nameLabel')}
          </label>
          <Input
            id="wizard-name-input"
            value={state.templateName}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder={t('wizard.namePlaceholder')}
            maxLength={80}
            data-testid="wizard-name-input"
          />
          {nameError ? (
            <p role="alert" data-testid="wizard-name-error" className="text-xs font-medium text-danger">
              {nameError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2" data-testid="wizard-summary-list">
          <h3 className="text-sm font-semibold text-text">{t('wizard.summaryTitle')}</h3>
          <div className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
            {summaryRows.map((row) => (
              <div
                key={row.step}
                data-testid={`wizard-summary-item-${row.step}`}
                className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <span>{row.label}</span>
                    {row.skipped ? (
                      <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px]">
                        {t('wizard.stepSkippedBadge')}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 break-words text-sm font-medium text-text">{row.value}</div>
                </div>
                {!row.skipped ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid={`wizard-summary-edit-${row.step}`}
                    onClick={() => onJumpStep(row.step)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span>{t('wizard.summaryEditBtn')}</span>
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {submitError ? (
          <p role="alert" data-testid="wizard-submit-error" className="text-xs font-medium text-danger">
            {submitError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" data-testid="wizard-back-btn" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            <span>{t('wizard.backBtn')}</span>
          </Button>
          <Button type="button" disabled={isSubmitting} data-testid="wizard-generate-btn" onClick={onSubmit}>
            {isSubmitting ? (
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
  );
}
