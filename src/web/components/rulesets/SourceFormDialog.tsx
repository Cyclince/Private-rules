import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { SOURCE_SYNC_INTERVALS, sourceFormSchema, type SourceFormValues } from '../../../shared/schemas/source';
import type { GeoSourceSuggestion, RuleSource } from '../../../types/domain-rules';
import { useI18n } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';

export type SourcePreviewPayload = {
  count: number;
  originalCount: number;
  optimized: boolean;
  invalidCount: number;
  rules: Array<{ type: string; value: string }>;
};

type SourceFormDialogProps = {
  open: boolean;
  mode: 'create' | 'edit';
  rulesetId: string;
  initial?: RuleSource | null;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: SourceFormValues) => Promise<void> | void;
};

const DEFAULT_UA = 'clash-verge/v2.5.1';

export function SourceFormDialog({
  open,
  mode,
  rulesetId,
  initial,
  submitting,
  onOpenChange,
  onSubmit,
}: SourceFormDialogProps) {
  const { t, locale } = useI18n();
  const { notify } = useToast();

  const [geoQuery, setGeoQuery] = useState('');
  const [geoSearching, setGeoSearching] = useState(false);
  const [geoResults, setGeoResults] = useState<GeoSourceSuggestion[]>([]);
  const [geoSearched, setGeoSearched] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<SourcePreviewPayload | null>(null);

  const form = useForm<SourceFormValues>({
    resolver: zodResolver(sourceFormSchema),
    defaultValues: {
      sourceType: 'url',
      name: '',
      url: '',
      geositeName: '',
      geoipName: '',
      syncIntervalMinutes: 60,
      userAgent: DEFAULT_UA,
      ruleOptimization: 'none',
      enabled: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setGeoQuery('');
    setGeoResults([]);
    setGeoSearched(false);
    if (mode === 'edit' && initial) {
      form.reset({
        sourceType: initial.sourceType ?? 'url',
        name: initial.name ?? '',
        url: initial.url ?? '',
        geositeName: initial.geositeName ?? '',
        geoipName: initial.geoipName ?? '',
        syncIntervalMinutes: initial.syncIntervalMinutes || 60,
        userAgent: initial.userAgent ?? DEFAULT_UA,
        ruleOptimization: initial.ruleOptimization ?? 'none',
        enabled: initial.enabled,
      });
    } else {
      form.reset({
        sourceType: 'url',
        name: '',
        url: '',
        geositeName: '',
        geoipName: '',
        syncIntervalMinutes: 60,
        userAgent: DEFAULT_UA,
        ruleOptimization: 'none',
        enabled: true,
      });
    }
  }, [open, mode, initial, form]);

  const sourceType = form.watch('sourceType');

  const handleGeoSearch = async () => {
    const q = geoQuery.trim();
    if (!q) return;
    setGeoSearching(true);
    setGeoSearched(false);
    try {
      const payload = await readApiJson<{ results: GeoSourceSuggestion[] }>(
        await api.api.geo.search.$get({ query: { q } }),
      );
      setGeoResults(payload.results);
      setGeoSearched(true);
    } catch (error) {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    } finally {
      setGeoSearching(false);
    }
  };

  const handlePreview = form.handleSubmit(async (values) => {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const payload = await readApiJson<{ preview: SourcePreviewPayload }>(
        await api.api.rulesets[':id'].sources.preview.$post({
          param: { id: rulesetId },
          json: {
            sourceType: values.sourceType,
            name: values.name || undefined,
            url: values.sourceType === 'url' ? values.url.trim() : undefined,
            geositeName: values.sourceType === 'geosite' ? values.geositeName.trim() : undefined,
            geoipName: values.sourceType === 'geoip' ? values.geoipName.trim() : undefined,
            syncIntervalMinutes: values.syncIntervalMinutes,
            userAgent: values.userAgent || undefined,
            ruleOptimization: values.sourceType === 'url' ? values.ruleOptimization : 'none',
            enabled: values.enabled,
          },
        }),
      );
      setPreview(payload.preview);
    } catch (error) {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    } finally {
      setPreviewLoading(false);
    }
  });

  const handleSave = form.handleSubmit(async (values) => {
    await onSubmit(values);
  });

  const intervalLabel = (minutes: number) => {
    if (minutes === 15) return t('sources.interval15');
    if (minutes === 30) return t('sources.interval30');
    if (minutes === 60) return t('sources.interval60');
    if (minutes === 360) return t('sources.interval360');
    if (minutes === 720) return t('sources.interval720');
    return t('sources.interval1440');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" data-testid="source-form-dialog">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? t('sources.add') : t('sources.edit')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSave} className="flex flex-col gap-3.5" noValidate>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text">{t('sources.fieldType')}</span>
            <div className="flex flex-wrap gap-1.5">
              {(['url', 'geosite', 'geoip'] as const).map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  size="sm"
                  data-testid={`source-type-${kind}`}
                  variant={sourceType === kind ? 'primary' : 'outline'}
                  onClick={() => {
                    form.setValue('sourceType', kind);
                    setPreview(null);
                  }}
                >
                  {kind === 'url'
                    ? t('sources.typeUrl')
                    : kind === 'geosite'
                      ? t('sources.typeGeosite')
                      : t('sources.typeGeoip')}
                </Button>
              ))}
            </div>
          </div>

          {sourceType === 'url' ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="source-url" className="text-xs font-medium text-text">
                {t('sources.fieldUrl')}
              </label>
              <Input
                id="source-url"
                data-testid="source-form-url"
                placeholder={t('sources.fieldUrlPlaceholder')}
                className="font-mono text-xs"
                {...form.register('url')}
              />
              {form.formState.errors.url ? (
                <p className="text-xs text-danger" role="alert">
                  {t('sources.validationUrlRequired')}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                  <Input
                    data-testid="source-geo-search-input"
                    value={geoQuery}
                    onChange={(event) => setGeoQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleGeoSearch();
                      }
                    }}
                    placeholder={t('sources.geoSearchPlaceholder')}
                    className="pl-9"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="source-geo-search-btn"
                  disabled={geoSearching || !geoQuery.trim()}
                  onClick={() => void handleGeoSearch()}
                >
                  {geoSearching ? t('common.loading') : t('sources.geoSearchAction')}
                </Button>
              </div>

              {geoResults.length > 0 ? (
                <div
                  data-testid="source-geo-results"
                  className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-[var(--radius-sm)] border border-border bg-surface-muted p-2"
                >
                  {geoResults.map((item) => (
                    <button
                      key={`${item.sourceType}:${item.name}`}
                      type="button"
                      data-testid={`geo-suggestion-${item.sourceType}-${item.name}`}
                      onClick={() => {
                        form.setValue('sourceType', item.sourceType);
                        if (item.sourceType === 'geosite') {
                          form.setValue('geositeName', item.name);
                        } else {
                          form.setValue('geoipName', item.name);
                        }
                      }}
                      className="inline-flex cursor-pointer items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs hover:border-primary"
                    >
                      <Badge variant={item.sourceType === 'geosite' ? 'primary' : 'accent'} className="text-[10px]">
                        {item.sourceType}
                      </Badge>
                      <span className="font-mono">{item.name}</span>
                    </button>
                  ))}
                </div>
              ) : geoSearched ? (
                <p className="text-xs text-text-muted">{t('sources.geoSearchEmpty')}</p>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <label htmlFor="source-geo-name" className="text-xs font-medium text-text">
                  {t('sources.fieldGeoName')} ({sourceType === 'geosite' ? 'GeoSite' : 'GeoIP'})
                </label>
                {sourceType === 'geosite' ? (
                  <Input
                    id="source-geo-name"
                    data-testid="source-form-geosite"
                    placeholder={t('sources.fieldGeoPlaceholder')}
                    className="font-mono text-xs"
                    {...form.register('geositeName')}
                  />
                ) : (
                  <Input
                    id="source-geo-name"
                    data-testid="source-form-geoip"
                    placeholder={t('sources.fieldGeoPlaceholder')}
                    className="font-mono text-xs"
                    {...form.register('geoipName')}
                  />
                )}
                {form.formState.errors.geositeName || form.formState.errors.geoipName ? (
                  <p className="text-xs text-danger" role="alert">
                    {t('sources.validationGeoRequired')}
                  </p>
                ) : null}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="source-name" className="text-xs font-medium text-text">
                {t('sources.fieldName')}
              </label>
              <Input
                id="source-name"
                data-testid="source-form-name"
                placeholder={t('sources.fieldNamePlaceholder')}
                {...form.register('name')}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="source-interval" className="text-xs font-medium text-text">
                {t('sources.fieldInterval')}
              </label>
              <Controller
                control={form.control}
                name="syncIntervalMinutes"
                render={({ field }) => (
                  <select
                    id="source-interval"
                    data-testid="source-form-interval"
                    value={field.value}
                    onChange={(event) => field.onChange(Number(event.target.value))}
                    className="flex h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-sm text-text focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    {SOURCE_SYNC_INTERVALS.map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {intervalLabel(minutes)}
                      </option>
                    ))}
                  </select>
                )}
              />
            </div>
          </div>

          {sourceType === 'url' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="source-ua" className="text-xs font-medium text-text">
                  {t('sources.fieldUserAgent')}
                </label>
                <Input
                  id="source-ua"
                  data-testid="source-form-ua"
                  className="font-mono text-xs"
                  {...form.register('userAgent')}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="source-opt" className="text-xs font-medium text-text">
                  {t('sources.fieldOptimization')}
                </label>
                <select
                  id="source-opt"
                  data-testid="source-form-optimization"
                  {...form.register('ruleOptimization')}
                  className="flex h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-sm text-text focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <option value="none">{t('sources.optNone')}</option>
                  <option value="conservative">{t('sources.optConservative')}</option>
                  <option value="aggressive">{t('sources.optAggressive')}</option>
                </select>
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-border bg-surface-muted/60 px-3 py-2.5">
            <span className="text-xs font-medium">{t('common.enabled')}</span>
            <Controller
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <Switch data-testid="source-form-enabled" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>

          {preview ? (
            <div
              data-testid="source-preview-result"
              className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-primary/50 bg-surface-muted p-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-primary">{t('sources.previewResult')}</span>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="primary">
                    {preview.count.toLocaleString()} {t('rules.unitItems')}
                  </Badge>
                  {preview.optimized ? (
                    <Badge variant="success">
                      {preview.originalCount.toLocaleString()} → {preview.count.toLocaleString()}
                    </Badge>
                  ) : null}
                  {preview.invalidCount > 0 ? (
                    <Badge variant="warning">
                      {t('import.summaryInvalid')}: {preview.invalidCount}
                    </Badge>
                  ) : null}
                </div>
              </div>
              <div className="text-[11px] text-text-muted">{t('sources.previewSample')}</div>
              <ul className="max-h-32 overflow-y-auto rounded bg-surface p-2 font-mono text-[11px]">
                {preview.rules.map((item, idx) => (
                  <li key={`${item.type}:${item.value}:${idx}`} className="truncate">
                    {item.type},{item.value}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="secondary"
              data-testid="source-preview-btn"
              disabled={previewLoading || submitting}
              onClick={handlePreview}
            >
              <Eye className="h-3.5 w-3.5" />
              <span>{previewLoading ? t('sources.previewing') : t('sources.preview')}</span>
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" data-testid="source-form-submit" disabled={submitting}>
              {submitting ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
