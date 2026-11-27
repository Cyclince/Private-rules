import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import type { ComplexityTier } from '../../../../shared/schemas/quick-create';
import { useI18n, type MessageKey } from '../../../i18n';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { WIZARD_COMPLEXITY_CARDS } from './wizard-state';

type WizardStepComplexityProps = {
  complexity: ComplexityTier;
  onChangeComplexity: (tier: ComplexityTier) => void;
  onBack: () => void;
  onNext: () => void;
};

export function WizardStepComplexity({ complexity, onChangeComplexity, onBack, onNext }: WizardStepComplexityProps) {
  const { t } = useI18n();

  return (
    <Card data-testid="wizard-step-3">
      <CardHeader>
        <CardTitle className="text-lg">{t('wizard.step3Title')}</CardTitle>
        <CardDescription>{t('wizard.step3Desc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {WIZARD_COMPLEXITY_CARDS.map((card) => {
            const selected = complexity === card.id;
            return (
              <button
                key={card.id}
                type="button"
                aria-pressed={selected}
                data-testid={`wizard-tier-${card.id}`}
                onClick={() => onChangeComplexity(card.id)}
                className={`motion-card flex cursor-pointer flex-col justify-between gap-3 rounded-[var(--radius-md)] border p-4 text-left ${
                  selected
                    ? 'border-primary bg-primary/8 ring-1 ring-primary/30'
                    : 'border-border bg-surface hover:border-primary/40 hover:bg-surface-muted/50'
                }`}
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span aria-hidden="true" className="text-xl leading-none">
                        {card.icon}
                      </span>
                      <span className="text-base font-semibold text-text">
                        {t(`wizard.tier.${card.id}.title` as MessageKey)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {card.recommended ? (
                        <Badge variant="default" className="text-[11px]">
                          {t('wizard.tierBadge.recommended')}
                        </Badge>
                      ) : null}
                      {selected ? <Check className="h-4 w-4 text-primary" /> : null}
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed text-text">
                    {t(`wizard.tier.${card.id}.summary` as MessageKey)}
                  </p>
                </div>
                <p className="border-t border-border/70 pt-2 text-[11px] leading-relaxed text-text-muted">
                  {t(`wizard.tier.${card.id}.audience` as MessageKey)}
                </p>
              </button>
            );
          })}
        </div>

        {complexity === 'simple' ? (
          <p
            data-testid="wizard-tier-simple-hint"
            className="rounded-[var(--radius-md)] border border-border bg-surface-muted/50 px-3 py-2 text-xs text-text-muted"
          >
            {t('wizard.tierUpgradeHint')}
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
