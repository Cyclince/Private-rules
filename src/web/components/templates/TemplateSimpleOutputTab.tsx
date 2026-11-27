import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Plus, Trash2 } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import type { SimpleTemplateOutputItem, SimpleTemplateView } from '../../../application/templates';
import { getApp, type AppDefinition } from '../../../shared/apps';
import type { TemplateClientId } from '../../../shared/clients';
import type { PublicationAccess } from '../../../shared/schemas/publication';
import { useI18n } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { invalidatePublications, invalidateTemplates } from '../../lib/query';
import { useToast } from '../../lib/toast';
import { AppIcon } from '../apps/AppIcon';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { QrCodeButton } from '../ui/QrCodeButton';
import { ClientImportButton } from './ClientImportButton';

const AddClientDialog = lazy(() => import('./AddClientDialog').then((m) => ({ default: m.AddClientDialog })));
const DeleteConfirmDialog = lazy(() =>
  import('../rulesets/DeleteConfirmDialog').then((m) => ({ default: m.DeleteConfirmDialog })),
);

type TemplateSimpleOutputTabProps = {
  view: SimpleTemplateView;
  readOnly: boolean;
};

const APP_BY_CLIENT: ReadonlyMap<TemplateClientId, AppDefinition> = new Map(
  ['shadowrocket', 'quantumult-x', 'loon', 'surge', 'stash', 'sing-box', 'clash-verge-rev']
    .map((id) => getApp(id))
    .filter((app): app is AppDefinition => Boolean(app?.templateClientId))
    .map((app) => [app.templateClientId!, app]),
);

/**
 * Output tab (design §6/§8): one card per software with its subscription address,
 * copy, one-click import (verified software only), access and remove actions.
 */
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
    mutationFn: async (id: string) => readApiJson(await api.api.publications[':id'].$delete({ param: { id } })),
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
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1600);
    } catch {
      notify({ title: t('links.copyFailed'), variant: 'danger' });
    }
  };

  const existingClientIds = useMemo(() => new Set(view.outputs.flatMap((output) => output.clients)), [view.outputs]);

  return (
    <div className="flex flex-col gap-4" data-testid="simple-output-tab">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text">{t('templateDetail.outputTitle')}</h2>
          <p className="text-xs text-text-muted">{t('templateDetail.outputDesc')}</p>
        </div>
        {!readOnly ? (
          <Button size="sm" data-testid="output-add-client-btn" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            <span>{t('templateDetail.addSoftwareBtn')}</span>
          </Button>
        ) : null}
      </div>

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
              <span>{t('templateDetail.addSoftwareBtn')}</span>
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="simple-output-list">
          {view.outputs.flatMap((output) =>
            output.links.map((link, linkIdx) => {
              const rowKey = `${output.id}:${link.client}`;
              const isCopied = copiedKey === rowKey;
              const app = APP_BY_CLIENT.get(link.client);
              const isFirstOfOutput = linkIdx === 0;
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

              return (
                <Card
                  key={rowKey}
                  data-testid={`simple-output-row-${link.client}`}
                  data-output-id={output.id}
                  className="flex flex-col"
                >
                  <CardContent className="flex flex-1 flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <AppIcon app={app ?? { id: link.client, name: link.displayName }} size="md" />
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold text-text">{link.displayName}</h3>
                          <p className="text-[11px] text-text-muted">
                            {output.access === 'disabled'
                              ? t('templateDetail.outputDisabledHint')
                              : t('templateDetail.outputSoftwareHint')}
                          </p>
                        </div>
                      </div>
                      {output.access === 'disabled' ? (
                        <Badge variant="outline">{t('templateDetail.accessDisabled')}</Badge>
                      ) : null}
                    </div>

                    {link.url ? (
                      <code
                        data-testid={`simple-output-url-${link.client}`}
                        className="block break-all rounded-[var(--radius-sm)] border border-border bg-surface-muted/70 px-2.5 py-1.5 font-mono text-[11px] text-text-muted"
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

                    <div className="mt-auto flex flex-wrap items-center gap-1.5">
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

                      {/* Phone scan shortcut next to the copy link; the dialog loads lazily on click. */}
                      <QrCodeButton
                        url={link.url ?? ''}
                        title={link.displayName}
                        size="sm"
                        variant="outline"
                        disabled={!link.url}
                        testId={`output-qr-${link.client}`}
                      />

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
                              accessMutation.mutate({ id: output.id, access: e.target.value as PublicationAccess })
                            }
                            className="h-8 rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-xs text-text focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                          >
                            {accessOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>

                          {!readOnly ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={t('templateDetail.removeClientBtn')}
                              data-testid={`output-remove-${output.id}`}
                              onClick={() => setRemoveTarget(output)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-danger" />
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            }),
          )}
        </div>
      )}

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
            itemName={removeTarget.links.map((link) => link.displayName).join(' / ')}
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
