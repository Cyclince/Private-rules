import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { getApp, type AppDefinition } from '../../../shared/apps';
import type { TemplateClientId } from '../../../shared/clients';
import { useI18n } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { invalidatePublications, invalidateTemplates } from '../../lib/query';
import { useToast } from '../../lib/toast';
import { AppPicker } from '../apps/AppPicker';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

type AddClientDialogProps = {
  open: boolean;
  templateId: string;
  templateSlug: string;
  existingClients: ReadonlySet<TemplateClientId>;
  hasBoundNodes: boolean;
  onOpenChange: (open: boolean) => void;
};

function buildUniqueClientSlug(templateSlug: string, client: TemplateClientId): string {
  const randomSuffix = Math.random().toString(36).slice(2, 6);
  const cleanBase = `${templateSlug}-${client}`
    .replace(/[^a-z0-9_-]/gi, '-')
    .toLowerCase()
    .slice(0, 68);
  return `${cleanBase}-${randomSuffix}`;
}

function appForClient(client: TemplateClientId): AppDefinition | null {
  const ids = ['shadowrocket', 'quantumult-x', 'loon', 'surge', 'stash', 'sing-box', 'clash-verge-rev'] as const;
  for (const id of ids) {
    const app = getApp(id);
    if (app && app.templateClientId === client) return app;
  }
  return null;
}

/**
 * "Add software" dialog (design §6): one AppPicker drives everything, then one
 * output link is created per distinct compiler family. Software that cannot
 * produce a full configuration is disabled inside the picker itself.
 */
export function AddClientDialog({
  open,
  templateId,
  templateSlug,
  existingClients,
  hasBoundNodes,
  onOpenChange,
}: AddClientDialogProps) {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const [selectedApps, setSelectedApps] = useState<string[]>([]);

  const targetClients = useMemo(() => {
    const clients: TemplateClientId[] = [];
    const seen = new Set<string>();
    for (const appId of selectedApps) {
      const client = getApp(appId)?.templateClientId ?? null;
      if (!client || seen.has(client)) continue;
      seen.add(client);
      clients.push(client);
    }
    return clients;
  }, [selectedApps]);

  const existingSelection = targetClients.filter((client) => existingClients.has(client));
  const pendingClients = targetClients.filter((client) => !existingClients.has(client));

  const addMutation = useMutation({
    mutationFn: async (clients: TemplateClientId[]) => {
      const createdIds: string[] = [];
      for (const client of clients) {
        const res = await readApiJson<{ publication: { id: string } }>(
          await api.api.publications.$post({
            json: {
              slug: buildUniqueClientSlug(templateSlug, client),
              templateId,
              clients: [client],
              access: 'token',
              experimentalFullConfig: false,
              inheritSlotBindings: true,
            },
          }),
        );
        createdIds.push(res.publication.id);
      }
      return createdIds;
    },
    onSuccess: async () => {
      setSelectedApps([]);
      onOpenChange(false);
      await Promise.all([invalidateTemplates(queryClient, templateId), invalidatePublications(queryClient)]);
      notify({ title: t('templateDetail.clientAddedToast'), variant: 'success' });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setSelectedApps([]);
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-testid="add-client-dialog">
        <DialogHeader>
          <DialogTitle>{t('templateDetail.addSoftwareTitle')}</DialogTitle>
          <DialogDescription>
            {hasBoundNodes ? t('templateDetail.addClientDescInherited') : t('templateDetail.addClientDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <AppPicker mode="multiple" value={selectedApps} onChange={setSelectedApps} />
        </div>

        {targetClients.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-surface-muted/60 px-3 py-2 text-xs text-text">
            <span>{t('templateDetail.addSoftwareSelected')}</span>
            {targetClients.map((client) => (
              <Badge key={client} variant={existingClients.has(client) ? 'outline' : 'primary'} className="text-[10px]">
                {appForClient(client)?.name ?? client}
                {existingClients.has(client) ? ` · ${t('templateDetail.clientAlreadyAdded')}` : ''}
              </Badge>
            ))}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={addMutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            data-testid="add-client-confirm-btn"
            disabled={pendingClients.length === 0 || addMutation.isPending}
            title={existingSelection.length > 0 ? t('templateDetail.clientAlreadyAdded') : undefined}
            onClick={() => addMutation.mutate(pendingClients)}
          >
            {addMutation.isPending ? t('common.loading') : t('templateDetail.addClientConfirmBtn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
