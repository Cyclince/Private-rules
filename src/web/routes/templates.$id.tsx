import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  History,
  MoreHorizontal,
  Pencil,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { TemplateRecord } from '../../shared/schemas/template';
import type { EditorCenterTab } from '../components/templates/TemplateCanvas';
import type { EditorMobileStep, EditorRightPanelTab } from '../components/templates/TemplateAdvancedEditor';
import { TemplateSimpleNodesTab } from '../components/templates/TemplateSimpleNodesTab';
import { TemplateSimpleOutputTab } from '../components/templates/TemplateSimpleOutputTab';
import { TemplateSimpleRoutingTab } from '../components/templates/TemplateSimpleRoutingTab';
import { ActionMenu } from '../components/ui/action-menu';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import { loadPageTranslations, useI18n } from '../i18n';
import { api, formatApiError, readApiJson } from '../lib/api';
import { isTelegramSession, requireAuthBeforeLoad } from '../lib/auth-guard';
import {
  authMeQueryOptions,
  invalidatePublications,
  invalidateTemplates,
  templateSimpleQueryOptions,
} from '../lib/query';
import { useToast } from '../lib/toast';

const TemplateAdvancedEditor = lazy(() =>
  import('../components/templates/TemplateAdvancedEditor').then((m) => ({ default: m.TemplateAdvancedEditor })),
);
const TemplateAdvancedNodesPanel = lazy(() =>
  import('../components/templates/TemplateAdvancedNodesPanel').then((m) => ({ default: m.TemplateAdvancedNodesPanel })),
);
const TemplateAdvancedOutputPanel = lazy(() =>
  import('../components/templates/TemplateAdvancedOutputPanel').then((m) => ({
    default: m.TemplateAdvancedOutputPanel,
  })),
);
const TemplateVersionsDialog = lazy(() =>
  import('../components/templates/TemplateVersionsDialog').then((m) => ({ default: m.TemplateVersionsDialog })),
);
const DeleteConfirmDialog = lazy(() =>
  import('../components/rulesets/DeleteConfirmDialog').then((m) => ({ default: m.DeleteConfirmDialog })),
);

const ADVANCED_MODE_STORAGE_KEY = 'private-rules:template-advanced-mode';

type DetailTab = 'routing' | 'nodes' | 'output';

type TemplateDetailSearch = {
  tab?: DetailTab;
  step?: EditorMobileStep;
  editorTab?: EditorCenterTab;
  panel?: EditorRightPanelTab;
};

const VALID_DETAIL_TABS = new Set<string>(['routing', 'nodes', 'output']);
const VALID_STEPS = new Set<string>(['catalog', 'editor', 'inspect']);
const VALID_EDITOR_TABS = new Set<string>(['rules', 'groups', 'modules', 'patches']);
const VALID_PANELS = new Set<string>(['lint', 'probe', 'preview', 'versions']);

function readInitialAdvancedMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(ADVANCED_MODE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export const Route = createFileRoute('/templates/$id')({
  validateSearch: (search: Record<string, unknown>): TemplateDetailSearch => {
    const rawTab = typeof search.tab === 'string' ? search.tab : undefined;
    const rawEditorTab = typeof search.editorTab === 'string' ? search.editorTab : undefined;

    let tab: DetailTab | undefined;
    let editorTab: EditorCenterTab | undefined;

    if (rawTab && VALID_DETAIL_TABS.has(rawTab)) {
      tab = rawTab as DetailTab;
    } else if (rawTab && VALID_EDITOR_TABS.has(rawTab)) {
      // Preserve beta.1 deep links like ?tab=modules or ?tab=patches inside routing advanced editor
      tab = 'routing';
      editorTab = rawTab as EditorCenterTab;
    }

    if (rawEditorTab && VALID_EDITOR_TABS.has(rawEditorTab)) {
      editorTab = rawEditorTab as EditorCenterTab;
    }

    const step =
      typeof search.step === 'string' && VALID_STEPS.has(search.step) ? (search.step as EditorMobileStep) : undefined;
    const panel =
      typeof search.panel === 'string' && VALID_PANELS.has(search.panel)
        ? (search.panel as EditorRightPanelTab)
        : undefined;

    return {
      ...(tab ? { tab } : {}),
      ...(step ? { step } : {}),
      ...(editorTab ? { editorTab } : {}),
      ...(panel ? { panel } : {}),
    };
  },
  beforeLoad: async ({ context, location }) => {
    await Promise.all([requireAuthBeforeLoad(context.queryClient, location.href), loadPageTranslations()]);
  },
  component: TemplateDetailPage,
});

function TemplateDetailPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const routeNavigate = Route.useNavigate();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t, locale } = useI18n();
  const { notify } = useToast();

  const authQuery = useQuery(authMeQueryOptions());
  const inTelegram = isTelegramSession(authQuery.data);
  const simpleQuery = useQuery(templateSimpleQueryOptions(id));

  const [advancedMode, setAdvancedMode] = useState<boolean>(readInitialAdvancedMode);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const view = simpleQuery.data;
  const activeTab: DetailTab = search.tab ?? 'routing';
  const activeStep: EditorMobileStep = search.step ?? 'editor';
  const activeEditorTab: EditorCenterTab = search.editorTab ?? 'rules';
  const activePanel: EditorRightPanelTab = search.panel ?? 'lint';

  useEffect(() => {
    if (view?.template.name && !editingName) {
      setNameInput(view.template.name);
    }
  }, [editingName, view?.template.name]);

  const handleToggleAdvanced = (checked: boolean) => {
    setAdvancedMode(checked);
    try {
      window.localStorage.setItem(ADVANCED_MODE_STORAGE_KEY, checked ? '1' : '0');
    } catch {
      // Ignore storage errors in private browsing
    }
  };

  const updateSearch = (patch: Partial<TemplateDetailSearch>) => {
    void routeNavigate({
      search: (prev) => ({
        ...prev,
        ...patch,
      }),
      replace: true,
    });
  };

  const renameMutation = useMutation({
    mutationFn: async (nextName: string) =>
      readApiJson<{ template: TemplateRecord }>(
        await api.api.templates[':id'].$patch({
          param: { id },
          json: { name: nextName },
        }),
      ),
    onSuccess: async () => {
      setEditingName(false);
      await invalidateTemplates(queryClient, id);
      notify({ title: t('templateDetail.renamedToast'), variant: 'success' });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const detail = await readApiJson<{ template: TemplateRecord }>(
        await api.api.templates[':id'].$get({ param: { id } }),
      );
      const tpl = detail.template;
      return readApiJson<{ template: TemplateRecord }>(
        await api.api.templates.$post({
          json: {
            name: `${tpl.name} (${t('templates.copySuffix')})`,
            description: tpl.description,
            baseKind: tpl.baseKind,
            ...(tpl.baseSourceUrl ? { baseSourceUrl: tpl.baseSourceUrl } : {}),
            baseBody: tpl.baseBody,
            overlay: tpl.overlay,
            note: `${t('templates.duplicatedFrom')} ${tpl.slug}`,
          },
        }),
      );
    },
    onSuccess: async (data) => {
      await invalidateTemplates(queryClient);
      notify({ title: t('templates.duplicatedToast'), variant: 'success' });
      void navigate({ to: '/templates/$id', params: { id: data.template.id } });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => readApiJson(await api.api.templates[':id'].$delete({ param: { id } })),
    onSuccess: async () => {
      setDeleteOpen(false);
      await Promise.all([invalidateTemplates(queryClient), invalidatePublications(queryClient)]);
      notify({ title: t('templates.deletedToast'), variant: 'success' });
      void navigate({ to: '/templates' });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const handleSaveName = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed || !view) return;
    if (trimmed === view.template.name) {
      setEditingName(false);
      return;
    }
    renameMutation.mutate(trimmed);
  };

  if (simpleQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-14 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
        <div className="h-10 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
        <div className="h-80 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
      </div>
    );
  }

  if (simpleQuery.isError || !view) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle className="h-8 w-8 text-warning" />
          <p className="text-sm font-medium text-text">
            {simpleQuery.error ? formatApiError(simpleQuery.error, locale) : t('templates.editorNotFound')}
          </p>
          <Link
            to="/templates"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-muted"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{t('templateDetail.backToTemplates')}</span>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const moreMenuItems = [
    {
      key: 'versions',
      label: t('templateDetail.menuVersions'),
      icon: <History className="h-4 w-4 text-text-muted" />,
      testId: 'template-menu-versions',
      onSelect: () => setVersionsOpen(true),
    },
    ...(!inTelegram
      ? [
          {
            key: 'duplicate',
            label: t('templateDetail.menuDuplicate'),
            icon: <Copy className="h-4 w-4 text-text-muted" />,
            testId: 'template-menu-duplicate',
            disabled: duplicateMutation.isPending,
            onSelect: () => duplicateMutation.mutate(),
          },
          {
            key: 'delete',
            label: t('templateDetail.menuDelete'),
            icon: <Trash2 className="h-4 w-4 text-danger" />,
            testId: 'template-menu-delete',
            danger: true,
            onSelect: () => setDeleteOpen(true),
          },
        ]
      : []),
  ];

  const tabs: ReadonlyArray<{ id: DetailTab; label: string }> = [
    { id: 'routing', label: t('templateDetail.tabRouting') },
    { id: 'nodes', label: t('templateDetail.tabNodes') },
    { id: 'output', label: t('templateDetail.tabOutput') },
  ];

  return (
    <div data-testid="template-detail-page" className="flex flex-col gap-4">
      {/* Top Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-border bg-surface px-3.5 py-3 shadow-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Link
            to="/templates"
            data-testid="editor-back-btn"
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[var(--radius-md)] border border-border bg-bg px-2.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{t('templateDetail.backToTemplates')}</span>
          </Link>

          {editingName && !inTelegram ? (
            <form onSubmit={handleSaveName} className="flex min-w-0 flex-1 items-center gap-1.5">
              <Input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                data-testid="template-rename-input"
                className="h-8 max-w-xs text-sm"
              />
              <Button
                type="submit"
                size="icon"
                variant="primary"
                aria-label={t('common.save')}
                data-testid="template-rename-save"
                disabled={renameMutation.isPending || !nameInput.trim()}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t('common.cancel')}
                onClick={() => {
                  setEditingName(false);
                  setNameInput(view.template.name);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </form>
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              <h1 data-testid="template-detail-title" className="truncate text-base font-semibold text-text sm:text-lg">
                {view.template.name}
              </h1>
              {!inTelegram ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('templateDetail.renameBtn')}
                  data-testid="template-rename-btn"
                  onClick={() => {
                    setNameInput(view.template.name);
                    setEditingName(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5 text-text-muted" />
                </Button>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-text">
            <span>{t('templateDetail.advancedToggle')}</span>
            <Switch
              checked={advancedMode}
              data-testid="template-advanced-toggle"
              aria-label={t('templateDetail.advancedToggle')}
              onCheckedChange={handleToggleAdvanced}
            />
          </label>

          <ActionMenu
            align="end"
            menuTestId="template-more-menu"
            trigger={({ open, toggle }) => (
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label={t('templateDetail.moreActions')}
                aria-expanded={open}
                aria-haspopup="menu"
                data-testid="template-more-menu-btn"
                onClick={toggle}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            )}
            items={moreMenuItems}
          />
        </div>
      </header>

      {/* Telegram Read-Only Banner */}
      {inTelegram ? (
        <div
          role="status"
          data-testid="templates-telegram-readonly"
          className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-warning bg-surface-muted px-3.5 py-2.5 text-xs text-text"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>{t('templates.listTelegramReadOnly')}</span>
        </div>
      ) : null}

      {/* 3-Tab Navigation */}
      <nav
        aria-label={t('templateDetail.tabsAriaLabel')}
        data-testid="template-detail-tabs"
        className="grid grid-cols-3 gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`template-tab-${tab.id}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => updateSearch({ tab: tab.id })}
              className={`cursor-pointer rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-text-muted hover:bg-surface-muted hover:text-text'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Active Tab Content */}
      {activeTab === 'routing' ? (
        advancedMode ? (
          <Suspense
            fallback={
              <div className="flex flex-col gap-3">
                <div className="h-14 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
                <div className="h-96 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
              </div>
            }
          >
            <TemplateAdvancedEditor
              templateId={id}
              activeStep={activeStep}
              activeTab={activeEditorTab}
              activePanel={activePanel}
              onUpdateSearch={(patch) => updateSearch(patch)}
            />
          </Suspense>
        ) : (
          <TemplateSimpleRoutingTab view={view} readOnly={inTelegram} />
        )
      ) : activeTab === 'nodes' ? (
        advancedMode ? (
          <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />}>
            <TemplateAdvancedNodesPanel
              templateId={id}
              readOnly={inTelegram}
              onGoToOutput={() => updateSearch({ tab: 'output' })}
            />
          </Suspense>
        ) : (
          <TemplateSimpleNodesTab
            view={view}
            readOnly={inTelegram}
            onGoToOutput={() => updateSearch({ tab: 'output' })}
          />
        )
      ) : advancedMode ? (
        <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />}>
          <TemplateAdvancedOutputPanel templateId={id} readOnly={inTelegram} />
        </Suspense>
      ) : (
        <TemplateSimpleOutputTab view={view} readOnly={inTelegram} />
      )}

      {/* Lazy Dialogs from ⋯ Menu */}
      {versionsOpen ? (
        <Suspense fallback={null}>
          <TemplateVersionsDialog
            open={versionsOpen}
            templateId={id}
            readOnly={inTelegram}
            onOpenChange={setVersionsOpen}
          />
        </Suspense>
      ) : null}

      {deleteOpen ? (
        <Suspense fallback={null}>
          <DeleteConfirmDialog
            open={deleteOpen}
            title={t('templates.deleteConfirmTitle')}
            description={`${view.template.name} — ${t('templates.deleteConfirmBodyPlain')}`}
            submitting={deleteMutation.isPending}
            onOpenChange={setDeleteOpen}
            onConfirm={() => deleteMutation.mutate()}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
