import { ArrowLeft, ArrowRight, CheckCircle2, Info } from 'lucide-react';
import { ENHANCEMENT_MODULE_METADATA, MODULE_GROUP_DEFINITIONS } from '../../../../domain/templates/modules/metadata';
import type { ComplexityTier } from '../../../../shared/schemas/quick-create';
import { useI18n, type MessageKey } from '../../../i18n';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Switch } from '../../ui/switch';
import { evaluateModuleSupport } from './wizard-state';

type WizardStepModulesProps = {
  complexity: ComplexityTier;
  selectedAppIds: readonly string[];
  modules: Readonly<Record<string, boolean>>;
  conflictNotice: string | null;
  onToggleModule: (moduleId: string, enabled: boolean) => void;
  onBack: () => void;
  onNext: () => void;
};

export function WizardStepModules({
  complexity,
  selectedAppIds,
  modules,
  conflictNotice,
  onToggleModule,
  onBack,
  onNext,
}: WizardStepModulesProps) {
  const { t } = useI18n();
  const isPro = complexity === 'pro';

  const readonlyModules = ENHANCEMENT_MODULE_METADATA.filter((mod) => mod.tierDefaults[complexity]).sort(
    (a, b) => a.order - b.order,
  );

  return (
    <Card data-testid="wizard-step-7">
      <CardHeader>
        <CardTitle className="text-lg">{t('wizard.step7Title')}</CardTitle>
        <CardDescription>{isPro ? t('wizard.step7DescPro') : t('wizard.step7DescSimple')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!isPro ? (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {readonlyModules.map((mod) => (
                <div
                  key={mod.id}
                  data-testid={`wizard-module-readonly-${mod.id}`}
                  className="flex items-start justify-between gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface p-3"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <span aria-hidden="true" className="mt-0.5 text-base leading-none">
                      {mod.icon}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text">
                        {t(`wizard.module.${mod.id}.name` as MessageKey)}
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
                        {t(`wizard.module.${mod.id}.desc` as MessageKey)}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[11px]">
                    <CheckCircle2 className="mr-1 h-3 w-3 text-success" />
                    {t('wizard.moduleReadonlyBadge')}
                  </Badge>
                </div>
              ))}
            </div>
            <p className="rounded-[var(--radius-md)] border border-border bg-surface-muted/50 px-3 py-2 text-xs text-text-muted">
              {t('wizard.moduleReadonlyTip')}
            </p>
          </>
        ) : (
          <div className="flex flex-col gap-4">
            {conflictNotice ? (
              <div
                role="status"
                data-testid="wizard-module-conflict-notice"
                className="flex items-start gap-2 rounded-[var(--radius-md)] border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-text"
              >
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>{conflictNotice}</span>
              </div>
            ) : null}

            {[...MODULE_GROUP_DEFINITIONS]
              .sort((a, b) => a.order - b.order)
              .map((group) => {
                const items = ENHANCEMENT_MODULE_METADATA.filter((mod) => mod.group === group.id).sort(
                  (a, b) => a.order - b.order,
                );
                if (items.length === 0) return null;

                return (
                  <section
                    key={group.id}
                    data-testid={`wizard-module-group-${group.id}`}
                    className="flex flex-col gap-2"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span aria-hidden="true" className="text-base leading-none">
                          {group.icon}
                        </span>
                        <h3 className="text-sm font-semibold text-text">
                          {t(`wizard.moduleGroup.${group.id}.name` as MessageKey)}
                        </h3>
                      </div>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {t(`wizard.moduleGroup.${group.id}.desc` as MessageKey)}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {items.map((mod) => {
                        const support = evaluateModuleSupport(mod, selectedAppIds);
                        const isUnsupported = support.status === 'unsupported';
                        const enabled = !isUnsupported && Boolean(modules[mod.id]);

                        return (
                          <div
                            key={mod.id}
                            data-testid={`wizard-module-card-${mod.id}`}
                            aria-disabled={isUnsupported ? true : undefined}
                            className={`motion-card flex flex-col justify-between gap-2 rounded-[var(--radius-md)] border p-3 ${
                              isUnsupported
                                ? 'border-border bg-surface-muted/45 opacity-65'
                                : enabled
                                  ? 'border-primary/40 bg-primary/6'
                                  : 'border-border bg-surface'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex min-w-0 items-start gap-2">
                                <span aria-hidden="true" className="mt-0.5 text-base leading-none">
                                  {mod.icon}
                                </span>
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-text">
                                    {t(`wizard.module.${mod.id}.name` as MessageKey)}
                                  </div>
                                  <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
                                    {t(`wizard.module.${mod.id}.desc` as MessageKey)}
                                  </p>
                                </div>
                              </div>
                              <Switch
                                checked={enabled}
                                disabled={isUnsupported}
                                onCheckedChange={(checked) => onToggleModule(mod.id, checked)}
                                aria-label={t(`wizard.module.${mod.id}.name` as MessageKey)}
                                data-testid={`wizard-module-switch-${mod.id}`}
                              />
                            </div>

                            {support.status === 'unsupported' ? (
                              <p
                                data-testid={`wizard-module-unsupported-${mod.id}`}
                                className="border-t border-border/60 pt-1.5 text-[11px] text-text-muted"
                              >
                                {t('wizard.moduleUnsupportedReason').replace(
                                  '{apps}',
                                  support.unsupportedAppNames.join('、'),
                                )}
                              </p>
                            ) : support.status === 'partial' ? (
                              <p
                                data-testid={`wizard-module-partial-${mod.id}`}
                                className="border-t border-border/60 pt-1.5 text-[11px] text-text-muted"
                              >
                                {t('wizard.modulePartialSupportHint')
                                  .replace('{supported}', support.supportingAppNames.join('、'))
                                  .replace('{unsupported}', support.unsupportedAppNames.join('、'))}
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
          </div>
        )}

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
