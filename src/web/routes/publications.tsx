import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { AlertTriangle, Code2, Link2, Lock, Pencil, Plus, Search, Send, ShieldAlert, Trash2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { PublicationWithLinks } from '../../server/routes/publications';
import {
  isTemplateClientSupported,
  TEMPLATE_CLIENT_IDS,
  TEMPLATE_CLIENTS,
  type TemplateClientId,
} from '../../shared/clients';
import { SectionSubNav } from '../components/layout/SectionSubNav';
import type { PublicationSubmitPayload } from '../components/publications/PublicationFormDialog';
import { PublicationLinksCard } from '../components/publications/PublicationLinksCard';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { loadPageTranslations, useI18n, type MessageKey } from '../i18n';
import { api, formatApiError, readApiJson } from '../lib/api';
import { isTelegramSession, requireAuthBeforeLoad } from '../lib/auth-guard';
import { authMeQueryOptions, invalidatePublications, publicationsListQueryOptions } from '../lib/query';
import { useToast } from '../lib/toast';

const PublicationFormDialog = lazy(() =>
  import('../components/publications/PublicationFormDialog').then((m) => ({ default: m.PublicationFormDialog })),
);
const NodeSlotBindingsPanel = lazy(() =>
  import('../components/publications/NodeSlotBindingsPanel').then((m) => ({ default: m.NodeSlotBindingsPanel })),
);
const PublicationPreviewPanel = lazy(() =>
  import('../components/publications/PublicationPreviewPanel').then((m) => ({ default: m.PublicationPreviewPanel })),
);
const DeleteConfirmDialog = lazy(() =>
  import('../components/rulesets/DeleteConfirmDialog').then((m) => ({ default: m.DeleteConfirmDialog })),
);

type DetailTab = 'links' | 'nodes' | 'preview';

type PublicationsSearch = {
  q?: string;
  client?: TemplateClientId;
  selected?: string;
  tab?: DetailTab;
};

const VALID_CLIENTS = new Set<string>(['mihomo', 'stash', 'surge', 'sing-box', 'loon', 'qx', 'shadowrocket']);
const VALID_TABS = new Set<string>(['links', 'nodes', 'preview']);

export const Route = createFileRoute('/publications')({
  validateSearch: (search: Record<string, unknown>): PublicationsSearch => {
    const q = typeof search.q === 'string' && search.q ? search.q : undefined;
    const rawClient = typeof search.client === 'string' ? search.client : undefined;
    const client = rawClient && VALID_CLIENTS.has(rawClient) ? (rawClient as TemplateClientId) : undefined;
    const selected = typeof search.selected === 'string' && search.selected ? search.selected : undefined;
    const rawTab = typeof search.tab === 'string' ? search.tab : undefined;
    const tab = rawTab && VALID_TABS.has(rawTab) && rawTab !== 'links' ? (rawTab as DetailTab) : undefined;
    return {
      ...(q ? { q } : {}),
      ...(client ? { client } : {}),
      ...(selected ? { selected } : {}),
      ...(tab ? { tab } : {}),
    };
  },
  beforeLoad: async ({ context, location }) => {
    await Promise.all([requireAuthBeforeLoad(context.queryClient, location.href), loadPageTranslations()]);
  },
  component: PublicationsPage,
});

function accessBadgeVariant(access: PublicationWithLinks['access']): 'primary' | 'success' | 'outline' {
  if (access === 'token') return 'primary';
  if (access === 'public') return 'success';
  return 'outline';
}

function PublicationsPage() {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const rawSearch = Route.useSearch();
  const navigate = Route.useNavigate();

  const authQuery = useQuery(authMeQueryOptions());
  const inTelegram = isTelegramSession(authQuery.data);

  const searchQ = rawSearch.q ?? '';
  const activeClient = rawSearch.client;
  const activeTab: DetailTab = rawSearch.tab ?? 'links';

  const [queryInput, setQueryInput] = useState(searchQ);
  const [formDialog, setFormDialog] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    publication: PublicationWithLinks | null;
  }>({ open: false, mode: 'create', publication: null });
  const [deleteTarget, setDeleteTarget] = useState<PublicationWithLinks | null>(null);

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

  const listQuery = useQuery({
    ...publicationsListQueryOptions({ limit: 100 }),
    placeholderData: keepPreviousData,
  });

  const allPublications = useMemo(() => listQuery.data?.publications ?? [], [listQuery.data]);
  const sessionSecretConfigured =
    listQuery.data?.sessionSecretConfigured ?? authQuery.data?.sessionSecretConfigured ?? true;
  const ruleTokenConfigured = listQuery.data?.ruleTokenConfigured ?? authQuery.data?.ruleTokenConfigured ?? false;

  const filteredPublications = useMemo(() => {
    const needle = searchQ.trim().toLowerCase();
    return allPublications.filter((pub) => {
      if (activeClient && !pub.clients.includes(activeClient)) return false;
      if (needle) {
        const haystacks = [pub.slug, pub.templateName, pub.templateSlug];
        if (!haystacks.some((field) => field.toLowerCase().includes(needle))) return false;
      }
      return true;
    });
  }, [allPublications, activeClient, searchQ]);

  const selectedPublication: PublicationWithLinks | null = useMemo(() => {
    if (rawSearch.selected) {
      const exact = allPublications.find((item) => item.id === rawSearch.selected);
      if (exact) return exact;
    }
    return filteredPublications[0] ?? allPublications[0] ?? null;
  }, [allPublications, filteredPublications, rawSearch.selected]);

  const updateSearch = (patch: Partial<PublicationsSearch>) => {
    void navigate({
      search: (prev) => ({ ...prev, ...patch }),
      replace: true,
    });
  };

  const createMutation = useMutation({
    mutationFn: async (payload: PublicationSubmitPayload) =>
      readApiJson<{ publication: PublicationWithLinks }>(
        await api.api.publications.$post({
          json: {
            slug: payload.slug,
            templateId: payload.templateId,
            ...(payload.pinnedVersion ? { pinnedVersion: payload.pinnedVersion } : {}),
            clients: payload.clients,
            access: payload.access,
            ...(payload.output ? { output: payload.output } : {}),
          },
        }),
      ),
    onSuccess: async ({ publication }) => {
      setFormDialog({ open: false, mode: 'create', publication: null });
      await invalidatePublications(queryClient, publication.id);
      updateSearch({ selected: publication.id });
      notify({ title: t('publications.createdToast'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: PublicationSubmitPayload }) =>
      readApiJson<{ publication: PublicationWithLinks }>(
        await api.api.publications[':id'].$patch({
          param: { id },
          json: {
            slug: payload.slug,
            templateId: payload.templateId,
            pinnedVersion: payload.pinnedVersion,
            clients: payload.clients,
            access: payload.access,
            output: payload.output,
          },
        }),
      ),
    onSuccess: async ({ publication }) => {
      setFormDialog({ open: false, mode: 'edit', publication: null });
      await invalidatePublications(queryClient, publication.id);
      notify({ title: t('publications.updatedToast'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      readApiJson<{ deletedId: string }>(await api.api.publications[':id'].$delete({ param: { id } })),
    onSuccess: async ({ deletedId }) => {
      setDeleteTarget(null);
      if (rawSearch.selected === deletedId) updateSearch({ selected: undefined });
      await invalidatePublications(queryClient, deletedId);
      notify({ title: t('publications.deletedToast'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  return (
    <div data-testid="publications-page" className="flex flex-col gap-4">
      <SectionSubNav section="templates" />

      {inTelegram ? (
        <div
          data-testid="publications-telegram-readonly"
          className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-warning/50 bg-surface-muted px-3.5 py-2.5 text-xs text-text"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>{t('taxonomy.telegramReadOnly')}</span>
        </div>
      ) : null}

      {!sessionSecretConfigured ? (
        <div
          data-testid="publications-session-secret-banner"
          role="alert"
          className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-danger/50 bg-danger/10 px-3.5 py-3 text-xs"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold text-text">{t('publications.sessionSecretMissingTitle')}</span>
            <p className="text-text-muted">{t('publications.sessionSecretMissingDesc')}</p>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>{t('publications.title')}</CardTitle>
              <CardDescription>{t('publications.subtitle')}</CardDescription>
            </div>
            <Button
              size="sm"
              data-testid="publications-create-btn"
              disabled={inTelegram}
              onClick={() => setFormDialog({ open: true, mode: 'create', publication: null })}
            >
              <Plus className="h-4 w-4" />
              <span>{t('publications.create')}</span>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              data-testid="publications-search-input"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder={t('publications.searchPlaceholder')}
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant={!activeClient ? 'primary' : 'outline'}
              data-testid="publications-client-all"
              onClick={() => updateSearch({ client: undefined })}
            >
              {t('publications.clientAll')}
            </Button>
            {TEMPLATE_CLIENT_IDS.map((clientId) => {
              const supported = isTemplateClientSupported(clientId);
              return (
                <Button
                  key={clientId}
                  size="sm"
                  variant={activeClient === clientId ? 'primary' : 'outline'}
                  data-testid={`publications-client-${clientId}`}
                  onClick={() => updateSearch({ client: clientId })}
                >
                  <span>{TEMPLATE_CLIENTS[clientId].label}</span>
                  {!supported ? (
                    <Badge variant="outline" className="ml-1 px-1.5 py-0 text-[10px]">
                      {t('taxonomy.clientComingSoon')}
                    </Badge>
                  ) : null}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-2.5 lg:col-span-4" data-testid="publications-list">
          {listQuery.isLoading ? (
            <>
              <div className="h-24 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
              <div className="h-24 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
            </>
          ) : filteredPublications.length === 0 ? (
            <Card>
              <CardContent
                className="flex flex-col items-center gap-2 py-8 text-center"
                data-testid="publications-empty"
              >
                <Send className="h-6 w-6 text-text-muted" />
                <div className="text-sm font-medium text-text">{t('publications.emptyList')}</div>
                <p className="text-xs text-text-muted">{t('publications.emptyListHint')}</p>
              </CardContent>
            </Card>
          ) : (
            filteredPublications.map((pub) => {
              const isSelected = selectedPublication?.id === pub.id;
              return (
                <button
                  key={pub.id}
                  type="button"
                  data-testid={`publication-item-${pub.id}`}
                  onClick={() => updateSearch({ selected: pub.id })}
                  className={`flex w-full cursor-pointer flex-col gap-2 rounded-[var(--radius-lg)] border p-3.5 text-left transition-colors ${
                    isSelected
                      ? 'border-primary bg-surface shadow-sm ring-1 ring-primary/30'
                      : 'border-border bg-surface hover:bg-surface-muted/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm font-semibold text-text">{pub.slug}</div>
                      <div className="truncate text-xs text-text-muted">
                        {pub.templateName} · v{pub.effectiveVersion}
                        {pub.pinnedVersion ? ` (${t('publications.versionPinned')})` : ''}
                      </div>
                    </div>
                    <Badge variant={accessBadgeVariant(pub.access)}>
                      {t(`publications.access.${pub.access}` as MessageKey)}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    <Badge variant="outline">{pub.effectiveOutput}</Badge>
                    {pub.bindings.length > 0 ? (
                      <Badge variant="accent">
                        {pub.bindings.length} {t('publications.boundSlotsBadge')}
                      </Badge>
                    ) : null}
                    {pub.clients.map((clientId) => (
                      <Badge key={clientId} variant="outline">
                        {TEMPLATE_CLIENTS[clientId].label}
                        {!isTemplateClientSupported(clientId) ? ` · ${t('taxonomy.clientComingSoon')}` : ''}
                      </Badge>
                    ))}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="min-w-0 lg:col-span-8">
          {!selectedPublication ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-text-muted">
                {t('publications.noneSelected')}
              </CardContent>
            </Card>
          ) : (
            <Card data-testid="publication-detail-card">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="truncate font-mono">{selectedPublication.slug}</CardTitle>
                      <Badge variant={accessBadgeVariant(selectedPublication.access)}>
                        {t(`publications.access.${selectedPublication.access}` as MessageKey)}
                      </Badge>
                      <Badge variant="outline">{selectedPublication.effectiveOutput}</Badge>
                    </div>
                    <CardDescription className="mt-1">
                      {selectedPublication.templateName} · v{selectedPublication.effectiveVersion}
                      {selectedPublication.pinnedVersion
                        ? ` (${t('publications.versionPinned')})`
                        : ` (${t('publications.versionLatest')})`}
                    </CardDescription>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={inTelegram}
                      data-testid="publication-edit-btn"
                      onClick={() => setFormDialog({ open: true, mode: 'edit', publication: selectedPublication })}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      <span>{t('common.edit')}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={inTelegram}
                      data-testid="publication-delete-btn"
                      onClick={() => setDeleteTarget(selectedPublication)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>{t('common.delete')}</span>
                    </Button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                  <Button
                    size="sm"
                    variant={activeTab === 'links' ? 'primary' : 'outline'}
                    data-testid="publication-tab-links"
                    onClick={() => updateSearch({ tab: undefined })}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    <span>{t('publications.tabLinks')}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant={activeTab === 'nodes' ? 'primary' : 'outline'}
                    data-testid="publication-tab-nodes"
                    onClick={() => updateSearch({ tab: 'nodes' })}
                  >
                    <Lock className="h-3.5 w-3.5" />
                    <span>
                      {t('publications.tabNodes')} ({selectedPublication.bindings.length}/
                      {selectedPublication.slots.length})
                    </span>
                  </Button>
                  <Button
                    size="sm"
                    variant={activeTab === 'preview' ? 'primary' : 'outline'}
                    data-testid="publication-tab-preview"
                    onClick={() => updateSearch({ tab: 'preview' })}
                  >
                    <Code2 className="h-3.5 w-3.5" />
                    <span>{t('publications.tabPreview')}</span>
                  </Button>
                </div>
              </CardHeader>

              <CardContent>
                {activeTab === 'links' ? (
                  <PublicationLinksCard publication={selectedPublication} ruleTokenConfigured={ruleTokenConfigured} />
                ) : activeTab === 'nodes' ? (
                  <Suspense
                    fallback={<div className="h-40 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />}
                  >
                    <NodeSlotBindingsPanel
                      publication={selectedPublication}
                      readOnly={inTelegram}
                      onChanged={async () => {
                        await invalidatePublications(queryClient, selectedPublication.id);
                      }}
                    />
                  </Suspense>
                ) : (
                  <Suspense
                    fallback={<div className="h-64 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />}
                  >
                    <PublicationPreviewPanel publication={selectedPublication} />
                  </Suspense>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {formDialog.open ? (
        <Suspense fallback={null}>
          <PublicationFormDialog
            open={formDialog.open}
            mode={formDialog.mode}
            initial={formDialog.publication}
            readOnly={inTelegram}
            submitting={createMutation.isPending || updateMutation.isPending}
            onOpenChange={(open) => setFormDialog((prev) => ({ ...prev, open }))}
            onSubmit={async (payload) => {
              if (formDialog.mode === 'create') {
                await createMutation.mutateAsync(payload);
              } else if (formDialog.publication) {
                await updateMutation.mutateAsync({ id: formDialog.publication.id, payload });
              }
            }}
          />
        </Suspense>
      ) : null}

      {deleteTarget ? (
        <Suspense fallback={null}>
          <DeleteConfirmDialog
            open={Boolean(deleteTarget)}
            title={t('publications.deleteConfirmTitle')}
            description={t('publications.deleteConfirmBody')}
            itemName={`${deleteTarget.slug} (${deleteTarget.templateName})`}
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
