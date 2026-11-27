import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { ComplexityTier, WizardGroupMode } from '../../../../shared/schemas/quick-create';
import { useI18n, type MessageKey } from '../../../i18n';
import { Button } from '../../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Switch } from '../../ui/switch';
import {
  aggregateDetectedRegions,
  getCandidateRegionList,
  WIZARD_TRAIT_POOL_PRESETS,
  type WizardSubscriptionRow,
} from './wizard-state';

const GROUP_MODES: readonly WizardGroupMode[] = ['region', 'auto', 'select'];

type WizardStepNodePoolsProps = {
  complexity: ComplexityTier;
  groupMode: WizardGroupMode;
  selectedRegions: readonly string[];
  includeProviderPools: boolean;
  selectedTraitPoolIds: readonly string[];
  subscriptions: readonly WizardSubscriptionRow[];
  skipSubscription: boolean;
  onChangeGroupMode: (mode: WizardGroupMode) => void;
  onToggleRegion: (code: string) => void;
  onToggleProviderPools: (enabled: boolean) => void;
  onToggleTraitPool: (presetId: string) => void;
  onBack: () => void;
  onNext: () => void;
};

export function WizardStepNodePools({
  complexity,
  groupMode,
  selectedRegions,
  includeProviderPools,
  selectedTraitPoolIds,
  subscriptions,
  skipSubscription,
  onChangeGroupMode,
  onToggleRegion,
  onToggleProviderPools,
  onToggleTraitPool,
  onBack,
  onNext,
}: WizardStepNodePoolsProps) {
  const { t } = useI18n();
  const isPro = complexity === 'pro';
  const detectedRegions = aggregateDetectedRegions(subscriptions, skipSubscription);
  const candidateRegions = getCandidateRegionList(subscriptions, skipSubscription, complexity);
  const showRegionSelection = groupMode === 'region' || isPro;

  return (
    <Card data-testid="wizard-step-6">
      <CardHeader>
        <CardTitle className="text-lg">{t('wizard.step6Title')}</CardTitle>
        <CardDescription>{t('wizard.step6Desc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text">{t('wizard.groupModeTitle')}</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {GROUP_MODES.map((mode) => {
              const selected = groupMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={selected}
                  data-testid={`wizard-group-mode-${mode}`}
                  onClick={() => onChangeGroupMode(mode)}
                  className={`motion-card flex cursor-pointer flex-col gap-1 rounded-[var(--radius-md)] border p-3 text-left ${
                    selected
                      ? 'border-primary bg-primary/8 ring-1 ring-primary/30'
                      : 'border-border bg-surface hover:border-primary/40 hover:bg-surface-muted/50'
                  }`}
                >
                  <span className="text-sm font-semibold text-text">{t(`wizard.groupMode.${mode}` as MessageKey)}</span>
                  <span className="text-xs leading-relaxed text-text-muted">
                    {t(`wizard.groupModeDesc.${mode}` as MessageKey)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {showRegionSelection ? (
          <div className="flex flex-col gap-2.5" data-testid="wizard-pool-regions-section">
            <h3 className="text-sm font-semibold text-text">{t('wizard.poolRegionsTitle')}</h3>
            <p className="text-xs text-text-muted">
              {detectedRegions.length > 0 ? t('wizard.poolRegionsFromSubHint') : t('wizard.poolRegionsFallbackHint')}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {candidateRegions.map((region) => {
                const checked = selectedRegions.includes(region.code);
                return (
                  <label
                    key={region.code}
                    data-testid={`wizard-pool-region-${region.code}`}
                    className={`motion-card flex cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-xs ${
                      checked ? 'border-primary bg-primary/8 text-text' : 'border-border bg-surface text-text-muted'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleRegion(region.code)}
                        data-testid={`wizard-pool-region-toggle-${region.code}`}
                        className="h-3.5 w-3.5 shrink-0 accent-[var(--primary)]"
                      />
                      <span aria-hidden="true">{region.emoji}</span>
                      <span className="truncate font-medium text-text">{region.name}</span>
                    </span>
                    {region.count !== undefined ? (
                      <span className="shrink-0 font-mono text-[11px] text-text-muted">{region.count}</span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </div>
        ) : null}

        {isPro ? (
          <>
            <div
              data-testid="wizard-pool-provider-section"
              className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3.5"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-text">{t('wizard.poolProviderTitle')}</div>
                <p className="mt-0.5 text-xs text-text-muted">{t('wizard.poolProviderDesc')}</p>
              </div>
              <Switch
                checked={includeProviderPools}
                onCheckedChange={onToggleProviderPools}
                aria-label={t('wizard.poolProviderToggle')}
                data-testid="wizard-pool-provider-toggle"
              />
            </div>

            <div className="flex flex-col gap-2" data-testid="wizard-pool-traits-section">
              <div>
                <h3 className="text-sm font-semibold text-text">{t('wizard.poolTraitsTitle')}</h3>
                <p className="text-xs text-text-muted">{t('wizard.poolTraitsDesc')}</p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {WIZARD_TRAIT_POOL_PRESETS.map((preset) => {
                  const checked = selectedTraitPoolIds.includes(preset.id);
                  return (
                    <label
                      key={preset.id}
                      data-testid={`wizard-pool-trait-${preset.id}`}
                      className={`motion-card flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-md)] border p-3 ${
                        checked ? 'border-primary/40 bg-primary/6' : 'border-border bg-surface'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleTraitPool(preset.id)}
                        data-testid={`wizard-pool-trait-toggle-${preset.id}`}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-text">
                          {t(`wizard.poolTrait.${preset.id}.name` as MessageKey)}
                        </div>
                        <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
                          {t(`wizard.poolTrait.${preset.id}.desc` as MessageKey)}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" data-testid="wizard-back-btn" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            <span>{t('wizard.backBtn')}</span>
          </Button>
          <Button type="button" data-testid="wizard-next-btn" onClick={onNext}>
            <span>{t('wizard.nextBtn')}</span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
