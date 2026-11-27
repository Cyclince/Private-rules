import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { BookOpen, ChevronDown, ChevronRight, CornerDownRight, Eye, Search } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { CatalogItem, CatalogItemKind } from '../../application/catalog';
import type { CatalogCategory } from '../../shared/schemas/card';
import { SectionSubNav } from '../components/layout/SectionSubNav';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { Input } from '../components/ui/input';
import { loadPageTranslations, useI18n, type MessageKey } from '../i18n';
import { requireAuthBeforeLoad } from '../lib/auth-guard';
import { catalogListQueryOptions } from '../lib/query';

const CatalogDetailSheet = lazy(() =>
  import('../components/catalog/CatalogDetailSheet').then((m) => ({ default: m.CatalogDetailSheet })),
);

type CatalogSearch = {
  q?: string;
  category?: CatalogCategory;
  kind?: CatalogItemKind;
  selected?: string;
};

const CATALOG_CATEGORIES: readonly CatalogCategory[] = [
  'ai',
  'streaming',
  'social',
  'gaming',
  'advertising',
  'domestic',
  'infrastructure',
  'other',
];
const VALID_CATEGORIES = new Set<string>(CATALOG_CATEGORIES);
const VALID_KINDS = new Set<string>(['builtin', 'ruleset', 'geosite', 'geoip']);
const KIND_VALUES: readonly CatalogItemKind[] = ['builtin', 'ruleset', 'geosite', 'geoip'];

export const Route = createFileRoute('/catalog')({
  validateSearch: (search: Record<string, unknown>): CatalogSearch => {
    const q = typeof search.q === 'string' && search.q ? search.q : undefined;
    const rawCategory = typeof search.category === 'string' ? search.category : undefined;
    const category = rawCategory && VALID_CATEGORIES.has(rawCategory) ? (rawCategory as CatalogCategory) : undefined;
    const rawKind = typeof search.kind === 'string' ? search.kind : undefined;
    const kind = rawKind && VALID_KINDS.has(rawKind) ? (rawKind as CatalogItemKind) : undefined;
    const selected = typeof search.selected === 'string' && search.selected ? search.selected : undefined;
    return {
      ...(q ? { q } : {}),
      ...(category ? { category } : {}),
      ...(kind ? { kind } : {}),
      ...(selected ? { selected } : {}),
    };
  },
  beforeLoad: async ({ context, location }) => {
    await Promise.all([requireAuthBeforeLoad(context.queryClient, location.href), loadPageTranslations()]);
  },
  component: CatalogPage,
});

function routeBadgeVariant(route: CatalogItem['defaultRoute']): 'primary' | 'success' | 'danger' {
  if (route === 'direct') return 'success';
  if (route === 'reject') return 'danger';
  return 'primary';
}

function CatalogPage() {
  const { t } = useI18n();
  const rawSearch = Route.useSearch();
  const navigate = Route.useNavigate();

  const searchQ = rawSearch.q ?? '';
  const activeCategory = rawSearch.category;
  const activeKind = rawSearch.kind;
  const selectedId = rawSearch.selected ?? null;

  const [queryInput, setQueryInput] = useState(searchQ);
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setQueryInput(searchQ);
  }, [searchQ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (queryInput !== searchQ) {
        void navigate({
          search: (prev) => ({ ...prev, q: queryInput.trim() || undefined }),
          replace: true,
        });
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [queryInput, searchQ, navigate]);

  const catalogQuery = useQuery({
    ...catalogListQueryOptions({
      ...(searchQ ? { q: searchQ } : {}),
      ...(activeCategory ? { category: activeCategory } : {}),
      ...(activeKind ? { kind: activeKind } : {}),
      limit: 200,
    }),
    placeholderData: keepPreviousData,
  });

  const items = useMemo(() => catalogQuery.data?.items ?? [], [catalogQuery.data]);
  const providers = catalogQuery.data?.providers ?? {};
  const total = catalogQuery.data?.total ?? 0;

  const { roots, childrenByParent, itemById } = useMemo(() => {
    const byId = new Map<string, CatalogItem>();
    for (const item of items) byId.set(item.id, item);

    const children = new Map<string, CatalogItem[]>();
    const topLevel: CatalogItem[] = [];

    for (const item of items) {
      if (item.parentId && byId.has(item.parentId)) {
        const list = children.get(item.parentId) ?? [];
        list.push(item);
        children.set(item.parentId, list);
      } else {
        topLevel.push(item);
      }
    }
    return { roots: topLevel, childrenByParent: children, itemById: byId };
  }, [items]);

  const selectedItem = selectedId ? (itemById.get(selectedId) ?? null) : null;

  const updateSearch = (patch: Partial<CatalogSearch>) => {
    void navigate({
      search: (prev) => ({ ...prev, ...patch }),
      replace: true,
    });
  };

  const toggleParent = (parentId: string) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  };

  const renderEntryRow = (item: CatalogItem, isChild: boolean, childCount = 0, isExpanded = false) => {
    const providerMeta = providers[item.provider];
    const providerLabel = providerMeta?.name ?? item.provider;

    return (
      <div
        key={item.id}
        data-testid={`catalog-item-${item.id}`}
        className={`flex flex-col gap-2 rounded-[var(--radius-md)] border border-border px-3.5 py-2.5 transition-colors hover:bg-surface-muted/70 sm:flex-row sm:items-center sm:justify-between ${
          isChild ? 'bg-surface-muted/35' : 'bg-surface'
        } ${selectedId === item.id ? 'border-primary/70 ring-1 ring-primary/30' : ''}`}
      >
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          {childCount > 0 ? (
            <button
              type="button"
              data-testid={`catalog-toggle-${item.id}`}
              aria-label={isExpanded ? t('catalog.collapseChildren') : t('catalog.expandChildren')}
              onClick={() => toggleParent(item.id)}
              className="mt-0.5 inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border border-border bg-surface-muted text-text-muted transition-colors hover:text-text"
            >
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : isChild ? (
            <CornerDownRight className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" />
          ) : (
            <BookOpen className="mt-1 h-4 w-4 shrink-0 text-text-muted" />
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => updateSearch({ selected: item.id })}
                className="cursor-pointer truncate text-left text-sm font-medium text-text hover:text-primary"
              >
                {item.name}
              </button>
              <Badge variant="outline" className="font-mono text-[10px]">
                {item.id}
              </Badge>
              {childCount > 0 ? (
                <Badge variant="accent" data-testid={`catalog-child-count-${item.id}`}>
                  {childCount} {t('catalog.childrenCount')}
                </Badge>
              ) : null}
              {!isChild && item.parentId ? (
                <Badge variant="outline" className="text-[10px]">
                  {t('catalog.parentLabel')}: {item.parentId}
                </Badge>
              ) : null}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
              <Badge variant="outline" className="text-[10px]">
                {t(`catalog.kind.${item.kind}` as MessageKey)}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {t(`taxonomy.category.${item.category}` as MessageKey)}
              </Badge>
              <Badge variant={routeBadgeVariant(item.defaultRoute)} className="text-[10px]">
                {t(`taxonomy.route.${item.defaultRoute}` as MessageKey)}
              </Badge>
              <span className="truncate">{providerLabel}</span>
              {typeof item.ruleCount === 'number' ? (
                <span className="font-mono">
                  · {item.ruleCount.toLocaleString()} {t('catalog.detailRuleCount')}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5">
          <Button
            size="sm"
            variant="outline"
            data-testid={`catalog-view-${item.id}`}
            onClick={() => updateSearch({ selected: item.id })}
          >
            <Eye className="h-3.5 w-3.5" />
            <span>{t('catalog.viewDetail')}</span>
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div data-testid="catalog-page" className="flex flex-col gap-4">
      <SectionSubNav section="templates" />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>{t('catalog.title')}</CardTitle>
              <CardDescription>{t('catalog.subtitle')}</CardDescription>
            </div>
            <Badge variant="primary" data-testid="catalog-total-badge">
              {total} {t('catalog.totalLabel')}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              data-testid="catalog-search-input"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder={t('catalog.searchPlaceholder')}
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('catalog.detailProvider')}>
            <Button
              size="sm"
              variant={!activeKind ? 'primary' : 'outline'}
              data-testid="catalog-kind-all"
              onClick={() => updateSearch({ kind: undefined })}
            >
              {t('catalog.kindAll')}
            </Button>
            {KIND_VALUES.map((kind) => (
              <Button
                key={kind}
                size="sm"
                variant={activeKind === kind ? 'primary' : 'outline'}
                data-testid={`catalog-kind-${kind}`}
                onClick={() => updateSearch({ kind })}
              >
                {t(`catalog.kind.${kind}` as MessageKey)}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('cards.fieldCategory')}>
            <Button
              size="sm"
              variant={!activeCategory ? 'primary' : 'outline'}
              data-testid="catalog-category-all"
              onClick={() => updateSearch({ category: undefined })}
            >
              {t('taxonomy.categoryAll')}
            </Button>
            {CATALOG_CATEGORIES.map((category) => (
              <Button
                key={category}
                size="sm"
                variant={activeCategory === category ? 'primary' : 'outline'}
                data-testid={`catalog-category-${category}`}
                onClick={() => updateSearch({ category })}
              >
                {t(`taxonomy.category.${category}` as MessageKey)}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {catalogQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          <div className="h-16 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
          <div className="h-16 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
          <div className="h-16 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
        </div>
      ) : roots.length === 0 ? (
        <Card>
          <CardContent className="pt-5">
            <EmptyState
              data-testid="catalog-empty"
              title={t('catalog.empty')}
              className="border-0 bg-transparent py-6"
            />
          </CardContent>
        </Card>
      ) : (
        <div data-testid="catalog-list" className="flex flex-col gap-2.5">
          {roots.map((root) => {
            const children = childrenByParent.get(root.id) ?? [];
            const isExpanded = children.length > 0 && !collapsedParents.has(root.id);
            return (
              <div key={root.id} data-testid={`catalog-group-${root.id}`} className="flex flex-col gap-1.5">
                {renderEntryRow(root, false, children.length, isExpanded)}
                {isExpanded ? (
                  <div
                    data-testid={`catalog-children-${root.id}`}
                    className="ml-4 flex flex-col gap-1.5 border-l-2 border-primary/35 pl-3 sm:ml-6 sm:pl-4"
                  >
                    {children.map((child) => renderEntryRow(child, true))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {selectedId ? (
        <Suspense fallback={null}>
          <CatalogDetailSheet
            open={Boolean(selectedId)}
            entryId={selectedId}
            initialItem={selectedItem}
            allItems={items}
            providers={providers}
            onSelectEntry={(nextId) => updateSearch({ selected: nextId })}
            onOpenChange={(open) => {
              if (!open) updateSearch({ selected: undefined });
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
