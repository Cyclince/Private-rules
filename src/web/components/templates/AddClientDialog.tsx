import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useState } from 'react';
import {
  mapWizardClientSelection,
  WIZARD_CLIENT_OPTIONS,
  type WizardClientOption,
  type WizardClientOptionId,
} from '../../../domain/templates/quick-create';
import type { TemplateClientId } from '../../../shared/clients';
import { useI18n, type MessageKey } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { invalidatePublications, invalidateTemplates } from '../../lib/query';
import { useToast } from '../../lib/toast';
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

function formatClientDisplayName(option: WizardClientOption, locale: string): string {
  if (locale === 'en') return option.displayName;
  if (option.id === 'shadowrocket') return `${option.displayName}（小火箭）`;
  if (option.id === 'quantumult-x') return `${option.displayName}（圈X）`;
  return option.displayName;
}

function clientDescKey(id: WizardClientOptionId): MessageKey {
  return `wizard.clientDesc.${id}` as MessageKey;
}

function buildUniqueClientSlug(templateSlug: string, client: TemplateClientId): string {
  const randomSuffix = Math.random().toString(36).slice(2, 6);
  const cleanBase = `${templateSlug}-${client}`
    .replace(/[^a-z0-9_-]/gi, '-')
    .toLowerCase()
    .slice(0, 68);
  return `${cleanBase}-${randomSuffix}`;
}

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

  const [selectedIds, setSelectedIds] = useState<WizardClientOptionId[]>([]);

  const desktopAndroidOptions = WIZARD_CLIENT_OPTIONS.filter((opt) => opt.groups.includes('desktop-android'));
  const appleOptions = WIZARD_CLIENT_OPTIONS.filter((opt) => opt.groups.includes('apple'));

  const toggleOption = (id: WizardClientOptionId) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const addMutation = useMutation({
    mutationFn: async (optionIds: WizardClientOptionId[]) => {
      const mapped = mapWizardClientSelection(optionIds);
      const createdIds: string[] = [];
      for (const client of mapped.clients) {
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
      setSelectedIds([]);
      onOpenChange(false);
      await Promise.all([invalidateTemplates(queryClient, templateId), invalidatePublications(queryClient)]);
      notify({ title: t('templateDetail.clientAddedToast'), variant: 'success' });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const renderGroup = (
    groupKey: 'desktop-android' | 'apple',
    title: string,
    options: readonly WizardClientOption[],
  ) => (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</h4>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = selectedIds.includes(opt.id);
          const alreadyExists = existingClients.has(opt.client);
          const isSecondarySingBox = groupKey === 'apple' && opt.groups.includes('desktop-android');
          return (
            <button
              key={`${groupKey}-${opt.id}`}
              type="button"
              data-testid={isSecondarySingBox ? `add-client-option-apple-${opt.id}` : `add-client-option-${opt.id}`}
              aria-pressed={isSelected}
              onClick={() => toggleOption(opt.id)}
              className={`flex cursor-pointer items-start justify-between gap-2 rounded-[var(--radius-md)] border p-3 text-left transition-colors ${
                isSelected
                  ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                  : 'border-border bg-surface hover:border-primary/40 hover:bg-surface-muted/50'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold text-text">{formatClientDisplayName(opt, locale)}</span>
                  {alreadyExists ? (
                    <Badge variant="outline" className="text-[10px]">
                      {t('templateDetail.clientAlreadyAdded')}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-text-muted">{t(clientDescKey(opt.id))}</p>
              </div>
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-bg'
                }`}
              >
                {isSelected ? <Check className="h-3 w-3" /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setSelectedIds([]);
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-testid="add-client-dialog">
        <DialogHeader>
          <DialogTitle>{t('templateDetail.addClientTitle')}</DialogTitle>
          <DialogDescription>
            {hasBoundNodes ? t('templateDetail.addClientDescInherited') : t('templateDetail.addClientDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {renderGroup('desktop-android', t('wizard.groupDesktopAndroid'), desktopAndroidOptions)}
          {renderGroup('apple', t('wizard.groupApple'), appleOptions)}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={addMutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            data-testid="add-client-confirm-btn"
            disabled={selectedIds.length === 0 || addMutation.isPending}
            onClick={() => addMutation.mutate(selectedIds)}
          >
            {addMutation.isPending ? t('common.loading') : t('templateDetail.addClientConfirmBtn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
