import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react';
import { MAX_TEMPLATE_SUBSCRIPTIONS, type NodeCombineMode } from '../../../../shared/schemas/quick-create';
import { useI18n, type MessageKey } from '../../../i18n';
import { Button } from '../../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Input } from '../../ui/input';
import type { WizardSubscriptionRow } from './wizard-state';

const COMBINE_MODES: readonly NodeCombineMode[] = ['merge', 'perProvider'];

type WizardStepSubscriptionsProps = {
  rows: readonly WizardSubscriptionRow[];
  skipSubscription: boolean;
  combineMode: NodeCombineMode;
  checkingRowId: string | null;
  validationError: string | null;
  onAddRow: () => void;
  onRemoveRow: (rowId: string) => void;
  onUpdateRow: (rowId: string, patch: { name?: string; url?: string }) => void;
  onCheckRow: (rowId: string, explicitClick: boolean) => void;
  onToggleSkip: (skip: boolean) => void;
  onChangeCombineMode: (mode: NodeCombineMode) => void;
  onBack: () => void;
  onNext: () => void;
};

export function WizardStepSubscriptions({
  rows,
  skipSubscription,
  combineMode,
  checkingRowId,
  validationError,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  onCheckRow,
  onToggleSkip,
  onChangeCombineMode,
  onBack,
  onNext,
}: WizardStepSubscriptionsProps) {
  const { t } = useI18n();
  const showCombineMode = !skipSubscription && rows.length > 1;

  return (
    <Card data-testid="wizard-step-2">
      <CardHeader>
        <CardTitle className="text-lg">{t('wizard.step2Title')}</CardTitle>
        <CardDescription>{t('wizard.step2Desc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          {rows.map((row, index) => {
            const isChecking = checkingRowId === row.id;
            const regionSummary = row.preview?.regions
              .map((region) => `${region.emoji} ${region.name} ${region.count}`)
              .join(' · ');

            return (
              <div
                key={row.id}
                data-testid={`wizard-sub-row-${index}`}
                className={`flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface p-3.5 ${
                  skipSubscription ? 'opacity-55' : ''
                }`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex flex-col gap-1 sm:w-44">
                    <label htmlFor={`wizard-sub-name-input-${row.id}`} className="text-xs font-medium text-text-muted">
                      {t('wizard.subItemNameLabel')}
                    </label>
                    <Input
                      id={`wizard-sub-name-input-${row.id}`}
                      type="text"
                      maxLength={60}
                      disabled={skipSubscription}
                      value={row.name}
                      onChange={(e) => onUpdateRow(row.id, { name: e.target.value })}
                      placeholder={t('wizard.subItemNamePlaceholder')}
                      data-testid={`wizard-sub-name-${index}`}
                    />
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <label htmlFor={`wizard-sub-url-input-${row.id}`} className="text-xs font-medium text-text-muted">
                      {t('wizard.subLabel')}
                    </label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id={`wizard-sub-url-input-${row.id}`}
                        type="url"
                        disabled={skipSubscription}
                        value={row.url}
                        onChange={(e) => onUpdateRow(row.id, { url: e.target.value })}
                        onBlur={() => onCheckRow(row.id, false)}
                        placeholder={t('wizard.subPlaceholder')}
                        data-testid={`wizard-sub-input-${index}`}
                        className="min-w-0 flex-1"
                      />
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={skipSubscription || !row.url.trim() || isChecking}
                          data-testid={`wizard-sub-check-btn-${index}`}
                          onClick={() => onCheckRow(row.id, true)}
                        >
                          {isChecking ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span>{t('wizard.checkingSubBtn')}</span>
                            </>
                          ) : (
                            <span>{t('wizard.checkSubBtn')}</span>
                          )}
                        </Button>
                        {rows.length > 1 && !skipSubscription ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label={`${t('wizard.subRemoveBtn')} ${row.name}`}
                            data-testid={`wizard-sub-remove-${index}`}
                            onClick={() => onRemoveRow(row.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                {!skipSubscription && row.preview ? (
                  <div
                    data-testid={`wizard-sub-preview-ok-${index}`}
                    className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-success/40 bg-success/8 px-3 py-2 text-xs text-text"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    <span className="min-w-0 break-words">
                      {row.preview.regions.length > 0
                        ? t('wizard.subDetectedSummary')
                            .replace('{count}', String(row.preview.nodeCount))
                            .replace('{regions}', regionSummary ?? '')
                        : t('wizard.subDetectedSummaryNoRegions').replace('{count}', String(row.preview.nodeCount))}
                    </span>
                  </div>
                ) : null}

                {!skipSubscription && row.errorCode ? (
                  <div
                    data-testid={`wizard-sub-preview-err-${index}`}
                    className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-text"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <span className="min-w-0 break-words">
                      {t('wizard.subErrorPrefix')}
                      {t(`wizard.subError.${row.errorCode}` as MessageKey)}
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}

          {!skipSubscription && rows.length < MAX_TEMPLATE_SUBSCRIPTIONS ? (
            <div>
              <Button type="button" variant="outline" size="sm" data-testid="wizard-sub-add-btn" onClick={onAddRow}>
                <Plus className="h-4 w-4" />
                <span>{t('wizard.subAddBtn')}</span>
              </Button>
            </div>
          ) : null}
        </div>

        <p className="text-xs text-text-muted">{t('wizard.subSecurityHint')}</p>

        {showCombineMode ? (
          <div className="flex flex-col gap-2" data-testid="wizard-combine-mode-section">
            <h3 className="text-sm font-semibold text-text">{t('wizard.combineModeTitle')}</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {COMBINE_MODES.map((mode) => {
                const selected = combineMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={selected}
                    data-testid={`wizard-combine-mode-${mode}`}
                    onClick={() => onChangeCombineMode(mode)}
                    className={`motion-card flex cursor-pointer flex-col gap-1 rounded-[var(--radius-md)] border p-3 text-left ${
                      selected
                        ? 'border-primary bg-primary/8 ring-1 ring-primary/30'
                        : 'border-border bg-surface hover:border-primary/40 hover:bg-surface-muted/50'
                    }`}
                  >
                    <span className="text-sm font-semibold text-text">
                      {t(`wizard.combineMode.${mode}` as MessageKey)}
                    </span>
                    <span className="text-xs leading-relaxed text-text-muted">
                      {t(`wizard.combineModeDesc.${mode}` as MessageKey)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-text">
          <input
            type="checkbox"
            checked={skipSubscription}
            onChange={(e) => onToggleSkip(e.target.checked)}
            data-testid="wizard-skip-sub"
            className="h-4 w-4 accent-[var(--primary)]"
          />
          <span>{t('wizard.skipSubLabel')}</span>
        </label>

        {skipSubscription ? (
          <p className="rounded-[var(--radius-md)] border border-border bg-surface-muted/50 px-3 py-2 text-xs text-text-muted">
            {t('wizard.subSkippedHint')}
          </p>
        ) : null}

        {validationError ? (
          <p role="alert" data-testid="wizard-step2-error" className="text-xs font-medium text-danger">
            {validationError}
          </p>
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
