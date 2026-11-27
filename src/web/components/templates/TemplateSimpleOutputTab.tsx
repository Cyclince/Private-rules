import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, Plus, Trash2 } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import type { SimpleTemplateOutputItem, SimpleTemplateView } from '../../../application/templates';
import type { PublicationAccess } from '../../../shared/schemas/publication';
import { useI18n } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { invalidatePublications, invalidateTemplates } from '../../lib/query';
import { useToast } from '../../lib/toast';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { ClientImportButton } from './ClientImportButton';

const AddClientDialog = lazy(() => import('./AddClientDialog').then((m) => ({ default: m.AddClientDialog })));
const DeleteConfirmDialog = lazy(() =>
  import('../rulesets/DeleteConfirmDialog').then((m) => ({ default: m.DeleteConfirmDialog })),
);

type TemplateSimpleOutputTabProps = {
  view: SimpleTemplateView;
  readOnly: boolean;
};

export function TemplateSimpleOutputTab({ view, readOnly }: TemplateSimpleOutputTabProps) {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<SimpleTemplateOutputItem | null>(null);

  const accessMutation = useMutation({
    mutationFn: async ({ id, access }: { id: string; access: PublicationAccess }) =>
      readApiJson(
        await api.api.publications[':id'].$patch({
          param: { id },
          json: { access },
        }),
      ),
    onSuccess: async () => {
      await Promise.all([invalidateTemplates(queryClient, view.template.id), invalidatePublications(queryClient)]);
      notify({ title: t('templateDetail.outputAccessUpdatedToast'), variant: 'success' });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) =>
      readApiJson(
        await api.api.publications[':id'].$delete({
          param: { id },
        }),
      ),
    onSuccess: async () => {
      setRemoveTarget(null);
      await Promise.all([invalidateTemplates(queryClient, view.template.id), invalidatePublications(queryClient)]);
      notify({ title: t('templateDetail.outputRemovedToast'), variant: 'success' });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const handleCopy = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      notify({ title: t('templates.copiedLinkToast'), variant: 'success' });
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1600);
    } catch {
      notify({ title: t('links.copyFailed'), variant: 'danger' });
    }
  };

  const existingClientIds = new Set(view.outputs.flatMap((output) => output.clients));

  return (
    <div className="flex flex-col gap-4" data-testid="simple-output-tab">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Link2 className="h-4 w-4 text-primary" />
                <span>{t('templateDetail.outputTitle')}</span>
              </CardTitle>
              <CardDescription>{t('templateDetail.outputDesc')}</CardDescription>
            </div>

            {!readOnly ? (
              <Button size="sm" data-testid="output-add-client-btn" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" />
                <span>{t('templateDetail.addClientBtn')}</span>
              </Button>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {!view.ruleTokenConfigured ? (
            <div className="rounded-[var(--radius-md)] border border-warning/50 bg-warning/10 px-3.5 py-2.5 text-xs text-text">
              {t('wizard.doneNoTokenWarning')}
            </div>
          ) : null}

          {view.outputs.length === 0 ? (
            <div
              data-testid="simple-output-empty"
              className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-dashed border-border px-4 py-8 text-center"
            >
              <p className="text-sm text-text-muted">{t('templateDetail.outputEmpty')}</p>
              {!readOnly ? (
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="h-4 w-4" />
                  <span>{t('templateDetail.addClientBtn')}</span>
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-bg/40">
              {view.outputs.map((output) => {
                const accessOptions: Array<{ value: PublicationAccess; label: string }> = output.hasBindings
                  ? [
                      { value: 'token', label: t('templateDetail.accessPrivate') },
                      { value: 'disabled', label: t('templateDetail.accessDisabled') },
                    ]
                  : [
                      { value: 'token', label: t('templateDetail.accessPrivate') },
                      { value: 'public', label: t('templateDetail.accessPublic') },
                      { value: 'disabled', label: t('templateDetail.accessDisabled') },
                    ];

                return output.links.map((link, linkIdx) => {
                  const rowKey = `${output.id}:${link.client}`;
                  const isCopied = copiedKey === rowKey;
                  const isFirstOfOutput = linkIdx === 0;

                  return (
                    <div
                      key={rowKey}
                      data-testid={`simple-output-row-${link.client}`}
                      data-output-id={output.id}
                      className="flex flex-col gap-2.5 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-text">{link.displayName}</span>
                          {output.access === 'disabled' ? (
                            <Badge variant="outline">{t('templateDetail.accessDisabled')}</Badge>
                          ) : null}
                        </div>
                        {link.url ? (
                          <code
                            data-testid={`simple-output-url-${link.client}`}
                            className="block truncate rounded-[var(--radius-sm)] bg-surface-muted/70 px-2 py-1 font-mono text-xs text-text-muted"
                          >
                            {link.url}
                          </code>
                        ) : (
                          <span className="text-xs text-text-muted">
                            {output.access === 'disabled'
                              ? t('templateDetail.outputDisabledHint')
                              : !view.ruleTokenConfigured
                                ? t('templates.copyLinkNoToken')
                                : t('templateDetail.outputUnavailableHint')}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!link.url}
                          data-testid={`output-copy-${link.client}`}
                          onClick={() => {
                            if (link.url) void handleCopy(rowKey, link.url);
                          }}
                        >
                          {isCopied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                          <span>{isCopied ? t('wizard.doneCopiedBtn') : t('wizard.doneCopyBtn')}</span>
                        </Button>

                        <ClientImportButton
                          client={link.client}
                          url={output.access !== 'disabled' && link.supported ? link.url : null}
                          name={view.template.name}
                          label={t('wizard.doneImportBtn')}
                          testId={`output-import-${link.client}`}
                        />

                        {isFirstOfOutput ? (
                          <>
                            <select
                              aria-label={`${link.displayName} ${t('templateDetail.accessLabel')}`}
                              data-testid={`output-access-${output.id}`}
                              disabled={readOnly || accessMutation.isPending}
                              value={output.access}
                              onChange={(e) =>
                                accessMutation.mutate({
                                  id: output.id,
                                  access: e.target.value as PublicationAccess,
                                })
                              }
                              className="h-8 rounded-[var(--radius-sm)] border border-border bg-surface px-2.5 text-xs text-text focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                            >
                              {accessOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>

                            {!readOnly ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={t('templateDetail.removeClientBtn')}
                                data-testid={`output-remove-${output.id}`}
                                onClick={() => setRemoveTarget(output)}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-danger" />
                                <span className="sr-only sm:not-sr-only sm:text-xs sm:text-danger">
                                  {t('templateDetail.removeClientBtn')}
                                </span>
                              </Button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </div>
                  );
                });
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {addOpen ? (
        <Suspense fallback={null}>
          <AddClientDialog
            open={addOpen}
            templateId={view.template.id}
            templateSlug={view.template.slug}
            existingClients={existingClientIds}
            hasBoundNodes={view.nodes.bound}
            onOpenChange={setAddOpen}
          />
        </Suspense>
      ) : null}

      {removeTarget ? (
        <Suspense fallback={null}>
          <DeleteConfirmDialog
            open={Boolean(removeTarget)}
            title={t('templateDetail.removeClientConfirmTitle')}
            description={t('templateDetail.removeClientConfirmBody')}
            itemName={removeTarget.links.map((l) => l.displayName).join(' / ')}
            submitting={removeMutation.isPending}
            onOpenChange={(open) => {
              if (!open) setRemoveTarget(null);
            }}
            onConfirm={async () => {
              if (removeTarget) await removeMutation.mutateAsync(removeTarget.id);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
