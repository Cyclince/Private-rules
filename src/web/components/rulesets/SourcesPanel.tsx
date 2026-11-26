import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import type { SourceFormValues } from '../../../shared/schemas/source';
import type { RuleSource } from '../../../types/domain-rules';
import { useI18n } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { invalidateRulesets, queryKeys, rulesetSourcesQueryOptions } from '../../lib/query';
import { useToast } from '../../lib/toast';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Switch } from '../ui/switch';

const SourceFormDialog = lazy(() => import('./SourceFormDialog').then((m) => ({ default: m.SourceFormDialog })));
const DeleteConfirmDialog = lazy(() =>
  import('./DeleteConfirmDialog').then((m) => ({ default: m.DeleteConfirmDialog })),
);

type SourcesPanelProps = {
  rulesetId: string;
};

function formatTime(iso?: string): string {
  if (!iso) return '-';
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : '-';
}

export function SourcesPanel({ rulesetId }: SourcesPanelProps) {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const sourcesQuery = useQuery(rulesetSourcesQueryOptions(rulesetId));
  const sources = sourcesQuery.data?.sources ?? [];

  const [formState, setFormState] = useState<{ open: boolean; mode: 'create' | 'edit'; source: RuleSource | null }>({
    open: false,
    mode: 'create',
    source: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<RuleSource | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const saveMutation = useMutation({
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
            param: { id: rulesetId },
            json: body,
          }),
        );
      }
      return readApiJson<{ source: RuleSource }>(
        await api.api.rulesets[':id'].sources[':sourceId'].$patch({
          param: { id: rulesetId, sourceId: args.sourceId! },
          json: body,
        }),
      );
    },
    onSuccess: async (_data, variables) => {
      setFormState({ open: false, mode: 'create', source: null });
      await invalidateRulesets(queryClient, rulesetId);
      notify({
        title: variables.mode === 'create' ? t('sources.created') : t('sources.updated'),
        variant: 'success',
      });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (args: { sourceId: string; enabled: boolean }) =>
      readApiJson<{ source: RuleSource }>(
        await api.api.rulesets[':id'].sources[':sourceId'].toggle.$post({
          param: { id: rulesetId, sourceId: args.sourceId },
          json: { enabled: args.enabled },
        }),
      ),
    onMutate: async ({ sourceId, enabled }) => {
      const key = queryKeys.rulesets.sources(rulesetId);
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
      await invalidateRulesets(queryClient, rulesetId);
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      setSyncingId(sourceId);
      return readApiJson<{ result: { ok: boolean; count: number; error?: string } }>(
        await api.api.rulesets[':id'].sources[':sourceId'].sync.$post({
          param: { id: rulesetId, sourceId },
        }),
      );
    },
    onSuccess: async ({ result }) => {
      await invalidateRulesets(queryClient, rulesetId);
      notify({
        title: result.ok ? t('sources.synced') : (result.error ?? t('error.UPSTREAM_FAILED')),
        description: result.ok ? `${result.count.toLocaleString()} ${t('rules.unitItems')}` : undefined,
        variant: result.ok ? 'success' : 'danger',
      });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
    onSettled: () => {
      setSyncingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (sourceId: string) =>
      readApiJson(
        await api.api.rulesets[':id'].sources[':sourceId'].$delete({
          param: { id: rulesetId, sourceId },
        }),
      ),
    onSuccess: async () => {
      setDeleteTarget(null);
      await invalidateRulesets(queryClient, rulesetId);
      notify({ title: t('sources.deleted'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  return (
    <Card data-testid="sources-panel">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            <span>{t('sources.title')}</span>
            <Badge variant="outline">{sources.length}</Badge>
          </CardTitle>
          <CardDescription>{t('sources.subtitle')}</CardDescription>
        </div>
        <Button
          size="sm"
          data-testid="add-source-btn"
          onClick={() => setFormState({ open: true, mode: 'create', source: null })}
        >
          <Plus className="h-3.5 w-3.5" />
          <span>{t('sources.add')}</span>
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {sourcesQuery.isLoading ? (
          <div className="h-20 animate-pulse rounded bg-surface-muted" />
        ) : sources.length === 0 ? (
          <div
            data-testid="sources-empty"
            className="rounded-[var(--radius-md)] border border-border bg-surface-muted/40 py-8 text-center text-sm text-text-muted"
          >
            {t('sources.empty')}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5" data-testid="sources-list">
            {sources.map((source) => {
              const isSyncing = syncingId === source.id;
              return (
                <div
                  key={source.id}
                  data-testid={`source-row-${source.id}`}
                  className="flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface-muted/40 p-3.5 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="primary" className="text-[10px]">
                        {(source.sourceType ?? 'url').toUpperCase()}
                      </Badge>
                      <span className="truncate text-sm font-medium">{source.name}</span>
                      <Badge
                        variant={
                          source.lastStatus === 'error'
                            ? 'danger'
                            : source.lastStatus === 'success'
                              ? 'success'
                              : 'outline'
                        }
                      >
                        {source.lastStatus === 'error'
                          ? t('sources.statusError')
                          : source.lastStatus === 'success'
                            ? t('sources.statusSuccess')
                            : t('sources.statusPending')}
                      </Badge>
                      {source.ruleOptimization && source.ruleOptimization !== 'none' ? (
                        <Badge variant="accent" className="text-[10px]">
                          {source.ruleOptimization}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 break-all font-mono text-xs text-text-muted">
                      {source.sourceType === 'geosite'
                        ? `geosite:${source.geositeName}`
                        : source.sourceType === 'geoip'
                          ? `geoip:${source.geoipName}`
                          : source.url}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
                      <span>
                        {(source.lastCount ?? 0).toLocaleString()} {t('rules.unitItems')}
                      </span>
                      <span>· {source.syncIntervalMinutes}m</span>
                      <span>· {formatTime(source.lastSyncedAt)}</span>
                    </div>
                    {source.lastStatus === 'error' && source.lastError ? (
                      <p className="mt-1 break-words text-xs text-danger">{source.lastError}</p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <Switch
                      data-testid={`source-toggle-${source.id}`}
                      checked={source.enabled}
                      onCheckedChange={(checked) => toggleMutation.mutate({ sourceId: source.id, enabled: checked })}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`source-sync-${source.id}`}
                      disabled={!source.enabled || isSyncing}
                      onClick={() => syncMutation.mutate(source.id)}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                      <span>{isSyncing ? t('sources.syncing') : t('sources.syncNow')}</span>
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t('sources.edit')}
                      data-testid={`source-edit-${source.id}`}
                      onClick={() => setFormState({ open: true, mode: 'edit', source })}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t('sources.delete')}
                      data-testid={`source-delete-${source.id}`}
                      onClick={() => setDeleteTarget(source)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-danger" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Suspense fallback={null}>
        {formState.open ? (
          <SourceFormDialog
            open={formState.open}
            mode={formState.mode}
            rulesetId={rulesetId}
            initial={formState.source}
            submitting={saveMutation.isPending}
            onOpenChange={(open) => setFormState((prev) => ({ ...prev, open }))}
            onSubmit={async (values) => {
              await saveMutation.mutateAsync({
                mode: formState.mode,
                sourceId: formState.source?.id,
                values,
              });
            }}
          />
        ) : null}

        {deleteTarget ? (
          <DeleteConfirmDialog
            open={Boolean(deleteTarget)}
            title={t('sources.deleteConfirmTitle')}
            description={t('sources.deleteConfirmBody')}
            itemName={deleteTarget.name}
            submitting={deleteMutation.isPending}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            onConfirm={async () => {
              await deleteMutation.mutateAsync(deleteTarget.id);
            }}
          />
        ) : null}
      </Suspense>
    </Card>
  );
}
