import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Blocks,
  Code2,
  History,
  Layers,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { lintTemplate } from '../../../domain/templates/lint';
import type { AppCard, CatalogEntry } from '../../../shared/schemas/card';
import type {
  TemplateBody,
  TemplateOverlay,
  TemplateOverlayOp,
  TemplateRecord,
} from '../../../shared/schemas/template';
import { useI18n } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { isTelegramSession } from '../../lib/auth-guard';
import {
  authMeQueryOptions,
  cardsListQueryOptions,
  catalogListQueryOptions,
  invalidateTemplates,
  templateDetailQueryOptions,
  templateVersionsQueryOptions,
} from '../../lib/query';
import {
  deleteTemplateDraft,
  isDraftDifferentFromServer,
  loadTemplateDraft,
  saveTemplateDraft,
  type TemplateDraftRecord,
} from '../../lib/template-drafts';
import { useToast } from '../../lib/toast';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { TemplateCanvas, type EditorCenterTab } from './TemplateCanvas';
import { TemplateCatalogSidebar } from './TemplateCatalogSidebar';
import { TemplateLintPanel } from './TemplateLintPanel';
import { appendOverlayOp, buildAddCardOp, resolveDraftBody } from './template-editor-helpers';

const TemplatePreviewPanel = lazy(() =>
  import('./TemplatePreviewPanel').then((m) => ({ default: m.TemplatePreviewPanel })),
);
const TemplateProbePanel = lazy(() => import('./TemplateProbePanel').then((m) => ({ default: m.TemplateProbePanel })));
const TemplateVersionsPanel = lazy(() =>
  import('./TemplateVersionsPanel').then((m) => ({ default: m.TemplateVersionsPanel })),
);

export type EditorMobileStep = 'catalog' | 'editor' | 'inspect';
export type EditorRightPanelTab = 'lint' | 'probe' | 'preview' | 'versions';

type TemplateAdvancedEditorProps = {
  templateId: string;
  activeStep: EditorMobileStep;
  activeTab: EditorCenterTab;
  activePanel: EditorRightPanelTab;
  onUpdateSearch: (patch: {
    step?: EditorMobileStep;
    editorTab?: EditorCenterTab;
    panel?: EditorRightPanelTab;
  }) => void;
};

/**
 * Full beta.1 3-column template editor (dnd-kit canvas, linter, probe, CodeMirror preview,
 * versions & rebase). Lazily loaded only when the user enables "高级编辑".
 */
export function TemplateAdvancedEditor({
  templateId,
  activeStep,
  activeTab,
  activePanel,
  onUpdateSearch,
}: TemplateAdvancedEditorProps) {
  const queryClient = useQueryClient();
  const { t, locale } = useI18n();
  const { notify } = useToast();

  const authQuery = useQuery(authMeQueryOptions());
  const inTelegram = isTelegramSession(authQuery.data);

  const detailQuery = useQuery(templateDetailQueryOptions(templateId));
  const versionsQuery = useQuery(templateVersionsQueryOptions(templateId));
  const cardsQuery = useQuery(cardsListQueryOptions({ limit: 200 }));
  const catalogQuery = useQuery(catalogListQueryOptions({ limit: 200 }));

  const hydratedKeyRef = useRef<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [baseBody, setBaseBody] = useState<TemplateBody | null>(null);
  const [overlay, setOverlay] = useState<TemplateOverlay>([]);
  const [baselineBody, setBaselineBody] = useState<TemplateBody | null>(null);
  const [versionNote, setVersionNote] = useState('');
  const [showMeta, setShowMeta] = useState(false);

  const [recoverableDraft, setRecoverableDraft] = useState<TemplateDraftRecord | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const skipNextAutoSaveRef = useRef(true);

  const serverTemplate = detailQuery.data?.template;
  const serverResolvedBody = detailQuery.data?.resolvedBody;

  useEffect(() => {
    if (!serverTemplate || !serverResolvedBody) return;
    const key = `${serverTemplate.id}:${serverTemplate.currentVersion}:${serverTemplate.updatedAt}`;
    if (hydratedKeyRef.current === key) return;

    hydratedKeyRef.current = key;
    skipNextAutoSaveRef.current = true;
    setName(serverTemplate.name);
    setSlug(serverTemplate.slug);
    setDescription(serverTemplate.description);
    setBaseBody(serverTemplate.baseBody);
    setOverlay(serverTemplate.overlay);
    setBaselineBody(serverResolvedBody);
    setVersionNote('');
    setDraftSavedAt(null);

    let cancelled = false;
    void loadTemplateDraft(serverTemplate.id).then((savedDraft) => {
      if (cancelled) return;
      if (savedDraft && isDraftDifferentFromServer(savedDraft, serverTemplate)) {
        setRecoverableDraft(savedDraft);
      } else {
        setRecoverableDraft(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [serverResolvedBody, serverTemplate]);

  const resolvedBody = useMemo(() => {
    if (!baseBody) return null;
    return resolveDraftBody(baseBody, overlay);
  }, [baseBody, overlay]);

  const isDirty = useMemo(() => {
    if (!serverTemplate || !baseBody) return false;
    return isDraftDifferentFromServer(
      {
        templateId: serverTemplate.id,
        baseVersion: serverTemplate.currentVersion,
        updatedAt: '',
        name,
        slug,
        description,
        baseBody,
        overlay,
        note: versionNote,
      },
      serverTemplate,
    );
  }, [baseBody, description, name, overlay, serverTemplate, slug, versionNote]);

  useEffect(() => {
    if (!serverTemplate || !baseBody || inTelegram) return;
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      if (!isDirty) {
        if (draftSavedAt !== null) {
          void deleteTemplateDraft(serverTemplate.id);
          setDraftSavedAt(null);
        }
        return;
      }
      const nowIso = new Date().toISOString();
      void saveTemplateDraft({
        templateId: serverTemplate.id,
        baseVersion: serverTemplate.currentVersion,
        updatedAt: nowIso,
        name,
        slug,
        description,
        baseBody,
        overlay,
        note: versionNote,
      }).then(() => {
        setDraftSavedAt(nowIso);
      });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [baseBody, description, draftSavedAt, inTelegram, isDirty, name, overlay, serverTemplate, slug, versionNote]);

  const cards = useMemo(() => cardsQuery.data?.cards ?? [], [cardsQuery.data?.cards]);
  const cardMap = useMemo(() => new Map<string, AppCard>(cards.map((card) => [card.id, card])), [cards]);
  const catalogItems = useMemo(() => catalogQuery.data?.items ?? [], [catalogQuery.data?.items]);
  const catalogIndex = useMemo<CatalogEntry[]>(() => {
    return catalogItems
      .filter((item): item is typeof item & { sourceUrl: string } => Boolean(item.sourceUrl))
      .map((item) => ({
        id: item.id,
        provider: item.provider,
        parentId: item.parentId,
        name: item.name,
        aliases: item.aliases,
        category: item.category,
        defaultRoute: item.defaultRoute,
        sourceUrl: item.sourceUrl,
        behavior: item.behavior,
        format: item.format,
        ruleCount: item.ruleCount,
      }));
  }, [catalogItems]);

  const addedCardIds = useMemo(() => {
    return new Set((resolvedBody?.cards ?? []).map((item) => item.cardId));
  }, [resolvedBody]);

  const lintReport = useMemo(() => {
    if (!resolvedBody) {
      return { ok: true, issues: [], errorCount: 0, warningCount: 0, infoCount: 0 };
    }
    return lintTemplate({
      body: resolvedBody,
      cards: cardMap,
      previousBody: baselineBody ?? undefined,
      catalogIndex,
    });
  }, [baselineBody, cardMap, catalogIndex, resolvedBody]);

  const reorderDiffIssue = useMemo(
    () => lintReport.issues.find((issue) => issue.code === 'reorder-diff'),
    [lintReport.issues],
  );

  const handleApplyOp = (op: TemplateOverlayOp) => {
    if (inTelegram) return;
    setOverlay((prev) => appendOverlayOp(prev, op));
  };

  const handleApplyOps = (ops: TemplateOverlayOp[]) => {
    if (inTelegram || ops.length === 0) return;
    setOverlay((prev) => ops.reduce((acc, op) => appendOverlayOp(acc, op), prev));
  };

  const handleAddCardFromCatalog = (card: AppCard) => {
    if (inTelegram || !resolvedBody) return;
    if (addedCardIds.has(card.id)) return;
    const op = buildAddCardOp(resolvedBody.cards, cardMap, card);
    handleApplyOp(op);
    notify({ title: `${t('templates.editorCardAddedToast')}: ${card.name}`, variant: 'success' });
  };

  const handleRestoreDraft = () => {
    if (!recoverableDraft) return;
    setName(recoverableDraft.name);
    setSlug(recoverableDraft.slug);
    setDescription(recoverableDraft.description);
    setBaseBody(recoverableDraft.baseBody);
    setOverlay(recoverableDraft.overlay);
    setVersionNote(recoverableDraft.note);
    setRecoverableDraft(null);
    notify({ title: t('templates.editorDraftRestoredToast'), variant: 'success' });
  };

  const handleDiscardDraft = async () => {
    if (!serverTemplate) return;
    await deleteTemplateDraft(serverTemplate.id);
    setRecoverableDraft(null);
    setDraftSavedAt(null);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!serverTemplate || !baseBody) throw new Error('Template not loaded');
      const res = await api.api.templates[':id'].$patch({
        param: { id: serverTemplate.id },
        json: {
          name: name.trim() || serverTemplate.name,
          slug: slug.trim() || serverTemplate.slug,
          description: description.trim(),
          baseBody,
          overlay,
          ...(versionNote.trim() ? { note: versionNote.trim() } : {}),
        },
      });
      return readApiJson<{ template: TemplateRecord; resolvedBody: TemplateBody }>(res);
    },
    onSuccess: async (data) => {
      await deleteTemplateDraft(data.template.id);
      skipNextAutoSaveRef.current = true;
      hydratedKeyRef.current = `${data.template.id}:${data.template.currentVersion}:${data.template.updatedAt}`;
      setName(data.template.name);
      setSlug(data.template.slug);
      setDescription(data.template.description);
      setBaseBody(data.template.baseBody);
      setOverlay(data.template.overlay);
      setBaselineBody(data.resolvedBody);
      setVersionNote('');
      setDraftSavedAt(null);
      setRecoverableDraft(null);
      await invalidateTemplates(queryClient, data.template.id);
      notify({
        title: `${t('templates.editorSavedToast')} (v${data.template.currentVersion})`,
        variant: 'success',
      });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const handleVersionSynced = async (
    payload: { template: TemplateRecord; resolvedBody: TemplateBody; version: number },
    toastKey: 'templates.editorRestoredToast' | 'templates.editorRebasedToast',
  ) => {
    await deleteTemplateDraft(payload.template.id);
    skipNextAutoSaveRef.current = true;
    hydratedKeyRef.current = `${payload.template.id}:${payload.template.currentVersion}:${payload.template.updatedAt}`;
    setName(payload.template.name);
    setSlug(payload.template.slug);
    setDescription(payload.template.description);
    setBaseBody(payload.template.baseBody);
    setOverlay(payload.template.overlay);
    setBaselineBody(payload.resolvedBody);
    setVersionNote('');
    setDraftSavedAt(null);
    setRecoverableDraft(null);
    await invalidateTemplates(queryClient, payload.template.id);
    notify({ title: `${t(toastKey)} (v${payload.version})`, variant: 'success' });
  };

  if (detailQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-14 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="h-96 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
          <div className="h-96 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
          <div className="h-96 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
        </div>
      </div>
    );
  }

  if (detailQuery.isError || !serverTemplate || !resolvedBody || !baselineBody) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle className="h-8 w-8 text-warning" />
          <p className="text-sm font-medium text-text">
            {detailQuery.error ? formatApiError(detailQuery.error, locale) : t('templates.editorNotFound')}
          </p>
        </CardContent>
      </Card>
    );
  }

  const versions = versionsQuery.data?.versions ?? [];

  return (
    <div data-testid="template-editor-page" className="flex flex-col gap-3">
      {/* Advanced Editor Action Bar */}
      <div className="flex flex-col gap-2.5 rounded-[var(--radius-lg)] border border-border bg-surface px-3.5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span data-testid="editor-template-title" className="truncate text-sm font-semibold text-text">
                {name || serverTemplate.name}
              </span>
              <Badge variant="outline" data-testid="editor-version-badge">
                v{serverTemplate.currentVersion}
              </Badge>
              {isDirty ? (
                <Badge variant="warning" data-testid="editor-dirty-badge">
                  {t('templates.editorDirtyBadge')}
                </Badge>
              ) : null}
              {draftSavedAt ? (
                <span data-testid="editor-draft-saved-indicator" className="text-[11px] text-text-muted">
                  {t('templates.editorSavedDraftHint')}
                </span>
              ) : null}
            </div>
            <div className="truncate font-mono text-[11px] text-text-muted">
              {slug || serverTemplate.slug} · {resolvedBody.cards.length} {t('templates.cardsCountSuffix')}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" data-testid="editor-meta-toggle" onClick={() => setShowMeta((v) => !v)}>
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>{t('templates.editorMetaToggle')}</span>
            </Button>

            {!inTelegram ? (
              <>
                <Input
                  data-testid="editor-version-note-input"
                  value={versionNote}
                  onChange={(e) => setVersionNote(e.target.value)}
                  placeholder={t('templates.editorVersionNotePlaceholder')}
                  className="h-8 w-36 text-xs sm:w-48"
                />
                <Button
                  size="sm"
                  data-testid="editor-save-version-btn"
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{saveMutation.isPending ? t('common.loading') : t('templates.editorSaveVersionBtn')}</span>
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {showMeta ? (
          <div className="grid grid-cols-1 gap-2 border-t border-border/70 pt-2.5 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-[11px] font-medium text-text-muted">
              <span>{t('templates.fieldName')}</span>
              <Input
                data-testid="editor-meta-name"
                value={name}
                disabled={inTelegram}
                onChange={(e) => setName(e.target.value)}
                className="h-8 text-xs"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-text-muted">
              <span>{t('templates.fieldSlug')}</span>
              <Input
                data-testid="editor-meta-slug"
                value={slug}
                disabled={inTelegram}
                onChange={(e) => setSlug(e.target.value)}
                className="h-8 font-mono text-xs"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-text-muted">
              <span>{t('templates.fieldDescription')}</span>
              <Input
                data-testid="editor-meta-description"
                value={description}
                disabled={inTelegram}
                onChange={(e) => setDescription(e.target.value)}
                className="h-8 text-xs"
              />
            </label>
          </div>
        ) : null}
      </div>

      {/* IndexedDB Draft Recovery Banner */}
      {recoverableDraft && !inTelegram ? (
        <div
          role="status"
          data-testid="editor-draft-recovery-banner"
          className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-primary/50 bg-primary/10 px-3.5 py-2.5 text-xs"
        >
          <div className="flex items-center gap-2 text-text">
            <RotateCcw className="h-4 w-4 shrink-0 text-primary" />
            <div>
              <span className="font-semibold">{t('templates.editorDraftBannerTitle')}</span>
              <span className="ml-1.5 text-text-muted">{t('templates.editorDraftBannerDesc')}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" data-testid="editor-restore-draft-btn" onClick={handleRestoreDraft}>
              {t('templates.editorDraftRestoreBtn')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="editor-discard-draft-btn"
              onClick={() => void handleDiscardDraft()}
            >
              {t('templates.editorDraftDiscardBtn')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Mobile / Tablet Stepper (< lg) */}
      <nav
        aria-label="Editor steps"
        data-testid="editor-mobile-stepper"
        className="grid grid-cols-3 gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1 lg:hidden"
      >
        {(
          [
            { id: 'catalog', label: t('templates.editorStepCatalog'), icon: Blocks },
            { id: 'editor', label: t('templates.editorStepCanvas'), icon: Layers },
            { id: 'inspect', label: t('templates.editorStepInspect'), icon: ShieldCheck },
          ] as const
        ).map((step) => {
          const Icon = step.icon;
          return (
            <button
              key={step.id}
              type="button"
              data-testid={`editor-step-${step.id}`}
              onClick={() => onUpdateSearch({ step: step.id })}
              className={`flex cursor-pointer items-center justify-center gap-1 rounded-[var(--radius-sm)] px-2 py-2 text-xs font-medium transition-colors ${
                activeStep === step.id ? 'bg-primary text-primary-foreground' : 'text-text-muted hover:text-text'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{step.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Main 3-Column Desktop Layout / Step-Switched Mobile Layout */}
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[235px_minmax(0,1fr)_315px] xl:grid-cols-[255px_minmax(0,1fr)_360px]">
        <div className={activeStep === 'catalog' ? 'block min-w-0' : 'hidden min-w-0 lg:block'}>
          <TemplateCatalogSidebar
            cards={cards}
            catalogItems={catalogItems}
            addedCardIds={addedCardIds}
            readOnly={inTelegram}
            onAddCard={handleAddCardFromCatalog}
          />
        </div>

        <div className={activeStep === 'editor' ? 'block min-w-0' : 'hidden min-w-0 lg:block'}>
          <TemplateCanvas
            body={resolvedBody}
            cardMap={cardMap}
            activeTab={activeTab}
            readOnly={inTelegram}
            reorderDiffIssue={reorderDiffIssue}
            onTabChange={(tab) => onUpdateSearch({ editorTab: tab })}
            onApplyOp={handleApplyOp}
            onApplyOps={handleApplyOps}
          />
        </div>

        <aside
          data-testid="editor-right-panel"
          className={`${activeStep === 'inspect' ? 'flex' : 'hidden lg:flex'} min-w-0 flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-3`}
        >
          <div className="grid grid-cols-4 gap-1 rounded-[var(--radius-md)] border border-border bg-bg p-1">
            {(
              [
                {
                  id: 'lint',
                  label: t('templates.editorPanelLint'),
                  icon: ShieldCheck,
                  count: lintReport.errorCount + lintReport.warningCount,
                },
                { id: 'probe', label: t('templates.editorPanelProbe'), icon: Search },
                { id: 'preview', label: t('templates.editorPanelPreview'), icon: Code2 },
                { id: 'versions', label: t('templates.editorPanelVersions'), icon: History },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`editor-panel-tab-${item.id}`}
                  onClick={() => onUpdateSearch({ panel: item.id })}
                  className={`flex cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[var(--radius-sm)] px-1.5 py-1.5 text-[11px] font-medium transition-colors ${
                    activePanel === item.id ? 'bg-primary text-primary-foreground' : 'text-text-muted hover:text-text'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    {'count' in item && item.count > 0 ? (
                      <span className="rounded-full bg-warning/20 px-1 text-[10px] font-semibold">{item.count}</span>
                    ) : null}
                  </div>
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>

          {activePanel === 'lint' ? (
            <TemplateLintPanel
              templateId={serverTemplate.id}
              body={resolvedBody}
              previousBody={baselineBody}
              localReport={lintReport}
            />
          ) : (
            <Suspense fallback={<div className="h-56 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />}>
              {activePanel === 'probe' ? (
                <TemplateProbePanel
                  templateId={serverTemplate.id}
                  body={resolvedBody}
                  cardMap={cardMap}
                  catalogIndex={catalogIndex}
                />
              ) : activePanel === 'preview' ? (
                <TemplatePreviewPanel
                  templateId={serverTemplate.id}
                  templateName={name || serverTemplate.name}
                  body={resolvedBody}
                  cardMap={cardMap}
                  catalogIndex={catalogIndex}
                />
              ) : (
                <TemplateVersionsPanel
                  template={serverTemplate}
                  versions={versions}
                  readOnly={inTelegram}
                  onRestored={(payload) => handleVersionSynced(payload, 'templates.editorRestoredToast')}
                  onRebased={(payload) => handleVersionSynced(payload, 'templates.editorRebasedToast')}
                />
              )}
            </Suspense>
          )}
        </aside>
      </div>
    </div>
  );
}
