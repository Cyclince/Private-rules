import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Copy, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { PublicationWithLinks } from '../../../server/routes/publications';
import { OUTPUT_PROFILES, type OutputProfile } from '../../../shared/clients';
import { useI18n, type MessageKey } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { invalidatePublications, invalidateTemplates, publicationsListQueryOptions } from '../../lib/query';
import { useToast } from '../../lib/toast';
import type { PublicationSubmitPayload } from '../publications/PublicationFormDialog';
import { PublicationPreviewPanel } from '../publications/PublicationPreviewPanel';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Switch } from '../ui/switch';

const PublicationFormDialog = lazy(() =>
  import('../publications/PublicationFormDialog').then((m) => ({ default: m.PublicationFormDialog })),
);
const DeleteConfirmDialog = lazy(() =>
  import('../rulesets/DeleteConfirmDialog').then((m) => ({ default: m.DeleteConfirmDialog })),
);

type TemplateAdvancedOutputPanelProps = {
  templateId: string;
  readOnly: boolean;
};

function accessBadgeVariant(access: PublicationWithLinks['access']): 'primary' | 'success' | 'outline' {
  if (access === 'token') return 'primary';
  if (access === 'public') return 'success';
  return 'outline';
}

/**
 * Advanced Output view (lazily loaded when "高级编辑" is on):
 * - Output profile (`full` / `minimal`)
 * - Experimental full config switch (with Loon / Quantumult X warning)
 * - Full publication create/edit/delete
 * - Live compiled config preview via `PublicationPreviewPanel`
 */
export function TemplateAdvancedOutputPanel({ templateId, readOnly }: TemplateAdvancedOutputPanelProps) {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const pubsQuery = useQuery(publicationsListQueryOptions({ templateId, limit: 100 }));
  const publications = useMemo(() => pubsQuery.data?.publications ?? [], [pubsQuery.data?.publications]);
  const ruleTokenConfigured = pubsQuery.data?.ruleTokenConfigured ?? true;

  const [selectedPubId, setSelectedPubId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [formDialog, setFormDialog] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    publication: PublicationWithLinks | null;
  }>({ open: false, mode: 'create', publication: null });
  const [deleteTarget, setDeleteTarget] = useState<PublicationWithLinks | null>(null);

  useEffect(() => {
    if (publications.length === 0) {
      setSelectedPubId(null);
      return;
    }
    if (!selectedPubId || !publications.some((p) => p.id === selectedPubId)) {
      setSelectedPubId(publications[0].id);
    }
  }, [publications, selectedPubId]);

  const selectedPub = publications.find((p) => p.id === selectedPubId) ?? publications[0] ?? null;

  const quickPatchMutation = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: { output?: OutputProfile | null; experimentalFullConfig?: boolean };
    }) =>
      readApiJson<{ publication: PublicationWithLinks }>(
        await api.api.publications[':id'].$patch({
          param: { id },
          json: patch,
        }),
      ),
    onSuccess: async (data) => {
      await Promise.all([
        invalidatePublications(queryClient, data.publication.id),
        invalidateTemplates(queryClient, templateId),
      ]);
      notify({ title: t('publications.updatedToast'), variant: 'success' });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: PublicationSubmitPayload) =>
      readApiJson<{ publication: PublicationWithLinks }>(
        await api.api.publications.$post({
          json: {
            slug: payload.slug,
            templateId: payload.templateId || templateId,
            ...(payload.pinnedVersion !== null ? { pinnedVersion: payload.pinnedVersion } : {}),
            clients: payload.clients,
            access: payload.access,
            ...(payload.output ? { output: payload.output } : {}),
            experimentalFullConfig: payload.experimentalFullConfig,
            inheritSlotBindings: payload.access !== 'public',
          },
        }),
      ),
    onSuccess: async (data) => {
      setFormDialog({ open: false, mode: 'create', publication: null });
      setSelectedPubId(data.publication.id);
      await Promise.all([invalidatePublications(queryClient), invalidateTemplates(queryClient, templateId)]);
      notify({ title: t('publications.createdToast'), variant: 'success' });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
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
            experimentalFullConfig: payload.experimentalFullConfig,
          },
        }),
      ),
    onSuccess: async (data) => {
      setFormDialog({ open: false, mode: 'edit', publication: null });
      await Promise.all([
        invalidatePublications(queryClient, data.publication.id),
        invalidateTemplates(queryClient, templateId),
      ]);
      notify({ title: t('publications.updatedToast'), variant: 'success' });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => readApiJson(await api.api.publications[':id'].$delete({ param: { id } })),
    onSuccess: async () => {
      setDeleteTarget(null);
      await Promise.all([invalidatePublications(queryClient), invalidateTemplates(queryClient, templateId)]);
      notify({ title: t('publications.deletedToast'), variant: 'success' });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const handleCopy = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      notify({ title: t('links.copiedToast'), variant: 'success' });
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1600);
    } catch {
      notify({ title: t('links.copyFailed'), variant: 'danger' });
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="advanced-output-panel">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">{t('publications.title')}</CardTitle>
              <CardDescription>{t('publications.subtitle')}</CardDescription>
            </div>
            {!readOnly ? (
              <Button
                size="sm"
                data-testid="publications-create-btn"
                onClick={() => setFormDialog({ open: true, mode: 'create', publication: null })}
              >
                <Plus className="h-4 w-4" />
                <span>{t('publications.create')}</span>
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!ruleTokenConfigured ? (
            <div className="rounded-[var(--radius-md)] border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-text">
              {t('publications.linksTokenMissingHint')}
            </div>
          ) : null}

          {publications.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">{t('publications.emptyList')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {publications.map((pub) => {
                const isSelected = selectedPub?.id === pub.id;
                const hasSafeDefaultClient = pub.clients.some((c) => c === 'loon' || c === 'quantumult-x');
                return (
                  <div
                    key={pub.id}
                    data-testid={`publication-row-${pub.id}`}
                    className={`flex flex-col gap-3 rounded-[var(--radius-md)] border p-3.5 transition-colors ${
                      isSelected ? 'border-primary bg-primary/5' : 'border-border bg-bg/40'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedPubId(pub.id)}
                        className="flex cursor-pointer flex-wrap items-center gap-2 text-left"
                      >
                        <span className="font-mono text-sm font-semibold text-text">{pub.slug}</span>
                        <Badge variant={accessBadgeVariant(pub.access)}>
                          {t(`publications.access.${pub.access}` as MessageKey)}
                        </Badge>
                        {pub.bindings.length > 0 ? (
                          <Badge variant="outline" className="gap-1 text-[11px]">
                            <Lock className="h-3 w-3" />
                            <span>{pub.bindings.length}</span>
                          </Badge>
                        ) : null}
                        <Badge variant="outline" className="text-[11px]">
                          v{pub.effectiveVersion}
                        </Badge>
                      </button>

                      {!readOnly ? (
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`publication-edit-${pub.id}`}
                            onClick={() => setFormDialog({ open: true, mode: 'edit', publication: pub })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            <span>{t('common.edit')}</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            data-testid={`publication-delete-${pub.id}`}
                            onClick={() => setDeleteTarget(pub)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>{t('common.delete')}</span>
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    {/* Output Profile (full / minimal) & Experimental Full Config */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-text-muted">{t('publications.fieldOutput')}:</span>
                        {OUTPUT_PROFILES.map((profile) => (
                          <Button
                            key={profile}
                            size="sm"
                            variant={pub.effectiveOutput === profile ? 'primary' : 'outline'}
                            disabled={readOnly || quickPatchMutation.isPending}
                            data-testid={`publication-output-${pub.id}-${profile}`}
                            onClick={() => quickPatchMutation.mutate({ id: pub.id, patch: { output: profile } })}
                          >
                            {t(`publications.output.${profile}` as MessageKey)}
                          </Button>
                        ))}
                      </div>

                      <label className="flex items-center gap-2 text-xs text-text">
                        <span>{t('publications.fieldExperimentalFullConfig')}</span>
                        <Switch
                          checked={Boolean(pub.experimentalFullConfig)}
                          disabled={readOnly || quickPatchMutation.isPending}
                          data-testid={`publication-experimental-${pub.id}`}
                          onCheckedChange={(checked) =>
                            quickPatchMutation.mutate({ id: pub.id, patch: { experimentalFullConfig: checked } })
                          }
                        />
                      </label>
                    </div>

                    {hasSafeDefaultClient && pub.experimentalFullConfig ? (
                      <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-warning/50 bg-warning/10 px-2.5 py-2 text-xs text-text">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                        <span>{t('publications.experimentalFullConfigWarningBody')}</span>
                      </div>
                    ) : null}

                    {/* Links */}
                    <div className="flex flex-col gap-1.5">
                      {pub.links.map((link) => {
                        const key = `${pub.id}:${link.client}`;
                        const isCopied = copiedKey === key;
                        return (
                          <div
                            key={key}
                            data-testid={`pub-link-row-${link.client}`}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-border/60 bg-surface px-2.5 py-1.5"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="mr-2 text-xs font-medium text-text">{link.label}</span>
                              {link.url ? (
                                <code
                                  data-testid={`pub-link-url-${link.client}`}
                                  className="break-all font-mono text-[11px] text-text-muted"
                                >
                                  {link.url}
                                </code>
                              ) : (
                                <span className="text-[11px] text-text-muted">
                                  {t('publications.linksDisabledHint')}
                                </span>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!link.url}
                              data-testid={`pub-link-copy-${link.client}`}
                              onClick={() => {
                                if (link.url) void handleCopy(key, link.url);
                              }}
                            >
                              {isCopied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                              <span>{t('common.copy')}</span>
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Compile Preview Panel */}
      {selectedPub ? (
        <Card>
          <CardContent className="pt-5">
            <PublicationPreviewPanel publication={selectedPub} />
          </CardContent>
        </Card>
      ) : null}

      {formDialog.open ? (
        <Suspense fallback={null}>
          <PublicationFormDialog
            open={formDialog.open}
            mode={formDialog.mode}
            initial={formDialog.publication}
            defaultTemplateId={templateId}
            readOnly={readOnly}
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
            itemName={deleteTarget.slug}
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
