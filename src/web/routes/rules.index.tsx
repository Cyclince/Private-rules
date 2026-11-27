import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Database,
  Globe,
  Link2,
  PenLine,
  Plus,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { describeRuleFriendly, formatRawRuleLine } from '../../domain/rules/friendly';
import type { DomainRule, RuleCategory } from '../../types/domain-rules';
import type { CreateRuleCategoryInput } from '../components/rulesets/RuleCategoryDialog';
import {
  formatFriendlyRuleInline,
  formatFriendlyRuleType,
  formatSyncTimestamp,
  nextRuleSortDirection,
  readStoredRuleSort,
  sortRuleCategories,
  writeStoredRuleSort,
  type RuleCategorySortKey,
  type SortDirection,
} from '../components/rulesets/rule-library-helpers';
import { CategoryIcon } from '../components/subscriptions/CategoryIcon';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { CollapsibleDetails } from '../components/ui/collapsible';
import { EmptyState } from '../components/ui/empty-state';
import { Input } from '../components/ui/input';
import { SkeletonSwap } from '../components/ui/skeleton';
import { loadPageTranslations, useI18n, type MessageKey } from '../i18n';
import { api, formatApiError, readApiJson } from '../lib/api';
import { isTelegramSession, requireAuthBeforeLoad } from '../lib/auth-guard';
import { primeSharedElements, SHARED_ELEMENT_NAMES, staggerStyle } from '../lib/shared-element';
import {
  authMeQueryOptions,
  invalidateRulesets,
  rulesetsListQueryOptions,
  type RulesetSummaryPayload,
} from '../lib/query-core';
import { useToast } from '../lib/toast';

const RuleCategoryDialog = lazy(() =>
  import('../components/rulesets/RuleCategoryDialog').then((m) => ({ default: m.RuleCategoryDialog })),
);

type RulesIndexSearch = {
  selected?: string;
  tab?: string;
  q?: string;
};

type RuleGroupId = 'manual' | 'url' | 'geo';

export const Route = createFileRoute('/rules/')({
  validateSearch: (search: Record<string, unknown>): RulesIndexSearch => {
    const selected = typeof search.selected === 'string' && search.selected ? search.selected : undefined;
    const tab = typeof search.tab === 'string' && search.tab ? search.tab : undefined;
    const q = typeof search.q === 'string' && search.q ? search.q : undefined;
    return {
      ...(selected ? { selected } : {}),
      ...(tab ? { tab } : {}),
      ...(q ? { q } : {}),
    };
  },
  beforeLoad: async ({ context, location, search }) => {
    await Promise.all([requireAuthBeforeLoad(context.queryClient, location.href), loadPageTranslations()]);
    if (search.selected) {
      throw redirect({
        to: '/rules/$id',
        params: { id: search.selected },
        replace: true,
      });
    }
  },
  component: RulesIndexPage,
});

const SORT_OPTIONS: ReadonlyArray<{ key: RuleCategorySortKey; labelKey: MessageKey }> = [
  { key: 'alpha', labelKey: 'subscriptions.sortAlpha' },
  { key: 'count', labelKey: 'subscriptions.sortCount' },
  { key: 'created', labelKey: 'subscriptions.sortCreated' },
  { key: 'modified', labelKey: 'subscriptions.sortModified' },
];

function CategoryRuleFolder({
  category,
  count,
  groupId,
  searchedRules,
  searching,
}: {
  category: RuleCategory;
  count: number;
  groupId: RuleGroupId;
  searchedRules?: DomainRule[];
  searching: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [loadedRules, setLoadedRules] = useState<DomainRule[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const effectiveOpen = searching || open;

  useEffect(() => {
    setLoadedRules([]);
    setNextCursor(null);
    setHasMore(false);
    setFetched(false);
  }, [category.id, category.updatedAt, groupId]);

  const fetchPage = async (cursor?: string) => {
    setLoading(true);
    try {
      const payload = await readApiJson<{
        rules: DomainRule[];
        total: number;
        nextCursor: string | null;
        hasMore: boolean;
      }>(
        await api.api.rulesets[':id'].rules.$get({
          param: { id: category.id },
          query: {
            source: groupId,
            limit: '50',
            ...(cursor ? { cursor } : {}),
          },
        }),
      );
      setLoadedRules((prev) => (cursor ? [...prev, ...payload.rules] : payload.rules));
      setNextCursor(payload.nextCursor);
      setHasMore(payload.hasMore);
      setFetched(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (effectiveOpen && !searching && !fetched && !loading) {
      void fetchPage();
    }
  }, [effectiveOpen, searching, fetched]);

  const rows = searching ? (searchedRules ?? []) : loadedRules;

  return (
    <CollapsibleDetails
      open={effectiveOpen}
      onOpenChange={setOpen}
      className="rounded-[var(--radius-md)] border border-border bg-surface"
      summaryClassName="gap-3 px-3.5 py-2.5"
      summary={(expanded) => (
        <>
          <span className="flex min-w-0 items-center gap-2.5">
            <CategoryIcon icon={category.icon} name={category.name} size={34} />
            <strong className="truncate text-sm font-semibold text-text">{category.name}</strong>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
            <span>
              {count.toLocaleString()} {t('rules.unitItems')}
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-[var(--motion-base)] ease-[var(--ease-out)] ${
                expanded ? 'rotate-180' : ''
              }`}
            />
          </span>
        </>
      )}
      contentClassName="flex flex-col divide-y divide-border/70 border-t border-border"
    >
      {loading && rows.length === 0 ? (
        <div className="px-3.5 py-3 text-xs text-text-muted">{t('common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="px-3.5 py-3 text-xs text-text-muted">{t('ruleLibrary.emptyGroup')}</div>
      ) : (
        rows.map((rule) => {
          const friendly = describeRuleFriendly(rule);
          const friendlyType = formatFriendlyRuleType(friendly, t);
          const friendlyInline = formatFriendlyRuleInline(friendly, t);
          const subtitle =
            groupId === 'manual'
              ? `${friendlyType} · ${friendlyInline} · ${t('ruleLibrary.groupManualTitle')}${rule.note ? ` · ${rule.note}` : ''}`
              : `${friendlyType} · ${friendlyInline}${rule.sourceName ? ` · ${rule.sourceName}` : ''}`;

          if (groupId === 'manual') {
            return (
              <Link
                key={rule.id}
                to="/rules/$id"
                params={{ id: category.id }}
                title={formatRawRuleLine(rule)}
                className="flex items-center gap-3 px-3.5 py-2.5 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:bg-surface-muted/60"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${rule.enabled ? 'bg-success' : 'bg-border'}`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-text">{friendly.params.displayValue}</div>
                  <div className="truncate text-xs text-text-muted">{subtitle}</div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
              </Link>
            );
          }

          return (
            <div key={rule.id} title={formatRawRuleLine(rule)} className="flex items-center gap-3 px-3.5 py-2.5">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${rule.enabled ? 'bg-success' : 'bg-border'}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text">{friendly.params.displayValue}</div>
                <div className="truncate text-xs text-text-muted">{subtitle}</div>
              </div>
            </div>
          );
        })
      )}

      {!searching && hasMore && nextCursor ? (
        <div className="p-2.5 text-center">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => void fetchPage(nextCursor)}
          >
            {loading ? t('common.loading') : t('ruleLibrary.loadMore')}
          </Button>
        </div>
      ) : null}
    </CollapsibleDetails>
  );
}

function RulesIndexPage() {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();

  const authQuery = useQuery(authMeQueryOptions());
  const summaryQuery = useQuery(rulesetsListQueryOptions());

  const isTelegram = isTelegramSession(authQuery.data);
  const categories = useMemo(() => summaryQuery.data?.data.categories ?? [], [summaryQuery.data]);
  const settings = summaryQuery.data?.data.settings;

  const [{ key: sortKey, direction: sortDirection }, setSortState] = useState<{
    key: RuleCategorySortKey;
    direction: SortDirection;
  }>(() => readStoredRuleSort());

  useEffect(() => {
    writeStoredRuleSort(sortKey, sortDirection);
  }, [sortKey, sortDirection]);

  const sortedCategories = useMemo(
    () => sortRuleCategories(categories, sortKey, sortDirection),
    [categories, sortKey, sortDirection],
  );

  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Global "All rules" search synced with ?q=
  const [searchInput, setSearchInput] = useState(search.q ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState((search.q ?? '').trim());
  const [globalSearchRules, setGlobalSearchRules] = useState<DomainRule[]>([]);
  const [searchingGlobal, setSearchingGlobal] = useState(false);

  useEffect(() => {
    setSearchInput(search.q ?? '');
  }, [search.q]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const timer = window.setTimeout(() => {
      setDebouncedSearch(trimmed);
      if ((search.q ?? '') !== trimmed) {
        void navigate({
          to: '/rules',
          search: trimmed ? { q: trimmed } : {},
          replace: true,
        });
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [searchInput, search.q, navigate]);

  useEffect(() => {
    if (!debouncedSearch) {
      setGlobalSearchRules([]);
      setSearchingGlobal(false);
      return;
    }
    let cancelled = false;
    setSearchingGlobal(true);
    void (async () => {
      try {
        const payload = await readApiJson<{ rules: DomainRule[] }>(
          await api.api.rules.$get({
            query: {
              q: debouncedSearch,
              limit: '200',
            },
          }),
        );
        if (!cancelled) setGlobalSearchRules(payload.rules ?? []);
      } catch {
        if (!cancelled) setGlobalSearchRules([]);
      } finally {
        if (!cancelled) setSearchingGlobal(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch]);

  const createMutation = useMutation({
    mutationFn: async (input: CreateRuleCategoryInput) => {
      const payload = await readApiJson<RulesetSummaryPayload>(
        await api.api.rulesets.$post({
          json: {
            name: input.name,
            description: input.description,
            icon: input.icon,
            sourceUrls: input.sourceUrls,
            geositeNames: input.geositeNames,
            geoipNames: input.geoipNames,
            syncIntervalMinutes: input.syncIntervalMinutes,
            userAgent: input.userAgent,
            ruleOptimization: input.ruleOptimization,
            tokenLinksEnabled: input.tokenLinksEnabled,
            publicLinksEnabled: input.publicLinksEnabled,
          },
        }),
      );
      const created =
        payload.data.categories.find((item) => item.name === input.name) ??
        [...payload.data.categories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      return { created, hasUpstream: input.mode === 'upstream' };
    },
    onSuccess: async ({ created, hasUpstream }) => {
      setCreateDialogOpen(false);
      await invalidateRulesets(queryClient);
      notify({
        title: hasUpstream ? t('ruleLibrary.createdUpstreamToast') : t('ruleLibrary.createdManualToast'),
        variant: 'success',
      });
      if (created) {
        await navigate({ to: '/rules/$id', params: { id: created.id } });
      }
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const sourceStats = useMemo(() => {
    const allSources = categories.flatMap((item) => item.sources ?? []);
    return {
      all: allSources.length,
      url: allSources.filter((s) => s.sourceType === 'url' || !s.sourceType).length,
      geosite: allSources.filter((s) => s.sourceType === 'geosite').length,
      geoip: allSources.filter((s) => s.sourceType === 'geoip').length,
    };
  }, [categories]);

  const sourceTypeById = useMemo(() => {
    const map = new Map<string, 'url' | 'geosite' | 'geoip'>();
    for (const category of categories) {
      for (const source of category.sources ?? []) {
        map.set(source.id, source.sourceType ?? 'url');
      }
    }
    return map;
  }, [categories]);

  const isSearching = Boolean(debouncedSearch);

  const ruleGroups = useMemo(() => {
    const manualSearch = globalSearchRules.filter((r) => !r.sourceId);
    const urlSearch = globalSearchRules.filter((r) => Boolean(r.sourceId) && sourceTypeById.get(r.sourceId!) === 'url');
    const geoSearch = globalSearchRules.filter((r) => Boolean(r.sourceId) && sourceTypeById.get(r.sourceId!) !== 'url');

    const totalManual = isSearching
      ? manualSearch.length
      : categories.reduce((sum, item) => sum + (item.manualRuleCount ?? 0), 0);
    const totalUrl = isSearching
      ? urlSearch.length
      : categories.reduce((sum, item) => sum + (item.urlRuleCount ?? 0), 0);
    const totalGeo = isSearching
      ? geoSearch.length
      : categories.reduce((sum, item) => sum + (item.geoRuleCount ?? 0), 0);

    return [
      {
        id: 'manual' as const,
        icon: PenLine,
        title: t('ruleLibrary.groupManualTitle'),
        description: t('ruleLibrary.groupManualDesc'),
        count: totalManual,
        matchedRules: manualSearch,
      },
      {
        id: 'url' as const,
        icon: Globe,
        title: t('ruleLibrary.groupUrlTitle'),
        description: t('ruleLibrary.groupUrlDesc'),
        count: totalUrl,
        matchedRules: urlSearch,
      },
      {
        id: 'geo' as const,
        icon: Database,
        title: t('ruleLibrary.groupGeoTitle'),
        description: t('ruleLibrary.groupGeoDesc'),
        count: totalGeo,
        matchedRules: geoSearch,
      },
    ];
  }, [categories, globalSearchRules, isSearching, sourceTypeById, t]);

  const handleSortClick = (nextKey: RuleCategorySortKey) => {
    setSortState((prev) => ({
      key: nextKey,
      direction: nextRuleSortDirection(prev.key, prev.direction, nextKey),
    }));
  };

  return (
    <div className="flex flex-col gap-5" data-testid="rules-page">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <div>
            <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/15 px-3 py-0.5 text-[11px] font-semibold tracking-[0.14em] text-primary">
              {t('ruleLibrary.eyebrow')}
            </span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">{t('ruleLibrary.title')}</h2>
          <p className="text-sm text-text-muted">{t('ruleLibrary.subtitle')}</p>
        </div>

        <Button
          type="button"
          data-testid="create-ruleset-btn"
          disabled={isTelegram}
          onClick={() => setCreateDialogOpen(true)}
          className="self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          <span>{t('ruleLibrary.newRule')}</span>
        </Button>
      </header>

      {isTelegram ? (
        <div
          data-testid="rulesets-telegram-notice"
          className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-text"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>{t('rulesets.telegramOnlySwitches')}</span>
        </div>
      ) : null}

      <section
        aria-label={t('ruleLibrary.statSources')}
        data-testid="rules-source-stats"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {[
          { id: 'all', label: t('ruleLibrary.statSources'), value: sourceStats.all },
          { id: 'url', label: t('ruleLibrary.statSubscriptions'), value: sourceStats.url },
          { id: 'geosite', label: t('ruleLibrary.statGeoSite'), value: sourceStats.geosite },
          { id: 'geoip', label: t('ruleLibrary.statGeoIP'), value: sourceStats.geoip },
        ].map((stat) => (
          <div
            key={stat.id}
            data-testid={`rules-stat-${stat.id}`}
            className="rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-3.5 shadow-sm"
          >
            <div className="text-xs font-medium text-text-muted">{stat.label}</div>
            <div className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-text">
              {stat.value.toLocaleString()}
            </div>
          </div>
        ))}
      </section>

      <Card data-testid="rules-categories-card">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg">{t('ruleLibrary.categoriesTitle')}</CardTitle>
            <CardDescription className="mt-0.5">{t('ruleLibrary.categoriesSubtitle')}</CardDescription>
          </div>

          <div
            role="group"
            aria-label={t('subscriptions.sortLabel')}
            data-testid="rules-sort-toolbar"
            className="grid grid-cols-4 gap-1 rounded-full border border-border bg-surface-muted p-1 sm:inline-flex sm:w-auto"
          >
            {SORT_OPTIONS.map((option) => {
              const active = sortKey === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  data-testid={`rules-sort-${option.key}`}
                  aria-pressed={active}
                  onClick={() => handleSortClick(option.key)}
                  className={`motion-press inline-flex cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-medium ${
                    active ? 'bg-surface text-primary shadow-sm' : 'text-text-muted hover:text-text'
                  }`}
                >
                  <span className="truncate">{t(option.labelKey)}</span>
                  {active ? (
                    sortDirection === 'asc' ? (
                      <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    )
                  ) : null}
                </button>
              );
            })}
          </div>
        </CardHeader>

        <CardContent>
          <SkeletonSwap
            loading={summaryQuery.isLoading}
            testId="rules-categories-swap"
            skeleton={
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="h-20 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
                <div className="h-20 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
              </div>
            }
          >
            {sortedCategories.length === 0 ? (
              <EmptyState
                title={t('ruleLibrary.emptyCategoriesTitle')}
                description={t('ruleLibrary.emptyCategoriesDesc')}
                action={
                  !isTelegram ? (
                    <Button type="button" size="sm" onClick={() => setCreateDialogOpen(true)}>
                      <Plus className="h-4 w-4" />
                      <span>{t('ruleLibrary.newRule')}</span>
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="rulesets-list">
                {sortedCategories.map((category, index) => {
                  const sourceCount = category.sources?.length ?? 0;
                  const syncedTime = formatSyncTimestamp(category.lastSyncedAt);
                  const subtext =
                    sourceCount > 0
                      ? syncedTime
                        ? `${sourceCount} ${t('ruleLibrary.upstreamsPrefix')} ${syncedTime}`
                        : `${sourceCount} ${t('ruleLibrary.upstreamsNeverSynced')}`
                      : category.description?.trim() || t('ruleLibrary.noDescription');

                  return (
                    <div
                      key={category.id}
                      data-testid={`ruleset-row-${category.id}`}
                      style={staggerStyle(index)}
                      className="motion-card motion-stagger-item group flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3.5 hover:border-primary/50 hover:bg-surface-muted/40"
                    >
                      <Link
                        to="/rules/$id"
                        params={{ id: category.id }}
                        data-testid={`ruleset-item-${category.id}`}
                        onClick={(event) =>
                          primeSharedElements(event, {
                            icon: SHARED_ELEMENT_NAMES.rulesIcon,
                            title: SHARED_ELEMENT_NAMES.rulesTitle,
                          })
                        }
                        className="flex min-w-0 flex-1 items-center gap-3.5 focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <span data-shared-icon className="inline-flex shrink-0">
                          <CategoryIcon icon={category.icon} name={category.name} size={44} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div
                            data-shared-title
                            className="truncate text-sm font-semibold text-text group-hover:text-primary"
                          >
                            {category.name}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-text-muted">{subtext}</div>
                        </div>
                        <span className="shrink-0 rounded-full border border-border bg-surface-muted px-2.5 py-0.5 text-xs font-semibold tabular-nums text-text">
                          {(category.ruleCount ?? category.rules.length).toLocaleString()}
                        </span>
                      </Link>

                      <Link
                        to="/subscriptions/$id"
                        params={{ id: category.id }}
                        aria-label={`${t('ruleLibrary.copyLink')} ${category.name}`}
                        title={t('ruleLibrary.copyLink')}
                        data-testid={`ruleset-copy-link-${category.id}`}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted transition-colors hover:bg-surface-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <Link2 className="h-4 w-4" />
                      </Link>

                      <Link
                        to="/rules/$id"
                        params={{ id: category.id }}
                        aria-hidden="true"
                        tabIndex={-1}
                        className="inline-flex shrink-0 items-center text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </SkeletonSwap>
        </CardContent>
      </Card>

      <Card data-testid="all-rules-card">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg">{t('ruleLibrary.allRulesTitle')}</CardTitle>
            <CardDescription className="mt-0.5">{t('ruleLibrary.allRulesSubtitle')}</CardDescription>
          </div>

          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t('ruleLibrary.allRulesSearchPlaceholder')}
              data-testid="all-rules-search-input"
              className="pl-9"
            />
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {searchingGlobal ? <p className="py-2 text-xs text-text-muted">{t('common.loading')}</p> : null}

          {ruleGroups.map((group) => {
            const GroupIcon = group.icon;
            const categoryEntries = sortedCategories
              .map((item) => {
                const matched = group.matchedRules.filter((rule) => rule.categoryId === item.id);
                const count = isSearching
                  ? matched.length
                  : group.id === 'manual'
                    ? (item.manualRuleCount ?? 0)
                    : group.id === 'url'
                      ? (item.urlRuleCount ?? 0)
                      : (item.geoRuleCount ?? 0);
                return { category: item, count, matched };
              })
              .filter((entry) => entry.count > 0);

            return (
              <CollapsibleDetails
                key={group.id}
                open={isSearching ? group.count > 0 : undefined}
                data-testid={`all-rules-group-${group.id}`}
                className="rounded-[var(--radius-md)] border border-border bg-surface-muted/30"
                summaryClassName="gap-3 px-4 py-3.5"
                summary={(expanded) => (
                  <>
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface text-text-muted">
                        <GroupIcon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-text">{group.title}</div>
                        <div className="truncate text-xs text-text-muted">{group.description}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
                      <span className="font-semibold tabular-nums text-text">{group.count.toLocaleString()}</span>
                      <span>{t('rules.unitItems')}</span>
                      <ChevronDown
                        className={`h-4 w-4 transition-transform duration-[var(--motion-base)] ease-[var(--ease-out)] ${
                          expanded ? 'rotate-180' : ''
                        }`}
                      />
                    </div>
                  </>
                )}
                contentClassName="flex flex-col gap-2.5 border-t border-border p-3"
              >
                {categoryEntries.length === 0 ? (
                  <p className="py-2 text-center text-xs text-text-muted">{t('ruleLibrary.emptyGroup')}</p>
                ) : (
                  categoryEntries.map((entry) => (
                    <CategoryRuleFolder
                      key={entry.category.id}
                      category={entry.category}
                      count={entry.count}
                      groupId={group.id}
                      searchedRules={entry.matched}
                      searching={isSearching}
                    />
                  ))
                )}
              </CollapsibleDetails>
            );
          })}
        </CardContent>
      </Card>

      <Suspense fallback={null}>
        {createDialogOpen ? (
          <RuleCategoryDialog
            open={createDialogOpen}
            mode="create"
            customIconPackUrls={settings?.customIconPackUrls}
            customIconPackNames={settings?.customIconPackNames}
            submitting={createMutation.isPending}
            onOpenChange={setCreateDialogOpen}
            onCreate={async (input) => {
              await createMutation.mutateAsync(input);
            }}
          />
        ) : null}
      </Suspense>
    </div>
  );
}
