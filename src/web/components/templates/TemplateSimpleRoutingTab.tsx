import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, GripVertical, Info, Plus, Save, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { SimpleTemplateView } from '../../../application/templates';
import {
  detectSimplePresetTier,
  getSimplePresetScenarios,
  inferSimpleRulesetDefaultRoute,
  type SimplePresetTier,
} from '../../../shared/scenarios';
import type {
  QuickCreateRulesetInput,
  WizardRouteTarget,
  WizardScenarioId,
} from '../../../shared/schemas/quick-create';
import { useI18n, type MessageKey } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { invalidateTemplates, rulesetsListQueryOptions } from '../../lib/query';
import { useToast } from '../../lib/toast';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Switch } from '../ui/switch';
import {
  buildSimpleTierCards,
  groupRoutingCards,
  routesForTier,
  type RoutingCard,
} from './detail/template-detail-data';

const PRESET_TIERS: readonly SimplePresetTier[] = ['less', 'recommended', 'all'];

function scenarioDescKey(id: WizardScenarioId): MessageKey {
  return `wizard.scenarioDesc.${id}` as MessageKey;
}

function categoryLabelKey(category: string): MessageKey {
  return `taxonomy.category.${category}` as MessageKey;
}

type LocalScenarioState = {
  id: WizardScenarioId;
  enabled: boolean;
  configurableRoute: boolean;
  route: WizardRouteTarget;
  custom: boolean;
};

type LocalRulesetState = {
  rulesetId: string;
  name: string;
  route: WizardRouteTarget;
};

type TemplateSimpleRoutingTabProps = {
  view: SimpleTemplateView;
  readOnly: boolean;
};

/**
 * Routing tab (design §8): policy-group cards grouped by the 15-category
 * vocabulary, each with its destination and switch, plus "My rules" ordering.
 * The simple tier shows only the three fixed destinations.
 */
export function TemplateSimpleRoutingTab({ view, readOnly }: TemplateSimpleRoutingTabProps) {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const rulesetsQuery = useQuery(rulesetsListQueryOptions());

  const complexity = view.template.complexity;
  const isSimple = complexity === 'simple';

  const [scenarios, setScenarios] = useState<LocalScenarioState[]>([]);
  const [selectedRulesets, setSelectedRulesets] = useState<LocalRulesetState[]>([]);
  const [draggingRulesetId, setDraggingRulesetId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const hydrateKey = `${view.template.id}:${view.template.currentVersion}:${view.template.updatedAt}`;

  useEffect(() => {
    setScenarios(
      view.routing.scenarios.map((item) => ({
        id: item.id,
        enabled: item.enabled,
        configurableRoute: item.configurableRoute,
        route: item.route,
        custom: item.custom,
      })),
    );
    setSelectedRulesets(
      view.routing.rulesets
        .filter((item) => !item.missing)
        .map((item) => ({
          rulesetId: item.rulesetId,
          name: item.name,
          route: item.route,
        })),
    );
    setDirty(false);
  }, [hydrateKey, view.routing.rulesets, view.routing.scenarios]);

  const allUserRulesets = useMemo(() => rulesetsQuery.data?.data.categories ?? [], [rulesetsQuery.data]);
  const selectedRulesetIdSet = useMemo(() => new Set(selectedRulesets.map((r) => r.rulesetId)), [selectedRulesets]);
  const unselectedRulesets = useMemo(
    () => allUserRulesets.filter((rs) => !selectedRulesetIdSet.has(rs.id)),
    [allUserRulesets, selectedRulesetIdSet],
  );

  const activePreset = useMemo(() => detectSimplePresetTier(scenarios), [scenarios]);

  const routeOptions = useMemo(() => {
    const allowed = new Set<WizardRouteTarget>(routesForTier(complexity) as readonly WizardRouteTarget[]);
    const allOptions: ReadonlyArray<{ value: WizardRouteTarget; label: string }> = [
      { value: 'proxy', label: t('wizard.route.proxy') },
      { value: 'auto', label: t('wizard.route.auto') },
      { value: 'direct', label: t('wizard.route.direct') },
      { value: 'reject', label: t('wizard.route.reject') },
    ];
    const base = allOptions.filter((option) => allowed.has(option.value));
    if (!isSimple) {
      for (const region of view.routing.availableRegions) {
        base.push({ value: `region:${region.code}`, label: `${region.emoji} ${region.name}` });
      }
    }
    return base;
  }, [complexity, isSimple, t, view.routing.availableRegions]);

  const groupedCards = useMemo(() => {
    const source = {
      scenarios: view.routing.scenarios,
      customItems: view.routing.customItems.filter((item) => item.kind !== 'scenario'),
    };
    return groupRoutingCards(source).filter((group) => group.cards.length > 0);
  }, [view.routing.customItems, view.routing.scenarios]);

  const simpleCards = useMemo(() => buildSimpleTierCards(view.routing.scenarios), [view.routing.scenarios]);

  const handleApplyPreset = (tier: SimplePresetTier) => {
    if (readOnly) return;
    const presetMap = new Map(getSimplePresetScenarios(tier).map((item) => [item.id, item]));
    setScenarios((prev) =>
      prev.map((item) => {
        if (item.custom) return item;
        const target = presetMap.get(item.id);
        if (!target) return item;
        return {
          ...item,
          enabled: target.enabled,
          route: target.route ?? item.route,
        };
      }),
    );
    setDirty(true);
  };

  const handleToggleScenario = (id: WizardScenarioId, enabled: boolean) => {
    if (readOnly) return;
    setScenarios((prev) => prev.map((item) => (item.id === id && !item.custom ? { ...item, enabled } : item)));
    setDirty(true);
  };

  const handleScenarioRoute = (id: WizardScenarioId, route: WizardRouteTarget) => {
    if (readOnly) return;
    setScenarios((prev) => prev.map((item) => (item.id === id && !item.custom ? { ...item, route } : item)));
    setDirty(true);
  };

  const handleAddRuleset = (rulesetId: string, name: string) => {
    if (readOnly || selectedRulesetIdSet.has(rulesetId)) return;
    setSelectedRulesets((prev) => [...prev, { rulesetId, name, route: inferSimpleRulesetDefaultRoute(name) }]);
    setDirty(true);
  };

  const handleRemoveRuleset = (rulesetId: string) => {
    if (readOnly) return;
    setSelectedRulesets((prev) => prev.filter((item) => item.rulesetId !== rulesetId));
    setDirty(true);
  };

  const handleRulesetRoute = (rulesetId: string, route: WizardRouteTarget) => {
    if (readOnly) return;
    setSelectedRulesets((prev) => prev.map((item) => (item.rulesetId === rulesetId ? { ...item, route } : item)));
    setDirty(true);
  };

  const moveRuleset = (fromIdx: number, toIdx: number) => {
    if (readOnly || fromIdx === toIdx || toIdx < 0 || toIdx >= selectedRulesets.length) return;
    setSelectedRulesets((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      if (moved) next.splice(toIdx, 0, moved);
      return next;
    });
    setDirty(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const scenarioPayload = scenarios
        .filter((s) => !s.custom)
        .map((s) => ({
          id: s.id,
          enabled: s.enabled,
          ...(s.configurableRoute ? { route: s.route } : {}),
        }));
      const rulesetPayload: QuickCreateRulesetInput[] = selectedRulesets.map((r) => ({
        rulesetId: r.rulesetId,
        route: r.route,
      }));
      return readApiJson<{ view: SimpleTemplateView; version: number }>(
        await api.api.templates[':id'].simple.$patch({
          param: { id: view.template.id },
          json: {
            scenarios: scenarioPayload,
            rulesets: rulesetPayload,
          },
        }),
      );
    },
    onSuccess: async () => {
      setDirty(false);
      await invalidateTemplates(queryClient, view.template.id);
      notify({ title: t('templateDetail.routingSavedToast'), variant: 'success' });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const selectOptionsFor = (route: WizardRouteTarget) =>
    routeOptions.some((opt) => opt.value === route) ? routeOptions : [...routeOptions, { value: route, label: route }];

  const renderPolicyCard = (card: RoutingCard) => {
    const scenario = scenarios.find((item) => item.id === card.id);
    const enabled = scenario ? scenario.enabled : card.enabled;
    const route = scenario ? scenario.route : card.route;
    const isScenario = card.kind === 'scenario';
    const selectOptions = selectOptionsFor(route);

    return (
      <div
        key={`${card.kind}:${card.id}`}
        data-testid={card.testId}
        data-category={card.category}
        className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-bg px-3 py-2.5"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface-muted text-base"
          >
            {card.icon}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-medium text-text">
                {card.titleKey ? t(card.titleKey as MessageKey) : card.title}
              </span>
              {card.custom ? (
                <Badge variant="outline" data-testid={`${card.testId}-custom`}>
                  {t('templateDetail.customizedInAdvanced')}
                </Badge>
              ) : null}
            </div>
            {isScenario ? (
              <p className="line-clamp-1 text-xs text-text-muted">{t(scenarioDescKey(card.id as WizardScenarioId))}</p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isScenario && card.configurableRoute && enabled && !card.custom ? (
            <select
              aria-label={`${card.titleKey ? t(card.titleKey as MessageKey) : card.title} ${t('templateDetail.routeLabel')}`}
              data-testid={`simple-scenario-route-${card.id}`}
              disabled={readOnly}
              value={route}
              onChange={(e) => handleScenarioRoute(card.id as WizardScenarioId, e.target.value as WizardRouteTarget)}
              className="h-8 rounded-[var(--radius-sm)] border border-border bg-surface px-2.5 text-xs text-text focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
            >
              {selectOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t('templateDetail.routePrefix')} {opt.label}
                </option>
              ))}
            </select>
          ) : !isScenario ? null : (
            <span className="text-xs text-text-muted">
              {t('templateDetail.routePrefix')}{' '}
              {route === 'direct' ? t('wizard.route.direct') : t('wizard.route.reject')}
            </span>
          )}

          <Switch
            checked={enabled}
            disabled={readOnly || !isScenario || card.custom}
            data-testid={`simple-scenario-toggle-${card.id}`}
            aria-label={card.titleKey ? t(card.titleKey as MessageKey) : card.title}
            onCheckedChange={(checked) => handleToggleScenario(card.id as WizardScenarioId, checked)}
          />
        </div>
      </div>
    );
  };

  const renderHubCard = (card: RoutingCard) => {
    const isDirect = card.kind === 'direct';
    const scenario = scenarios.find((item) => item.id === (isDirect ? 'domestic-direct' : 'ad-block'));
    const enabled = scenario ? scenario.enabled : card.enabled;
    const proxyModeLabel =
      view.nodes.groupMode === 'auto' || view.nodes.groupMode === 'region'
        ? t('templateDetail.proxyAutoHint')
        : t('templateDetail.proxyManualHint');

    return (
      <div
        key={card.id}
        data-testid={card.testId}
        className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-bg px-3 py-2.5"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface-muted text-base"
          >
            {card.icon}
          </span>
          <div className="min-w-0">
            <span className="block truncate text-sm font-medium text-text">
              {card.titleKey ? t(card.titleKey as MessageKey) : card.title}
            </span>
            <p className="truncate text-xs text-text-muted">
              {card.kind === 'proxy'
                ? proxyModeLabel
                : isDirect
                  ? t('templateDetail.hubDirectDesc')
                  : t('templateDetail.hubRejectDesc')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {card.kind === 'proxy' ? (
            <span className="text-xs text-text-muted">{t('templateDetail.alwaysOn')}</span>
          ) : null}
          <Switch
            checked={enabled}
            disabled={readOnly || card.kind === 'proxy' || Boolean(scenario?.custom)}
            data-testid={`simple-hub-toggle-${card.id}`}
            aria-label={card.titleKey ? t(card.titleKey as MessageKey) : card.title}
            onCheckedChange={(checked) => handleToggleScenario(isDirect ? 'domestic-direct' : 'ad-block', checked)}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4" data-testid="simple-routing-tab" data-complexity={complexity}>
      {view.routing.hasCustomizations ? (
        <div
          data-testid="simple-routing-custom-notice"
          className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface-muted/60 px-3.5 py-2.5 text-xs text-text-muted"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>{t('templateDetail.customPreservedHint')}</span>
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            <span>{t('templateDetail.routingGroupsTitle')}</span>
          </CardTitle>
          <CardDescription>
            {isSimple ? t('templateDetail.routingSimpleHint') : t('templateDetail.routingSubtitle')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {!isSimple ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="simple-presets">
              {PRESET_TIERS.map((tier) => {
                const isActive = activePreset === tier;
                return (
                  <button
                    key={tier}
                    type="button"
                    disabled={readOnly}
                    data-testid={`simple-preset-${tier}`}
                    onClick={() => handleApplyPreset(tier)}
                    className={`flex cursor-pointer items-center justify-center rounded-[var(--radius-md)] border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      isActive
                        ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/30'
                        : 'border-border bg-bg text-text hover:border-primary/40 hover:bg-surface-muted/50'
                    }`}
                  >
                    {tier === 'recommended'
                      ? t('wizard.preset.recommendedDefault')
                      : t(`wizard.preset.${tier}` as MessageKey)}
                  </button>
                );
              })}
            </div>
          ) : null}

          {isSimple ? (
            <div className="flex flex-col gap-2" data-testid="simple-hub-cards">
              {simpleCards.map(renderHubCard)}
            </div>
          ) : (
            <div className="flex flex-col gap-4" data-testid="simple-routing-groups">
              {groupedCards.map((group) => (
                <section key={group.category} data-testid={`routing-group-${group.category}`}>
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                    <span aria-hidden="true">{group.emoji}</span>
                    <span>{t(categoryLabelKey(group.category))}</span>
                  </h3>
                  <div className="flex flex-col gap-2">{group.cards.map(renderPolicyCard)}</div>
                </section>
              ))}
            </div>
          )}

          {/* My Rules (from Rules module, drag-and-drop + up/down order) */}
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-text">{t('wizard.myRulesTitle')}</h3>
                <p className="text-xs text-text-muted">{t('wizard.myRulesPriorityNote')}</p>
              </div>
              <Link to="/rules" className="text-xs font-medium text-primary hover:underline">
                {t('wizard.myRulesGoCreate')}
              </Link>
            </div>

            {selectedRulesets.length > 0 ? (
              <div
                data-testid="simple-my-rules-list"
                className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-bg/40"
              >
                {selectedRulesets.map((rs, index) => {
                  const rsRouteOptions = selectOptionsFor(rs.route);
                  return (
                    <div
                      key={rs.rulesetId}
                      draggable={!readOnly}
                      data-testid={`simple-ruleset-row-${rs.rulesetId}`}
                      onDragStart={() => setDraggingRulesetId(rs.rulesetId)}
                      onDragOver={(e) => {
                        if (!readOnly) e.preventDefault();
                      }}
                      onDrop={() => {
                        if (!draggingRulesetId || draggingRulesetId === rs.rulesetId) return;
                        const fromIdx = selectedRulesets.findIndex((item) => item.rulesetId === draggingRulesetId);
                        if (fromIdx >= 0) moveRuleset(fromIdx, index);
                        setDraggingRulesetId(null);
                      }}
                      onDragEnd={() => setDraggingRulesetId(null)}
                      className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 transition-colors ${
                        draggingRulesetId === rs.rulesetId ? 'bg-primary/10' : ''
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {!readOnly ? (
                          <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-text-muted" aria-hidden="true" />
                        ) : null}
                        <span className="truncate text-sm font-medium text-text">{rs.name}</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <select
                          aria-label={`${rs.name} ${t('templateDetail.routeLabel')}`}
                          data-testid={`simple-ruleset-route-${rs.rulesetId}`}
                          disabled={readOnly}
                          value={rs.route}
                          onChange={(e) => handleRulesetRoute(rs.rulesetId, e.target.value as WizardRouteTarget)}
                          className="h-8 rounded-[var(--radius-sm)] border border-border bg-surface px-2.5 text-xs text-text focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                        >
                          {rsRouteOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {t('templateDetail.routePrefix')} {opt.label}
                            </option>
                          ))}
                        </select>

                        {!readOnly ? (
                          <>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              disabled={index === 0}
                              aria-label={t('templateDetail.moveUp')}
                              data-testid={`simple-ruleset-up-${rs.rulesetId}`}
                              onClick={() => moveRuleset(index, index - 1)}
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              disabled={index === selectedRulesets.length - 1}
                              aria-label={t('templateDetail.moveDown')}
                              data-testid={`simple-ruleset-down-${rs.rulesetId}`}
                              onClick={() => moveRuleset(index, index + 1)}
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={t('common.delete')}
                              data-testid={`simple-ruleset-remove-${rs.rulesetId}`}
                              onClick={() => handleRemoveRuleset(rs.rulesetId)}
                            >
                              <X className="h-3.5 w-3.5 text-text-muted" />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[var(--radius-md)] border border-dashed border-border px-3.5 py-3 text-xs text-text-muted">
                {allUserRulesets.length === 0 ? t('wizard.myRulesEmpty') : t('templateDetail.myRulesNoneSelected')}
              </div>
            )}

            {!readOnly && unselectedRulesets.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {unselectedRulesets.map((rs) => (
                  <Button
                    key={rs.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid={`simple-ruleset-add-${rs.id}`}
                    onClick={() => handleAddRuleset(rs.id, rs.name)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>{rs.name}</span>
                  </Button>
                ))}
              </div>
            ) : null}
          </div>

          {isSimple
            ? null
            : (() => {
                const extraCustomItems = view.routing.customItems.filter((item) => item.kind !== 'scenario');
                if (extraCustomItems.length === 0) return null;
                return (
                  <div className="flex flex-col gap-2" data-testid="simple-custom-items-list">
                    <h3 className="text-sm font-semibold text-text">{t('templateDetail.customItemsTitle')}</h3>
                    <div className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface-muted/40">
                      {extraCustomItems.map((item) => (
                        <div
                          key={`${item.kind}:${item.id}`}
                          data-testid={`simple-custom-item-${item.id}`}
                          className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 text-sm"
                        >
                          <span className="font-medium text-text">{item.name}</span>
                          <Badge variant="outline">{t('templateDetail.customizedInAdvanced')}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

          {!readOnly ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              <span className="text-xs text-text-muted">{t('templateDetail.routingUrlUnchangedHint')}</span>
              <Button
                type="button"
                data-testid="simple-routing-save-btn"
                disabled={saveMutation.isPending || !dirty}
                onClick={() => saveMutation.mutate()}
              >
                <Save className="h-4 w-4" />
                <span>{saveMutation.isPending ? t('common.loading') : t('common.save')}</span>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
