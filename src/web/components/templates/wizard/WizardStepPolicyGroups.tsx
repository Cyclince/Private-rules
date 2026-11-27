import { ArrowLeft, ArrowRight } from 'lucide-react';
import { getRegionDefinition } from '../../../../domain/nodes/regions';
import {
  CATALOG_CATEGORY_VALUES,
  CATEGORY_EMOJI,
  type PrimaryCatalogCategory,
} from '../../../../shared/app-categories';
import type {
  QuickCreateScenarioInput,
  WizardRouteTarget,
  WizardScenarioId,
} from '../../../../shared/schemas/quick-create';
import { useI18n, type MessageKey } from '../../../i18n';
import { Button } from '../../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Switch } from '../../ui/switch';
import { WIZARD_SCENARIO_CATALOG } from './wizard-state';

const EMPTY_CATEGORY_NOTES: Partial<Record<PrimaryCatalogCategory, MessageKey>> = {
  base: 'wizard.categoryNote.base',
  music: 'wizard.categoryNote.music',
  apple: 'wizard.categoryNote.apple',
  finance: 'wizard.categoryNote.finance',
  shopping: 'wizard.categoryNote.shopping',
  other: 'wizard.categoryNote.other',
};

type WizardStepPolicyGroupsProps = {
  scenarios: readonly QuickCreateScenarioInput[];
  regionCodes: readonly string[];
  onApplyPreset: (preset: 'recommended' | 'all' | 'clear') => void;
  onToggleScenario: (id: WizardScenarioId, enabled: boolean) => void;
  onChangeScenarioRoute: (id: WizardScenarioId, route: WizardRouteTarget) => void;
  onBack: () => void;
  onNext: () => void;
};

export function WizardStepPolicyGroups({
  scenarios,
  regionCodes,
  onApplyPreset,
  onToggleScenario,
  onChangeScenarioRoute,
  onBack,
  onNext,
}: WizardStepPolicyGroupsProps) {
  const { t, locale } = useI18n();
  const scenarioMap = new Map(scenarios.map((item) => [item.id, item]));

  return (
    <Card data-testid="wizard-step-4">
      <CardHeader>
        <CardTitle className="text-lg">{t('wizard.step4Title')}</CardTitle>
        <CardDescription>{t('wizard.step4Desc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-surface-muted/40 px-3 py-2">
          <span className="text-xs font-medium text-text-muted">{t('wizard.presetsLabel')}</span>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="wizard-preset-recommended"
              onClick={() => onApplyPreset('recommended')}
            >
              {t('wizard.preset.recommended')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="wizard-preset-all"
              onClick={() => onApplyPreset('all')}
            >
              {t('wizard.preset.all')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="wizard-preset-clear"
              onClick={() => onApplyPreset('clear')}
            >
              {t('wizard.preset.clear')}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {CATALOG_CATEGORY_VALUES.map((category) => {
            const items = WIZARD_SCENARIO_CATALOG.filter((item) => item.category === category);
            const noteKey = EMPTY_CATEGORY_NOTES[category];

            return (
              <section key={category} data-testid={`wizard-category-${category}`} className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="text-base leading-none">
                    {CATEGORY_EMOJI[category]}
                  </span>
                  <h3 className="text-sm font-semibold text-text">
                    {t(`taxonomy.category.${category}` as MessageKey)}
                  </h3>
                </div>

                {items.length > 0 ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {items.map((def) => {
                      const stateItem = scenarioMap.get(def.id);
                      const enabled = stateItem?.enabled ?? def.defaultEnabled;
                      const currentRoute = stateItem?.route ?? def.defaultRoute;

                      return (
                        <div
                          key={def.id}
                          data-testid={`wizard-scenario-${def.id}`}
                          className={`motion-card flex flex-col justify-between gap-2.5 rounded-[var(--radius-md)] border p-3 ${
                            enabled ? 'border-primary/40 bg-primary/6' : 'border-border bg-surface'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-start gap-2">
                              <span aria-hidden="true" className="mt-0.5 text-base leading-none">
                                {def.icon}
                              </span>
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-text">
                                  {t(`wizard.scenario.${def.id}` as MessageKey)}
                                </div>
                                <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
                                  {t(`wizard.scenarioDesc.${def.id}` as MessageKey)}
                                </p>
                              </div>
                            </div>
                            <Switch
                              checked={enabled}
                              onCheckedChange={(checked) => onToggleScenario(def.id, checked)}
                              aria-label={t(`wizard.scenario.${def.id}` as MessageKey)}
                              data-testid={`wizard-scenario-toggle-${def.id}`}
                            />
                          </div>

                          {enabled && def.configurableRoute ? (
                            <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-2">
                              <label
                                htmlFor={`wizard-scenario-route-select-${def.id}`}
                                className="text-xs text-text-muted"
                              >
                                {t('wizard.routePrefix')}
                              </label>
                              <select
                                id={`wizard-scenario-route-select-${def.id}`}
                                value={currentRoute}
                                onChange={(e) => onChangeScenarioRoute(def.id, e.target.value as WizardRouteTarget)}
                                data-testid={`wizard-scenario-route-${def.id}`}
                                className="h-8 rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-xs text-text"
                              >
                                <option value="proxy">{t('wizard.route.proxy')}</option>
                                <option value="auto">{t('wizard.route.auto')}</option>
                                <option value="direct">{t('wizard.route.direct')}</option>
                                <option value="reject">{t('wizard.route.reject')}</option>
                                {regionCodes.map((code) => {
                                  const regionDef = getRegionDefinition(code);
                                  if (!regionDef) return null;
                                  return (
                                    <option key={code} value={`region:${code}`}>
                                      {regionDef.flag} {locale === 'en' ? regionDef.nameEn : regionDef.nameZh}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : noteKey ? (
                  <p className="rounded-[var(--radius-sm)] border border-border/70 bg-surface-muted/35 px-3 py-2 text-xs text-text-muted">
                    {t(noteKey)}
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>

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
