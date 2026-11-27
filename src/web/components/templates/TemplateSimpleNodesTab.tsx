import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  X,
} from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import type { PreviewSubscriptionResult, SimpleTemplateView } from '../../../application/templates';
import { matchRegion } from '../../../domain/nodes/filter';
import { previewPoolMatch } from '../../../domain/nodes/pool-preview';
import type { NodeCombineMode, WizardGroupMode } from '../../../shared/schemas/quick-create';
import type { NodePool, TemplateOverlayOp } from '../../../shared/schemas/template';
import { useI18n, type MessageKey } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { invalidatePublications, invalidateTemplates, templateDetailQueryOptions } from '../../lib/query';
import { useToast } from '../../lib/toast';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { appendOverlayOp } from '../../lib/overlay-ops';
import { clonePresetPool, regionPresetPools, traitPresetPools } from './detail/pool-presets';
import { tierSupportsCustomPools, tierSupportsRegionPools } from './detail/template-detail-data';

const COMBINE_MODES: readonly NodeCombineMode[] = ['merge', 'perProvider'];

// The professional editor is only needed while creating/editing a pool; keeping it
// lazy keeps its regex/preview code out of the nodes tab chunk.
const TemplateNodePoolEditor = lazy(() =>
  import('./TemplateNodePoolEditor').then((module) => ({ default: module.TemplateNodePoolEditor })),
);

type TemplateSimpleNodesTabProps = {
  view: SimpleTemplateView;
  readOnly: boolean;
  onGoToOutput: () => void;
};

type SubFormState = {
  /** `'new'` adds an airport, a slot id replaces that airport's address. */
  mode: 'new' | string;
  name: string;
  url: string;
  userAgent: string;
};

function describeRegexError(
  t: (key: MessageKey) => string,
  result: ReturnType<typeof previewPoolMatch>,
): string | null {
  return result.invalid ? t('templateDetail.poolRegexInvalid').replace('{message}', result.error ?? '') : null;
}

/**
 * Nodes tab (design §8): airport subscriptions + the node-pool list.
 * Reads cached snapshots only (no airport fetch); the "check" action is explicit.
 */
export function TemplateSimpleNodesTab({ view, readOnly, onGoToOutput }: TemplateSimpleNodesTabProps) {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const complexity = view.template.complexity;
  const isSimple = complexity === 'simple';
  const showsRegionPools = tierSupportsRegionPools(complexity);
  const showsCustomPools = tierSupportsCustomPools(complexity);

  const detailQuery = useQuery({ ...templateDetailQueryOptions(view.template.id), enabled: !isSimple });
  const resolved = detailQuery.data?.resolvedBody;
  const pools = useMemo(() => resolved?.pools ?? [], [resolved?.pools]);
  const slots = view.nodes.subscriptions.map((sub) => ({ id: sub.slotId, name: sub.name }));
  const nodeNames = view.nodes.nodeNames ?? [];

  const [form, setForm] = useState<SubFormState | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewSubscriptionResult | null>(null);
  const [renamingSlotId, setRenamingSlotId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [editingPool, setEditingPool] = useState<{ pool: NodePool | null } | null>(null);

  const refreshView = async () => {
    await Promise.all([invalidateTemplates(queryClient, view.template.id), invalidatePublications(queryClient)]);
  };

  const patchSimple = async (payload: Record<string, unknown>) =>
    readApiJson<{ view: SimpleTemplateView; version: number }>(
      await api.api.templates[':id'].simple.$patch({
        param: { id: view.template.id },
        json: payload as never,
      }),
    );

  const previewMutation = useMutation({
    mutationFn: async (payload: { subscriptionUrl: string; userAgent?: string }) =>
      readApiJson<PreviewSubscriptionResult>(await api.api.templates['preview-subscription'].$post({ json: payload })),
    onSuccess: (data) => setPreviewResult(data),
    onError: (err) => {
      setPreviewResult(null);
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const saveSubscriptionMutation = useMutation({
    mutationFn: async (state: SubFormState) => {
      if (view.outputs.length === 0) throw new Error(t('templateDetail.nodesNoClientError'));
      // Public links cannot hide a subscription address; switch them to private first (existing behaviour).
      for (const output of view.outputs) {
        if (output.access === 'public') {
          await readApiJson(
            await api.api.publications[':id'].$patch({ param: { id: output.id }, json: { access: 'token' } }),
          );
        }
      }
      const previewSummary = previewResult
        ? {
            nodeCount: previewResult.nodeCount,
            regions: previewResult.regions.reduce<Record<string, number>>((acc, item) => {
              acc[item.code] = item.count;
              return acc;
            }, {}),
            checkedAt: previewResult.checkedAt,
            status: 'ok',
            ...(previewResult.sampleNames?.length ? { sampleNames: previewResult.sampleNames } : {}),
          }
        : undefined;
      if (state.mode === 'new') {
        return patchSimple({
          addSubscriptions: [
            {
              name: state.name.trim() || undefined,
              url: state.url.trim(),
              ...(state.userAgent.trim() ? { userAgent: state.userAgent.trim() } : {}),
              ...(previewSummary ? { previewSummary } : {}),
            },
          ],
        });
      }
      return patchSimple({
        replaceSubscriptionUrls: [
          {
            slotId: state.mode,
            url: state.url.trim(),
            ...(state.userAgent.trim() ? { userAgent: state.userAgent.trim() } : {}),
            ...(previewSummary ? { previewSummary } : {}),
          },
        ],
      });
    },
    onSuccess: async () => {
      setForm(null);
      setPreviewResult(null);
      setUrlError(null);
      await refreshView();
      notify({
        title: form?.mode === 'new' ? t('templateDetail.nodesSubAddedToast') : t('templateDetail.nodesSubUpdatedToast'),
        variant: 'success',
      });
    },
    onError: (err) => notify({ title: formatApiError(err, locale), variant: 'danger' }),
  });

  const removeSubscriptionMutation = useMutation({
    mutationFn: async (slotId: string) => patchSimple({ removeSlotIds: [slotId] }),
    onSuccess: async () => {
      await refreshView();
      notify({ title: t('templateDetail.nodesSubRemovedToast'), variant: 'success' });
    },
    onError: (err) => notify({ title: formatApiError(err, locale), variant: 'danger' }),
  });

  const renameSubscriptionMutation = useMutation({
    mutationFn: async (payload: { slotId: string; name: string }) => patchSimple({ renameSubscriptions: [payload] }),
    onSuccess: async () => {
      setRenamingSlotId(null);
      await refreshView();
      notify({ title: t('templateDetail.routingSavedToast'), variant: 'success' });
    },
    onError: (err) => notify({ title: formatApiError(err, locale), variant: 'danger' }),
  });

  const combineModeMutation = useMutation({
    mutationFn: async (combineMode: NodeCombineMode) => patchSimple({ combineMode }),
    onSuccess: async () => {
      await refreshView();
      notify({ title: t('templateDetail.routingSavedToast'), variant: 'success' });
    },
    onError: (err) => notify({ title: formatApiError(err, locale), variant: 'danger' }),
  });

  const groupModeMutation = useMutation({
    mutationFn: async (groupMode: WizardGroupMode) => patchSimple({ groupMode }),
    onSuccess: async () => {
      await refreshView();
      notify({ title: t('templateDetail.routingSavedToast'), variant: 'success' });
    },
    onError: (err) => notify({ title: formatApiError(err, locale), variant: 'danger' }),
  });

  const checkMutation = useMutation({
    mutationFn: async (slotId: string) => {
      const boundOutputs = view.outputs.filter((output) => output.hasBindings);
      if (boundOutputs.length === 0) throw new Error(t('templateDetail.nodesNotBound'));
      let lastError: unknown = null;
      for (const output of boundOutputs) {
        try {
          return readApiJson(
            await api.api.publications[':id'].slots[':slotId']['fetch-names'].$post({
              param: { id: output.id, slotId },
            }),
          );
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
    onSuccess: async () => {
      await refreshView();
      notify({ title: t('templateDetail.nodesRefreshedToast'), variant: 'success' });
    },
    onError: (err) => notify({ title: formatApiError(err, locale), variant: 'danger' }),
  });

  const overlayMutation = useMutation({
    mutationFn: async (op: TemplateOverlayOp) => {
      const detail = await queryClient.ensureQueryData(templateDetailQueryOptions(view.template.id));
      const overlay = appendOverlayOp(detail.template.overlay, op);
      return readApiJson<{ template: { currentVersion: number } }>(
        await api.api.templates[':id'].$patch({
          param: { id: view.template.id },
          json: { overlay, note: '更新节点池' },
        }),
      );
    },
    onSuccess: async () => {
      setEditingPool(null);
      await Promise.all([refreshView(), queryClient.invalidateQueries({ queryKey: ['templates', 'detail'] })]);
      notify({ title: t('templateDetail.poolSavedToast'), variant: 'success' });
    },
    onError: (err) => notify({ title: formatApiError(err, locale), variant: 'danger' }),
  });

  const validateUrl = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return t('templateDetail.nodesUrlInvalid');
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return t('templateDetail.nodesUrlInvalid');
      return null;
    } catch {
      return t('templateDetail.nodesUrlInvalid');
    }
  };

  const handleSubmitSub = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    const err = validateUrl(form.url);
    if (err) {
      setUrlError(err);
      return;
    }
    setUrlError(null);
    saveSubscriptionMutation.mutate(form);
  };

  const openForm = (mode: 'new' | string) => {
    const slot = mode === 'new' ? undefined : view.nodes.subscriptions.find((item) => item.slotId === mode);
    setForm({ mode, name: slot?.name ?? '', url: '', userAgent: '' });
    setUrlError(null);
    setPreviewResult(null);
  };

  /* ------------------------------------------------------------- node pools */

  const checkedPoolIds = useMemo(() => new Set(pools.map((pool) => pool.id)), [pools]);
  const customPools = useMemo(
    () =>
      pools.filter(
        (pool) =>
          pool.kind === 'trait' &&
          !regionPresetPools().some((preset) => preset.id === pool.id) &&
          !traitPresetPools().some((preset) => preset.id === pool.id),
      ),
    [pools],
  );

  const presetMatchCount = (preset: NodePool): number => {
    if (nodeNames.length === 0) return 0;
    if (preset.kind === 'region' && preset.region) {
      return nodeNames.filter((nodeName) => matchRegion(nodeName, preset.region!)).length;
    }
    return previewPoolMatch(nodeNames, preset.include, preset.exclude, { limit: nodeNames.length }).matched.length;
  };

  const togglePreset = (preset: NodePool, checked: boolean) => {
    if (readOnly) return;
    if (checked) {
      overlayMutation.mutate({ op: 'addPool', pool: { ...clonePresetPool(preset), hidden: false } });
    } else {
      overlayMutation.mutate({ op: 'removePool', poolId: preset.id });
    }
  };

  const savePool = (pool: NodePool) => {
    const exists = pools.some((item) => item.id === pool.id);
    if (exists) {
      overlayMutation.mutate({
        op: 'updatePool',
        poolId: pool.id,
        patch: {
          name: pool.name,
          sources: pool.sources,
          include: pool.include ?? null,
          exclude: pool.exclude ?? null,
          type: pool.type,
          hidden: pool.hidden,
        },
      });
      return;
    }
    overlayMutation.mutate({ op: 'addPool', pool });
  };

  const renderPoolRow = (preset: NodePool, options: { custom?: boolean } = {}) => {
    const checked = checkedPoolIds.has(preset.id);
    const matched = checked ? presetMatchCount(preset) : 0;
    const regexCheck = previewPoolMatch(nodeNames, preset.include, preset.exclude, {
      limit: nodeNames.length,
    });
    const regexError = describeRegexError(t, regexCheck);
    return (
      <div
        key={preset.id}
        data-testid={`node-pool-row-${preset.id}`}
        data-checked={checked ? 'true' : 'false'}
        className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {preset.icon && !preset.name.trim().startsWith(preset.icon) ? (
            <span aria-hidden="true" className="text-base">
              {preset.icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-medium text-text">{preset.name}</span>
              {checked ? (
                <Badge variant={matched > 0 ? 'success' : 'warning'} className="text-[10px]">
                  {t('templateDetail.poolMatchedBadge').replace('{count}', String(matched))}
                </Badge>
              ) : null}
            </div>
            {checked && nodeNames.length > 0 && matched === 0 ? (
              <p className="text-[11px] text-warning" data-testid={`node-pool-empty-${preset.id}`}>
                {t('templateDetail.poolEmptyHint')}
              </p>
            ) : null}
            {regexError ? <p className="text-[11px] text-danger">{regexError}</p> : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {options.custom ? (
            <>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t('templateDetail.poolEditBtn')}
                data-testid={`node-pool-edit-${preset.id}`}
                disabled={readOnly}
                onClick={() => setEditingPool({ pool: preset })}
              >
                <Pencil className="h-3.5 w-3.5 text-text-muted" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t('templateDetail.poolDeleteBtn')}
                data-testid={`node-pool-delete-${preset.id}`}
                disabled={readOnly || overlayMutation.isPending}
                onClick={() => overlayMutation.mutate({ op: 'removePool', poolId: preset.id })}
              >
                <Trash2 className="h-3.5 w-3.5 text-danger" />
              </Button>
            </>
          ) : (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={checked}
                disabled={readOnly || overlayMutation.isPending}
                data-testid={`node-pool-toggle-${preset.id}`}
                onChange={(event) => togglePreset(preset, event.target.checked)}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              <span className="sr-only">{preset.name}</span>
            </label>
          )}
        </div>
      </div>
    );
  };

  const combineMode: NodeCombineMode = view.nodes.combineMode ?? 'merge';
  const boundCount = view.nodes.subscriptions.filter((sub) => sub.bound).length;
  const canAdd = view.nodes.subscriptions.length < 10;

  return (
    <div className="flex flex-col gap-4" data-testid="simple-nodes-tab" data-complexity={complexity}>
      {/* Airport subscriptions */}
      <Card data-testid="simple-nodes-subscription-card">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4 text-primary" />
                <span>{t('templateDetail.nodesSubsTitle')}</span>
              </CardTitle>
              <CardDescription>{t('templateDetail.nodesSubDesc')}</CardDescription>
            </div>
            {!readOnly ? (
              view.outputs.length === 0 ? (
                <Button size="sm" variant="outline" onClick={onGoToOutput}>
                  {t('templateDetail.nodesGoAddClient')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="simple-nodes-add-btn"
                  disabled={!canAdd || form !== null}
                  onClick={() => openForm('new')}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{t('templateDetail.nodesAddSubBtn')}</span>
                </Button>
              )
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {boundCount > 0 ? (
              <span
                data-testid="simple-nodes-status-bound"
                className="inline-flex items-center gap-1.5 font-medium text-text"
              >
                <Lock className="h-4 w-4 text-success" />
                <span>{t('templateDetail.nodesBoundText')}</span>
              </span>
            ) : (
              <span data-testid="simple-nodes-status-empty" className="text-text-muted">
                {t('templateDetail.nodesUnboundText')}
              </span>
            )}
            {view.nodes.needsRebind ? <Badge variant="danger">{t('templateDetail.nodesNeedsRebind')}</Badge> : null}
            <span className="text-xs text-text-muted">
              {t('templateDetail.nodesSubCount').replace('{count}', String(view.nodes.subscriptions.length))}
            </span>
          </div>

          {view.nodes.subscriptions.length > 0 ? (
            <div className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-bg/40">
              {view.nodes.subscriptions.map((sub, index) => {
                const isRenaming = renamingSlotId === sub.slotId;
                return (
                  <div
                    key={sub.slotId}
                    data-testid={`simple-nodes-sub-row-${sub.slotId}`}
                    className="flex flex-col gap-2 px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <Server className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                        {isRenaming ? (
                          <form
                            className="flex min-w-0 items-center gap-1.5"
                            onSubmit={(event) => {
                              event.preventDefault();
                              if (renameValue.trim()) {
                                renameSubscriptionMutation.mutate({ slotId: sub.slotId, name: renameValue.trim() });
                              }
                            }}
                          >
                            <Input
                              autoFocus
                              value={renameValue}
                              onChange={(event) => setRenameValue(event.target.value)}
                              data-testid="simple-nodes-rename-input"
                              className="h-7 max-w-[12rem] text-xs"
                            />
                            <Button
                              type="submit"
                              size="icon"
                              variant="primary"
                              aria-label={t('common.save')}
                              data-testid="simple-nodes-rename-save"
                              disabled={renameSubscriptionMutation.isPending || !renameValue.trim()}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={t('common.cancel')}
                              onClick={() => setRenamingSlotId(null)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </form>
                        ) : (
                          <>
                            <span className="truncate text-sm font-medium text-text">{sub.name}</span>
                            {!readOnly ? (
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                aria-label={t('templateDetail.nodesRenameBtn')}
                                data-testid={`simple-nodes-rename-${sub.slotId}`}
                                onClick={() => {
                                  setRenamingSlotId(sub.slotId);
                                  setRenameValue(sub.name);
                                }}
                              >
                                <Pencil className="h-3 w-3 text-text-muted" />
                              </Button>
                            ) : null}
                          </>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          data-testid={index === 0 ? 'simple-nodes-refresh-btn' : `simple-nodes-refresh-${sub.slotId}`}
                          disabled={readOnly || !sub.bound || checkMutation.isPending}
                          onClick={() => checkMutation.mutate(sub.slotId)}
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${checkMutation.isPending ? 'animate-spin' : ''}`} />
                          <span>{t('templateDetail.nodesRefreshBtn')}</span>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          data-testid={index === 0 ? 'simple-nodes-replace-btn' : `simple-nodes-replace-${sub.slotId}`}
                          disabled={readOnly || form !== null}
                          onClick={() => openForm(sub.slotId)}
                        >
                          {t('templateDetail.nodesReplaceBtn')}
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={t('templateDetail.nodesDeleteBtn')}
                          data-testid={index === 0 ? 'simple-nodes-delete-btn' : `simple-nodes-delete-${sub.slotId}`}
                          disabled={readOnly || removeSubscriptionMutation.isPending}
                          onClick={() => removeSubscriptionMutation.mutate(sub.slotId)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      {sub.bound ? (
                        <>
                          <span>{sub.maskedUrl ?? t('templateDetail.nodesBoundText')}</span>
                          {sub.nodeCount !== null ? (
                            <span data-testid={`simple-nodes-count-${sub.slotId}`}>
                              {t('wizard.subDetectedSummaryNoRegions').replace('{count}', String(sub.nodeCount))}
                            </span>
                          ) : (
                            <span>{t('templateDetail.nodesResultPending')}</span>
                          )}
                          {sub.regions.length > 0 ? (
                            <span className="flex flex-wrap items-center gap-1" data-testid="simple-nodes-regions">
                              {sub.regions.slice(0, 8).map((region) => (
                                <Badge key={region.code} variant="outline" className="text-[10px] font-normal">
                                  {region.emoji} {region.name} · {region.count}
                                </Badge>
                              ))}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span>{t('templateDetail.nodesUnboundText')}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              data-testid="simple-nodes-sub-empty"
              className="rounded-[var(--radius-md)] border border-dashed border-border px-3.5 py-3 text-xs text-text-muted"
            >
              {t('templateDetail.nodesSubEmpty')}
            </div>
          )}

          {form ? (
            <form
              data-testid="simple-nodes-sub-form"
              onSubmit={handleSubmitSub}
              className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-border bg-bg/50 p-3.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-text">
                  {form.mode === 'new' ? t('templateDetail.nodesAddSubTitle') : t('templateDetail.nodesReplaceBtn')}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('common.cancel')}
                  onClick={() => {
                    setForm(null);
                    setPreviewResult(null);
                    setUrlError(null);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {form.mode === 'new' ? (
                <label className="flex flex-col gap-1.5 text-xs font-medium text-text">
                  <span>{t('templateDetail.nodesSubNameLabel')}</span>
                  <Input
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    placeholder={t('templateDetail.nodesSubNamePlaceholder')}
                    data-testid="simple-nodes-sub-name-input"
                  />
                </label>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <label htmlFor="simple-nodes-sub-input" className="text-xs font-medium text-text">
                  {t('wizard.subLabel')}
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="simple-nodes-sub-input"
                    type="url"
                    autoComplete="off"
                    value={form.url}
                    onChange={(event) => {
                      setForm({ ...form, url: event.target.value });
                      if (urlError) setUrlError(null);
                      if (previewResult) setPreviewResult(null);
                    }}
                    placeholder={t('wizard.subPlaceholder')}
                    data-testid="simple-nodes-sub-input"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!form.url.trim() || previewMutation.isPending}
                    data-testid="simple-nodes-sub-check-btn"
                    onClick={() => {
                      const err = validateUrl(form.url);
                      if (err) {
                        setUrlError(err);
                        return;
                      }
                      setUrlError(null);
                      previewMutation.mutate({
                        subscriptionUrl: form.url.trim(),
                        ...(form.userAgent.trim() ? { userAgent: form.userAgent.trim() } : {}),
                      });
                    }}
                  >
                    {previewMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{t('wizard.checkingSubBtn')}</span>
                      </>
                    ) : (
                      <span>{t('wizard.checkSubBtn')}</span>
                    )}
                  </Button>
                </div>
                {urlError ? <p className="text-xs text-danger">{urlError}</p> : null}
                <p className="text-xs text-text-muted">{t('wizard.subSecurityHint')}</p>
              </div>

              {previewResult ? (
                <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-success/40 bg-success/10 px-3 py-2 text-xs text-text">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                  <span>
                    {t('wizard.subDetectedSummaryNoRegions').replace('{count}', String(previewResult.nodeCount))}
                  </span>
                  {previewResult.regions.slice(0, 6).map((region) => (
                    <Badge key={region.code} variant="outline" className="text-[11px]">
                      {region.emoji} {region.name} {region.count}
                    </Badge>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setForm(null);
                    setPreviewResult(null);
                    setUrlError(null);
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  data-testid="simple-nodes-sub-save-btn"
                  disabled={saveSubscriptionMutation.isPending || !form.url.trim()}
                >
                  {saveSubscriptionMutation.isPending ? t('common.loading') : t('common.save')}
                </Button>
              </div>
            </form>
          ) : null}

          {view.nodes.subscriptions.length > 1 ? (
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold text-text">{t('templateDetail.nodesCombineTitle')}</h4>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {COMBINE_MODES.map((mode) => {
                  const active = combineMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      data-testid={`simple-combine-mode-${mode}`}
                      aria-pressed={active}
                      disabled={readOnly || combineModeMutation.isPending}
                      onClick={() => {
                        if (!active) combineModeMutation.mutate(mode);
                      }}
                      className={`motion-card flex cursor-pointer flex-col gap-1 rounded-[var(--radius-md)] border p-3 text-left disabled:cursor-not-allowed disabled:opacity-60 ${
                        active
                          ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                          : 'border-border bg-bg hover:border-primary/40 hover:bg-surface-muted/50'
                      }`}
                    >
                      <span className="text-sm font-semibold text-text">
                        {t(`templateDetail.nodesCombine.${mode}` as MessageKey)}
                      </span>
                      <span className="text-xs leading-relaxed text-text-muted">
                        {t(`templateDetail.nodesCombineDesc.${mode}` as MessageKey)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Node recognition summary (kept for the plain-language node counts) */}
      <Card data-testid="simple-nodes-summary-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="h-4 w-4 text-primary" />
            <span>{t('templateDetail.nodesResultTitle')}</span>
          </CardTitle>
          <CardDescription>{t('templateDetail.nodesResultDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!view.nodes.bound ? (
            <p className="text-sm text-text-muted">{t('templateDetail.nodesResultEmpty')}</p>
          ) : view.nodes.nodeCount !== null ? (
            <>
              <p className="text-sm font-medium text-text" data-testid="simple-nodes-count">
                {t('wizard.subDetectedSummaryNoRegions').replace('{count}', String(view.nodes.nodeCount))}
              </p>
              {view.nodes.regions.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5" data-testid="simple-nodes-region-summary">
                  {view.nodes.regions.map((region) => (
                    <Badge key={region.code} variant="outline" className="text-xs font-normal">
                      {region.emoji} {region.name} · {region.count}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-text-muted">{t('templateDetail.nodesResultPending')}</p>
          )}
        </CardContent>
      </Card>

      {/* Node selection mode (advanced tiers keep the plain-language choice) */}
      {!isSimple ? (
        <Card data-testid="simple-nodes-group-mode-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('wizard.groupModeTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {(['auto', 'select', 'region'] as const).map((mode) => {
                const selected = view.nodes.groupMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    disabled={readOnly || groupModeMutation.isPending}
                    data-testid={`simple-group-mode-${mode}`}
                    aria-pressed={selected}
                    onClick={() => {
                      if (!selected && !readOnly) groupModeMutation.mutate(mode);
                    }}
                    className={`motion-card flex cursor-pointer flex-col gap-1 rounded-[var(--radius-md)] border p-3 text-left disabled:cursor-not-allowed disabled:opacity-60 ${
                      selected
                        ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                        : 'border-border bg-bg hover:border-primary/40 hover:bg-surface-muted/50'
                    }`}
                  >
                    <span className="text-sm font-semibold text-text">
                      {t(`wizard.groupMode.${mode}` as MessageKey)}
                    </span>
                    <span className="text-xs leading-relaxed text-text-muted">
                      {t(`wizard.groupModeDesc.${mode}` as MessageKey)}
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Node pools (advanced from region presets, pro adds custom pools) */}
      {showsRegionPools ? (
        <Card data-testid="simple-nodes-pools-card">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Layers className="h-4 w-4 text-primary" />
                  <span>{t('templateDetail.poolsTitle')}</span>
                </CardTitle>
                <CardDescription>
                  {showsCustomPools ? t('templateDetail.poolsProDesc') : t('templateDetail.poolsAdvancedDesc')}
                </CardDescription>
              </div>
              {showsCustomPools && !readOnly ? (
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="node-pool-new-btn"
                  disabled={editingPool !== null}
                  onClick={() => setEditingPool({ pool: null })}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{t('templateDetail.poolNewBtn')}</span>
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {detailQuery.isLoading ? (
              <div className="h-24 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <h4 className="text-xs font-semibold text-text">{t('templateDetail.poolRegionTitle')}</h4>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="node-pool-region-list">
                    {regionPresetPools().map((preset) => renderPoolRow(preset))}
                  </div>
                </div>

                {showsCustomPools ? (
                  <div className="flex flex-col gap-2">
                    <h4 className="text-xs font-semibold text-text">{t('templateDetail.poolTraitTitle')}</h4>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="node-pool-trait-list">
                      {traitPresetPools().map((preset) => renderPoolRow(preset))}
                    </div>
                  </div>
                ) : null}

                {showsCustomPools ? (
                  <div className="flex flex-col gap-2">
                    <h4 className="text-xs font-semibold text-text">{t('templateDetail.poolCustomTitle')}</h4>
                    {customPools.length > 0 ? (
                      <div className="flex flex-col gap-2" data-testid="node-pool-custom-list">
                        {customPools.map((pool) => renderPoolRow(pool, { custom: true }))}
                      </div>
                    ) : (
                      <p
                        className="rounded-[var(--radius-sm)] border border-dashed border-border px-3 py-2 text-xs text-text-muted"
                        data-testid="node-pool-custom-empty"
                      >
                        {t('templateDetail.poolCustomEmpty')}
                      </p>
                    )}
                  </div>
                ) : null}

                {editingPool ? (
                  <Suspense
                    fallback={<div className="h-40 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />}
                  >
                    <TemplateNodePoolEditor
                      pool={editingPool.pool}
                      slots={slots}
                      nodeNames={nodeNames}
                      readOnly={readOnly}
                      onCancel={() => setEditingPool(null)}
                      onSubmit={savePool}
                    />
                  </Suspense>
                ) : null}

                {nodeNames.length === 0 ? (
                  <p className="text-[11px] text-text-muted" data-testid="node-pool-preview-hint">
                    {t('templateDetail.poolPreviewNoSnapshot')}
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
