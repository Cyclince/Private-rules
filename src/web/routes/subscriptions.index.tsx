import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CategoryIcon } from '../components/subscriptions/CategoryIcon';
import {
  getEnabledRuleCount,
  nextSortDirection,
  readStoredSubscriptionSort,
  resolveAccessPolicy,
  sortSubscriptionCategories,
  writeStoredSubscriptionSort,
  type AccessPolicy,
  type CategorySortKey,
  type SortDirection,
} from '../components/subscriptions/subscription-helpers';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { loadPageTranslations, useI18n, type MessageKey } from '../i18n';
import { requireAuthBeforeLoad } from '../lib/auth-guard';
import { rulesetsListQueryOptions } from '../lib/query-core';

export const Route = createFileRoute('/subscriptions/')({
  beforeLoad: async ({ context, location }) => {
    await Promise.all([requireAuthBeforeLoad(context.queryClient, location.href), loadPageTranslations()]);
  },
  component: SubscriptionsIndexPage,
});

const SORT_OPTIONS: ReadonlyArray<{ key: CategorySortKey; labelKey: MessageKey }> = [
  { key: 'alpha', labelKey: 'subscriptions.sortAlpha' },
  { key: 'count', labelKey: 'subscriptions.sortCount' },
  { key: 'created', labelKey: 'subscriptions.sortCreated' },
  { key: 'modified', labelKey: 'subscriptions.sortModified' },
];

function policyBadgeClass(policy: AccessPolicy): string {
  if (policy === 'token') return 'border-primary/25 bg-primary/15 text-primary';
  if (policy === 'public') return 'border-success/25 bg-success/15 text-success';
  return 'border-border bg-surface-muted text-text-muted';
}

function policyBadgeLabelKey(policy: AccessPolicy): MessageKey {
  if (policy === 'token') return 'subscriptions.policyBadgeToken';
  if (policy === 'public') return 'subscriptions.policyBadgePublic';
  return 'subscriptions.policyBadgeDisabled';
}

function SubscriptionsIndexPage() {
  const { t } = useI18n();
  const summaryQuery = useQuery(rulesetsListQueryOptions());

  const [{ key: sortKey, direction: sortDirection }, setSortState] = useState<{
    key: CategorySortKey;
    direction: SortDirection;
  }>(() => readStoredSubscriptionSort());

  useEffect(() => {
    writeStoredSubscriptionSort(sortKey, sortDirection);
  }, [sortKey, sortDirection]);

  const categories = useMemo(() => {
    const list = summaryQuery.data?.data.categories ?? [];
    return sortSubscriptionCategories(list, sortKey, sortDirection);
  }, [summaryQuery.data, sortKey, sortDirection]);

  const handleSortClick = (nextKey: CategorySortKey) => {
    setSortState((prev) => ({
      key: nextKey,
      direction: nextSortDirection(prev.key, prev.direction, nextKey),
    }));
  };

  return (
    <div className="flex flex-col gap-5" data-testid="subscriptions-page">
      <header className="flex flex-col gap-1.5">
        <div>
          <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/15 px-3 py-0.5 text-[11px] font-semibold tracking-[0.14em] text-primary">
            {t('subscriptions.eyebrow')}
          </span>
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">{t('subscriptions.title')}</h2>
        <p className="text-sm text-text-muted">{t('subscriptions.subtitle')}</p>
      </header>

      <Card data-testid="subscriptions-list-card">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg">{t('subscriptions.selectRuleTitle')}</CardTitle>
            <CardDescription className="mt-0.5">{t('subscriptions.selectRuleSubtitle')}</CardDescription>
          </div>

          <div
            role="group"
            aria-label={t('subscriptions.sortLabel')}
            data-testid="subscriptions-sort-toolbar"
            className="grid grid-cols-4 gap-1 rounded-full border border-border bg-surface-muted p-1 sm:inline-flex sm:w-auto"
          >
            {SORT_OPTIONS.map((option) => {
              const active = sortKey === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  data-testid={`subscriptions-sort-${option.key}`}
                  aria-pressed={active}
                  onClick={() => handleSortClick(option.key)}
                  className={`inline-flex cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors ${
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
          {summaryQuery.isLoading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="h-20 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
              <div className="h-20 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
              <div className="h-20 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
              <div className="h-20 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
            </div>
          ) : categories.length === 0 ? (
            <EmptyState
              title={t('subscriptions.emptyTitle')}
              description={t('subscriptions.emptyDesc')}
              action={
                <Button asChild size="sm">
                  <Link to="/rules">{t('subscriptions.goToRules')}</Link>
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="subscriptions-category-grid">
              {categories.map((category) => {
                const policy = resolveAccessPolicy(category);
                const enabledCount = getEnabledRuleCount(category);
                return (
                  <Link
                    key={category.id}
                    to="/subscriptions/$id"
                    params={{ id: category.id }}
                    data-testid={`subscription-card-${category.id}`}
                    className="motion-card group flex items-center gap-3.5 rounded-[var(--radius-md)] border border-border bg-surface p-4 hover:border-primary/50 hover:bg-surface-muted/40 focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <CategoryIcon icon={category.icon} name={category.name} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-text group-hover:text-primary">
                        {category.name}
                      </div>
                      <div className="mt-0.5 text-xs text-text-muted">
                        {enabledCount.toLocaleString()} {t('subscriptions.enabledRulesSuffix')}
                      </div>
                    </div>
                    <Badge
                      data-testid={`subscription-policy-badge-${category.id}`}
                      className={`shrink-0 ${policyBadgeClass(policy)}`}
                    >
                      {t(policyBadgeLabelKey(policy))}
                    </Badge>
                    <ChevronRight className="h-4 w-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
