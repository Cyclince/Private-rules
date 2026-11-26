import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { rulesetFormSchema, type RulesetFormValues } from '../../../shared/schemas/ruleset';
import type { RuleCategory } from '../../../types/domain-rules';
import { useI18n } from '../../i18n';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';

type RulesetFormDialogProps = {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: RuleCategory | null;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: RulesetFormValues) => Promise<void> | void;
};

export function RulesetFormDialog({ open, mode, initial, submitting, onOpenChange, onSubmit }: RulesetFormDialogProps) {
  const { t } = useI18n();
  const form = useForm<RulesetFormValues>({
    resolver: zodResolver(rulesetFormSchema),
    defaultValues: {
      name: '',
      icon: '',
      description: '',
      note: '',
      enabled: true,
      publicLinksEnabled: false,
      tokenLinksEnabled: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && initial) {
      form.reset({
        name: initial.name,
        icon: initial.icon ?? '',
        description: initial.description ?? '',
        note: initial.note ?? '',
        enabled: initial.enabled !== false,
        publicLinksEnabled: Boolean(initial.publicLinksEnabled),
        tokenLinksEnabled: initial.tokenLinksEnabled !== false,
      });
    } else {
      form.reset({
        name: '',
        icon: '',
        description: '',
        note: '',
        enabled: true,
        publicLinksEnabled: false,
        tokenLinksEnabled: true,
      });
    }
  }, [open, mode, initial, form]);

  const handleValidSubmit = form.handleSubmit(async (values) => {
    await onSubmit(values);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="ruleset-form-dialog">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? t('rulesets.create') : t('rulesets.edit')}</DialogTitle>
          <DialogDescription>{t('preview.dialogDescription')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleValidSubmit} className="flex flex-col gap-3.5" noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ruleset-name" className="text-xs font-medium text-text">
              {t('rulesets.fieldName')}
            </label>
            <Input
              id="ruleset-name"
              data-testid="ruleset-form-name"
              placeholder={t('rulesets.fieldNamePlaceholder')}
              {...form.register('name')}
            />
            {form.formState.errors.name ? (
              <p className="text-xs text-danger" role="alert">
                {t('rulesets.validationNameRequired')}
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ruleset-icon" className="text-xs font-medium text-text">
                {t('rulesets.fieldIcon')}
              </label>
              <Input
                id="ruleset-icon"
                data-testid="ruleset-form-icon"
                placeholder={t('rulesets.fieldIconPlaceholder')}
                {...form.register('icon')}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="ruleset-description" className="text-xs font-medium text-text">
                {t('rulesets.fieldDescription')}
              </label>
              <Input
                id="ruleset-description"
                data-testid="ruleset-form-description"
                placeholder={t('rulesets.fieldDescriptionPlaceholder')}
                {...form.register('description')}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ruleset-note" className="text-xs font-medium text-text">
              {t('rulesets.fieldNote')}
            </label>
            <Input
              id="ruleset-note"
              data-testid="ruleset-form-note"
              placeholder={t('rulesets.fieldNotePlaceholder')}
              {...form.register('note')}
            />
          </div>

          <div className="flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface-muted/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">{t('rulesets.toggleEnabled')}</span>
              <Controller
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <Switch data-testid="ruleset-form-enabled" checked={field.value} onCheckedChange={field.onChange} />
                )}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">{t('rulesets.toggleToken')}</span>
              <Controller
                control={form.control}
                name="tokenLinksEnabled"
                render={({ field }) => (
                  <Switch
                    data-testid="ruleset-form-token"
                    checked={field.value}
                    onCheckedChange={(checked) => {
                      field.onChange(checked);
                      if (checked) form.setValue('publicLinksEnabled', false);
                    }}
                  />
                )}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">{t('rulesets.togglePublic')}</span>
              <Controller
                control={form.control}
                name="publicLinksEnabled"
                render={({ field }) => (
                  <Switch
                    data-testid="ruleset-form-public"
                    checked={field.value}
                    onCheckedChange={(checked) => {
                      field.onChange(checked);
                      if (checked) form.setValue('tokenLinksEnabled', false);
                    }}
                  />
                )}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" data-testid="ruleset-form-submit" disabled={submitting}>
              {submitting ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
