import { useI18n } from '../../i18n';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

type DeleteConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  itemName?: string;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
};

export function DeleteConfirmDialog({
  open,
  title,
  description,
  itemName,
  submitting,
  onOpenChange,
  onConfirm,
}: DeleteConfirmDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="delete-confirm-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {itemName ? (
          <div className="rounded-[var(--radius-sm)] border border-danger/30 bg-surface-muted px-3 py-2 font-mono text-xs text-text">
            {itemName}
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            data-testid="delete-confirm-submit"
            disabled={submitting}
            onClick={() => void onConfirm()}
          >
            {submitting ? t('common.loading') : t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
