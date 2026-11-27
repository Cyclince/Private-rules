import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, Loader2, Lock, RefreshCw, Server } from 'lucide-react';
import { useState } from 'react';
import type { PreviewSubscriptionResult, SimpleTemplateView } from '../../../application/templates';
import type { WizardGroupMode } from '../../../shared/schemas/quick-create';
import { useI18n, type MessageKey } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { invalidatePublications, invalidateTemplates } from '../../lib/query';
import { useToast } from '../../lib/toast';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';

const GROUP_MODES: readonly WizardGroupMode[] = ['auto', 'select', 'region'];

type TemplateSimpleNodesTabProps = {
  view: SimpleTemplateView;
  readOnly: boolean;
  onGoToOutput: () => void;
};

export function TemplateSimpleNodesTab({ view, readOnly, onGoToOutput }: TemplateSimpleNodesTabProps) {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const [editingSub, setEditingSub] = useState(false);
  const [subUrl, setSubUrl] = useState('');
  const [subUa, setSubUa] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewSubscriptionResult | null>(null);

  const previewMutation = useMutation({
    mutationFn: async (payload: { subscriptionUrl: string; userAgent?: string }) =>
      readApiJson<PreviewSubscriptionResult>(
        await api.api.templates['preview-subscription'].$post({
          json: payload,
        }),
      ),
    onSuccess: (data) => {
      setPreviewResult(data);
    },
    onError: (err) => {
      setPreviewResult(null);
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const replaceSubMutation = useMutation({
    mutationFn: async (payload: { subscriptionUrl: string; userAgent?: string | null }) => {
      if (view.outputs.length === 0) {
        throw new Error(t('templateDetail.nodesNoClientError'));
      }
      for (const output of view.outputs) {
        // Bound outputs cannot use public access; switch to private token link first.
        if (output.access === 'public') {
          await readApiJson(
            await api.api.publications[':id'].$patch({
              param: { id: output.id },
              json: { access: 'token' },
            }),
          );
        }
        await readApiJson(
          await api.api.publications[':id'].slots[':slotId'].$put({
            param: { id: output.id, slotId: 'slot-main' },
            json: payload,
          }),
        );
      }
    },
    onSuccess: async () => {
      // Immediately scrub plaintext URL from state and DOM
      setSubUrl('');
      setSubUa('');
      setUrlError(null);
      setPreviewResult(null);
      setEditingSub(false);
      await Promise.all([invalidateTemplates(queryClient, view.template.id), invalidatePublications(queryClient)]);
      notify({ title: t('templateDetail.nodesSubUpdatedToast'), variant: 'success' });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const refreshStatsMutation = useMutation({
    mutationFn: async () => {
      const boundOutput = view.outputs.find((item) => item.hasBindings);
      if (!boundOutput) throw new Error(t('templateDetail.nodesNotBound'));
      return readApiJson(
        await api.api.publications[':id'].slots[':slotId']['fetch-names'].$post({
          param: { id: boundOutput.id, slotId: 'slot-main' },
        }),
      );
    },
    onSuccess: async () => {
      await Promise.all([invalidateTemplates(queryClient, view.template.id), invalidatePublications(queryClient)]);
      notify({ title: t('templateDetail.nodesRefreshedToast'), variant: 'success' });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const groupModeMutation = useMutation({
    mutationFn: async (groupMode: WizardGroupMode) =>
      readApiJson<{ view: SimpleTemplateView; version: number }>(
        await api.api.templates[':id'].simple.$patch({
          param: { id: view.template.id },
          json: { groupMode },
        }),
      ),
    onSuccess: async () => {
      await invalidateTemplates(queryClient, view.template.id);
      notify({ title: t('templateDetail.routingSavedToast'), variant: 'success' });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const validateUrl = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return t('templateDetail.nodesUrlInvalid');
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return t('templateDetail.nodesUrlInvalid');
      }
      return null;
    } catch {
      return t('templateDetail.nodesUrlInvalid');
    }
  };

  const handleSubmitSub = (event: React.FormEvent) => {
    event.preventDefault();
    const err = validateUrl(subUrl);
    if (err) {
      setUrlError(err);
      return;
    }
    setUrlError(null);
    replaceSubMutation.mutate({
      subscriptionUrl: subUrl.trim(),
      userAgent: subUa.trim() || null,
    });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="simple-nodes-tab">
      {/* Airport Subscription Card */}
      <Card data-testid="simple-nodes-subscription-card">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4 text-primary" />
                <span>{t('templateDetail.nodesSubTitle')}</span>
              </CardTitle>
              <CardDescription>{t('templateDetail.nodesSubDesc')}</CardDescription>
            </div>
            {!readOnly && !editingSub ? (
              view.outputs.length === 0 ? (
                <Button size="sm" variant="outline" onClick={onGoToOutput}>
                  {t('templateDetail.nodesGoAddClient')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant={view.nodes.bound ? 'outline' : 'primary'}
                  data-testid={view.nodes.bound ? 'simple-nodes-replace-btn' : 'simple-nodes-fill-btn'}
                  onClick={() => {
                    setEditingSub(true);
                    setUrlError(null);
                    setPreviewResult(null);
                  }}
                >
                  {view.nodes.bound ? t('templateDetail.nodesReplaceBtn') : t('templateDetail.nodesFillBtn')}
                </Button>
              )
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {view.nodes.bound ? (
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
          </div>

          {editingSub && !readOnly ? (
            <form
              data-testid="simple-nodes-sub-form"
              onSubmit={handleSubmitSub}
              className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-border bg-bg/50 p-3.5"
            >
              <div className="flex flex-col gap-1.5">
                <label htmlFor="simple-nodes-sub-input" className="text-xs font-medium text-text">
                  {t('wizard.subLabel')}
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="simple-nodes-sub-input"
                    type="url"
                    autoComplete="off"
                    value={subUrl}
                    onChange={(e) => {
                      setSubUrl(e.target.value);
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
                    disabled={!subUrl.trim() || previewMutation.isPending}
                    data-testid="simple-nodes-sub-check-btn"
                    onClick={() => {
                      const err = validateUrl(subUrl);
                      if (err) {
                        setUrlError(err);
                        return;
                      }
                      setUrlError(null);
                      previewMutation.mutate({
                        subscriptionUrl: subUrl.trim(),
                        ...(subUa.trim() ? { userAgent: subUa.trim() } : {}),
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
                  {previewResult.regions.slice(0, 6).map((r) => (
                    <Badge key={r.code} variant="outline" className="text-[11px]">
                      {r.emoji} {r.name} {r.count}
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
                    setEditingSub(false);
                    setSubUrl('');
                    setSubUa('');
                    setUrlError(null);
                    setPreviewResult(null);
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  data-testid="simple-nodes-sub-save-btn"
                  disabled={replaceSubMutation.isPending || !subUrl.trim()}
                >
                  {replaceSubMutation.isPending ? t('common.loading') : t('common.save')}
                </Button>
              </div>
            </form>
          ) : null}
        </CardContent>
      </Card>

      {/* Node Recognition Summary Card */}
      <Card data-testid="simple-nodes-summary-card">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Server className="h-4 w-4 text-primary" />
                <span>{t('templateDetail.nodesResultTitle')}</span>
              </CardTitle>
              <CardDescription>{t('templateDetail.nodesResultDesc')}</CardDescription>
            </div>
            {view.nodes.bound && !readOnly ? (
              <Button
                size="sm"
                variant="outline"
                data-testid="simple-nodes-refresh-btn"
                disabled={refreshStatsMutation.isPending}
                onClick={() => refreshStatsMutation.mutate()}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshStatsMutation.isPending ? 'animate-spin' : ''}`} />
                <span>{t('templateDetail.nodesRefreshBtn')}</span>
              </Button>
            ) : null}
          </div>
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
                <div className="flex flex-wrap items-center gap-1.5" data-testid="simple-nodes-regions">
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

      {/* Node Selection Mode (3-way) */}
      <Card data-testid="simple-nodes-group-mode-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('wizard.groupModeTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {GROUP_MODES.map((mode) => {
              const selected = view.nodes.groupMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={readOnly || groupModeMutation.isPending}
                  data-testid={`simple-group-mode-${mode}`}
                  aria-pressed={selected}
                  onClick={() => {
                    if (!selected && !readOnly) {
                      groupModeMutation.mutate(mode);
                    }
                  }}
                  className={`flex cursor-pointer flex-col gap-1 rounded-[var(--radius-md)] border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    selected
                      ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                      : 'border-border bg-bg hover:border-primary/40 hover:bg-surface-muted/50'
                  }`}
                >
                  <span className="text-sm font-semibold text-text">{t(`wizard.groupMode.${mode}` as MessageKey)}</span>
                  <span className="text-xs leading-relaxed text-text-muted">
                    {t(`wizard.groupModeDesc.${mode}` as MessageKey)}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
