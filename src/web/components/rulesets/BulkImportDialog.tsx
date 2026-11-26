import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { bulkImportFormSchema, type BulkImportFormValues } from '../../../shared/schemas/rule';
import type { ImportPreview } from '../../../types/domain-rules';
import { useI18n } from '../../i18n';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Switch } from '../ui/switch';

type BulkImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreview: (text: string) => Promise<ImportPreview>;
  onConfirm: (text: string, replaceConflicts: boolean) => Promise<{ importedCount: number; replaced: number }>;
};

export function BulkImportDialog({ open, onOpenChange, onPreview, onConfirm }: BulkImportDialogProps) {
  const { t } = useI18n();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<{ importedCount: number; replaced: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm<BulkImportFormValues>({
    resolver: zodResolver(bulkImportFormSchema),
    defaultValues: {
      text: '',
      replaceConflicts: false,
    },
  });

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setPreview(null);
    setResult(null);
    setBusy(false);
    form.reset({ text: '', replaceConflicts: false });
  }, [open, form]);

  const conflictCount = preview?.conflicts?.length ?? 0;
  const replaceConflicts = form.watch('replaceConflicts');

  const handleStep1Preview = form.handleSubmit(async (values) => {
    setBusy(true);
    try {
      const nextPreview = await onPreview(values.text);
      setPreview(nextPreview);
      setStep(2);
    } finally {
      setBusy(false);
    }
  });

  const handleStep2Confirm = async () => {
    const text = form.getValues('text');
    const shouldReplace = form.getValues('replaceConflicts');
    setBusy(true);
    try {
      const outcome = await onConfirm(text, shouldReplace);
      setResult(outcome);
      setStep(3);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="bulk-import-dialog">
        <DialogHeader>
          <DialogTitle>{t('import.title')}</DialogTitle>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            <Badge variant={step === 1 ? 'primary' : 'outline'}>{t('import.step1')}</Badge>
            <Badge variant={step === 2 ? 'primary' : 'outline'}>{t('import.step2')}</Badge>
            <Badge variant={step === 3 ? 'primary' : 'outline'}>{t('import.step3')}</Badge>
          </div>
        </DialogHeader>

        {step === 1 ? (
          <form onSubmit={handleStep1Preview} className="flex flex-col gap-3" noValidate>
            <label htmlFor="bulk-import-text" className="text-xs font-medium text-text-muted">
              {t('import.textareaLabel')}
            </label>
            <textarea
              id="bulk-import-text"
              data-testid="bulk-import-textarea"
              rows={8}
              placeholder={t('import.textareaPlaceholder')}
              {...form.register('text')}
              className="w-full rounded-[var(--radius-sm)] border border-border bg-surface p-3 font-mono text-xs text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-primary"
            />
            {form.formState.errors.text ? (
              <p className="text-xs text-danger" role="alert">
                {t('import.validationTextRequired')}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" data-testid="bulk-import-preview-btn" disabled={busy}>
                {busy ? t('common.loading') : t('import.previewAction')}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {step === 2 && preview ? (
          <div className="flex flex-col gap-3.5" data-testid="bulk-import-preview-step">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-[var(--radius-sm)] border border-border bg-surface-muted p-2.5">
                <div className="text-[11px] text-text-muted">{t('import.summaryValid')}</div>
                <div className="mt-0.5 text-lg font-bold" data-testid="bulk-import-valid-count">
                  {preview.rules.length}
                </div>
              </div>
              <div className="rounded-[var(--radius-sm)] border border-border bg-surface-muted p-2.5">
                <div className="text-[11px] text-text-muted">{t('import.summaryDuplicates')}</div>
                <div className="mt-0.5 text-lg font-bold">{preview.duplicateValues.length}</div>
              </div>
              <div className="rounded-[var(--radius-sm)] border border-border bg-surface-muted p-2.5">
                <div className="text-[11px] text-text-muted">{t('import.summaryInvalid')}</div>
                <div className="mt-0.5 text-lg font-bold">{preview.invalidValues.length}</div>
              </div>
              <div className="rounded-[var(--radius-sm)] border border-border bg-surface-muted p-2.5">
                <div className="text-[11px] text-text-muted">{t('import.summaryConflicts')}</div>
                <div
                  className={`mt-0.5 text-lg font-bold ${conflictCount > 0 ? 'text-warning' : ''}`}
                  data-testid="bulk-import-conflict-count"
                >
                  {conflictCount}
                </div>
              </div>
            </div>

            {preview.invalidValues.length > 0 ? (
              <div className="rounded-[var(--radius-sm)] border border-danger/40 bg-surface-muted p-3">
                <div className="text-xs font-medium text-danger">{t('import.invalidListTitle')}</div>
                <ul className="mt-1.5 max-h-24 overflow-y-auto font-mono text-xs text-text-muted">
                  {preview.invalidValues.slice(0, 20).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {conflictCount > 0 ? (
              <div
                data-testid="bulk-import-conflicts"
                className="flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-warning bg-surface-muted p-3"
              >
                <div className="flex items-start gap-2 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t('import.conflictHint')}</span>
                </div>
                <ul className="flex max-h-36 flex-col gap-1.5 overflow-y-auto text-xs">
                  {preview.conflicts!.slice(0, 20).map((entry) => (
                    <li key={`${entry.rule.type}:${entry.rule.value}`} className="rounded bg-surface px-2.5 py-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline">{entry.rule.type}</Badge>
                        <span className="font-mono">{entry.rule.value}</span>
                      </div>
                      {entry.matches.map((match) => (
                        <p key={match.id} className="mt-0.5 text-[11px] text-text-muted">
                          ↔ {match.type},{match.value} ({match.categoryName}) — {match.reason}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                  <span className="text-xs font-medium text-text">{t('import.replaceConflictsLabel')}</span>
                  <Controller
                    control={form.control}
                    name="replaceConflicts"
                    render={({ field }) => (
                      <Switch
                        data-testid="bulk-import-replace-toggle"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                </div>
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={busy}>
                {t('import.backAction')}
              </Button>
              <Button
                type="button"
                data-testid="bulk-import-confirm-btn"
                disabled={busy || preview.rules.length === 0 || (conflictCount > 0 && !replaceConflicts)}
                onClick={() => void handleStep2Confirm()}
              >
                {busy ? t('import.importing') : t('import.confirmAction')}
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {step === 3 && result ? (
          <div className="flex flex-col gap-4" data-testid="bulk-import-done-step">
            <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-success bg-surface-muted p-4">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
              <div className="text-sm">
                <div className="font-semibold">{t('import.successTitle')}</div>
                <p className="mt-0.5 text-xs text-text-muted">
                  {t('import.successSummary')}: {result.importedCount} {t('rules.unitItems')}
                  {result.replaced > 0 ? ` · ${t('import.replacedLabel')}: ${result.replaced}` : ''}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" data-testid="bulk-import-close-btn" onClick={() => onOpenChange(false)}>
                {t('common.close')}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
