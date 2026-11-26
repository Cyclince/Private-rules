import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Blocks, Copy, Eye, Pencil, Plus, Search, ShieldAlert, Trash2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { AppCard, CardOrigin, CatalogCategory } from '../../shared/schemas/card';
import type { CardSubmitPayload } from '../components/cards/CardFormDialog';
import { formatPolicyRefLabel } from '../components/cards/card-helpers';
import { SectionSubNav } from '../components/layout/SectionSubNav';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
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

type CardsSearch = {
  q?: string;
  origin?: CardOrigin;
  category?: CatalogCategory;
  selected?: string;
};

const CARD_ORIGINS: readonly CardOrigin[] = ['builtin', 'user', 'fork'];
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
const VALID_ORIGINS = new Set<string>(CARD_ORIGINS);
const VALID_CATEGORIES = new Set<string>(CATALOG_CATEGORIES);

export const Route = createFileRoute('/cards')({
  validateSearch: (search: Record<string, unknown>): CardsSearch => {
    const q = typeof search.q === 'string' && search.q ? search.q : undefined;
    const rawOrigin = typeof search.origin === 'string' ? search.origin : undefined;
    const origin = rawOrigin && VALID_ORIGINS.has(rawOrigin) ? (rawOrigin as CardOrigin) : undefined;
    const rawCategory = typeof search.category === 'string' ? search.category : undefined;
    const category = rawCategory && VALID_CATEGORIES.has(rawCategory) ? (rawCategory as CatalogCategory) : undefined;
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
  component: CardsPage,
});

function originBadgeVariant(origin: CardOrigin | undefined): 'outline' | 'primary' | 'accent' {
  if (origin === 'user') return 'primary';
  if (origin === 'fork') return 'accent';
  return 'outline';
}

function CardsPage() {
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

  const selectedCard = useMemo(
    () => (selectedId ? (allCards.find((card) => card.id === selectedId) ?? null) : null),
    [allCards, selectedId],
  );

  const updateSearch = (patch: Partial<CardsSearch>) => {
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
    mutationFn: async (cardId: string) =>
      readApiJson<{ deletedId: string }>(await api.api.cards[':id'].$delete({ param: { id: cardId } })),
    onSuccess: async ({ deletedId }) => {
      setDeleteTarget(null);
      if (selectedId === deletedId) updateSearch({ selected: undefined });
      await invalidateCards(queryClient, deletedId);
      notify({ title: t('cards.deletedToast'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  return (
    <div data-testid="cards-page" className="flex flex-col gap-4">
      <SectionSubNav section="templates" />

      {inTelegram ? (
        <div
          data-testid="cards-telegram-readonly"
          className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-warning/50 bg-surface-muted px-3.5 py-2.5 text-xs text-text"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>{t('taxonomy.telegramReadOnly')}</span>
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>{t('cards.title')}</CardTitle>
              <CardDescription>{t('cards.subtitle')}</CardDescription>
            </div>
            <Button
              size="sm"
              data-testid="cards-create-btn"
              disabled={inTelegram}
              onClick={() => setFormDialog({ open: true, mode: 'create', card: null })}
            >
              <Plus className="h-4 w-4" />
              <span>{t('cards.create')}</span>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              data-testid="cards-search-input"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder={t('cards.searchPlaceholder')}
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
                onClick={() => updateSearch({ origin })}
              >
                {t(`cards.origin.${origin}` as MessageKey)} ({originCounts[origin]})
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant={!activeCategory ? 'primary' : 'outline'}
              data-testid="cards-category-all"
              onClick={() => updateSearch({ category: undefined })}
            >
              {t('taxonomy.categoryAll')}
            </Button>
            {CATALOG_CATEGORIES.map((category) => (
              <Button
                key={category}
                size="sm"
                variant={activeCategory === category ? 'primary' : 'outline'}
                data-testid={`cards-category-${category}`}
                onClick={() => updateSearch({ category })}
              >
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
          <CardContent className="py-10 text-center text-sm text-text-muted" data-testid="cards-empty">
            {t('cards.empty')}
          </CardContent>
        </Card>
      ) : (
        <div data-testid="cards-list" className="grid gap-3 md:grid-cols-2">
          {filteredCards.map((card) => {
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
                    <span className="truncate font-medium text-text" data-testid={`card-default-route-${card.id}`}>
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
