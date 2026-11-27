import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { AlertTriangle, Copy, FileUp, Layers, Pencil, Plus, Search, ShieldAlert, Sparkles, Trash2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { StarterTemplateTier } from '../../builtin';
import type { OutputProfile } from '../../shared/clients';
import type { TemplateGroupMode, TemplateRecord } from '../../shared/schemas/template';
import { SectionSubNav } from '../components/layout/SectionSubNav';
import type { CreateTemplateSubmitPayload } from '../components/templates/CreateTemplateDialog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { Input } from '../components/ui/input';
import { loadPageTranslations, useI18n } from '../i18n';
import { api, formatApiError, readApiJson } from '../lib/api';
import { isTelegramSession, requireAuthBeforeLoad } from '../lib/auth-guard';
import { authMeQueryOptions, invalidateTemplates, templatesListQueryOptions } from '../lib/query';
import { useToast } from '../lib/toast';

const CreateTemplateDialog = lazy(() =>
  import('../components/templates/CreateTemplateDialog').then((m) => ({ default: m.CreateTemplateDialog })),
);
const TemplateImportWizardDialog = lazy(() =>
  import('../components/templates/TemplateImportWizardDialog').then((m) => ({ default: m.TemplateImportWizardDialog })),
);
const DeleteConfirmDialog = lazy(() =>
  import('../components/rulesets/DeleteConfirmDialog').then((m) => ({ default: m.DeleteConfirmDialog })),
);

type TemplateTierFilter = 'all' | 'minimal' | 'light' | 'standard' | 'heavy';

type TemplatesSearch = {
  q?: string;
  tier?: TemplateTierFilter;
};

const VALID_TIERS = new Set<string>(['all', 'minimal', 'light', 'standard', 'heavy']);

export const Route = createFileRoute('/templates/')({
  validateSearch: (search: Record<string, unknown>): TemplatesSearch => {
    const q = typeof search.q === 'string' && search.q ? search.q : undefined;
    const rawTier = typeof search.tier === 'string' ? search.tier : undefined;
    const tier = rawTier && VALID_TIERS.has(rawTier) && rawTier !== 'all' ? (rawTier as TemplateTierFilter) : undefined;
    return {
      ...(q ? { q } : {}),
      ...(tier ? { tier } : {}),
    };
  },
  beforeLoad: async ({ context, location }) => {
    await Promise.all([requireAuthBeforeLoad(context.queryClient, location.href), loadPageTranslations()]);
  },
  component: TemplatesListPage,
});

function tierFromStarterId(starterId: string): StarterTemplateTier {
  if (starterId.includes('minimal')) return 'minimal';
  if (starterId.includes('light')) return 'light';
  if (starterId.includes('heavy')) return 'heavy';
  return 'standard';
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : iso;
}

function TemplatesListPage() {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const routeNavigate = Route.useNavigate();
  const search = Route.useSearch();

  const authQuery = useQuery(authMeQueryOptions());
  const inTelegram = isTelegramSession(authQuery.data);

  const searchQ = search.q ?? '';
  const tierFilter: TemplateTierFilter = search.tier ?? 'all';
  const [queryInput, setQueryInput] = useState(searchQ);
  const [starterGroupMode, setStarterGroupMode] = useState<TemplateGroupMode>('select');
  const [starterOutput, setStarterOutput] = useState<OutputProfile>('full');

  const [createDialog, setCreateDialog] = useState<{ open: boolean; tier: StarterTemplateTier | null }>({
    open: false,
    tier: null,
  });
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TemplateRecord | null>(null);

  useEffect(() => {
    setQueryInput(searchQ);
  }, [searchQ]);

  const listQuery = useQuery({
    ...templatesListQueryOptions({ q: searchQ || undefined, limit: 100 }),
    placeholderData: keepPreviousData,
  });

  const updateSearch = (patch: Partial<TemplatesSearch>) => {
    const next: TemplatesSearch = {
      ...search,
      ...patch,
    };
    if (!next.q) delete next.q;
    if (!next.tier || next.tier === 'all') delete next.tier;
    void routeNavigate({ search: next, replace: true });
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (queryInput !== searchQ) {
        updateSearch({ q: queryInput.trim() || undefined });
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  const createMutation = useMutation({
    mutationFn: async (payload: CreateTemplateSubmitPayload) => {
      const res = await api.api.templates.$post({ json: payload });
      return readApiJson<{ template: TemplateRecord }>(res);
    },
    onSuccess: async (data) => {
      await invalidateTemplates(queryClient);
      setCreateDialog({ open: false, tier: null });
      notify({ title: t('templates.createdToast'), variant: 'success' });
      await navigate({ to: '/templates/$id', params: { id: data.template.id } });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (source: TemplateRecord) => {
      const res = await api.api.templates.$post({
        json: {
          name: `${source.name} (${t('templates.copySuffix')})`,
          description: source.description,
          baseKind: source.baseKind,
          ...(source.baseSourceUrl ? { baseSourceUrl: source.baseSourceUrl } : {}),
          baseBody: source.baseBody,
          overlay: source.overlay,
          note: `${t('templates.duplicatedFrom')} ${source.name}`,
        },
      });
      return readApiJson<{ template: TemplateRecord }>(res);
    },
    onSuccess: async () => {
      await invalidateTemplates(queryClient);
      notify({ title: t('templates.duplicatedToast'), variant: 'success' });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.api.templates[':id'].$delete({ param: { id } });
      return readApiJson<{ deletedId: string }>(res);
    },
    onSuccess: async () => {
      await invalidateTemplates(queryClient);
      setDeleteTarget(null);
      notify({ title: t('templates.deletedToast'), variant: 'success' });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const templates = listQuery.data?.templates ?? [];
  const starters = listQuery.data?.starters ?? [];
  const filteredStarters =
    tierFilter === 'all' ? starters : starters.filter((item) => tierFromStarterId(item.id) === tierFilter);

  return (
    <div data-testid="templates-page" className="flex flex-col gap-4">
      <SectionSubNav section="templates" />

      {inTelegram ? (
        <div
          data-testid="templates-telegram-readonly"
          className="flex items-start gap-2 rounded-[var(--radius-md)] border border-warning bg-surface px-3.5 py-2.5 text-xs text-text"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>{t('templates.telegramReadOnlyNotice')}</span>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-primary" />
                <span>{t('templates.title')}</span>
              </CardTitle>
              <CardDescription>{t('templates.subtitle')}</CardDescription>
            </div>
            {!inTelegram ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="templates-import-btn"
                  onClick={() => setImportOpen(true)}
                >
                  <FileUp className="h-3.5 w-3.5" />
                  <span>{t('templates.importBtn')}</span>
                </Button>
                <Button
                  size="sm"
                  data-testid="templates-create-blank-btn"
                  onClick={() => setCreateDialog({ open: true, tier: null })}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{t('templates.createBlankBtn')}</span>
                </Button>
              </div>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <Input
                data-testid="templates-search-input"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder={t('templates.searchPlaceholder')}
                className="pl-9"
              />
            </div>
            <Badge variant="outline">
              {templates.length} {t('templates.savedCountSuffix')}
            </Badge>
          </div>

          {listQuery.isLoading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="h-32 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
              <div className="h-32 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
            </div>
          ) : templates.length === 0 ? (
            <EmptyState
              data-testid="templates-empty"
              title={t('templates.emptyTitle')}
              description={t('templates.emptyHint')}
              action={
                !inTelegram && !searchQ ? (
                  <Button size="sm" onClick={() => setCreateDialog({ open: true, tier: null })}>
                    <Plus className="h-3.5 w-3.5" />
                    <span>{t('templates.createBlankBtn')}</span>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div data-testid="templates-list" className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  data-testid={`template-card-${tpl.id}`}
                  className="flex flex-col justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-surface-muted/40 p-4 transition-colors hover:bg-surface-muted/70"
                >
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          to="/templates/$id"
                          params={{ id: tpl.id }}
                          className="block truncate text-sm font-semibold text-text hover:text-primary"
                        >
                          {tpl.name}
                        </Link>
                        <div className="truncate font-mono text-xs text-text-muted">{tpl.slug}</div>
                      </div>
                      <Badge variant="primary">v{tpl.currentVersion}</Badge>
                    </div>
                    {tpl.description ? <p className="line-clamp-2 text-xs text-text-muted">{tpl.description}</p> : null}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">{tpl.baseKind}</Badge>
                      <Badge variant="outline">
                        {tpl.baseBody.cards.length} {t('templates.cardsCountSuffix')}
                      </Badge>
                      <Badge variant="outline">{tpl.baseBody.groupMode}</Badge>
                      <Badge variant="outline">{tpl.baseBody.output}</Badge>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5">
                    <span className="text-[11px] text-text-muted">{formatDate(tpl.updatedAt)}</span>
                    <div className="flex items-center gap-1.5">
                      <Link
                        to="/templates/$id"
                        params={{ id: tpl.id }}
                        data-testid={`template-open-${tpl.id}`}
                        className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:opacity-95"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span>{inTelegram ? t('cards.view') : t('templates.openEditor')}</span>
                      </Link>
                      {!inTelegram ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`template-duplicate-${tpl.id}`}
                            disabled={duplicateMutation.isPending}
                            onClick={() => duplicateMutation.mutate(tpl)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            <span>{t('templates.duplicateBtn')}</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`template-delete-${tpl.id}`}
                            onClick={() => setDeleteTarget(tpl)}
                            aria-label={t('common.delete')}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-danger" />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" />
                <span>{t('templates.startersTitle')}</span>
              </CardTitle>
              <CardDescription>{t('templates.startersSubtitle')}</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-border bg-bg p-0.5">
                {(['select', 'fallback'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    data-testid={`starter-mode-${mode}`}
                    onClick={() => setStarterGroupMode(mode)}
                    className={`cursor-pointer rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium transition-colors ${
                      starterGroupMode === mode
                        ? 'bg-primary text-primary-foreground'
                        : 'text-text-muted hover:text-text'
                    }`}
                  >
                    {mode === 'select' ? t('templates.groupModeSelect') : t('templates.groupModeFallback')}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-border bg-bg p-0.5">
                {(['full', 'minimal'] as const).map((out) => (
                  <button
                    key={out}
                    type="button"
                    data-testid={`starter-output-${out}`}
                    onClick={() => setStarterOutput(out)}
                    className={`cursor-pointer rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium transition-colors ${
                      starterOutput === out ? 'bg-primary text-primary-foreground' : 'text-text-muted hover:text-text'
                    }`}
                  >
                    {out}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {starterGroupMode === 'fallback' ? (
            <div
              data-testid="starter-fallback-warning"
              className="flex items-start gap-2 rounded-[var(--radius-md)] border border-warning bg-surface-muted px-3 py-2 text-xs text-text"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>{t('templates.fallbackModeWarning')}</span>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-1.5">
            {(['all', 'minimal', 'light', 'standard', 'heavy'] as const).map((item) => (
              <Button
                key={item}
                size="sm"
                data-testid={`templates-tier-filter-${item}`}
                variant={tierFilter === item ? 'primary' : 'outline'}
                onClick={() => updateSearch({ tier: item })}
              >
                {item === 'all'
                  ? t('templates.tierAll')
                  : item === 'minimal'
                    ? t('templates.tierMinimal')
                    : item === 'light'
                      ? t('templates.tierLight')
                      : item === 'standard'
                        ? t('templates.tierStandard')
                        : t('templates.tierHeavy')}
              </Button>
            ))}
          </div>

          <div data-testid="starter-templates-grid" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {filteredStarters.map((starter) => {
              const tier = tierFromStarterId(starter.id);
              return (
                <div
                  key={starter.id}
                  data-testid={`starter-card-${tier}`}
                  className="flex flex-col justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-bg p-3.5"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-text">{starter.name}</span>
                      <Badge variant={tier === 'standard' ? 'accent' : 'outline'}>
                        {starter.baseBody.cards.length} {t('templates.cardsCountSuffix')}
                      </Badge>
                    </div>
                    <p className="text-xs text-text-muted">{starter.description}</p>
                  </div>
                  {!inTelegram ? (
                    <Button
                      size="sm"
                      variant={tier === 'standard' ? 'primary' : 'outline'}
                      data-testid={`starter-use-${tier}`}
                      disabled={createMutation.isPending}
                      onClick={() =>
                        createMutation.mutate({
                          starterTier: tier,
                          groupMode: starterGroupMode,
                          output: starterOutput,
                        })
                      }
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>{t('templates.useStarterBtn')}</span>
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {createDialog.open ? (
        <Suspense fallback={null}>
          <CreateTemplateDialog
            open={createDialog.open}
            initialTier={createDialog.tier}
            readOnly={inTelegram}
            submitting={createMutation.isPending}
            onOpenChange={(open) => setCreateDialog((prev) => ({ ...prev, open }))}
            onSubmit={async (payload) => {
              await createMutation.mutateAsync(payload);
            }}
          />
        </Suspense>
      ) : null}

      {importOpen ? (
        <Suspense fallback={null}>
          <TemplateImportWizardDialog
            open={importOpen}
            readOnly={inTelegram}
            onOpenChange={setImportOpen}
            onImported={async (template) => {
              await invalidateTemplates(queryClient);
              notify({ title: t('templates.importedToast'), variant: 'success' });
              await navigate({ to: '/templates/$id', params: { id: template.id } });
            }}
          />
        </Suspense>
      ) : null}

      {deleteTarget ? (
        <Suspense fallback={null}>
          <DeleteConfirmDialog
            open={Boolean(deleteTarget)}
            title={t('templates.deleteConfirmTitle')}
            description={t('templates.deleteConfirmBody')}
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
