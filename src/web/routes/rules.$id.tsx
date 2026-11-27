import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Code2,
  Copy,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  describeRuleFriendly,
  formatRawRuleLine,
  isIpCidrRuleType,
  previewRuleInputFriendly,
} from '../../domain/rules/friendly';
import type { ManualRuleFormValues } from '../../shared/schemas/rule';
import type { SourceFormValues } from '../../shared/schemas/source';
import type {
  DomainRule,
  DomainRuleType,
  ImportPreview,
  RuleCategory,
  RuleConflict,
  RuleSource,
} from '../../types/domain-rules';
import type { EditRuleCategoryInput } from '../components/rulesets/RuleCategoryDialog';
import {
  formatFriendlyRuleInline,
  formatFriendlyRuleType,
  formatRuleResolveHint,
  formatSyncTimestamp,
  intervalLabelKey,
} from '../components/rulesets/rule-library-helpers';
import { RuleTypeSelectField } from '../components/rulesets/RuleTypeSelectField';
import { CategoryIcon } from '../components/subscriptions/CategoryIcon';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import { loadPageTranslations, useI18n } from '../i18n';
import { api, ApiClientError, formatApiError, readApiJson } from '../lib/api';
import { isTelegramSession, requireAuthBeforeLoad } from '../lib/auth-guard';
import {
  authMeQueryOptions,
  invalidateRulesets,
  queryKeys,
  rulesetRulesQueryOptions,
  rulesetSourcesQueryOptions,
  rulesetsListQueryOptions,
  settingsDetailQueryOptions,
  type RulesPageFilter,
  type RulesPagePayload,
  type RulesetSummaryPayload,
} from '../lib/query';
import { useToast } from '../lib/toast';

const RuleCategoryDialog = lazy(() =>
  import('../components/rulesets/RuleCategoryDialog').then((m) => ({ default: m.RuleCategoryDialog })),
);
const RuleFormDialog = lazy(() =>
  import('../components/rulesets/RuleFormDialog').then((m) => ({ default: m.RuleFormDialog })),
);
const SourceFormDialog = lazy(() =>
  import('../components/rulesets/SourceFormDialog').then((m) => ({ default: m.SourceFormDialog })),
);
const DeleteConfirmDialog = lazy(() =>
  import('../components/rulesets/DeleteConfirmDialog').then((m) => ({ default: m.DeleteConfirmDialog })),
);

const RULES_PAGE_SIZE = 50;
const MIRROR_PAGE_SIZE = 50;

type RuleDetailSearch = {
  rq?: string;
};

export const Route = createFileRoute('/rules/$id')({
  validateSearch: (search: Record<string, unknown>): RuleDetailSearch => {
    const rq = typeof search.rq === 'string' && search.rq ? search.rq : undefined;
    return rq ? { rq } : {};
  },
  beforeLoad: async ({ context, location }) => {
    await Promise.all([requireAuthBeforeLoad(context.queryClient, location.href), loadPageTranslations()]);
  },
  component: RuleDetailPage,
});

function extractConflicts(error: unknown): RuleConflict[] {
  if (!(error instanceof ApiClientError)) return [];
  const details = error.details as { conflicts?: RuleConflict[] } | undefined;
  return Array.isArray(details?.conflicts) ? details.conflicts : [];
}

function RuleRowMenu({
  rule,
  typeLabel,
  typeDescription,
  isTelegram,
  rawExpanded,
  onEdit,
  onCopy,
  onToggleRaw,
  onDelete,
}: {
  rule: DomainRule;
  typeLabel: string;
  typeDescription: string;
  isTelegram: boolean;
  rawExpanded: boolean;
  onEdit: () => void;
  onCopy: () => void;
  onToggleRaw: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={t('preview.menuTrigger')}
        aria-expanded={open}
        data-testid={`rule-menu-${rule.id}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 flex w-56 flex-col rounded-[var(--radius-md)] border border-border bg-surface p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            data-testid={`rule-edit-${rule.id}`}
            disabled={isTelegram}
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-xs text-text transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Pencil className="h-3.5 w-3.5 text-text-muted" />
            <span>{t('common.edit')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid={`rule-copy-${rule.id}`}
            onClick={() => {
              setOpen(false);
              onCopy();
            }}
            className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-xs text-text transition-colors hover:bg-surface-muted"
          >
            <Copy className="h-3.5 w-3.5 text-text-muted" />
            <span>{t('ruleDetail.copyValue')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid={`rule-view-raw-${rule.id}`}
            title={`${typeLabel}：${typeDescription}`}
            onClick={() => {
              setOpen(false);
              onToggleRaw();
            }}
            className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-xs text-text transition-colors hover:bg-surface-muted"
          >
            <Code2 className="h-3.5 w-3.5 text-text-muted" />
            <span>{rawExpanded ? t('ruleDetail.hideRaw') : t('ruleDetail.viewRaw')}</span>
          </button>
          <div className="mx-1.5 my-1 rounded-[var(--radius-sm)] bg-surface-muted/70 px-2 py-1.5 text-[11px] leading-snug text-text-muted">
            <span className="font-medium text-text">{typeLabel}</span>：{typeDescription}
          </div>
          <button
            type="button"
            role="menuitem"
            data-testid={`rule-delete-${rule.id}`}
            disabled={isTelegram}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-xs text-danger transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t('common.delete')}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RuleDetailPage() {
  const { id } = Route.useParams();
  const { rq = '' } = Route.useSearch();
  const routeNavigate = Route.useNavigate();
  const routerNavigate = useNavigate();
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const authQuery = useQuery(authMeQueryOptions());
  const isTelegram = isTelegramSession(authQuery.data);

  const summaryQuery = useQuery(rulesetsListQueryOptions());
  const settingsQuery = useQuery({
    ...settingsDetailQueryOptions(),
    enabled: !isTelegram,
  });

  const category: RuleCategory | null = useMemo(() => {
    const categories = summaryQuery.data?.data.categories ?? [];
    return categories.find((item) => item.id === id) ?? null;
  }, [summaryQuery.data, id]);

  const sourcesQuery = useQuery({
    ...rulesetSourcesQueryOptions(id),
    enabled: Boolean(category),
  });
  const sources = sourcesQuery.data?.sources ?? [];

  // Upstream mirror collapsible state
  const [mirrorOpen, setMirrorOpen] = useState(false);
  const [mirrorCursorStack, setMirrorCursorStack] = useState<Array<string | undefined>>([undefined]);
  const mirrorCursor = mirrorCursorStack[mirrorCursorStack.length - 1];
  const mirrorRulesQuery = useQuery({
    ...rulesetRulesQueryOptions(id, {
      source: 'upstream',
      limit: MIRROR_PAGE_SIZE,
      ...(mirrorCursor ? { cursor: mirrorCursor } : {}),
    }),
    enabled: Boolean(category) && mirrorOpen,
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    setMirrorOpen(false);
    setMirrorCursorStack([undefined]);
  }, [id]);

  // Custom rules search + pagination + batch mode
  const [ruleSearchInput, setRuleSearchInput] = useState(rq);
  useEffect(() => {
    setRuleSearchInput(rq);
  }, [rq]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (ruleSearchInput !== rq) {
        void routeNavigate({
          search: ruleSearchInput ? { rq: ruleSearchInput } : {},
          replace: true,
        });
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [ruleSearchInput, rq, routeNavigate]);

  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined]);
  const [manageMode, setManageMode] = useState(false);
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([]);
  const [rawExpandedIds, setRawExpandedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCursorStack([undefined]);
    setSelectedRuleIds([]);
  }, [id, rq]);

  const currentCursor = cursorStack[cursorStack.length - 1];
  const currentPageIndex = cursorStack.length;

  const rulesFilter: RulesPageFilter = useMemo(
    () => ({
      source: 'manual',
      ...(rq ? { q: rq } : {}),
      ...(currentCursor ? { cursor: currentCursor } : {}),
      limit: RULES_PAGE_SIZE,
    }),
    [rq, currentCursor],
  );

  const rulesQuery = useQuery({
    ...rulesetRulesQueryOptions(id, rulesFilter),
    enabled: Boolean(category),
    placeholderData: keepPreviousData,
  });

  const rules = rulesQuery.data?.rules ?? [];
  const totalCustomRules = rulesQuery.data?.total ?? category?.manualRuleCount ?? 0;
  const hasMore = rulesQuery.data?.hasMore ?? false;
  const nextCursor = rulesQuery.data?.nextCursor ?? null;

  // Single add inline form state
  const [singleValue, setSingleValue] = useState('');
  const [singleType, setSingleType] = useState<'AUTO' | DomainRuleType>('AUTO');
  const [singleNote, setSingleNote] = useState('');
  const [singleNoResolve, setSingleNoResolve] = useState(true);
  const [singleNoResolveTouched, setSingleNoResolveTouched] = useState(false);
  const [singleConflicts, setSingleConflicts] = useState<RuleConflict[]>([]);
  const [singleValueError, setSingleValueError] = useState('');

  const singlePreview = useMemo(() => previewRuleInputFriendly(singleValue, singleType), [singleValue, singleType]);

  const effectiveSingleType = singleType === 'AUTO' ? (singlePreview?.ok ? singlePreview.type : undefined) : singleType;
  const singleIsIpType = isIpCidrRuleType(effectiveSingleType);

  useEffect(() => {
    if (!singleNoResolveTouched) {
      setSingleNoResolve(singleIsIpType);
    }
  }, [singleIsIpType, singleNoResolveTouched]);

  // Bulk add inline state
  const [bulkText, setBulkText] = useState('');
  const [bulkStep, setBulkStep] = useState<1 | 2 | 3>(1);
  const [bulkPreview, setBulkPreview] = useState<ImportPreview | null>(null);
  const [bulkReplaceConflicts, setBulkReplaceConflicts] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ importedCount: number; replaced: number } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState('');

  // Dialog states
  const [editCategoryOpen, setEditCategoryOpen] = useState(false);
  const [deleteCategoryOpen, setDeleteCategoryOpen] = useState(false);
  const [sourceDialog, setSourceDialog] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    source: RuleSource | null;
  }>({ open: false, mode: 'create', source: null });
  const [deleteSourceTarget, setDeleteSourceTarget] = useState<RuleSource | null>(null);
  const [syncingSourceId, setSyncingSourceId] = useState<string | null>(null);
  const [editRuleDialog, setEditRuleDialog] = useState<{
    open: boolean;
    rule: DomainRule | null;
    conflicts: RuleConflict[];
  }>({ open: false, rule: null, conflicts: [] });
  const [deleteRuleTarget, setDeleteRuleTarget] = useState<DomainRule | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);

  // --- Category Mutations ---
  const updateCategoryMutation = useMutation({
    mutationFn: async (args: {
      patch: Partial<{ name: string; description: string; icon: string; enabled: boolean }>;
      silent?: boolean;
    }) =>
      readApiJson<RulesetSummaryPayload>(
        await api.api.rulesets[':id'].$patch({
          param: { id },
          json: args.patch,
        }),
      ),
    onMutate: async ({ patch }) => {
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
      setEditCategoryOpen(false);
      if (!variables.silent) {
        notify({ title: t('ruleLibrary.updatedCategoryToast'), variant: 'success' });
      }
    },
    onSettled: async () => {
      await invalidateRulesets(queryClient, id);
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async () =>
      readApiJson<RulesetSummaryPayload>(await api.api.rulesets[':id'].$delete({ param: { id } })),
    onSuccess: async () => {
      setDeleteCategoryOpen(false);
      await invalidateRulesets(queryClient);
      notify({ title: t('ruleLibrary.deletedCategoryToast'), variant: 'success' });
      void routerNavigate({ to: '/rules', replace: true });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  // --- Upstream Source Mutations ---
  const syncCategoryMutation = useMutation({
    mutationFn: async () =>
      readApiJson<{ results: Array<{ ok: boolean; error?: string }> }>(
        await api.api.rulesets[':id'].sync.$post({ param: { id } }),
      ),
    onSuccess: async () => {
      await invalidateRulesets(queryClient, id);
      notify({ title: t('ruleDetail.upstreamSyncedToast'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const saveSourceMutation = useMutation({
    mutationFn: async (args: { mode: 'create' | 'edit'; sourceId?: string; values: SourceFormValues }) => {
      const body = {
        sourceType: args.values.sourceType,
        name: args.values.name.trim() || undefined,
        url: args.values.sourceType === 'url' ? args.values.url.trim() : undefined,
        geositeName: args.values.sourceType === 'geosite' ? args.values.geositeName.trim() : undefined,
        geoipName: args.values.sourceType === 'geoip' ? args.values.geoipName.trim() : undefined,
        syncIntervalMinutes: args.values.syncIntervalMinutes,
        userAgent: args.values.userAgent.trim() || undefined,
        ruleOptimization: args.values.sourceType === 'url' ? args.values.ruleOptimization : ('none' as const),
        enabled: args.values.enabled,
      };
      if (args.mode === 'create') {
        return readApiJson<{ source: RuleSource }>(
          await api.api.rulesets[':id'].sources.$post({
            param: { id },
            json: body,
          }),
        );
      }
      return readApiJson<{ source: RuleSource }>(
        await api.api.rulesets[':id'].sources[':sourceId'].$patch({
          param: { id, sourceId: args.sourceId! },
          json: body,
        }),
      );
    },
    onSuccess: async (_data, variables) => {
      setSourceDialog({ open: false, mode: 'create', source: null });
      await invalidateRulesets(queryClient, id);
      notify({
        title: variables.mode === 'create' ? t('sources.created') : t('sources.updated'),
        variant: 'success',
      });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const toggleSourceMutation = useMutation({
    mutationFn: async (args: { sourceId: string; enabled: boolean }) =>
      readApiJson<{ source: RuleSource }>(
        await api.api.rulesets[':id'].sources[':sourceId'].toggle.$post({
          param: { id, sourceId: args.sourceId },
          json: { enabled: args.enabled },
        }),
      ),
    onMutate: async ({ sourceId, enabled }) => {
      const key = queryKeys.rulesets.sources(id);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<{ sources: RuleSource[] }>(key);
      if (previous) {
        queryClient.setQueryData(key, {
          sources: previous.sources.map((item) => (item.id === sourceId ? { ...item, enabled } : item)),
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
      await invalidateRulesets(queryClient, id);
    },
  });

  const syncSingleSourceMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      setSyncingSourceId(sourceId);
      return readApiJson<{
        result?: { ok: boolean; error?: string };
        results?: Array<{ ok: boolean; error?: string }>;
      }>(
        await api.api.rulesets[':id'].sources[':sourceId'].sync.$post({
          param: { id, sourceId },
        }),
      );
    },
    onSuccess: async (payload) => {
      await invalidateRulesets(queryClient, id);
      const outcome = payload.result ?? payload.results?.[0];
      if (outcome && !outcome.ok) {
        notify({ title: outcome.error || t('sources.statusError'), variant: 'danger' });
      } else {
        notify({ title: t('sources.synced'), variant: 'success' });
      }
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
    onSettled: () => {
      setSyncingSourceId(null);
    },
  });

  const deleteSourceMutation = useMutation({
    mutationFn: async (sourceId: string) =>
      readApiJson(
        await api.api.rulesets[':id'].sources[':sourceId'].$delete({
          param: { id, sourceId },
        }),
      ),
    onSuccess: async () => {
      setDeleteSourceTarget(null);
      await invalidateRulesets(queryClient, id);
      notify({ title: t('sources.deleted'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  // --- Rule Mutations ---
  const addSingleRuleMutation = useMutation({
    mutationFn: async (args: { replaceConflicts: boolean }) => {
      const options = singleIsIpType ? { noResolve: singleNoResolve } : undefined;
      return readApiJson(
        await api.api.rulesets[':id'].rules.$post({
          param: { id },
          json: {
            value: singleValue.trim(),
            ...(singleType !== 'AUTO' ? { type: singleType } : {}),
            note: singleNote.trim() || undefined,
            enabled: true,
            ...(options ? { options } : {}),
            replaceConflicts: args.replaceConflicts,
          },
        }),
      );
    },
    onSuccess: async () => {
      setSingleValue('');
      setSingleType('AUTO');
      setSingleNote('');
      setSingleNoResolve(true);
      setSingleNoResolveTouched(false);
      setSingleConflicts([]);
      setSingleValueError('');
      await invalidateRulesets(queryClient, id);
      notify({ title: t('rules.created'), variant: 'success' });
    },
    onError: (error) => {
      const conflicts = extractConflicts(error);
      if (conflicts.length > 0) {
        setSingleConflicts(conflicts);
        return;
      }
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const updateRuleMutation = useMutation({
    mutationFn: async (args: { ruleId: string; values: ManualRuleFormValues }) => {
      const options = isIpCidrRuleType(args.values.type) ? { noResolve: args.values.noResolve } : undefined;
      return readApiJson(
        await api.api.rulesets[':id'].rules[':ruleId'].$patch({
          param: { id, ruleId: args.ruleId },
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
    onSuccess: async () => {
      setEditRuleDialog({ open: false, rule: null, conflicts: [] });
      await invalidateRulesets(queryClient, id);
      notify({ title: t('rules.updated'), variant: 'success' });
    },
    onError: (error) => {
      const conflicts = extractConflicts(error);
      if (conflicts.length > 0) {
        setEditRuleDialog((prev) => ({ ...prev, conflicts }));
        return;
      }
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const toggleRuleMutation = useMutation({
    mutationFn: async (args: { ruleId: string; enabled: boolean }) =>
      readApiJson(
        await api.api.rulesets[':id'].rules[':ruleId'].$patch({
          param: { id, ruleId: args.ruleId },
          json: { enabled: args.enabled },
        }),
      ),
    onMutate: async ({ ruleId, enabled }) => {
      const key = queryKeys.rulesets.rules(id, rulesFilter);
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
      await invalidateRulesets(queryClient, id);
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (ruleId: string) =>
      readApiJson(
        await api.api.rulesets[':id'].rules[':ruleId'].$delete({
          param: { id, ruleId },
        }),
      ),
    onSuccess: async () => {
      setDeleteRuleTarget(null);
      await invalidateRulesets(queryClient, id);
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
          param: { id },
          json: args,
        }),
      ),
    onSuccess: async (_data, variables) => {
      setSelectedRuleIds([]);
      setBatchDeleteOpen(false);
      await invalidateRulesets(queryClient, id);
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

  // Bulk import handlers
  const handleBulkPreview = async (event: FormEvent) => {
    event.preventDefault();
    if (!bulkText.trim()) {
      setBulkError(t('import.validationTextRequired'));
      return;
    }
    setBulkError('');
    setBulkBusy(true);
    try {
      const payload = await readApiJson<{ preview: ImportPreview }>(
        await api.api.rulesets[':id'].rules.import.$post({
          param: { id },
          json: { text: bulkText, confirm: false },
        }),
      );
      setBulkPreview(payload.preview);
      setBulkReplaceConflicts(false);
      setBulkStep(2);
    } catch (error) {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkConfirm = async () => {
    setBulkBusy(true);
    try {
      const payload = await readApiJson<{ preview: ImportPreview; replaced: number }>(
        await api.api.rulesets[':id'].rules.import.$post({
          param: { id },
          json: { text: bulkText, confirm: true, replaceConflicts: bulkReplaceConflicts },
        }),
      );
      await invalidateRulesets(queryClient, id);
      setBulkResult({
        importedCount: payload.preview.rules.length,
        replaced: payload.replaced ?? 0,
      });
      setBulkStep(3);
      notify({ title: t('import.successTitle'), variant: 'success' });
    } catch (error) {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    } finally {
      setBulkBusy(false);
    }
  };

  const resetBulkAdd = () => {
    setBulkText('');
    setBulkPreview(null);
    setBulkReplaceConflicts(false);
    setBulkResult(null);
    setBulkError('');
    setBulkStep(1);
  };

  const handleSingleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!singleValue.trim()) {
      setSingleValueError(t('rules.validationValueRequired'));
      return;
    }
    setSingleValueError('');
    addSingleRuleMutation.mutate({ replaceConflicts: false });
  };

  const handleCopyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify({ title: t('ruleDetail.copiedValueToast'), variant: 'success' });
    } catch {
      notify({ title: value });
    }
  };

  const pageRuleIds = useMemo(() => rules.map((item) => item.id), [rules]);
  const allPageSelected = pageRuleIds.length > 0 && pageRuleIds.every((ruleId) => selectedRuleIds.includes(ruleId));

  const toggleSelectRule = (ruleId: string) => {
    setSelectedRuleIds((prev) => (prev.includes(ruleId) ? prev.filter((item) => item !== ruleId) : [...prev, ruleId]));
  };

  const toggleSelectAllPage = () => {
    if (allPageSelected) {
      setSelectedRuleIds((prev) => prev.filter((ruleId) => !pageRuleIds.includes(ruleId)));
    } else {
      setSelectedRuleIds((prev) => [...new Set([...prev, ...pageRuleIds])]);
    }
  };

  if (summaryQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4" data-testid="rule-detail-loading">
        <div className="h-8 w-36 animate-pulse rounded-[var(--radius-sm)] bg-surface-muted" />
        <div className="h-28 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
        <div className="h-64 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
      </div>
    );
  }

  if (!category) {
    return (
      <div className="flex flex-col gap-4" data-testid="rule-detail-not-found">
        <Link
          to="/rules"
          data-testid="back-to-rules-btn"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-text-muted transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{t('ruleLibrary.backToLibrary')}</span>
        </Link>
        <EmptyState
          title={t('ruleLibrary.notFoundTitle')}
          description={t('ruleLibrary.notFoundDesc')}
          action={
            <Button asChild variant="outline">
              <Link to="/rules">{t('ruleLibrary.backToLibrary')}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const primarySyncInterval = sources.reduce<number | undefined>((min, source) => {
    const minutes = source.syncIntervalMinutes || 60;
    return min === undefined ? minutes : Math.min(min, minutes);
  }, undefined);

  const upstreamSubtitle =
    sources.length > 0
      ? `${t(intervalLabelKey(primarySyncInterval))} ${t('ruleDetail.upstreamSubtitlePattern')}`
      : t('ruleDetail.upstreamEmptySubtitle');

  const upstreamRuleCount = (category.urlRuleCount ?? 0) + (category.geoRuleCount ?? 0);
  const mirrorRules = mirrorRulesQuery.data?.rules ?? [];
  const mirrorTotal = mirrorRulesQuery.data?.total ?? upstreamRuleCount;
  const mirrorHasMore = mirrorRulesQuery.data?.hasMore ?? false;
  const mirrorNextCursor = mirrorRulesQuery.data?.nextCursor ?? null;

  const customIconPackUrls = settingsQuery.data?.settings.customIconPackUrls ?? [];
  const customIconPackNames = settingsQuery.data?.settings.customIconPackNames ?? {};

  const bulkConflictCount = bulkPreview?.conflicts?.length ?? 0;

  return (
    <div className="flex flex-col gap-5" data-testid="rule-detail-page">
      {/* Back link */}
      <div>
        <Link
          to="/rules"
          data-testid="back-to-rules-btn"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{t('ruleLibrary.backToLibrary')}</span>
        </Link>
      </div>

      {isTelegram ? (
        <div
          data-testid="telegram-restriction-banner"
          className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-warning bg-surface p-3 text-xs text-text-muted shadow-sm"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>{t('rulesets.telegramOnlySwitches')}</span>
        </div>
      ) : null}

      {/* Header */}
      <div
        className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between"
        data-testid="rule-detail-header"
      >
        <div className="flex min-w-0 items-center gap-3.5">
          <CategoryIcon name={category.name} icon={category.icon} size={44} />
          <div className="min-w-0">
            <h1
              className="truncate text-xl font-bold tracking-tight text-text sm:text-2xl"
              data-testid="rule-detail-title"
            >
              {category.name}
            </h1>
            {category.description ? <p className="mt-0.5 text-sm text-text-muted">{category.description}</p> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface-muted/60 px-2.5 py-1.5">
            <span className="text-xs text-text-muted">{t('common.enabled')}</span>
            <Switch
              data-testid="ruleset-enabled-toggle"
              checked={category.enabled !== false}
              disabled={updateCategoryMutation.isPending}
              onCheckedChange={(checked) =>
                updateCategoryMutation.mutate({ patch: { enabled: checked }, silent: true })
              }
            />
          </div>
          <Button asChild size="sm" variant="outline" data-testid="ruleset-open-links-btn">
            <Link to="/subscriptions/$id" params={{ id: category.id }}>
              <Link2 className="h-3.5 w-3.5" />
              <span>{t('rulesets.openLinks')}</span>
            </Link>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="edit-ruleset-btn"
            disabled={isTelegram}
            onClick={() => setEditCategoryOpen(true)}
          >
            <Pencil className="h-3.5 w-3.5" />
            <span>{t('ruleLibrary.editRuleCategory')}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="danger"
            data-testid="delete-ruleset-btn"
            disabled={isTelegram}
            onClick={() => setDeleteCategoryOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t('ruleLibrary.deleteRuleCategory')}</span>
          </Button>
        </div>
      </div>

      {/* Section 1: Upstream sync */}
      <Card data-testid="sources-panel">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{t('ruleDetail.upstreamTitle')}</CardTitle>
            <CardDescription className="mt-1">{upstreamSubtitle}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {sources.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="sync-upstream-btn"
                disabled={syncCategoryMutation.isPending || isTelegram}
                onClick={() => syncCategoryMutation.mutate()}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncCategoryMutation.isPending ? 'animate-spin' : ''}`} />
                <span>
                  {syncCategoryMutation.isPending ? t('ruleDetail.syncingUpstream') : t('ruleDetail.syncUpstream')}
                </span>
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              data-testid="add-source-btn"
              disabled={isTelegram}
              onClick={() => setSourceDialog({ open: true, mode: 'create', source: null })}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{t('sources.add')}</span>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {sourcesQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              <div className="h-16 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
            </div>
          ) : sources.length === 0 ? (
            <div
              data-testid="sources-empty"
              className="rounded-[var(--radius-md)] border border-dashed border-border bg-surface-muted/40 px-4 py-5 text-center text-xs text-text-muted"
            >
              {t('sources.empty')}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5" data-testid="sources-list">
              {sources.map((source) => {
                const isSyncing = syncingSourceId === source.id;
                const targetText =
                  source.sourceType === 'geosite'
                    ? `geosite:${source.geositeName}`
                    : source.sourceType === 'geoip'
                      ? `geoip:${source.geoipName}`
                      : source.url;
                const count = source.lastCount ?? 0;
                const origCount = source.lastOriginalCount;
                const countText =
                  origCount && origCount !== count
                    ? `${origCount.toLocaleString()} → ${count.toLocaleString()} ${t('ruleDetail.rulesCountUnit')}`
                    : `${count.toLocaleString()} ${t('ruleDetail.rulesCountUnit')}`;
                const syncedTime = formatSyncTimestamp(source.lastSyncedAt);
                const statusDotClass =
                  source.lastStatus === 'success'
                    ? 'bg-success'
                    : source.lastStatus === 'error'
                      ? 'bg-danger'
                      : 'bg-text-muted/40';
                const optBadge =
                  source.ruleOptimization === 'conservative'
                    ? t('ruleDetail.optBadgeConservative')
                    : source.ruleOptimization === 'aggressive'
                      ? t('ruleDetail.optBadgeAggressive')
                      : null;

                return (
                  <div
                    key={source.id}
                    data-testid={`source-row-${source.id}`}
                    className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-border bg-surface-muted/40 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusDotClass}`}
                        />
                        <span className="truncate text-sm font-semibold text-text">
                          {source.name || targetText || t('sources.typeUrl')}
                        </span>
                        {optBadge ? <Badge variant="accent">{optBadge}</Badge> : null}
                      </div>
                      {targetText ? (
                        <div className="mt-1 break-all font-mono text-xs text-text-muted">{targetText}</div>
                      ) : null}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-text-muted">
                        <span data-testid={`source-count-${source.id}`}>{countText}</span>
                        <span>·</span>
                        <span>
                          {syncedTime
                            ? `${t('ruleDetail.lastSyncedLabel')} ${syncedTime}`
                            : t('ruleDetail.neverSynced')}
                        </span>
                      </div>
                      {source.lastStatus === 'error' && source.lastError ? (
                        <p className="mt-1.5 break-words text-xs text-danger" data-testid={`source-error-${source.id}`}>
                          {source.lastError}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      <Switch
                        data-testid={`source-toggle-${source.id}`}
                        checked={source.enabled}
                        disabled={isTelegram}
                        onCheckedChange={(checked) =>
                          toggleSourceMutation.mutate({ sourceId: source.id, enabled: checked })
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        data-testid={`source-sync-${source.id}`}
                        disabled={!source.enabled || isSyncing || isTelegram}
                        onClick={() => syncSingleSourceMutation.mutate(source.id)}
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                        <span>{isSyncing ? t('sources.syncing') : t('sources.syncNow')}</span>
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={t('sources.edit')}
                        data-testid={`source-edit-${source.id}`}
                        disabled={isTelegram}
                        onClick={() => setSourceDialog({ open: true, mode: 'edit', source })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={t('sources.delete')}
                        data-testid={`source-delete-${source.id}`}
                        disabled={isTelegram}
                        onClick={() => setDeleteSourceTarget(source)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-danger" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Collapsible upstream mirror rules */}
          {upstreamRuleCount > 0 || sources.length > 0 ? (
            <div className="rounded-[var(--radius-md)] border border-border bg-surface">
              <button
                type="button"
                data-testid="upstream-mirror-rules-toggle"
                onClick={() => setMirrorOpen((prev) => !prev)}
                className="flex w-full cursor-pointer items-center justify-between gap-2 px-3.5 py-2.5 text-left text-xs font-medium text-text transition-colors hover:bg-surface-muted/60"
              >
                <span className="flex items-center gap-2">
                  <span>{t('ruleDetail.mirrorRulesTitle')}</span>
                  <span
                    data-testid="upstream-mirror-count"
                    className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-text-muted"
                  >
                    {mirrorTotal.toLocaleString()}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1 text-text-muted">
                  <span>{mirrorOpen ? t('ruleDetail.collapseView') : t('ruleDetail.expandView')}</span>
                  {mirrorOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </span>
              </button>

              {mirrorOpen ? (
                <div className="border-t border-border p-3" data-testid="upstream-mirror-rules-list">
                  {mirrorRulesQuery.isLoading ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="h-10 animate-pulse rounded bg-surface-muted" />
                      <div className="h-10 animate-pulse rounded bg-surface-muted" />
                    </div>
                  ) : mirrorRules.length === 0 ? (
                    <p className="py-2 text-center text-xs text-text-muted">{t('ruleDetail.mirrorEmpty')}</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto rounded-[var(--radius-sm)] border border-border">
                        {mirrorRules.map((rule) => {
                          const descriptor = describeRuleFriendly(rule);
                          const typeLabel = formatFriendlyRuleType(descriptor, t);
                          const inlineDesc = formatFriendlyRuleInline(descriptor, t);
                          const rawLine = formatRawRuleLine(rule);
                          return (
                            <div key={rule.id} title={rawLine} className="flex flex-col gap-0.5 px-3 py-2 text-xs">
                              <div className="break-all font-mono font-medium text-text">
                                {descriptor.params.displayValue}
                              </div>
                              <div className="text-[11px] text-text-muted">
                                {typeLabel} · {inlineDesc}
                                {rule.sourceName ? ` · ${rule.sourceName}` : ''}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {mirrorCursorStack.length > 1 || mirrorHasMore ? (
                        <div className="flex items-center justify-end gap-1.5 pt-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={mirrorCursorStack.length <= 1 || mirrorRulesQuery.isFetching}
                            onClick={() => setMirrorCursorStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))}
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                            <span>{t('rules.prevPage')}</span>
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!mirrorHasMore || !mirrorNextCursor || mirrorRulesQuery.isFetching}
                            onClick={() => {
                              if (mirrorNextCursor) setMirrorCursorStack((prev) => [...prev, mirrorNextCursor]);
                            }}
                          >
                            <span>{t('rules.nextPage')}</span>
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Section 2: Single Add & Bulk Add side-by-side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Left: Single Add */}
        <Card data-testid="single-add-card">
          <CardHeader>
            <CardTitle>{t('ruleDetail.singleAddTitle')}</CardTitle>
            <CardDescription>{t('ruleDetail.singleAddSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSingleSubmit} className="flex flex-col gap-3" noValidate>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="single-rule-value" className="text-xs font-medium text-text">
                  {t('ruleDetail.fieldAddress')}
                </label>
                <Input
                  id="single-rule-value"
                  data-testid="single-rule-value"
                  value={singleValue}
                  disabled={isTelegram}
                  onChange={(event) => {
                    setSingleValue(event.target.value);
                    setSingleValueError('');
                    setSingleConflicts([]);
                    if (!event.target.value.trim()) {
                      setSingleNoResolveTouched(false);
                    }
                  }}
                  placeholder={t('ruleDetail.fieldAddressPlaceholder')}
                  className="font-mono text-xs"
                />
                {singleValueError ? (
                  <p className="text-xs text-danger" role="alert">
                    {singleValueError}
                  </p>
                ) : singlePreview?.ok ? (
                  <div
                    data-testid="single-rule-preview"
                    className="rounded-[var(--radius-sm)] bg-surface-muted/80 px-2.5 py-1.5 text-xs text-text-muted"
                  >
                    <div>
                      <span className="font-medium text-primary">{t('ruleDetail.previewPrefix')}</span>
                      <span>
                        {formatFriendlyRuleType(singlePreview.friendly, t)} ·{' '}
                        {formatFriendlyRuleInline(singlePreview.friendly, t)}
                      </span>
                    </div>
                    <p data-testid="single-rule-preview-desc" className="mt-0.5 text-[11px] text-text-muted">
                      {t(singlePreview.friendly.descriptionKey)}
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <RuleTypeSelectField
                  id="single-rule-type"
                  selectTestId="single-rule-type"
                  value={singleType}
                  disabled={isTelegram}
                  onChange={(next) => {
                    setSingleType(next);
                    setSingleNoResolveTouched(false);
                    setSingleConflicts([]);
                  }}
                />

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="single-rule-note" className="text-xs font-medium text-text">
                    {t('ruleDetail.fieldNote')}
                  </label>
                  <Input
                    id="single-rule-note"
                    data-testid="single-rule-note"
                    value={singleNote}
                    disabled={isTelegram}
                    onChange={(event) => setSingleNote(event.target.value)}
                    placeholder={t('ruleDetail.fieldNotePlaceholder')}
                  />
                </div>
              </div>

              {/* Collapsible More Options (no-resolve, IP rules only) */}
              {singleIsIpType ? (
                <details
                  data-testid="single-rule-more-options"
                  className="rounded-[var(--radius-md)] border border-border bg-surface-muted/40"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-medium text-text-muted hover:text-text">
                    <span className="inline-flex items-center gap-1.5">
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      <span>{t('ruleDetail.moreOptions')}</span>
                    </span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </summary>
                  <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-text">{t('rules.fieldNoResolve')}</div>
                      <p className="text-[11px] text-text-muted">{t('ruleDetail.noResolveHint')}</p>
                    </div>
                    <Switch
                      data-testid="single-rule-no-resolve"
                      checked={singleNoResolve}
                      disabled={isTelegram}
                      onCheckedChange={(checked) => {
                        setSingleNoResolveTouched(true);
                        setSingleNoResolve(checked);
                      }}
                    />
                  </div>
                </details>
              ) : null}

              {singleConflicts.length > 0 ? (
                <div
                  data-testid="single-rule-conflicts"
                  role="alert"
                  className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-warning bg-surface-muted p-3"
                >
                  <div className="flex items-start gap-2 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{t('ruleDetail.conflictBody')}</span>
                  </div>
                  <ul className="flex max-h-32 flex-col gap-1.5 overflow-y-auto text-xs">
                    {singleConflicts.map((conflict) => {
                      const desc = describeRuleFriendly(conflict);
                      return (
                        <li key={conflict.id} className="rounded bg-surface px-2.5 py-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono font-medium text-text">{conflict.value}</span>
                            <span className="text-[11px] text-text-muted">
                              {formatFriendlyRuleType(desc, t)} · {conflict.categoryName}
                            </span>
                          </div>
                          {conflict.reason ? (
                            <p className="mt-0.5 text-[11px] text-text-muted">{conflict.reason}</p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      data-testid="single-rule-replace-conflicts"
                      disabled={addSingleRuleMutation.isPending || isTelegram}
                      onClick={() => addSingleRuleMutation.mutate({ replaceConflicts: true })}
                    >
                      {t('rules.replaceConflictsAndAdd')}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="flex justify-end pt-1">
                <Button
                  type="submit"
                  data-testid="single-rule-submit"
                  disabled={addSingleRuleMutation.isPending || isTelegram}
                >
                  <Plus className="h-4 w-4" />
                  <span>{addSingleRuleMutation.isPending ? t('common.loading') : t('ruleDetail.addRuleBtn')}</span>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Right: Bulk Add (inline) */}
        <Card data-testid="bulk-add-card">
          <CardHeader>
            <CardTitle>{t('ruleDetail.bulkAddTitle')}</CardTitle>
            <CardDescription>{t('ruleDetail.bulkAddSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            {bulkStep === 1 ? (
              <form onSubmit={(event) => void handleBulkPreview(event)} className="flex flex-col gap-3" noValidate>
                <textarea
                  id="bulk-import-text"
                  data-testid="bulk-import-textarea"
                  rows={5}
                  disabled={isTelegram}
                  value={bulkText}
                  onChange={(event) => {
                    setBulkText(event.target.value);
                    setBulkError('');
                  }}
                  placeholder={t('ruleDetail.bulkAddPlaceholder')}
                  className="w-full rounded-[var(--radius-sm)] border border-border bg-surface p-3 font-mono text-xs text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                />
                {bulkError ? (
                  <p className="text-xs text-danger" role="alert">
                    {bulkError}
                  </p>
                ) : null}
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    variant="outline"
                    data-testid="bulk-import-preview-btn"
                    disabled={bulkBusy || isTelegram}
                  >
                    {bulkBusy ? t('common.loading') : t('ruleDetail.previewRulesBtn')}
                  </Button>
                </div>
              </form>
            ) : null}

            {bulkStep === 2 && bulkPreview ? (
              <div className="flex flex-col gap-3" data-testid="bulk-import-preview-step">
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Badge variant="primary">
                    {t('import.summaryValid')}:{' '}
                    <span data-testid="bulk-import-valid-count">{bulkPreview.rules.length}</span>
                  </Badge>
                  {bulkPreview.invalidValues.length > 0 ? (
                    <Badge variant="danger">
                      {t('import.summaryInvalid')}: {bulkPreview.invalidValues.length}
                    </Badge>
                  ) : null}
                  {bulkPreview.duplicateValues.length > 0 ? (
                    <Badge variant="outline">
                      {t('import.summaryDuplicates')}: {bulkPreview.duplicateValues.length}
                    </Badge>
                  ) : null}
                  {bulkConflictCount > 0 ? (
                    <Badge variant="warning">
                      {t('import.summaryConflicts')}:{' '}
                      <span data-testid="bulk-import-conflict-count">{bulkConflictCount}</span>
                    </Badge>
                  ) : null}
                </div>

                {bulkPreview.rules.length > 0 ? (
                  <ul className="flex max-h-36 flex-col divide-y divide-border overflow-y-auto rounded-[var(--radius-sm)] border border-border bg-surface-muted/40 text-xs">
                    {bulkPreview.rules.slice(0, 20).map((item, idx) => {
                      const desc = describeRuleFriendly(item);
                      return (
                        <li key={`${item.type}:${item.value}:${idx}`} className="px-2.5 py-1.5">
                          <div className="break-all font-mono font-medium text-text">{desc.params.displayValue}</div>
                          <div className="text-[11px] text-text-muted">
                            {formatFriendlyRuleType(desc, t)} · {formatFriendlyRuleInline(desc, t)}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}

                {bulkPreview.invalidValues.length > 0 ? (
                  <div className="rounded-[var(--radius-md)] border border-danger/40 bg-surface-muted p-2.5 text-xs">
                    <div className="font-medium text-danger">{t('import.invalidListTitle')}</div>
                    <ul className="mt-1 max-h-24 overflow-y-auto font-mono text-[11px] text-text-muted">
                      {bulkPreview.invalidValues.slice(0, 20).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {bulkConflictCount > 0 ? (
                  <div
                    data-testid="bulk-import-conflicts"
                    className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-warning bg-surface-muted p-3"
                  >
                    <div className="flex items-start gap-2 text-xs text-warning">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{t('ruleDetail.conflictBody')}</span>
                    </div>
                    <ul className="flex max-h-28 flex-col gap-1.5 overflow-y-auto text-xs">
                      {bulkPreview.conflicts!.slice(0, 20).map((entry) => (
                        <li key={`${entry.rule.type}:${entry.rule.value}`} className="rounded bg-surface px-2.5 py-1.5">
                          <div className="font-mono font-medium text-text">{entry.rule.value}</div>
                          {entry.matches.map((match) => (
                            <p key={match.id} className="mt-0.5 text-[11px] text-text-muted">
                              ↔ {match.value} ({match.categoryName}) — {match.reason}
                            </p>
                          ))}
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                      <span className="text-xs font-medium text-text">{t('import.replaceConflictsLabel')}</span>
                      <Switch
                        data-testid="bulk-import-replace-toggle"
                        checked={bulkReplaceConflicts}
                        onCheckedChange={setBulkReplaceConflicts}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setBulkStep(1)} disabled={bulkBusy}>
                    {t('import.backAction')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    data-testid="bulk-import-confirm-btn"
                    disabled={
                      bulkBusy || bulkPreview.rules.length === 0 || (bulkConflictCount > 0 && !bulkReplaceConflicts)
                    }
                    onClick={() => void handleBulkConfirm()}
                  >
                    {bulkBusy ? t('import.importing') : t('import.confirmAction')}
                  </Button>
                </div>
              </div>
            ) : null}

            {bulkStep === 3 && bulkResult ? (
              <div className="flex flex-col gap-3" data-testid="bulk-import-done-step">
                <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-success bg-surface-muted p-3.5">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                  <div className="text-sm">
                    <div className="font-semibold text-text">{t('import.successTitle')}</div>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {t('import.successSummary')}: {bulkResult.importedCount} {t('rules.unitItems')}
                      {bulkResult.replaced > 0 ? ` · ${t('import.replacedLabel')}: ${bulkResult.replaced}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid="bulk-import-close-btn"
                    onClick={resetBulkAdd}
                  >
                    {t('common.close')}
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Section 3: Custom rules list */}
      <Card data-testid="custom-rules-card">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{t('ruleDetail.customRulesTitle')}</CardTitle>
            <CardDescription className="mt-1">
              <span data-testid="rules-total-badge">{totalCustomRules.toLocaleString()}</span>{' '}
              {t('ruleDetail.customRulesSubtitleSuffix')}
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <Input
                type="search"
                data-testid="rules-search-input"
                value={ruleSearchInput}
                onChange={(event) => setRuleSearchInput(event.target.value)}
                placeholder={t('ruleDetail.searchPlaceholder')}
                className="pl-9"
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant={manageMode ? 'primary' : 'outline'}
              data-testid="manage-rules-toggle-btn"
              disabled={isTelegram}
              onClick={() => {
                setManageMode((prev) => {
                  const next = !prev;
                  if (!next) setSelectedRuleIds([]);
                  return next;
                });
              }}
            >
              <span>
                {manageMode
                  ? t('ruleDetail.exitManage')
                  : `${t('ruleDetail.manageRulesTitle')} · ${t('ruleDetail.manageRulesSubtitle')}`}
              </span>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {/* Batch selection bar */}
          {manageMode ? (
            <div
              data-testid="batch-action-bar"
              className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-primary/40 bg-primary/5 px-3 py-2 text-xs"
            >
              <label className="flex cursor-pointer items-center gap-2 font-medium text-text">
                <input
                  type="checkbox"
                  data-testid="select-all-page-checkbox"
                  checked={allPageSelected}
                  disabled={pageRuleIds.length === 0}
                  onChange={toggleSelectAllPage}
                  className="h-4 w-4 accent-primary"
                />
                <span>
                  {t('rules.selectAllPage')} ({t('rules.selectedCount')} {selectedRuleIds.length})
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="batch-enable-btn"
                  disabled={selectedRuleIds.length === 0 || batchRuleMutation.isPending}
                  onClick={() => batchRuleMutation.mutate({ ruleIds: selectedRuleIds, action: 'enable' })}
                >
                  {t('rules.batchEnable')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="batch-disable-btn"
                  disabled={selectedRuleIds.length === 0 || batchRuleMutation.isPending}
                  onClick={() => batchRuleMutation.mutate({ ruleIds: selectedRuleIds, action: 'disable' })}
                >
                  {t('rules.batchDisable')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  data-testid="batch-delete-btn"
                  disabled={selectedRuleIds.length === 0 || batchRuleMutation.isPending}
                  onClick={() => setBatchDeleteOpen(true)}
                >
                  {t('rules.batchDelete')}
                </Button>
              </div>
            </div>
          ) : null}

          {rulesQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              <div className="h-14 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
              <div className="h-14 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
              <div className="h-14 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
            </div>
          ) : rules.length === 0 ? (
            <div
              data-testid="rules-empty"
              className="rounded-[var(--radius-md)] border border-dashed border-border bg-surface-muted/40 px-4 py-8 text-center"
            >
              <div className="text-sm font-medium text-text">{t('ruleDetail.emptyCustomTitle')}</div>
              <p className="mt-1 text-xs text-text-muted">
                {upstreamRuleCount > 0 && !rq ? t('ruleDetail.emptyCustomDesc') : t('rules.emptyRules')}
              </p>
            </div>
          ) : (
            <div
              className="flex flex-col divide-y divide-border rounded-[var(--radius-md)] border border-border"
              data-testid="rules-list"
            >
              {rules.map((rule) => {
                const descriptor = describeRuleFriendly(rule);
                const typeLabel = formatFriendlyRuleType(descriptor, t);
                const inlineDesc = formatFriendlyRuleInline(descriptor, t);
                const rawLine = formatRawRuleLine(rule);
                const isRawExpanded = Boolean(rawExpandedIds[rule.id]);
                const subtitleParts = [typeLabel, inlineDesc, t('ruleDetail.manualMaintenance')];
                const resolveHint = formatRuleResolveHint(rule, t);
                if (resolveHint) subtitleParts.push(resolveHint);
                if (rule.note) subtitleParts.push(rule.note);

                return (
                  <div
                    key={rule.id}
                    data-testid={`rule-row-${rule.id}`}
                    title={rawLine}
                    className={`flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-surface-muted/40 ${
                      rule.enabled ? '' : 'opacity-65'
                    }`}
                  >
                    {manageMode ? (
                      <input
                        type="checkbox"
                        aria-label={rule.value}
                        data-testid={`rule-select-${rule.id}`}
                        checked={selectedRuleIds.includes(rule.id)}
                        onChange={() => toggleSelectRule(rule.id)}
                        className="h-4 w-4 shrink-0 accent-primary"
                      />
                    ) : null}

                    <Switch
                      data-testid={`rule-toggle-${rule.id}`}
                      checked={rule.enabled}
                      disabled={isTelegram}
                      onCheckedChange={(checked) => toggleRuleMutation.mutate({ ruleId: rule.id, enabled: checked })}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="break-all font-mono text-sm font-medium text-text">
                        {descriptor.params.displayValue}
                      </div>
                      <div
                        data-testid={`rule-subtitle-${rule.id}`}
                        className="mt-0.5 break-words text-xs text-text-muted"
                      >
                        {subtitleParts.join(' · ')}
                      </div>
                      {isRawExpanded ? (
                        <div className="mt-1.5 flex max-w-full flex-col gap-1 rounded bg-surface-muted px-2.5 py-1.5 text-[11px]">
                          <code data-testid={`rule-raw-${rule.id}`} className="break-all font-mono text-text">
                            {rawLine}
                          </code>
                          <p data-testid={`rule-raw-desc-${rule.id}`} className="text-text-muted">
                            {typeLabel}：{t(descriptor.descriptionKey)}
                          </p>
                        </div>
                      ) : null}
                    </div>

                    <RuleRowMenu
                      rule={rule}
                      typeLabel={typeLabel}
                      typeDescription={t(descriptor.descriptionKey)}
                      isTelegram={isTelegram}
                      rawExpanded={isRawExpanded}
                      onEdit={() => setEditRuleDialog({ open: true, rule, conflicts: [] })}
                      onCopy={() => void handleCopyValue(rule.value)}
                      onToggleRaw={() =>
                        setRawExpandedIds((prev) => ({
                          ...prev,
                          [rule.id]: !prev[rule.id],
                        }))
                      }
                      onDelete={() => setDeleteRuleTarget(rule)}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Cursor Pagination */}
          {totalCustomRules > RULES_PAGE_SIZE || currentPageIndex > 1 || hasMore ? (
            <div
              data-testid="rules-pagination"
              className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-text-muted"
            >
              <span>
                {t('rules.pageSummary')} {currentPageIndex} · {rules.length} / {totalCustomRules.toLocaleString()}{' '}
                {t('rules.unitItems')}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="rules-prev-page"
                  disabled={currentPageIndex <= 1 || rulesQuery.isFetching}
                  onClick={() => setCursorStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>{t('rules.prevPage')}</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="rules-next-page"
                  disabled={!hasMore || !nextCursor || rulesQuery.isFetching}
                  onClick={() => {
                    if (nextCursor) setCursorStack((prev) => [...prev, nextCursor]);
                  }}
                >
                  <span>{t('rules.nextPage')}</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Lazy Dialogs */}
      <Suspense fallback={null}>
        {editCategoryOpen ? (
          <RuleCategoryDialog
            open={editCategoryOpen}
            mode="edit"
            initial={category}
            customIconPackUrls={customIconPackUrls}
            customIconPackNames={customIconPackNames}
            submitting={updateCategoryMutation.isPending}
            onOpenChange={setEditCategoryOpen}
            onEdit={async (input: EditRuleCategoryInput) => {
              await updateCategoryMutation.mutateAsync({
                patch: {
                  name: input.name,
                  description: input.description,
                  icon: input.icon,
                },
              });
            }}
          />
        ) : null}

        {deleteCategoryOpen ? (
          <DeleteConfirmDialog
            open={deleteCategoryOpen}
            title={t('ruleLibrary.deleteCategoryTitle')}
            description={t('ruleLibrary.deleteCategoryBody')}
            itemName={category.name}
            submitting={deleteCategoryMutation.isPending}
            onOpenChange={setDeleteCategoryOpen}
            onConfirm={async () => {
              await deleteCategoryMutation.mutateAsync();
            }}
          />
        ) : null}

        {sourceDialog.open ? (
          <SourceFormDialog
            open={sourceDialog.open}
            mode={sourceDialog.mode}
            rulesetId={id}
            initial={sourceDialog.source}
            submitting={saveSourceMutation.isPending}
            onOpenChange={(open) => setSourceDialog((prev) => ({ ...prev, open }))}
            onSubmit={async (values) => {
              await saveSourceMutation.mutateAsync({
                mode: sourceDialog.mode,
                sourceId: sourceDialog.source?.id,
                values,
              });
            }}
          />
        ) : null}

        {deleteSourceTarget ? (
          <DeleteConfirmDialog
            open={Boolean(deleteSourceTarget)}
            title={t('sources.deleteConfirmTitle')}
            description={t('sources.deleteConfirmBody')}
            itemName={deleteSourceTarget.name}
            submitting={deleteSourceMutation.isPending}
            onOpenChange={(open) => {
              if (!open) setDeleteSourceTarget(null);
            }}
            onConfirm={async () => {
              await deleteSourceMutation.mutateAsync(deleteSourceTarget.id);
            }}
          />
        ) : null}

        {editRuleDialog.open && editRuleDialog.rule ? (
          <RuleFormDialog
            open={editRuleDialog.open}
            mode="edit"
            initial={editRuleDialog.rule}
            conflicts={editRuleDialog.conflicts}
            submitting={updateRuleMutation.isPending}
            onOpenChange={(open) =>
              setEditRuleDialog((prev) => ({ ...prev, open, ...(open ? {} : { conflicts: [] }) }))
            }
            onSubmit={async (values) => {
              if (!editRuleDialog.rule) return;
              await updateRuleMutation.mutateAsync({
                ruleId: editRuleDialog.rule.id,
                values,
              });
            }}
          />
        ) : null}

        {deleteRuleTarget ? (
          <DeleteConfirmDialog
            open={Boolean(deleteRuleTarget)}
            title={t('rules.delete')}
            description={t('rules.deleteConfirmBody')}
            itemName={deleteRuleTarget.value}
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
