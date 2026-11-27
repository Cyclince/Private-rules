import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  ChevronDown,
  Copy,
  FileUp,
  FolderOpen,
  Layers,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { PublicationWithLinks } from '../../server/routes/publications';
import { CARD_TO_SCENARIO_ID } from '../../shared/scenarios';
import type { WizardScenarioId } from '../../shared/schemas/quick-create';
import type { TemplateRecord } from '../../shared/schemas/template';
import { SectionSubNav } from '../components/layout/SectionSubNav';
import { ActionMenu } from '../components/ui/action-menu';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { Input } from '../components/ui/input';
import { loadPageTranslations, useI18n, type MessageKey } from '../i18n';
import { api, formatApiError, readApiJson } from '../lib/api';
import { isTelegramSession, requireAuthBeforeLoad } from '../lib/auth-guard';
import {
  authMeQueryOptions,
  invalidatePublications,
  invalidateTemplates,
  publicationsListQueryOptions,
  rulesetsListQueryOptions,
  templatesListQueryOptions,
} from '../lib/query';
import { useToast } from '../lib/toast';

const TemplateImportWizardDialog = lazy(() =>
  import('../components/templates/TemplateImportWizardDialog').then((m) => ({ default: m.TemplateImportWizardDialog })),
);
const DeleteConfirmDialog = lazy(() =>
  import('../components/rulesets/DeleteConfirmDialog').then((m) => ({ default: m.DeleteConfirmDialog })),
);

type TemplatesSearch = {
  q?: string;
};

export const Route = createFileRoute('/templates/')({
  validateSearch: (search: Record<string, unknown>): TemplatesSearch => {
    const q = typeof search.q === 'string' && search.q ? search.q : undefined;
    return q ? { q } : {};
  },
  beforeLoad: async ({ context, location }) => {
    await Promise.all([requireAuthBeforeLoad(context.queryClient, location.href), loadPageTranslations()]);
  },
  component: TemplatesListPage,
});

function scenarioLabelKey(id: WizardScenarioId): MessageKey {
  return `wizard.scenario.${id}` as MessageKey;
}

type TemplateCardLinkItem = {
  key: string;
  label: string;
  url: string;
};

type AirportStatusInfo = {
  kind: 'ok' | 'bound' | 'error' | 'empty';
  nodeCount?: number;
};

function deriveAirportStatus(tpl: TemplateRecord, pubs: readonly PublicationWithLinks[]): AirportStatusInfo {
  const bindings = pubs.flatMap((pub) => pub.bindings);
  if (bindings.length > 0) {
    const okBinding = bindings.find((b) => b.lastStatus === 'ok' && typeof b.lastNodeCount === 'number');
    if (okBinding && typeof okBinding.lastNodeCount === 'number') {
      return { kind: 'ok', nodeCount: okBinding.lastNodeCount };
    }
    const errBinding = bindings.find((b) => b.needsRebind || (b.lastStatus && b.lastStatus !== 'ok'));
    if (errBinding) {
      return { kind: 'error' };
    }
    const summary = tpl.baseBody.wizardMeta?.previewSummary;
    if (summary) {
      if (summary.status === 'error') return { kind: 'error' };
      return { kind: 'ok', nodeCount: summary.nodeCount };
    }
    return { kind: 'bound' };
  }
  return { kind: 'empty' };
}

function deriveClientDisplayText(tpl: TemplateRecord, pubs: readonly PublicationWithLinks[]): string | null {
  const wizardMeta = tpl.baseBody.wizardMeta;
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const pub of pubs) {
    for (const link of pub.links) {
      const display = wizardMeta?.clientLabels?.[link.client] ?? link.label;
      if (seen.has(display)) continue;
      seen.add(display);
      labels.push(display);
    }
  }
  if (labels.length > 0) {
    return labels.join(' · ');
  }
  if (wizardMeta?.clientDisplayNames && wizardMeta.clientDisplayNames.length > 0) {
    return wizardMeta.clientDisplayNames.join(' · ');
  }
  return null;
}

function deriveTemplateCopyLinks(tpl: TemplateRecord, pubs: readonly PublicationWithLinks[]): TemplateCardLinkItem[] {
  const wizardMeta = tpl.baseBody.wizardMeta;
  const items: TemplateCardLinkItem[] = [];
  const seenUrls = new Set<string>();
  for (const pub of pubs) {
    for (const link of pub.links) {
      if (!link.url || seenUrls.has(link.url)) continue;
      seenUrls.add(link.url);
      items.push({
        key: `${pub.id}:${link.client}`,
        label: wizardMeta?.clientLabels?.[link.client] ?? link.label,
        url: link.url,
      });
    }
  }
  return items;
}

function deriveScenarioTags(
  tpl: TemplateRecord,
  rulesetNamesById: ReadonlyMap<string, string>,
  t: (key: MessageKey) => string,
): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  const addTag = (label: string) => {
    if (!label || seen.has(label)) return;
    seen.add(label);
    tags.push(label);
  };

  const wizardMeta = tpl.baseBody.wizardMeta;
  if (wizardMeta?.rulesets) {
    for (const rs of wizardMeta.rulesets) {
      const name = rulesetNamesById.get(rs.rulesetId);
      if (name) addTag(name);
    }
  }

  if (wizardMeta?.scenarios) {
    for (const sc of wizardMeta.scenarios) {
      if (!sc.enabled) continue;
      addTag(t(scenarioLabelKey(sc.id)));
    }
    return tags;
  }

  for (const ref of tpl.baseBody.cards) {
    if (!ref.enabled) continue;
    const scenarioId = CARD_TO_SCENARIO_ID.get(ref.cardId);
    if (scenarioId) {
      addTag(t(scenarioLabelKey(scenarioId)));
    }
  }
  return tags;
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
  const [queryInput, setQueryInput] = useState(searchQ);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TemplateRecord | null>(null);

  useEffect(() => {
    setQueryInput(searchQ);
  }, [searchQ]);

  const listQuery = useQuery({
    ...templatesListQueryOptions({ q: searchQ || undefined, limit: 100 }),
    placeholderData: keepPreviousData,
  });

  const publicationsQuery = useQuery(publicationsListQueryOptions({ limit: 200 }));
  const rulesetsQuery = useQuery(rulesetsListQueryOptions());

  const publicationsByTemplateId = useMemo(() => {
    const map = new Map<string, PublicationWithLinks[]>();
    for (const pub of publicationsQuery.data?.publications ?? []) {
      const list = map.get(pub.templateId) ?? [];
      list.push(pub);
      map.set(pub.templateId, list);
    }
    return map;
  }, [publicationsQuery.data]);

  const rulesetNamesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const cat of rulesetsQuery.data?.data.categories ?? []) {
      map.set(cat.id, cat.name);
    }
    return map;
  }, [rulesetsQuery.data]);

  const duplicateMutation = useMutation({
    mutationFn: async (tpl: TemplateRecord) =>
      readApiJson<{ template: TemplateRecord }>(
        await api.api.templates.$post({
          json: {
            name: `${tpl.name} (${t('templates.copySuffix')})`,
            description: tpl.description,
            baseKind: tpl.baseKind,
            baseSourceUrl: tpl.baseSourceUrl,
            baseBody: tpl.baseBody,
            overlay: tpl.overlay,
            note: `${t('templates.duplicatedFrom')} ${tpl.name}`,
          },
        }),
      ),
    onSuccess: async () => {
      await invalidateTemplates(queryClient);
      notify({ title: t('templates.duplicatedToast'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (templateId: string) =>
      readApiJson<{ deleted: boolean }>(await api.api.templates[':id'].$delete({ param: { id: templateId } })),
    onSuccess: async () => {
      setDeleteTarget(null);
      await Promise.all([invalidateTemplates(queryClient), invalidatePublications(queryClient)]);
      notify({ title: t('templates.deletedToast'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const handleCopyLink = async (url: string) => {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(url);
      notify({ title: t('templates.copiedLinkToast'), variant: 'success' });
    } catch {
      notify({ title: t('subscriptions.copyFailed'), variant: 'danger' });
    }
  };

  const applySearch = () => {
    const nextQ = queryInput.trim() || undefined;
    void routeNavigate({ search: nextQ ? { q: nextQ } : {}, replace: true });
  };

  const templates = listQuery.data?.templates ?? [];
  const ruleTokenConfigured = publicationsQuery.data?.ruleTokenConfigured ?? true;

  return (
    <div className="flex flex-col gap-5" data-testid="templates-page">
      <SectionSubNav section="templates" />

      {/* Header banner per §4.1 */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight text-text">{t('templates.listTitle')}</h1>
          <p className="text-sm text-text-muted">{t('templates.listSubtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!inTelegram ? (
            <Link
              to="/templates/new"
              data-testid="templates-new-btn"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-primary px-3.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
            >
              <Plus className="h-4 w-4" />
              <span>{t('templates.newBtn')}</span>
            </Link>
          ) : null}

          <Link
            to="/templates/scenes"
            data-testid="templates-scenes-btn"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface px-3 text-sm font-medium text-text transition-colors hover:bg-surface-muted"
          >
            <Layers className="h-4 w-4 text-text-muted" />
            <span>{t('templates.scenesBtn')}</span>
          </Link>

          {!inTelegram ? (
            <Button variant="outline" size="md" data-testid="templates-import-btn" onClick={() => setImportOpen(true)}>
              <FileUp className="h-4 w-4" />
              <span>{t('templates.importConfigBtn')}</span>
            </Button>
          ) : null}
        </div>
      </div>

      {inTelegram ? (
        <div
          data-testid="templates-telegram-readonly"
          className="flex items-start gap-2 rounded-[var(--radius-md)] border border-warning bg-surface-muted px-3.5 py-2.5 text-xs text-text"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>{t('templates.listTelegramReadOnly')}</span>
        </div>
      ) : null}

      {/* Search bar (only when there are templates or an active search filter) */}
      {templates.length > 0 || searchQ ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            applySearch();
          }}
        >
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder={t('templates.searchPlaceholderPlain')}
              data-testid="templates-search-input"
              className="pl-8"
            />
          </div>
          <Button type="submit" variant="outline" size="sm">
            {t('common.search')}
          </Button>
          {searchQ ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQueryInput('');
                void routeNavigate({ search: {}, replace: true });
              }}
            >
              {t('common.cancel')}
            </Button>
          ) : null}
        </form>
      ) : null}

      {/* Main list or empty state */}
      {listQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="h-44 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
          <div className="h-44 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
        </div>
      ) : templates.length === 0 ? (
        <EmptyState
          data-testid="templates-empty-state"
          title={t('templates.emptyTitlePlain')}
          description={searchQ ? t('templates.searchPlaceholderPlain') : t('templates.listSubtitle')}
          action={
            !inTelegram ? (
              <div className="flex flex-col items-center gap-3">
                <Link
                  to="/templates/new"
                  data-testid="templates-empty-new-btn"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
                >
                  <Sparkles className="h-4 w-4" />
                  <span>{t('templates.newBtn')}</span>
                </Link>
                <p className="text-xs text-text-muted">
                  {t('templates.emptyCtaHint')}{' '}
                  <button
                    type="button"
                    data-testid="templates-empty-import-btn"
                    onClick={() => setImportOpen(true)}
                    className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {t('templates.emptyCtaImport')}
                  </button>
                </p>
              </div>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {templates.map((tpl) => {
            const pubs = publicationsByTemplateId.get(tpl.id) ?? [];
            const clientDisplay = deriveClientDisplayText(tpl, pubs);
            const airport = deriveAirportStatus(tpl, pubs);
            const copyLinks = deriveTemplateCopyLinks(tpl, pubs);
            const scenarioTags = deriveScenarioTags(tpl, rulesetNamesById, t);
            const visibleTags = scenarioTags.slice(0, 6);
            const extraTagCount = Math.max(0, scenarioTags.length - visibleTags.length);

            return (
              <Card
                key={tpl.id}
                interactive
                data-testid={`template-card-${tpl.id}`}
                className="relative flex flex-col justify-between hover:border-primary/40 focus-within:z-10"
              >
                <CardContent className="flex flex-1 flex-col justify-between gap-4 p-4 sm:p-5">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          to="/templates/$id"
                          params={{ id: tpl.id }}
                          className="block truncate text-base font-semibold text-text hover:text-primary"
                        >
                          {tpl.name}
                        </Link>
                        {tpl.description ? (
                          <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">{tpl.description}</p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-10 shrink-0 text-text-muted">{t('templates.cardOutputLabel')}</span>
                        <span className="truncate font-medium text-text" data-testid={`template-card-output-${tpl.id}`}>
                          {clientDisplay ?? t('templates.cardOutputEmpty')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-10 shrink-0 text-text-muted">{t('templates.cardAirportLabel')}</span>
                        <span data-testid={`template-card-airport-${tpl.id}`}>
                          {airport.kind === 'ok' && typeof airport.nodeCount === 'number' ? (
                            <span className="inline-flex items-center gap-1.5 font-medium text-success">
                              <span className="h-1.5 w-1.5 rounded-full bg-success" />
                              {t('templates.cardAirportNodesOk').replace('{count}', String(airport.nodeCount))}
                            </span>
                          ) : airport.kind === 'bound' ? (
                            <span className="inline-flex items-center gap-1.5 font-medium text-text">
                              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                              {t('templates.cardAirportBound')}
                            </span>
                          ) : airport.kind === 'error' ? (
                            <span className="inline-flex items-center gap-1.5 font-medium text-danger">
                              <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                              {t('templates.cardAirportError')}
                            </span>
                          ) : (
                            <span className="text-text-muted">{t('templates.cardAirportEmpty')}</span>
                          )}
                        </span>
                      </div>
                    </div>

                    {visibleTags.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5" data-testid={`template-card-tags-${tpl.id}`}>
                        {visibleTags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[11px] font-normal">
                            {tag}
                          </Badge>
                        ))}
                        {extraTagCount > 0 ? (
                          <Badge variant="outline" className="text-[11px] font-normal text-text-muted">
                            {t('templates.cardScenariosMore').replace('{count}', String(extraTagCount))}
                          </Badge>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <ActionMenu
                        align="start"
                        trigger={({ open, toggle }) => (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-expanded={open}
                            aria-haspopup="menu"
                            data-testid={`template-copy-links-${tpl.id}`}
                            onClick={toggle}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            <span>{t('templates.copyLinkBtn')}</span>
                            <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
                          </Button>
                        )}
                        items={copyLinks.map((item) => ({
                          key: item.key,
                          label: item.label,
                          icon: <Copy className="h-3.5 w-3.5 text-text-muted" />,
                          testId: `template-copy-item-${tpl.id}-${item.key}`,
                          onSelect: () => {
                            void handleCopyLink(item.url);
                          },
                        }))}
                        emptyContent={
                          <div className="px-2.5 py-2 text-xs text-text-muted">
                            {!ruleTokenConfigured ? t('templates.copyLinkNoToken') : t('templates.copyLinkEmpty')}
                          </div>
                        }
                      />

                      <Link
                        to="/templates/$id"
                        params={{ id: tpl.id }}
                        data-testid={`template-open-${tpl.id}`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        <span>{inTelegram ? t('templates.viewBtn') : t('templates.openBtn')}</span>
                      </Link>
                    </div>

                    {!inTelegram ? (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid={`template-duplicate-${tpl.id}`}
                          disabled={duplicateMutation.isPending}
                          onClick={() => duplicateMutation.mutate(tpl)}
                          aria-label={t('templates.duplicateBtn')}
                          title={t('templates.duplicateBtn')}
                        >
                          <Copy className="h-3.5 w-3.5 text-text-muted" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid={`template-delete-${tpl.id}`}
                          onClick={() => setDeleteTarget(tpl)}
                          aria-label={t('common.delete')}
                          title={t('common.delete')}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {importOpen ? (
        <Suspense fallback={null}>
          <TemplateImportWizardDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            onImported={async (importedTemplate) => {
              setImportOpen(false);
              await invalidateTemplates(queryClient);
              notify({ title: t('templates.importedToast'), variant: 'success' });
              void navigate({ to: '/templates/$id', params: { id: importedTemplate.id } });
            }}
          />
        </Suspense>
      ) : null}

      {deleteTarget ? (
        <Suspense fallback={null}>
          <DeleteConfirmDialog
            open={Boolean(deleteTarget)}
            title={t('templates.deleteConfirmTitle')}
            description={`${deleteTarget.name} — ${t('templates.deleteConfirmBodyPlain')}`}
            submitting={deleteMutation.isPending}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            onConfirm={() => {
              if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
