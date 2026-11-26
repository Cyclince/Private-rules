import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Link2,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { ManualRuleFormValues } from '../../shared/schemas/rule';
import type { RulesetFormValues } from '../../shared/schemas/ruleset';
import type { DomainRule, ImportPreview, RuleCategory, RuleConflict } from '../../types/domain-rules';
import { SectionSubNav } from '../components/layout/SectionSubNav';
import { Badge } from '../components/ui/badge';

const DeleteConfirmDialog = lazy(() =>
  import('../components/rulesets/DeleteConfirmDialog').then((m) => ({ default: m.DeleteConfirmDialog })),
);

const RulesetFormDialog = lazy(() =>
  import('../components/rulesets/RulesetFormDialog').then((m) => ({ default: m.RulesetFormDialog })),
);
const RuleFormDialog = lazy(() =>
  import('../components/rulesets/RuleFormDialog').then((m) => ({ default: m.RuleFormDialog })),
);
const BulkImportDialog = lazy(() =>
  import('../components/rulesets/BulkImportDialog').then((m) => ({ default: m.BulkImportDialog })),
);
const SubscriptionLinksDrawer = lazy(() =>
  import('../components/rulesets/SubscriptionLinksDrawer').then((m) => ({ default: m.SubscriptionLinksDrawer })),
);
const SourcesPanel = lazy(() =>
  import('../components/rulesets/SourcesPanel').then((m) => ({ default: m.SourcesPanel })),
);
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import { loadPageTranslations, useI18n } from '../i18n';
import { api, ApiClientError, formatApiError, readApiJson } from '../lib/api';
import { requireAuthBeforeLoad } from '../lib/auth-guard';
import {
  authMeQueryOptions,
  invalidateRulesets,
  queryKeys,
  rulesetRulesQueryOptions,
  rulesetsListQueryOptions,
  type RulesetSummaryPayload,
  type RulesPageFilter,
  type RulesPagePayload,
} from '../lib/query';
import { useToast } from '../lib/toast';

type SourceFilter = 'all' | 'manual' | 'upstream';
type DetailTab = 'rules' | 'sources';

type RulesetsSearch = {
  q?: string;
  rq?: string;
  source?: SourceFilter;
  selected?: string;
  tab?: DetailTab;
  links?: '1';
};

const VALID_SOURCES = new Set<SourceFilter>(['all', 'manual', 'upstream']);
const VALID_DETAIL_TABS = new Set<DetailTab>(['rules', 'sources']);
const RULES_PAGE_SIZE = 50;

export const Route = createFileRoute('/rulesets')({
  validateSearch: (search: Record<string, unknown>): RulesetsSearch => {
    const q = typeof search.q === 'string' && search.q ? search.q : undefined;
    const rq = typeof search.rq === 'string' && search.rq ? search.rq : undefined;
    const rawSource = typeof search.source === 'string' ? (search.source as SourceFilter) : undefined;
    const source = rawSource && VALID_SOURCES.has(rawSource) && rawSource !== 'all' ? rawSource : undefined;
    const selected = typeof search.selected === 'string' && search.selected ? search.selected : undefined;
    const rawTab = typeof search.tab === 'string' ? (search.tab as DetailTab) : undefined;
    const tab = rawTab && VALID_DETAIL_TABS.has(rawTab) && rawTab !== 'rules' ? rawTab : undefined;
    const links = search.links === '1' ? ('1' as const) : undefined;
    return {
      ...(q ? { q } : {}),
      ...(rq ? { rq } : {}),
      ...(source ? { source } : {}),
      ...(selected ? { selected } : {}),
      ...(tab ? { tab } : {}),
      ...(links ? { links } : {}),
    };
  },
  beforeLoad: async ({ context, location }) => {
    await Promise.all([requireAuthBeforeLoad(context.queryClient, location.href), loadPageTranslations()]);
  },
  component: RulesetsPage,
});

function extractConflicts(error: unknown): RuleConflict[] {
  if (!(error instanceof ApiClientError) || error.code !== 'RULE_CONFLICT') return [];
  const details = error.details as { conflicts?: RuleConflict[] } | undefined;
  return Array.isArray(details?.conflicts) ? details.conflicts : [];
}

function RulesetsPage() {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const rawSearch = Route.useSearch();
  const navigate = Route.useNavigate();

  const search = {
    q: rawSearch.q ?? '',
    rq: rawSearch.rq ?? '',
    source: rawSearch.source ?? ('all' as SourceFilter),
    selected: rawSearch.selected ?? '',
    tab: rawSearch.tab ?? ('rules' as DetailTab),
  };

  const authQuery = useQuery(authMeQueryOptions());
  const isTelegram = authQuery.data?.authType === 'telegram';

  const summaryQuery = useQuery(rulesetsListQueryOptions());
  const categories = useMemo(() => {
    const list = summaryQuery.data?.data.categories ?? [];
    return [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [summaryQuery.data]);
  const linksByCategory = summaryQuery.data?.links ?? {};

  const filteredCategories = useMemo(() => {
    const needle = search.q.trim().toLowerCase();
    if (!needle) return categories;
    return categories.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        item.slug.toLowerCase().includes(needle) ||
        (item.description ?? '').toLowerCase().includes(needle),
    );
  }, [categories, search.q]);

  const selectedRuleset: RuleCategory | null = useMemo(() => {
    if (search.selected) {
      const exact = categories.find((item) => item.id === search.selected);
      if (exact) return exact;
    }
    return filteredCategories[0] ?? categories[0] ?? null;
  }, [categories, filteredCategories, search.selected]);

  const activeRulesetId = selectedRuleset?.id ?? '';

  // Server-side rule search input (debounced to URL `?rq=`)
  const [ruleSearchInput, setRuleSearchInput] = useState(search.rq);
  useEffect(() => {
    setRuleSearchInput(search.rq);
  }, [search.rq]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (ruleSearchInput !== search.rq) {
        void navigate({
          search: (prev) => ({ ...prev, rq: ruleSearchInput || undefined }),
          replace: true,
        });
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [ruleSearchInput, search.rq, navigate]);

  // Cursor pagination stack (index 0 = first page with undefined cursor)
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined]);
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([]);

  useEffect(() => {
    setCursorStack([undefined]);
    setSelectedRuleIds([]);
  }, [activeRulesetId, search.rq, search.source]);

  const currentCursor = cursorStack[cursorStack.length - 1];
  const currentPageIndex = cursorStack.length;

  const rulesFilter: RulesPageFilter = useMemo(
    () => ({
      ...(search.rq ? { q: search.rq } : {}),
      ...(search.source !== 'all' ? { source: search.source } : {}),
      ...(currentCursor ? { cursor: currentCursor } : {}),
      limit: RULES_PAGE_SIZE,
    }),
    [search.rq, search.source, currentCursor],
  );

  const rulesQuery = useQuery({
    ...rulesetRulesQueryOptions(activeRulesetId, rulesFilter),
    enabled: Boolean(activeRulesetId),
    placeholderData: keepPreviousData,
  });

  const rules = rulesQuery.data?.rules ?? [];
  const totalRules = rulesQuery.data?.total ?? 0;
  const hasMore = rulesQuery.data?.hasMore ?? false;
  const nextCursor = rulesQuery.data?.nextCursor ?? null;

  // Dialog & Drawer state
  const [rulesetDialog, setRulesetDialog] = useState<{ open: boolean; mode: 'create' | 'edit' }>({
    open: false,
    mode: 'create',
  });
  const [deleteRulesetOpen, setDeleteRulesetOpen] = useState(false);
  const [linksDrawerOpen, setLinksDrawerOpen] = useState(() => rawSearch.links === '1');
  useEffect(() => {
    if (rawSearch.links === '1') setLinksDrawerOpen(true);
  }, [rawSearch.links]);
  const [ruleDialog, setRuleDialog] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    rule: DomainRule | null;
    conflicts: RuleConflict[];
  }>({ open: false, mode: 'create', rule: null, conflicts: [] });
  const [deleteRuleTarget, setDeleteRuleTarget] = useState<DomainRule | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const updateSearch = (patch: Partial<RulesetsSearch>) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        ...patch,
      }),
      replace: true,
    });
  };

  // --- Ruleset Mutations ---

  const createRulesetMutation = useMutation({
    mutationFn: async (values: RulesetFormValues) =>
      readApiJson<RulesetSummaryPayload>(
        await api.api.rulesets.$post({
          json: {
            name: values.name,
            icon: values.icon || undefined,
            description: values.description || undefined,
            note: values.note || undefined,
            publicLinksEnabled: values.publicLinksEnabled,
            tokenLinksEnabled: values.tokenLinksEnabled,
          },
        }),
      ),
    onSuccess: async (payload, values) => {
      const created = payload.data.categories.find((item) => item.name === values.name);
      if (created && !values.enabled) {
        await api.api.rulesets[':id'].$patch({
          param: { id: created.id },
          json: { enabled: false },
        });
      }
      await invalidateRulesets(queryClient);
      setRulesetDialog({ open: false, mode: 'create' });
      if (created) updateSearch({ selected: created.id });
      notify({ title: t('rulesets.created'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const updateRulesetMutation = useMutation({
    mutationFn: async (args: {
      id: string;
      patch: Partial<{
        name: string;
        icon: string;
        description: string;
        note: string;
        enabled: boolean;
        sortOrder: number;
        publicLinksEnabled: boolean;
        tokenLinksEnabled: boolean;
      }>;
      silent?: boolean;
    }) =>
      readApiJson<RulesetSummaryPayload>(
        await api.api.rulesets[':id'].$patch({
          param: { id: args.id },
          json: args.patch,
        }),
      ),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.rulesets.list() });
      const previous = queryClient.getQueryData<RulesetSummaryPayload>(queryKeys.rulesets.list());
      if (previous) {
        queryClient.setQueryData<RulesetSummaryPayload>(queryKeys.rulesets.list(), {
          ...previous,
          data: {
            ...previous.data,
            categories: previous.data.categories.map((item) => (item.id === id ? { ...item, ...patch } : item)),
          },
        });
      }
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.rulesets.list(), context.previous);
      }
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
    onSuccess: (_data, variables) => {
      if (!variables.silent) {
        notify({ title: t('rulesets.updated'), variant: 'success' });
      }
    },
    onSettled: async (_data, _error, variables) => {
      await invalidateRulesets(queryClient, variables.id);
    },
  });

  const deleteRulesetMutation = useMutation({
    mutationFn: async (id: string) =>
      readApiJson<RulesetSummaryPayload>(await api.api.rulesets[':id'].$delete({ param: { id } })),
    onSuccess: async (_data, deletedId) => {
      setDeleteRulesetOpen(false);
      if (search.selected === deletedId) {
        updateSearch({ selected: undefined });
      }
      await invalidateRulesets(queryClient);
      notify({ title: t('rulesets.deleted'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      for (let index = 0; index < orderedIds.length; index += 1) {
        await readApiJson(
          await api.api.rulesets[':id'].$patch({
            param: { id: orderedIds[index] },
            json: { sortOrder: (index + 1) * 10 },
          }),
        );
      }
    },
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.rulesets.list() });
      const previous = queryClient.getQueryData<RulesetSummaryPayload>(queryKeys.rulesets.list());
      if (previous) {
        const orderMap = new Map(orderedIds.map((id, idx) => [id, (idx + 1) * 10]));
        queryClient.setQueryData<RulesetSummaryPayload>(queryKeys.rulesets.list(), {
          ...previous,
          data: {
            ...previous.data,
            categories: previous.data.categories.map((item) => ({
              ...item,
              sortOrder: orderMap.get(item.id) ?? item.sortOrder ?? 0,
            })),
          },
        });
      }
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.rulesets.list(), context.previous);
      }
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
    onSuccess: () => {
      notify({ title: t('rulesets.reordered'), variant: 'success' });
    },
    onSettled: async () => {
      await invalidateRulesets(queryClient);
    },
  });

  const moveRuleset = (fromIndex: number, toIndex: number) => {
    if (isTelegram || fromIndex === toIndex || toIndex < 0 || toIndex >= categories.length) return;
    const next = [...categories];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    reorderMutation.mutate(next.map((item) => item.id));
  };

  // --- Rule Mutations ---

  const saveRuleMutation = useMutation({
    mutationFn: async (args: {
      mode: 'create' | 'edit';
      ruleId?: string;
      values: ManualRuleFormValues;
      replaceConflicts: boolean;
    }) => {
      const options =
        args.values.type === 'IP-CIDR' || args.values.type === 'IP-CIDR6' || args.values.type === 'SRC-IP-CIDR'
          ? { noResolve: args.values.noResolve }
          : undefined;
      if (args.mode === 'create') {
        return readApiJson(
          await api.api.rulesets[':id'].rules.$post({
            param: { id: activeRulesetId },
            json: {
              value: args.values.value,
              ...(args.values.type !== 'AUTO' ? { type: args.values.type } : {}),
              note: args.values.note || undefined,
              enabled: args.values.enabled,
              ...(options ? { options } : {}),
              replaceConflicts: args.replaceConflicts,
            },
          }),
        );
      }
      return readApiJson(
        await api.api.rulesets[':id'].rules[':ruleId'].$patch({
          param: { id: activeRulesetId, ruleId: args.ruleId! },
          json: {
            value: args.values.value,
            ...(args.values.type !== 'AUTO' ? { type: args.values.type } : {}),
            note: args.values.note,
            enabled: args.values.enabled,
            options: options ?? null,
          },
        }),
      );
    },
    onSuccess: async (_data, variables) => {
      setRuleDialog({ open: false, mode: 'create', rule: null, conflicts: [] });
      await invalidateRulesets(queryClient, activeRulesetId);
      notify({
        title: variables.mode === 'create' ? t('rules.created') : t('rules.updated'),
        variant: 'success',
      });
    },
    onError: (error) => {
      const conflicts = extractConflicts(error);
      if (conflicts.length > 0) {
        setRuleDialog((prev) => ({ ...prev, conflicts }));
        return;
      }
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const toggleRuleMutation = useMutation({
    mutationFn: async (args: { ruleId: string; enabled: boolean }) =>
      readApiJson(
        await api.api.rulesets[':id'].rules[':ruleId'].$patch({
          param: { id: activeRulesetId, ruleId: args.ruleId },
          json: { enabled: args.enabled },
        }),
      ),
    onMutate: async ({ ruleId, enabled }) => {
      const key = queryKeys.rulesets.rules(activeRulesetId, rulesFilter);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<RulesPagePayload>(key);
      if (previous) {
        queryClient.setQueryData<RulesPagePayload>(key, {
          ...previous,
          rules: previous.rules.map((item) => (item.id === ruleId ? { ...item, enabled } : item)),
        });
      }
      return { key, previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
    onSettled: async () => {
      await invalidateRulesets(queryClient, activeRulesetId);
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (ruleId: string) =>
      readApiJson(
        await api.api.rulesets[':id'].rules[':ruleId'].$delete({
          param: { id: activeRulesetId, ruleId },
        }),
      ),
    onSuccess: async () => {
      setDeleteRuleTarget(null);
      await invalidateRulesets(queryClient, activeRulesetId);
      notify({ title: t('rules.deleted'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const batchRuleMutation = useMutation({
    mutationFn: async (args: { ruleIds: string[]; action: 'enable' | 'disable' | 'delete' }) =>
      readApiJson(
        await api.api.rulesets[':id'].rules.batch.$post({
          param: { id: activeRulesetId },
          json: args,
        }),
      ),
    onSuccess: async (_data, variables) => {
      setSelectedRuleIds([]);
      setBatchDeleteOpen(false);
      await invalidateRulesets(queryClient, activeRulesetId);
      notify({
        title:
          variables.action === 'enable'
            ? t('rules.batchEnabled')
            : variables.action === 'disable'
              ? t('rules.batchDisabled')
              : t('rules.batchDeleted'),
        variant: 'success',
      });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const manualPageRuleIds = useMemo(() => rules.filter((item) => !item.sourceId).map((item) => item.id), [rules]);
  const allManualPageSelected =
    manualPageRuleIds.length > 0 && manualPageRuleIds.every((id) => selectedRuleIds.includes(id));

  const toggleRuleSelection = (ruleId: string) => {
    setSelectedRuleIds((prev) => (prev.includes(ruleId) ? prev.filter((id) => id !== ruleId) : [...prev, ruleId]));
  };

  const toggleSelectAllPage = () => {
    if (allManualPageSelected) {
      setSelectedRuleIds([]);
    } else {
      setSelectedRuleIds(manualPageRuleIds);
    }
  };

  const handleBulkPreview = async (text: string): Promise<ImportPreview> => {
    try {
      const payload = await readApiJson<{ preview: ImportPreview }>(
        await api.api.rulesets[':id'].rules.import.$post({
          param: { id: activeRulesetId },
          json: { text, confirm: false, replaceConflicts: false },
        }),
      );
      return payload.preview;
    } catch (error) {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
      throw error;
    }
  };

  const handleBulkConfirm = async (
    text: string,
    replaceConflicts: boolean,
  ): Promise<{ importedCount: number; replaced: number }> => {
    try {
      const payload = await readApiJson<{ preview: ImportPreview; replaced?: number }>(
        await api.api.rulesets[':id'].rules.import.$post({
          param: { id: activeRulesetId },
          json: { text, confirm: true, replaceConflicts },
        }),
      );
      await invalidateRulesets(queryClient, activeRulesetId);
      notify({ title: t('import.successTitle'), variant: 'success' });
      return {
        importedCount: payload.preview.rules.length,
        replaced: payload.replaced ?? 0,
      };
    } catch (error) {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
      throw error;
    }
  };

  const selectedLinks = selectedRuleset ? (linksByCategory[selectedRuleset.id] ?? []) : [];

  return (
    <div className="flex flex-col gap-4" data-testid="rulesets-page">
      <SectionSubNav section="rules" />
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{t('rulesets.title')}</CardTitle>
            <CardDescription>{t('rulesets.subtitle')}</CardDescription>
          </div>
          <Button
            size="sm"
            data-testid="create-ruleset-btn"
            disabled={isTelegram}
            onClick={() => setRulesetDialog({ open: true, mode: 'create' })}
          >
            <Plus className="h-4 w-4" />
            <span>{t('rulesets.create')}</span>
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {isTelegram ? (
            <div
              data-testid="rulesets-telegram-notice"
              className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-warning/40 bg-surface-muted px-3 py-2 text-xs text-text-muted"
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>{t('rulesets.telegramOnlySwitches')}</span>
            </div>
          ) : null}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              data-testid="rulesets-search-input"
              value={search.q}
              onChange={(event) => updateSearch({ q: event.target.value || undefined })}
              placeholder={t('rulesets.searchPlaceholder')}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[310px_minmax(0,1fr)]">
        {/* Left pane: ruleset list with drag/up-down reorder */}
        <Card className="h-fit min-w-0">
          <CardContent className="flex flex-col gap-2 pt-4" data-testid="rulesets-list">
            {summaryQuery.isLoading ? (
              <div className="flex flex-col gap-2">
                <div className="h-14 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
                <div className="h-14 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
              </div>
            ) : filteredCategories.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-muted">{t('rulesets.emptyList')}</p>
            ) : (
              filteredCategories.map((item) => {
                const isSelected = selectedRuleset?.id === item.id;
                const fullIndex = categories.findIndex((c) => c.id === item.id);
                const hasSourceError = (item.sources ?? []).some((s) => s.lastStatus === 'error');
                return (
                  <div
                    key={item.id}
                    draggable={!isTelegram && !search.q}
                    onDragStart={() => setDraggingId(item.id)}
                    onDragOver={(event) => {
                      if (!isTelegram && !search.q) event.preventDefault();
                    }}
                    onDrop={() => {
                      if (!draggingId || draggingId === item.id || isTelegram || search.q) return;
                      const fromIdx = categories.findIndex((c) => c.id === draggingId);
                      const toIdx = categories.findIndex((c) => c.id === item.id);
                      setDraggingId(null);
                      moveRuleset(fromIdx, toIdx);
                    }}
                    onDragEnd={() => setDraggingId(null)}
                    data-testid={`ruleset-row-${item.id}`}
                    className={`flex items-center gap-1.5 rounded-[var(--radius-md)] border px-2.5 py-2.5 transition-colors ${
                      isSelected
                        ? 'border-primary bg-surface-muted text-text'
                        : 'border-border bg-surface text-text hover:bg-surface-muted/70'
                    }`}
                  >
                    {!isTelegram && !search.q ? (
                      <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-text-muted" aria-hidden="true" />
                    ) : null}
                    <button
                      type="button"
                      data-testid={`ruleset-item-${item.id}`}
                      onClick={() => updateSearch({ selected: item.id })}
                      className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{item.name}</span>
                        {item.enabled === false ? <Badge variant="outline">{t('common.disabled')}</Badge> : null}
                        {hasSourceError ? (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-danger" title="Source sync error" />
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-text-muted">
                        <span className="truncate font-mono">{item.slug}</span>
                        <span>·</span>
                        <span>{(item.ruleCount ?? 0).toLocaleString()}</span>
                      </div>
                    </button>
                    <div className="flex shrink-0 flex-col gap-0.5">
                      <button
                        type="button"
                        aria-label={t('rulesets.moveUp')}
                        title={t('rulesets.moveUp')}
                        data-testid={`ruleset-move-up-${item.id}`}
                        disabled={isTelegram || Boolean(search.q) || fullIndex <= 0 || reorderMutation.isPending}
                        onClick={() => moveRuleset(fullIndex, fullIndex - 1)}
                        className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-text-muted hover:bg-surface hover:text-text disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={t('rulesets.moveDown')}
                        title={t('rulesets.moveDown')}
                        data-testid={`ruleset-move-down-${item.id}`}
                        disabled={
                          isTelegram ||
                          Boolean(search.q) ||
                          fullIndex < 0 ||
                          fullIndex >= categories.length - 1 ||
                          reorderMutation.isPending
                        }
                        onClick={() => moveRuleset(fullIndex, fullIndex + 1)}
                        className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-text-muted hover:bg-surface hover:text-text disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Right pane: selected ruleset detail & paginated rules */}
        <div className="flex min-w-0 flex-col gap-4">
          {!selectedRuleset ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('rulesets.selectedLabel')}</CardTitle>
                <CardDescription data-testid="rulesets-selected-value">{t('rulesets.noneSelected')}</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <>
              <Card data-testid="ruleset-detail-card">
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="truncate" data-testid="ruleset-detail-name">
                        {selectedRuleset.name}
                      </CardTitle>
                      <Badge variant="outline" className="font-mono" data-testid="rulesets-selected-value">
                        {selectedRuleset.id}
                      </Badge>
                    </div>
                    <CardDescription className="mt-1">
                      <span className="font-mono">{selectedRuleset.slug}</span>
                      {selectedRuleset.description ? ` · ${selectedRuleset.description}` : ''}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      data-testid="open-links-drawer-btn"
                      onClick={() => setLinksDrawerOpen(true)}
                    >
                      <Link2 className="h-4 w-4" />
                      <span>{t('rulesets.openLinks')}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="edit-ruleset-btn"
                      disabled={isTelegram}
                      onClick={() => setRulesetDialog({ open: true, mode: 'edit' })}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      <span>{t('common.edit')}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      data-testid="delete-ruleset-btn"
                      disabled={isTelegram}
                      onClick={() => setDeleteRulesetOpen(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>{t('common.delete')}</span>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-4 border-t border-border pt-4">
                  <label className="flex items-center gap-2 text-xs font-medium">
                    <Switch
                      data-testid="ruleset-switch-enabled"
                      checked={selectedRuleset.enabled !== false}
                      onCheckedChange={(checked) =>
                        updateRulesetMutation.mutate({ id: selectedRuleset.id, patch: { enabled: checked } })
                      }
                    />
                    <span>{t('rulesets.toggleEnabled')}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium">
                    <Switch
                      data-testid="ruleset-switch-token"
                      checked={Boolean(selectedRuleset.tokenLinksEnabled)}
                      onCheckedChange={(checked) =>
                        updateRulesetMutation.mutate({
                          id: selectedRuleset.id,
                          patch: checked
                            ? { tokenLinksEnabled: true, publicLinksEnabled: false }
                            : { tokenLinksEnabled: false },
                        })
                      }
                    />
                    <span>{t('rulesets.toggleToken')}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium">
                    <Switch
                      data-testid="ruleset-switch-public"
                      checked={Boolean(selectedRuleset.publicLinksEnabled)}
                      onCheckedChange={(checked) =>
                        updateRulesetMutation.mutate({
                          id: selectedRuleset.id,
                          patch: checked
                            ? { publicLinksEnabled: true, tokenLinksEnabled: false }
                            : { publicLinksEnabled: false },
                        })
                      }
                    />
                    <span>{t('rulesets.togglePublic')}</span>
                  </label>
                </CardContent>
              </Card>

              {/* Detail view switcher: Rules vs Upstream Sources */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  data-testid="ruleset-tab-rules"
                  variant={search.tab === 'rules' ? 'primary' : 'outline'}
                  onClick={() => updateSearch({ tab: undefined })}
                >
                  <span>{t('rulesets.tabRules')}</span>
                  <Badge variant={search.tab === 'rules' ? 'default' : 'outline'} className="ml-1 text-[10px]">
                    {(selectedRuleset.ruleCount ?? 0).toLocaleString()}
                  </Badge>
                </Button>
                <Button
                  size="sm"
                  data-testid="ruleset-tab-sources"
                  variant={search.tab === 'sources' ? 'primary' : 'outline'}
                  onClick={() => updateSearch({ tab: 'sources' })}
                >
                  <span>{t('rulesets.tabSources')}</span>
                  <Badge variant={search.tab === 'sources' ? 'default' : 'outline'} className="ml-1 text-[10px]">
                    {(selectedRuleset.sources ?? []).length}
                  </Badge>
                </Button>
              </div>

              {search.tab === 'sources' ? (
                <Suspense fallback={<div className="h-32 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />}>
                  <SourcesPanel rulesetId={selectedRuleset.id} />
                </Suspense>
              ) : (
                /* Rules management card with server-side search & cursor pagination */
                <Card data-testid="rules-list-card">
                  <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <span>{t('rules.sectionTitle')}</span>
                        <Badge variant="outline" data-testid="rules-total-badge">
                          {totalRules.toLocaleString()}
                        </Badge>
                      </CardTitle>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid="bulk-import-open-btn"
                        onClick={() => setBulkImportOpen(true)}
                      >
                        <Upload className="h-3.5 w-3.5" />
                        <span>{t('rules.bulkImport')}</span>
                      </Button>
                      <Button
                        size="sm"
                        data-testid="add-rule-btn"
                        onClick={() => setRuleDialog({ open: true, mode: 'create', rule: null, conflicts: [] })}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>{t('rules.add')}</span>
                      </Button>
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-col gap-3">
                    {/* Server search & source filter */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                        <Input
                          data-testid="rules-search-input"
                          value={ruleSearchInput}
                          onChange={(event) => setRuleSearchInput(event.target.value)}
                          placeholder={t('rules.searchPlaceholder')}
                          className="pl-9"
                        />
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(['all', 'manual', 'upstream'] as const).map((item) => (
                          <Button
                            key={item}
                            size="sm"
                            data-testid={`rulesets-source-${item}`}
                            variant={search.source === item ? 'primary' : 'outline'}
                            onClick={() => updateSearch({ source: item === 'all' ? undefined : item })}
                          >
                            {item === 'all'
                              ? t('rulesets.filterAll')
                              : item === 'manual'
                                ? t('rulesets.filterManual')
                                : t('rulesets.filterUpstream')}
                          </Button>
                        ))}
                      </div>
                    </div>

                    {/* Batch selection bar */}
                    {manualPageRuleIds.length > 0 ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-border bg-surface-muted/60 px-3 py-2 text-xs">
                        <label className="flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            data-testid="rules-select-all"
                            checked={allManualPageSelected}
                            onChange={toggleSelectAllPage}
                            className="h-4 w-4 accent-primary"
                          />
                          <span>{t('rules.selectAllPage')}</span>
                          {selectedRuleIds.length > 0 ? (
                            <Badge variant="primary">
                              {t('rules.selectedCount')} {selectedRuleIds.length}
                            </Badge>
                          ) : null}
                        </label>
                        {selectedRuleIds.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1.5" data-testid="rules-batch-actions">
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid="rules-batch-enable"
                              disabled={batchRuleMutation.isPending}
                              onClick={() => batchRuleMutation.mutate({ ruleIds: selectedRuleIds, action: 'enable' })}
                            >
                              {t('rules.batchEnable')}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid="rules-batch-disable"
                              disabled={batchRuleMutation.isPending}
                              onClick={() => batchRuleMutation.mutate({ ruleIds: selectedRuleIds, action: 'disable' })}
                            >
                              {t('rules.batchDisable')}
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              data-testid="rules-batch-delete"
                              disabled={batchRuleMutation.isPending}
                              onClick={() => setBatchDeleteOpen(true)}
                            >
                              {t('rules.batchDelete')}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Paginated rules list */}
                    {rulesQuery.isLoading ? (
                      <div className="flex flex-col gap-2">
                        <div className="h-11 animate-pulse rounded bg-surface-muted" />
                        <div className="h-11 animate-pulse rounded bg-surface-muted" />
                      </div>
                    ) : rules.length === 0 ? (
                      <div
                        data-testid="rules-empty-state"
                        className="rounded-[var(--radius-md)] border border-border bg-surface-muted/40 py-8 text-center text-sm text-text-muted"
                      >
                        {t('rules.emptyRules')}
                      </div>
                    ) : (
                      <div
                        className="flex flex-col divide-y divide-border rounded-[var(--radius-md)] border border-border"
                        data-testid="rules-rows"
                      >
                        {rules.map((rule) => {
                          const isManual = !rule.sourceId;
                          const isChecked = selectedRuleIds.includes(rule.id);
                          return (
                            <div
                              key={rule.id}
                              data-testid={`rule-row-${rule.id}`}
                              className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                                <input
                                  type="checkbox"
                                  disabled={!isManual}
                                  checked={isChecked}
                                  data-testid={`rule-checkbox-${rule.id}`}
                                  onChange={() => toggleRuleSelection(rule.id)}
                                  className="mt-1 h-4 w-4 shrink-0 accent-primary disabled:opacity-30"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <Badge variant="outline" className="font-mono text-[11px]">
                                      {rule.type}
                                    </Badge>
                                    <span
                                      className={`break-all font-mono text-xs ${
                                        rule.enabled ? 'text-text' : 'text-text-muted line-through'
                                      }`}
                                    >
                                      {rule.value}
                                    </span>
                                    {rule.options?.noResolve ? (
                                      <Badge variant="accent" className="text-[10px]">
                                        no-resolve
                                      </Badge>
                                    ) : null}
                                    <Badge variant={isManual ? 'primary' : 'outline'} className="text-[10px]">
                                      {isManual
                                        ? t('rules.manualBadge')
                                        : (rule.sourceName ?? t('rules.readonlyUpstream'))}
                                    </Badge>
                                  </div>
                                  {rule.note ? <p className="mt-0.5 text-xs text-text-muted">{rule.note}</p> : null}
                                </div>
                              </div>

                              <div className="flex shrink-0 items-center justify-end gap-2">
                                <Switch
                                  data-testid={`rule-toggle-${rule.id}`}
                                  disabled={!isManual}
                                  checked={rule.enabled}
                                  onCheckedChange={(checked) =>
                                    toggleRuleMutation.mutate({ ruleId: rule.id, enabled: checked })
                                  }
                                />
                                {isManual ? (
                                  <>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      aria-label={t('rules.edit')}
                                      data-testid={`rule-edit-${rule.id}`}
                                      onClick={() => setRuleDialog({ open: true, mode: 'edit', rule, conflicts: [] })}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      aria-label={t('rules.delete')}
                                      data-testid={`rule-delete-${rule.id}`}
                                      onClick={() => setDeleteRuleTarget(rule)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5 text-danger" />
                                    </Button>
                                  </>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Cursor Pagination Footer */}
                    <div
                      data-testid="rules-pagination"
                      className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-text-muted"
                    >
                      <span>
                        {t('rules.pageSummary')} {currentPageIndex} · {t('rules.totalLabel')}{' '}
                        {totalRules.toLocaleString()} {t('rules.unitItems')}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="rules-prev-page"
                          disabled={cursorStack.length <= 1 || rulesQuery.isFetching}
                          onClick={() => {
                            setSelectedRuleIds([]);
                            setCursorStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
                          }}
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                          <span>{t('rules.prevPage')}</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="rules-next-page"
                          disabled={!hasMore || !nextCursor || rulesQuery.isFetching}
                          onClick={() => {
                            if (!nextCursor) return;
                            setSelectedRuleIds([]);
                            setCursorStack((prev) => [...prev, nextCursor]);
                          }}
                        >
                          <span>{t('rules.nextPage')}</span>
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      {/* Dialogs & Drawers (form dialogs lazy-loaded on demand so /rulesets route chunk stays lean) */}
      <Suspense fallback={null}>
        {rulesetDialog.open ? (
          <RulesetFormDialog
            open={rulesetDialog.open}
            mode={rulesetDialog.mode}
            initial={rulesetDialog.mode === 'edit' ? selectedRuleset : null}
            submitting={createRulesetMutation.isPending || updateRulesetMutation.isPending}
            onOpenChange={(open) => setRulesetDialog((prev) => ({ ...prev, open }))}
            onSubmit={async (values) => {
              if (rulesetDialog.mode === 'create') {
                await createRulesetMutation.mutateAsync(values);
              } else if (selectedRuleset) {
                await updateRulesetMutation.mutateAsync({
                  id: selectedRuleset.id,
                  patch: {
                    name: values.name,
                    icon: values.icon,
                    description: values.description,
                    note: values.note,
                    enabled: values.enabled,
                    publicLinksEnabled: values.publicLinksEnabled,
                    tokenLinksEnabled: values.tokenLinksEnabled,
                  },
                });
                setRulesetDialog({ open: false, mode: 'edit' });
              }
            }}
          />
        ) : null}

        {ruleDialog.open ? (
          <RuleFormDialog
            open={ruleDialog.open}
            mode={ruleDialog.mode}
            initial={ruleDialog.rule}
            conflicts={ruleDialog.conflicts}
            submitting={saveRuleMutation.isPending}
            onOpenChange={(open) => setRuleDialog((prev) => ({ ...prev, open, ...(open ? {} : { conflicts: [] }) }))}
            onSubmit={async (values, replaceConflicts) => {
              await saveRuleMutation.mutateAsync({
                mode: ruleDialog.mode,
                ruleId: ruleDialog.rule?.id,
                values,
                replaceConflicts,
              });
            }}
          />
        ) : null}

        {bulkImportOpen ? (
          <BulkImportDialog
            open={bulkImportOpen}
            onOpenChange={setBulkImportOpen}
            onPreview={handleBulkPreview}
            onConfirm={handleBulkConfirm}
          />
        ) : null}

        {linksDrawerOpen ? (
          <SubscriptionLinksDrawer
            open={linksDrawerOpen}
            ruleset={selectedRuleset}
            links={selectedLinks}
            onOpenChange={setLinksDrawerOpen}
          />
        ) : null}

        {deleteRulesetOpen ? (
          <DeleteConfirmDialog
            open={deleteRulesetOpen}
            title={t('rulesets.deleteConfirmTitle')}
            description={t('rulesets.deleteConfirmBody')}
            itemName={selectedRuleset ? `${selectedRuleset.name} (${selectedRuleset.slug})` : undefined}
            submitting={deleteRulesetMutation.isPending}
            onOpenChange={setDeleteRulesetOpen}
            onConfirm={async () => {
              if (!selectedRuleset) return;
              await deleteRulesetMutation.mutateAsync(selectedRuleset.id);
            }}
          />
        ) : null}

        {deleteRuleTarget ? (
          <DeleteConfirmDialog
            open={Boolean(deleteRuleTarget)}
            title={t('rules.delete')}
            description={t('rules.deleteConfirmBody')}
            itemName={`${deleteRuleTarget.type},${deleteRuleTarget.value}`}
            submitting={deleteRuleMutation.isPending}
            onOpenChange={(open) => {
              if (!open) setDeleteRuleTarget(null);
            }}
            onConfirm={async () => {
              await deleteRuleMutation.mutateAsync(deleteRuleTarget.id);
            }}
          />
        ) : null}

        {batchDeleteOpen ? (
          <DeleteConfirmDialog
            open={batchDeleteOpen}
            title={t('rules.deleteConfirmTitle')}
            description={t('rules.deleteConfirmBody')}
            itemName={`${selectedRuleIds.length} ${t('rules.unitItems')}`}
            submitting={batchRuleMutation.isPending}
            onOpenChange={setBatchDeleteOpen}
            onConfirm={async () => {
              await batchRuleMutation.mutateAsync({ ruleIds: selectedRuleIds, action: 'delete' });
            }}
          />
        ) : null}
      </Suspense>
    </div>
  );
}
