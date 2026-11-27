import { Check } from 'lucide-react';
import { useI18n, type MessageKey } from '../../../i18n';
import { getStepStatuses, TOTAL_WIZARD_STEPS, type WizardStep, type WizardStepNumber } from './wizard-state';
import type { ComplexityTier } from '../../../../shared/schemas/quick-create';

type WizardProgressProps = {
  step: WizardStep;
  complexity: ComplexityTier;
  maxReachedStep: WizardStepNumber;
  onJumpStep: (target: WizardStepNumber) => void;
};

export function WizardProgress({ step, complexity, maxReachedStep, onJumpStep }: WizardProgressProps) {
  const { t } = useI18n();
  const statuses = getStepStatuses(step, complexity);
  const ratio = step === 'done' ? 1 : step / TOTAL_WIZARD_STEPS;

  return (
    <div className="flex flex-col gap-3" data-testid="wizard-progress">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-text">{t('wizard.title')}</h1>
        <span
          data-testid="wizard-step-indicator"
          className="rounded-full bg-surface-muted px-3 py-1 text-xs font-medium text-text-muted"
        >
          {step === 'done' ? t('wizard.doneIndicator') : t('wizard.stepIndicator').replace('{step}', String(step))}
        </span>
      </div>

      {/* Smooth scaleX progress bar using unified M3.5 duration/easing tokens */}
      <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
        <div
          className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-[var(--motion-slow)] ease-[var(--ease-out)]"
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>

      {/* 8-step overview: 4x2 on mobile (<= 390px) and 8 columns on desktop */}
      <nav aria-label={t('wizard.title')} className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
        {statuses.map((item) => {
          const canJump = step !== 'done' && !item.skipped && item.step !== step && item.step <= maxReachedStep;
          const shortLabel = t(`wizard.stepShort.${item.step}` as MessageKey);

          return (
            <button
              key={item.step}
              type="button"
              disabled={!canJump}
              onClick={() => {
                if (canJump) onJumpStep(item.step);
              }}
              data-testid={`wizard-progress-step-${item.step}`}
              data-status={item.status}
              aria-current={item.status === 'active' ? 'step' : undefined}
              className={`flex min-w-0 flex-col items-start gap-0.5 rounded-[var(--radius-sm)] border px-2 py-1.5 text-left text-[11px] transition-colors duration-[var(--motion-fast)] ${
                item.status === 'active'
                  ? 'border-primary bg-primary/10 text-text font-semibold'
                  : item.status === 'completed'
                    ? 'border-success/35 bg-success/8 text-text'
                    : item.status === 'skipped'
                      ? 'border-dashed border-border bg-surface-muted/40 text-text-muted opacity-75'
                      : 'border-border bg-surface text-text-muted'
              } ${canJump ? 'cursor-pointer hover:border-primary/50' : 'cursor-default'}`}
            >
              <div className="flex w-full items-center justify-between gap-1">
                <span className="font-mono text-[10px] opacity-80">{item.step}</span>
                {item.status === 'completed' ? (
                  <Check className="h-3 w-3 shrink-0 text-success" />
                ) : item.status === 'skipped' ? (
                  <span
                    data-testid={`wizard-progress-skipped-${item.step}`}
                    className="truncate text-[10px] text-text-muted"
                  >
                    {t('wizard.stepSkippedBadge')}
                  </span>
                ) : null}
              </div>
              <span className="w-full truncate">{shortLabel}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
