import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Blocks, Copy, Eye, Pencil, Plus, Search, ShieldAlert, Trash2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  CATALOG_CATEGORY_VALUES,
  CATEGORY_EMOJI,
  LEGACY_CATALOG_CATEGORY_VALUES,
  normalizeCatalogCategory,
  type CatalogCategory,
  type PrimaryCatalogCategory,
} from '../../shared/app-categories';
import type { AppCard, CardOrigin } from '../../shared/schemas/card';
import type { CardSubmitPayload } from '../components/cards/CardFormDialog';
import { formatPolicyRefLabel } from '../components/cards/card-helpers';
import { SectionSubNav } from '../components/layout/SectionSubNav';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { Input } from '../components/ui/input';
import { loadPageTranslations, useI18n, type MessageKey } from '../i18n';
import { api, formatApiError, readApiJson } from '../lib/api';
import { isTelegramSession, requireAuthBeforeLoad } from '../lib/auth-guard';
import { authMeQueryOptions, cardsListQueryOptions, invalidateCards } from '../lib/query';
import { useToast } from '../lib/toast';

const CardDetailSheet = lazy(() =>
  import('../components/cards/CardDetailSheet').then((m) => ({ default: m.CardDetailSheet })),
);
const CardFormDialog = lazy(() =>
  import('../components/cards/CardFormDialog').then((m) => ({ default: m.CardFormDialog })),
);
const DeleteConfirmDialog = lazy(() =>
  import('../components/rulesets/DeleteConfirmDialog').then((m) => ({ default: m.DeleteConfirmDialog })),
);

type GroupsSearch = {
  q?: string;
  origin?: CardOrigin;
  category?: CatalogCategory;
  selected?: string;
};

const CARD_ORIGINS: readonly CardOrigin[] = ['builtin', 'user', 'fork'];
const CATALOG_CATEGORIES: readonly PrimaryCatalogCategory[] = CATALOG_CATEGORY_VALUES;
const VALID_ORIGINS = new Set<string>(CARD_ORIGINS);
/** Old shared links may still carry a pre-r2 category id; map it to the current one. */
const VALID_CATEGORIES = new Set<string>([...CATALOG_CATEGORY_VALUES, ...LEGACY_CATALOG_CATEGORY_VALUES]);

export const Route = createFileRoute('/templates/groups')({
  validateSearch: (search: Record<string, unknown>): GroupsSearch => {
    const q = typeof search.q === 'string' && search.q ? search.q : undefined;
    const rawOrigin = typeof search.origin === 'string' ? search.origin : undefined;
    const origin = rawOrigin && VALID_ORIGINS.has(rawOrigin) ? (rawOrigin as CardOrigin) : undefined;
    const rawCategory = typeof search.category === 'string' ? search.category : undefined;
    const normalizedCategory =
      rawCategory && VALID_CATEGORIES.has(rawCategory) ? normalizeCatalogCategory(rawCategory) : undefined;
    const category = normalizedCategory as CatalogCategory | undefined;
    const selected = typeof search.selected === 'string' && search.selected ? search.selected : undefined;
    return {
      ...(q ? { q } : {}),
      ...(origin ? { origin } : {}),
      ...(category ? { category } : {}),
      ...(selected ? { selected } : {}),
    };
  },
  beforeLoad: async ({ context, location }) => {
    await Promise.all([requireAuthBeforeLoad(context.queryClient, location.href), loadPageTranslations()]);
  },
  component: PolicyGroupsPage,
});

function originBadgeVariant(origin: CardOrigin | undefined): 'outline' | 'primary' | 'accent' {
  if (origin === 'user') return 'primary';
  if (origin === 'fork') return 'accent';
  return 'outline';
}

function PolicyGroupsPage() {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const rawSearch = Route.useSearch();
  const navigate = Route.useNavigate();

  const authQuery = useQuery(authMeQueryOptions());
  const inTelegram = isTelegramSession(authQuery.data);

  const searchQ = rawSearch.q ?? '';
  const activeOrigin = rawSearch.origin;
  const activeCategory = rawSearch.category;
  const selectedId = rawSearch.selected ?? null;

  const [queryInput, setQueryInput] = useState(searchQ);
  const [formDialog, setFormDialog] = useState<{ open: boolean; mode: 'create' | 'edit'; card: AppCard | null }>({
    open: false,
    mode: 'create',
    card: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<AppCard | null>(null);
  const [forkingId, setForkingId] = useState<string | null>(null);

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

  const cardsQuery = useQuery({
    ...cardsListQueryOptions({ limit: 200 }),
    placeholderData: keepPreviousData,
  });

  const allCards = useMemo(() => cardsQuery.data?.cards ?? [], [cardsQuery.data]);
  const cardNames = useMemo(() => new Map(allCards.map((card) => [card.id, card.name])), [allCards]);

  const originCounts = useMemo(() => {
    const counts: Record<CardOrigin, number> = { builtin: 0, user: 0, fork: 0 };
    for (const card of allCards) {
      counts[card.origin ?? 'builtin'] += 1;
    }
    return counts;
  }, [allCards]);

  const filteredCards = useMemo(() => {
    const needle = searchQ.trim().toLowerCase();
    return allCards.filter((card) => {
      const origin: CardOrigin = card.origin ?? 'builtin';
      if (activeOrigin && origin !== activeOrigin) return false;
      if (activeCategory && card.category !== activeCategory) return false;
      if (needle) {
        const haystacks = [card.id, card.slug, card.name, card.category, card.icon ?? ''];
        if (!haystacks.some((field) => field.toLowerCase().includes(needle))) return false;
      }
      return true;
    });
  }, [allCards, activeOrigin, activeCategory, searchQ]);

  /** Policy groups are listed by category (design revision r2 §4.2), in the designed order. */
  const groupedCards = useMemo(() => {
    const buckets = new Map<CatalogCategory, AppCard[]>();
    for (const card of filteredCards) {
      const category = normalizeCatalogCategory(card.category) ?? 'other';
      const bucket = buckets.get(category);
      if (bucket) bucket.push(card);
      else buckets.set(category, [card]);
    }
    return CATALOG_CATEGORY_VALUES.map((category) => ({ category, cards: buckets.get(category) ?? [] })).filter(
      (group) => group.cards.length > 0,
    );
  }, [filteredCards]);

  const selectedCard = useMemo(
    () => (selectedId ? (allCards.find((card) => card.id === selectedId) ?? null) : null),
    [allCards, selectedId],
  );

  const updateSearch = (patch: Partial<GroupsSearch>) => {
    void navigate({
      search: (prev) => ({ ...prev, ...patch }),
      replace: true,
    });
  };

  const createMutation = useMutation({
    mutationFn: async (payload: CardSubmitPayload) =>
      readApiJson<{ card: AppCard }>(await api.api.cards.$post({ json: payload })),
    onSuccess: async ({ card }) => {
      setFormDialog({ open: false, mode: 'create', card: null });
      await invalidateCards(queryClient, card.id);
      notify({ title: t('cards.createdToast'), variant: 'success' });
      if (activeOrigin === 'builtin') {
        updateSearch({ origin: undefined, selected: card.id });
      }
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: CardSubmitPayload }) =>
      readApiJson<{ card: AppCard }>(
        await api.api.cards[':id'].$patch({
          param: { id },
          json: {
            ...payload,
            icon: payload.icon ?? null,
          },
        }),
      ),
    onSuccess: async ({ card }) => {
      setFormDialog({ open: false, mode: 'edit', card: null });
      await invalidateCards(queryClient, card.id);
      notify({ title: t('cards.updatedToast'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const forkMutation = useMutation({
    mutationFn: async (sourceCard: AppCard) => {
      setForkingId(sourceCard.id);
      return readApiJson<{ card: AppCard }>(
        await api.api.cards[':id'].fork.$post({
          param: { id: sourceCard.id },
          json: {},
        }),
      );
    },
    onSuccess: async ({ card }) => {
      await invalidateCards(queryClient, card.id);
      notify({ title: t('cards.forkedToast'), variant: 'success' });
      updateSearch({
        origin: activeOrigin === 'builtin' || activeOrigin === 'user' ? 'fork' : activeOrigin,
        selected: card.id,
      });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
    onSettled: () => {
      setForkingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => readApiJson(await api.api.cards[':id'].$delete({ param: { id } })),
    onSuccess: async (_res, id) => {
      setDeleteTarget(null);
      if (selectedId === id) {
        updateSearch({ selected: undefined });
      }
      await invalidateCards(queryClient, id);
      notify({ title: t('cards.deletedToast'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  return (
    <div className="flex flex-col gap-5" data-testid="cards-page">
      <SectionSubNav section="templates" />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text">{t('cards.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('cards.subtitle')}</p>
        </div>

        <Button
          size="md"
          disabled={inTelegram}
          data-testid="cards-create-btn"
          onClick={() => setFormDialog({ open: true, mode: 'create', card: null })}
        >
          <Plus className="h-4 w-4" />
          <span>{t('cards.create')}</span>
        </Button>
      </div>

      {inTelegram ? (
        <div
          role="status"
          data-testid="cards-telegram-readonly"
          className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-warning bg-surface-muted px-3.5 py-2.5 text-xs text-text"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>{t('templates.listTelegramReadOnly')}</span>
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">{t('cards.title')}</CardTitle>
              <CardDescription>{t('cards.builtinHint')}</CardDescription>
            </div>
            <Badge variant="outline" data-testid="cards-total-badge">
              {filteredCards.length} / {allCards.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder={t('cards.searchPlaceholder')}
              data-testid="cards-search-input"
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant={!activeOrigin ? 'primary' : 'outline'}
              data-testid="cards-origin-all"
              onClick={() => updateSearch({ origin: undefined })}
            >
              {t('cards.originAll')} ({allCards.length})
            </Button>
            {CARD_ORIGINS.map((origin) => (
              <Button
                key={origin}
                size="sm"
                variant={activeOrigin === origin ? 'primary' : 'outline'}
                data-testid={`cards-origin-${origin}`}
                onClick={() => updateSearch({ origin: activeOrigin === origin ? undefined : origin })}
              >
                {t(`cards.origin.${origin}` as MessageKey)} ({originCounts[origin]})
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant={!activeCategory ? 'secondary' : 'ghost'}
              data-testid="cards-category-all"
              onClick={() => updateSearch({ category: undefined })}
            >
              {t('taxonomy.categoryAll')}
            </Button>
            {CATALOG_CATEGORIES.map((category) => (
              <Button
                key={category}
                size="sm"
                variant={activeCategory === category ? 'secondary' : 'ghost'}
                data-testid={`cards-category-${category}`}
                onClick={() => updateSearch({ category: activeCategory === category ? undefined : category })}
              >
                <span aria-hidden="true" className="mr-1">
                  {CATEGORY_EMOJI[category]}
                </span>
                {t(`taxonomy.category.${category}` as MessageKey)}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {cardsQuery.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="h-36 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
          <div className="h-36 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
        </div>
      ) : filteredCards.length === 0 ? (
        <Card>
          <CardContent className="pt-5">
            <EmptyState data-testid="cards-empty" title={t('cards.empty')} className="border-0 bg-transparent py-6" />
          </CardContent>
        </Card>
      ) : (
        <div data-testid="cards-list" className="flex flex-col gap-5">
          {groupedCards.map((group) => (
            <section
              key={group.category}
              data-testid={`policy-group-section-${group.category}`}
              aria-labelledby={`policy-group-section-title-${group.category}`}
              className="flex flex-col gap-3"
            >
              <div className="flex items-center justify-between gap-2 border-b border-border pb-1.5">
                <h2
                  id={`policy-group-section-title-${group.category}`}
                  className="flex items-center gap-1.5 text-sm font-semibold text-text"
                >
                  <span aria-hidden="true">{CATEGORY_EMOJI[group.category]}</span>
                  <span>{t(`taxonomy.category.${group.category}` as MessageKey)}</span>
                </h2>
                <Badge variant="outline">{group.cards.length}</Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {group.cards.map((card) => {
                  const origin: CardOrigin = card.origin ?? 'builtin';
                  const isEditable = origin !== 'builtin';
                  const defaultCandidate = card.group.candidates[0];
                  const defaultRouteLabel = defaultCandidate
                    ? formatPolicyRefLabel(defaultCandidate, t, cardNames)
                    : 'DIRECT';

                  return (
                    <Card
                      key={card.id}
                      data-testid={`card-item-${card.id}`}
                      className={selectedId === card.id ? 'border-primary/70 ring-1 ring-primary/30' : ''}
                    >
                      <CardContent className="flex flex-col gap-3 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-border bg-surface-muted font-mono text-xs font-semibold text-primary">
                              {card.icon ? card.icon.slice(0, 4) : <Blocks className="h-4 w-4" />}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-text">{card.name}</div>
                              <div className="truncate font-mono text-[11px] text-text-muted">{card.slug}</div>
                            </div>
                          </div>
                          <Badge variant={originBadgeVariant(origin)} data-testid={`card-origin-badge-${card.id}`}>
                            {t(`cards.origin.${origin}` as MessageKey)}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <Badge variant="outline">{t(`taxonomy.category.${card.category}` as MessageKey)}</Badge>
                          <Badge variant="outline">{t(`taxonomy.stage.${card.stage}` as MessageKey)}</Badge>
                          <Badge variant="outline">
                            {card.matchers.length} {t('cards.matchersCount')}
                          </Badge>
                        </div>

                        <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-surface-muted/50 px-2.5 py-1.5 text-xs">
                          <span className="text-text-muted">{t('cards.defaultRouteLabel')}</span>
                          <span
                            className="truncate font-medium text-text"
                            data-testid={`card-default-route-${card.id}`}
                          >
                            {defaultRouteLabel}
                          </span>
                        </div>

                        {card.forkedFrom ? (
                          <div className="truncate text-[11px] text-text-muted">
                            {t('cards.forkedFromLabel')}: {cardNames.get(card.forkedFrom) ?? card.forkedFrom}
                          </div>
                        ) : null}

                        <div className="flex flex-wrap items-center justify-end gap-1.5 pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`card-view-${card.id}`}
                            onClick={() => updateSearch({ selected: card.id })}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>{t('cards.view')}</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={inTelegram || forkingId === card.id}
                            data-testid={`card-fork-${card.id}`}
                            onClick={() => forkMutation.mutate(card)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            <span>{forkingId === card.id ? t('cards.forking') : t('cards.fork')}</span>
                          </Button>
                          {isEditable ? (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={inTelegram}
                                data-testid={`card-edit-${card.id}`}
                                onClick={() => setFormDialog({ open: true, mode: 'edit', card })}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                <span>{t('common.edit')}</span>
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                disabled={inTelegram}
                                data-testid={`card-delete-${card.id}`}
                                onClick={() => setDeleteTarget(card)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span>{t('common.delete')}</span>
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {selectedCard ? (
        <Suspense fallback={null}>
          <CardDetailSheet
            open={Boolean(selectedCard)}
            card={selectedCard}
            cardNames={cardNames}
            readOnly={inTelegram}
            forking={forkingId === selectedCard.id}
            onFork={(card) => forkMutation.mutate(card)}
            onEdit={(card) => {
              updateSearch({ selected: undefined });
              setFormDialog({ open: true, mode: 'edit', card });
            }}
            onDelete={(card) => {
              updateSearch({ selected: undefined });
              setDeleteTarget(card);
            }}
            onOpenChange={(open) => {
              if (!open) updateSearch({ selected: undefined });
            }}
          />
        </Suspense>
      ) : null}

      {formDialog.open ? (
        <Suspense fallback={null}>
          <CardFormDialog
            open={formDialog.open}
            mode={formDialog.mode}
            initial={formDialog.card}
            submitting={createMutation.isPending || updateMutation.isPending}
            onOpenChange={(open) => setFormDialog((prev) => ({ ...prev, open }))}
            onSubmit={async (payload) => {
              if (formDialog.mode === 'create') {
                await createMutation.mutateAsync(payload);
              } else if (formDialog.card) {
                await updateMutation.mutateAsync({ id: formDialog.card.id, payload });
              }
            }}
          />
        </Suspense>
      ) : null}

      {deleteTarget ? (
        <Suspense fallback={null}>
          <DeleteConfirmDialog
            open={Boolean(deleteTarget)}
            title={t('cards.deleteConfirmTitle')}
            description={t('cards.deleteConfirmBody')}
            itemName={`${deleteTarget.name} (${deleteTarget.slug})`}
            submitting={deleteMutation.isPending}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            onConfirm={async () => {
              if (deleteTarget) await deleteMutation.mutateAsync(deleteTarget.id);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
