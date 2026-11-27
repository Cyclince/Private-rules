import { Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { getRegionDefinition } from '../../../../domain/nodes/regions';
import type { ComplexityTier, WizardRouteTarget } from '../../../../shared/schemas/quick-create';
import { useI18n } from '../../../i18n';
import { Button } from '../../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { clampRouteForTier, inferRulesetDefaultRoute } from './wizard-state';

export type WizardRulesetOption = {
  id: string;
  name: string;
  description?: string | null;
};

type WizardStepMyRulesProps = {
  complexity: ComplexityTier;
  rulesets: readonly WizardRulesetOption[];
  selectedRulesetIds: readonly string[];
  rulesetRoutes: Readonly<Record<string, WizardRouteTarget>>;
  regionCodes: readonly string[];
  onToggleRuleset: (rulesetId: string, rulesetName: string, checked: boolean) => void;
  onChangeRoute: (rulesetId: string, route: WizardRouteTarget) => void;
  onBack: () => void;
  onNext: () => void;
};

export function WizardStepMyRules({
  complexity,
  rulesets,
  selectedRulesetIds,
  rulesetRoutes,
  regionCodes,
  onToggleRuleset,
  onChangeRoute,
  onBack,
  onNext,
}: WizardStepMyRulesProps) {
  const { t, locale } = useI18n();
  const isSimple = complexity === 'simple';

  return (
    <Card data-testid="wizard-step-5">
      <CardHeader>
        <CardTitle className="text-lg">{t('wizard.step5Title')}</CardTitle>
        <CardDescription>{t('wizard.step5Desc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface-muted/40 px-3 py-2.5 text-xs text-text-muted">
          <p>{t('wizard.myRulesPriorityNote')}</p>
          {isSimple ? (
            <p data-testid="wizard-my-rules-simple-note" className="font-medium text-text">
              {t('wizard.myRulesSimpleLimitNote')}
            </p>
          ) : null}
        </div>

        {rulesets.length === 0 ? (
          <div
            data-testid="wizard-my-rules-empty"
            className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-dashed border-border px-3.5 py-3 text-xs text-text-muted"
          >
            <span>{t('wizard.myRulesEmpty')}</span>
            <Button asChild size="sm" variant="outline">
              <Link to="/rules">{t('wizard.myRulesGoCreate')}</Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {rulesets.map((rs) => {
              const checked = selectedRulesetIds.includes(rs.id);
              const rawRoute = rulesetRoutes[rs.id] ?? inferRulesetDefaultRoute(rs.name);
              const route = clampRouteForTier(rawRoute, complexity);

              return (
                <div
                  key={rs.id}
                  data-testid={`wizard-ruleset-row-${rs.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2.5"
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => onToggleRuleset(rs.id, rs.name, e.target.checked)}
                      data-testid={`wizard-ruleset-toggle-${rs.id}`}
                      className="h-4 w-4 shrink-0 accent-[var(--primary)]"
                    />
                    <span className="truncate text-sm font-medium text-text">{rs.name}</span>
                  </label>

                  <select
                    aria-label={`${rs.name} ${t('wizard.routePrefix')}`}
                    value={route}
                    onChange={(e) => onChangeRoute(rs.id, e.target.value as WizardRouteTarget)}
                    data-testid={`wizard-ruleset-route-${rs.id}`}
                    className="h-8 rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-xs text-text"
                  >
                    {isSimple ? (
                      <>
                        <option value="proxy">{t('wizard.route.proxySimple')}</option>
                        <option value="direct">{t('wizard.route.direct')}</option>
                        <option value="reject">{t('wizard.route.reject')}</option>
                      </>
                    ) : (
                      <>
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
                      </>
                    )}
                  </select>
                </div>
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
