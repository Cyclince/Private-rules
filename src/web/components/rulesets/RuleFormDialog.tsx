import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  describeRuleFriendly,
  getAllRuleTypeOptions,
  isIpCidrRuleType,
  previewRuleInputFriendly,
} from '../../../domain/rules/friendly';
import { manualRuleFormSchema, type ManualRuleFormValues } from '../../../shared/schemas/rule';
import type { DomainRule, RuleConflict } from '../../../types/domain-rules';
import { useI18n } from '../../i18n';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { formatFriendlyRuleInline, formatFriendlyRuleType } from './rule-library-helpers';

type RuleFormDialogProps = {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: DomainRule | null;
  conflicts: RuleConflict[];
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: ManualRuleFormValues, replaceConflicts: boolean) => Promise<void> | void;
};

export function RuleFormDialog({
  open,
  mode,
  initial,
  conflicts,
  submitting,
  onOpenChange,
  onSubmit,
}: RuleFormDialogProps) {
  const { t } = useI18n();
  const typeOptions = useMemo(() => getAllRuleTypeOptions(), []);
  const form = useForm<ManualRuleFormValues>({
    resolver: zodResolver(manualRuleFormSchema),
    defaultValues: {
      value: '',
      type: 'AUTO',
      note: '',
      enabled: true,
      noResolve: false,
    },
  });

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && initial) {
      form.reset({
        value: initial.value,
        type: initial.type,
        note: initial.note ?? '',
        enabled: initial.enabled,
        noResolve: Boolean(initial.options?.noResolve),
      });
    } else {
      form.reset({
        value: '',
        type: 'AUTO',
        note: '',
        enabled: true,
        noResolve: true,
      });
    }
  }, [open, mode, initial, form]);

  const watchedValue = form.watch('value');
  const selectedType = form.watch('type');
  const preview = useMemo(() => previewRuleInputFriendly(watchedValue, selectedType), [watchedValue, selectedType]);
  const effectiveType = selectedType === 'AUTO' ? (preview?.ok ? preview.type : undefined) : selectedType;
  const showNoResolve = isIpCidrRuleType(effectiveType);

  const handleSubmitNormal = form.handleSubmit(async (values) => {
    await onSubmit(values, false);
  });

  const handleReplaceConflicts = form.handleSubmit(async (values) => {
    await onSubmit(values, true);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="rule-form-dialog">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? t('rules.add') : t('rules.edit')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmitNormal} className="flex flex-col gap-3.5" noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rule-value" className="text-xs font-medium text-text">
              {t('ruleDetail.fieldAddress')}
            </label>
            <Input
              id="rule-value"
              data-testid="rule-form-value"
              placeholder={t('ruleDetail.fieldAddressPlaceholder')}
              className="font-mono text-xs"
              {...form.register('value')}
            />
            {form.formState.errors.value ? (
              <p className="text-xs text-danger" role="alert">
                {t('rules.validationValueRequired')}
              </p>
            ) : preview?.ok ? (
              <p className="rounded-[var(--radius-sm)] bg-surface-muted/80 px-2.5 py-1.5 text-xs text-text-muted">
                <span className="font-medium text-primary">{t('ruleDetail.previewPrefix')}</span>
                <span>
                  {formatFriendlyRuleType(preview.friendly, t)} · {formatFriendlyRuleInline(preview.friendly, t)}
                </span>
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rule-type" className="text-xs font-medium text-text">
                {t('ruleDetail.fieldType')}
              </label>
              <select
                id="rule-type"
                data-testid="rule-form-type"
                {...form.register('type')}
                className="flex h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-sm text-text focus-visible:outline-2 focus-visible:outline-primary"
              >
                {mode === 'create' ? <option value="AUTO">{t('rules.typeAuto')}</option> : null}
                {typeOptions.map((option) => (
                  <option key={option.type} value={option.type}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="rule-note" className="text-xs font-medium text-text">
                {t('ruleDetail.fieldNote')}
              </label>
              <Input
                id="rule-note"
                data-testid="rule-form-note"
                placeholder={t('ruleDetail.fieldNotePlaceholder')}
                {...form.register('note')}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-surface-muted/60 px-3 py-2.5">
            <span className="text-xs font-medium">{t('rules.fieldEnabled')}</span>
            <Controller
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <Switch data-testid="rule-form-enabled" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>

          {showNoResolve ? (
            <details className="rounded-[var(--radius-md)] border border-border bg-surface-muted/40">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-medium text-text-muted hover:text-text">
                <span className="inline-flex items-center gap-1.5">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>{t('ruleDetail.moreOptions')}</span>
                </span>
                <ChevronDown className="h-3.5 w-3.5" />
              </summary>
              <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-text">{t('rules.fieldNoResolve')}</div>
                  <p className="text-[11px] text-text-muted">{t('ruleDetail.noResolveHint')}</p>
                </div>
                <Controller
                  control={form.control}
                  name="noResolve"
                  render={({ field }) => (
                    <Switch data-testid="rule-form-no-resolve" checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
              </div>
            </details>
          ) : null}

          {conflicts.length > 0 ? (
            <div
              data-testid="rule-form-conflicts"
              role="alert"
              className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-warning bg-surface-muted p-3"
            >
              <div className="flex items-start gap-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('ruleDetail.conflictBody')}</span>
              </div>
              <ul className="flex max-h-36 flex-col gap-1.5 overflow-y-auto text-xs">
                {conflicts.map((conflict) => {
                  const desc = describeRuleFriendly(conflict);
                  return (
                    <li key={conflict.id} className="rounded bg-surface px-2.5 py-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono font-medium">{conflict.value}</span>
                        <span className="text-[11px] text-text-muted">
                          {formatFriendlyRuleType(desc, t)} · {conflict.categoryName}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-text-muted">{conflict.reason}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            {conflicts.length > 0 && mode === 'create' ? (
              <Button
                type="button"
                variant="danger"
                data-testid="rule-form-replace-conflicts"
                disabled={submitting}
                onClick={handleReplaceConflicts}
              >
                {t('rules.replaceConflictsAndAdd')}
              </Button>
            ) : null}
            <Button type="submit" data-testid="rule-form-submit" disabled={submitting}>
              {submitting ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
