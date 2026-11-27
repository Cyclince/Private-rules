import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TemplateBody, TemplateRecord } from '../../../shared/schemas/template';
import { useI18n } from '../../i18n';
import { invalidateTemplates, templateDetailQueryOptions, templateVersionsQueryOptions } from '../../lib/query';
import { useToast } from '../../lib/toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { TemplateVersionsPanel } from './TemplateVersionsPanel';

type TemplateVersionsDialogProps = {
  open: boolean;
  templateId: string;
  readOnly: boolean;
  onOpenChange: (open: boolean) => void;
};

export function TemplateVersionsDialog({ open, templateId, readOnly, onOpenChange }: TemplateVersionsDialogProps) {
  const { t } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    ...templateDetailQueryOptions(templateId),
    enabled: open,
  });
  const versionsQuery = useQuery({
    ...templateVersionsQueryOptions(templateId),
    enabled: open,
  });

  const handleSynced = async (
    payload: { template: TemplateRecord; resolvedBody: TemplateBody; version: number },
    toastKey: 'templates.editorRestoredToast' | 'templates.editorRebasedToast',
  ) => {
    await invalidateTemplates(queryClient, payload.template.id);
    notify({ title: `${t(toastKey)} (v${payload.version})`, variant: 'success' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-testid="template-versions-dialog">
        <DialogHeader>
          <DialogTitle>{t('templateDetail.menuVersions')}</DialogTitle>
        </DialogHeader>
        {detailQuery.data?.template ? (
          <TemplateVersionsPanel
            template={detailQuery.data.template}
            versions={versionsQuery.data?.versions ?? []}
            readOnly={readOnly}
            onRestored={(payload) => handleSynced(payload, 'templates.editorRestoredToast')}
            onRebased={(payload) => handleSynced(payload, 'templates.editorRebasedToast')}
          />
        ) : (
          <div className="h-48 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
        )}
      </DialogContent>
    </Dialog>
  );
}
