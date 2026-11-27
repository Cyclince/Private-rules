import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ShieldAlert, Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { PublicationWithLinks } from '../../../server/routes/publications';
import {
  isTemplateClientSupported,
  OUTPUT_PROFILES,
  TEMPLATE_CLIENT_IDS,
  TEMPLATE_CLIENTS,
  type OutputProfile,
  type TemplateClientId,
} from '../../../shared/clients';
import {
  PUBLICATION_ACCESS_VALUES,
  publicationAccessSchema,
  templateClientIdSchema,
  type PublicationAccess,
} from '../../../shared/schemas/publication';
import type { TemplateRecord } from '../../../shared/schemas/template';
import { useI18n, type MessageKey } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { invalidateTemplates, templatesListQueryOptions, templateVersionsQueryOptions } from '../../lib/query';
import { useToast } from '../../lib/toast';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';

const publicationDialogSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9_-]*$/i),
  templateId: z.string().trim().min(1),
  pinnedVersion: z.string(),
  clients: z.array(templateClientIdSchema).min(1),
  access: publicationAccessSchema,
  output: z.enum(['', ...OUTPUT_PROFILES]),
  experimentalFullConfig: z.boolean(),
});

type PublicationDialogFormValues = z.infer<typeof publicationDialogSchema>;

export type PublicationSubmitPayload = {
  slug: string;
  templateId: string;
  pinnedVersion: number | null;
  clients: TemplateClientId[];
  access: PublicationAccess;
  output: OutputProfile | null;
  experimentalFullConfig: boolean;
};

type PublicationFormDialogProps = {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: PublicationWithLinks | null;
  defaultTemplateId?: string;
  readOnly: boolean;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: PublicationSubmitPayload) => Promise<void> | void;
};

const selectClassName =
  'h-10 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 text-sm text-text focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50';

export function PublicationFormDialog({
  open,
  mode,
  initial,
  defaultTemplateId,
  readOnly,
  submitting,
  onOpenChange,
  onSubmit,
}: PublicationFormDialogProps) {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const hasBindings = mode === 'edit' && Boolean(initial && initial.bindings.length > 0);

  const templatesQuery = useQuery({
    ...templatesListQueryOptions({ limit: 100 }),
    enabled: open,
  });
  const templates = templatesQuery.data?.templates ?? [];

  const form = useForm<PublicationDialogFormValues>({
    resolver: zodResolver(publicationDialogSchema),
    defaultValues: {
      slug: '',
      templateId: '',
      pinnedVersion: '',
      clients: ['mihomo'],
      access: 'token',
      output: '',
      experimentalFullConfig: false,
    },
  });

  const watchedTemplateId = form.watch('templateId');
  const watchedClients = form.watch('clients');
  const watchedAccess = form.watch('access');
  const watchedExperimentalFullConfig = form.watch('experimentalFullConfig');

  const versionsQuery = useQuery({
    ...templateVersionsQueryOptions(watchedTemplateId),
    enabled: open && Boolean(watchedTemplateId),
  });
  const versions = versionsQuery.data?.versions ?? [];

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && initial) {
      form.reset({
        slug: initial.slug,
        templateId: initial.templateId,
        pinnedVersion: initial.pinnedVersion ? String(initial.pinnedVersion) : '',
        clients: initial.clients.length > 0 ? [...initial.clients] : ['mihomo'],
        access: initial.access,
        output: initial.output ?? '',
        experimentalFullConfig: Boolean(initial.experimentalFullConfig),
      });
    } else {
      form.reset({
        slug: '',
        templateId: defaultTemplateId || templates[0]?.id || '',
        pinnedVersion: '',
        clients: ['mihomo'],
        access: 'token',
        output: '',
        experimentalFullConfig: false,
      });
    }
  }, [open, mode, initial, defaultTemplateId, form, templates]);

  const createStarterMutation = useMutation({
    mutationFn: async () =>
      readApiJson<{ template: TemplateRecord }>(
        await api.api.templates.$post({
          json: { name: '标准模板', starterTier: 'standard' },
        }),
      ),
    onSuccess: async ({ template }) => {
      await invalidateTemplates(queryClient, template.id);
      form.setValue('templateId', template.id, { shouldValidate: true });
      form.setValue('pinnedVersion', '');
      notify({ title: t('publications.starterCreatedToast'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const toggleClient = (clientId: TemplateClientId) => {
    const current = form.getValues('clients');
    const next = current.includes(clientId) ? current.filter((item) => item !== clientId) : [...current, clientId];
    form.setValue('clients', next, { shouldValidate: true });
  };

  const handleValidSubmit = form.handleSubmit(async (values) => {
    const parsedVersion = values.pinnedVersion ? Number(values.pinnedVersion) : null;
    await onSubmit({
      slug: values.slug.trim(),
      templateId: values.templateId.trim(),
      pinnedVersion: parsedVersion && Number.isInteger(parsedVersion) && parsedVersion > 0 ? parsedVersion : null,
      clients: values.clients,
      access: values.access,
      output: values.output ? (values.output as OutputProfile) : null,
      experimentalFullConfig: values.experimentalFullConfig,
    });
  });

  const selectedTemplate = templates.find((tpl) => tpl.id === watchedTemplateId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="publication-form-dialog" className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? t('publications.create') : t('publications.edit')}</DialogTitle>
          <DialogDescription>{t('publications.subtitle')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleValidSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pub-slug" className="text-xs font-medium text-text">
              {t('publications.fieldSlug')}
            </label>
            <Input
              id="pub-slug"
              data-testid="pub-form-slug"
              placeholder={t('publications.fieldSlugPlaceholder')}
              {...form.register('slug')}
            />
            {form.formState.errors.slug ? (
              <p className="text-xs text-danger" role="alert">
                {t('publications.validationSlug')}
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pub-template" className="text-xs font-medium text-text">
                {t('publications.fieldTemplate')}
              </label>
              {templates.length === 0 && !templatesQuery.isLoading ? (
                <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-surface-muted/60 p-3 text-xs text-text-muted">
                  <p>{t('publications.noTemplatesHint')}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    data-testid="pub-create-starter-btn"
                    disabled={readOnly || createStarterMutation.isPending}
                    onClick={() => createStarterMutation.mutate()}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>{t('publications.createStarterBtn')}</span>
                  </Button>
                </div>
              ) : (
                <select
                  id="pub-template"
                  data-testid="pub-form-template"
                  className={selectClassName}
                  {...form.register('templateId', {
                    onChange: () => {
                      form.setValue('pinnedVersion', '');
                    },
                  })}
                >
                  <option value="">{t('publications.fieldTemplatePlaceholder')}</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name} (v{tpl.currentVersion})
                    </option>
                  ))}
                </select>
              )}
              {form.formState.errors.templateId ? (
                <p className="text-xs text-danger" role="alert">
                  {t('publications.validationTemplate')}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="pub-version" className="text-xs font-medium text-text">
                {t('publications.fieldPinnedVersion')}
              </label>
              <select
                id="pub-version"
                data-testid="pub-form-version"
                className={selectClassName}
                disabled={!watchedTemplateId}
                {...form.register('pinnedVersion')}
              >
                <option value="">
                  {t('publications.versionLatest')}
                  {selectedTemplate ? ` (v${selectedTemplate.currentVersion})` : ''}
                </option>
                {versions.map((ver) => (
                  <option key={ver.version} value={String(ver.version)}>
                    {t('publications.versionPinned')} v{ver.version}
                    {ver.note ? ` · ${ver.note}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-text">{t('publications.fieldClients')}</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {TEMPLATE_CLIENT_IDS.map((clientId) => {
                const meta = TEMPLATE_CLIENTS[clientId];
                const supported = isTemplateClientSupported(clientId);
                const checked = watchedClients.includes(clientId);
                return (
                  <label
                    key={clientId}
                    data-testid={`pub-form-client-${clientId}`}
                    className={`flex cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-xs transition-colors ${
                      checked
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-surface-muted/40 hover:bg-surface-muted'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleClient(clientId)}
                        className="h-4 w-4 accent-[var(--primary)]"
                      />
                      <span className="truncate font-medium text-text">{meta.label}</span>
                      <span className="truncate font-mono text-[10px] text-text-muted">{meta.fileName}</span>
                    </span>
                    {supported ? (
                      <Badge variant="success" className="shrink-0 text-[10px]">
                        {t('taxonomy.clientSupported')}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        data-testid={`pub-form-client-coming-soon-${clientId}`}
                        className="shrink-0 text-[10px]"
                      >
                        {t('taxonomy.clientComingSoon')}
                      </Badge>
                    )}
                  </label>
                );
              })}
            </div>
            {form.formState.errors.clients ? (
              <p className="text-xs text-danger" role="alert">
                {t('publications.validationClients')}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-text">{t('publications.fieldAccess')}</span>
            <div className="grid grid-cols-3 gap-2">
              {PUBLICATION_ACCESS_VALUES.map((modeOption) => {
                const isPublicBlocked = modeOption === 'public' && hasBindings;
                const active = watchedAccess === modeOption;
                return (
                  <button
                    key={modeOption}
                    type="button"
                    disabled={isPublicBlocked}
                    data-testid={`pub-form-access-${modeOption}`}
                    onClick={() => form.setValue('access', modeOption, { shouldValidate: true })}
                    className={`rounded-[var(--radius-md)] border px-3 py-2 text-xs font-medium transition-colors ${
                      active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-surface text-text hover:bg-surface-muted'
                    } disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    {t(`publications.access.${modeOption}` as MessageKey)}
                  </button>
                );
              })}
            </div>
            {hasBindings ? (
              <div
                data-testid="pub-public-disabled-reason"
                className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-warning/50 bg-surface-muted px-3 py-2 text-xs text-text-muted"
              >
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>{t('publications.publicDisabledReason')}</span>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="pub-output" className="text-xs font-medium text-text">
              {t('publications.fieldOutput')}
            </label>
            <select
              id="pub-output"
              data-testid="pub-form-output"
              className={selectClassName}
              {...form.register('output')}
            >
              <option value="">{t('publications.output.inherit')}</option>
              <option value="full">{t('publications.output.full')}</option>
              <option value="minimal">{t('publications.output.minimal')}</option>
            </select>
            <p className="text-[11px] text-text-muted">{t('publications.outputHint')}</p>
          </div>

          <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-surface-muted/40 p-3">
            <span className="text-xs font-medium text-text">{t('publications.fieldExperimentalFullConfig')}</span>
            <label className="flex cursor-pointer items-start gap-2 text-xs text-text">
              <input
                type="checkbox"
                data-testid="pub-form-experimental-full-config"
                className="mt-0.5 accent-primary"
                disabled={readOnly}
                {...form.register('experimentalFullConfig')}
              />
              <span>{t('publications.experimentalFullConfigLabel')}</span>
            </label>
            {watchedExperimentalFullConfig ? (
              <div
                data-testid="pub-form-experimental-warning"
                role="alert"
                className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-warning bg-warning/10 px-3 py-2 text-xs text-text"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold">{t('publications.experimentalFullConfigWarningTitle')}</span>
                  <span className="text-text-muted">{t('publications.experimentalFullConfigWarningBody')}</span>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-text-muted">{t('publications.experimentalFullConfigSafeHint')}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" data-testid="pub-form-submit" disabled={submitting || readOnly}>
              {submitting ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
