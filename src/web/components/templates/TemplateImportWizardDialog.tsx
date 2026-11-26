import { AlertTriangle, CheckCircle2, FileUp, Info, Upload } from 'lucide-react';
import { useEffect, useState, type ChangeEvent } from 'react';
import type { ImportCompatibilityReport, ImportSourceFormat } from '../../../domain/templates';
import type { TemplateRecord } from '../../../shared/schemas/template';
import { useI18n } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';

type ImportPreviewResponse = {
  saved: false;
  imported: {
    name: string;
    report: ImportCompatibilityReport;
  };
};

type ImportSaveResponse = {
  saved: true;
  template: TemplateRecord;
  report: ImportCompatibilityReport;
};

type TemplateImportWizardDialogProps = {
  open: boolean;
  readOnly?: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (template: TemplateRecord, report: ImportCompatibilityReport) => void;
};

export function TemplateImportWizardDialog({
  open,
  readOnly = false,
  onOpenChange,
  onImported,
}: TemplateImportWizardDialogProps) {
  const { t, locale } = useI18n();
  const [step, setStep] = useState<'input' | 'report'>('input');
  const [format, setFormat] = useState<ImportSourceFormat>('acl4ssr-ini');
  const [sourceMode, setSourceMode] = useState<'content' | 'url'>('content');
  const [content, setContent] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [previewReport, setPreviewReport] = useState<ImportCompatibilityReport | null>(null);
  const [suggestedName, setSuggestedName] = useState('');

  useEffect(() => {
    if (!open) return;
    setStep('input');
    setFormat('acl4ssr-ini');
    setSourceMode('content');
    setContent('');
    setSourceUrl('');
    setName('');
    setSlug('');
    setDescription('');
    setLoading(false);
    setSaving(false);
    setError('');
    setPreviewReport(null);
    setSuggestedName('');
  }, [open]);

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setContent(text);
    setSourceMode('content');
    if (file.name.endsWith('.yaml') || file.name.endsWith('.yml')) {
      setFormat('mihomo-yaml');
    } else if (file.name.endsWith('.ini')) {
      setFormat('acl4ssr-ini');
    }
    if (!name.trim()) {
      setName(file.name.replace(/\.(ini|ya?ml|txt)$/i, ''));
    }
  };

  const buildRequestPayload = (save: boolean) => {
    const trimmedUrl = sourceUrl.trim();
    const trimmedSlug = slug.trim();
    return {
      format,
      ...(sourceMode === 'content' ? { content } : { sourceUrl: trimmedUrl }),
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(trimmedSlug ? { slug: trimmedSlug } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      save,
    };
  };

  const handlePreview = async () => {
    if (readOnly || loading) return;
    if (sourceMode === 'content' && !content.trim()) {
      setError(t('templates.importContentRequired'));
      return;
    }
    if (sourceMode === 'url' && !/^https?:\/\//i.test(sourceUrl.trim())) {
      setError(t('templates.importUrlRequired'));
      return;
    }
    if (slug.trim() && !/^[a-z0-9][a-z0-9_-]*$/i.test(slug.trim())) {
      setError(t('templates.validationSlug'));
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await api.api.templates.import.$post({ json: buildRequestPayload(false) });
      const data = await readApiJson<ImportPreviewResponse>(res);
      setPreviewReport(data.imported.report);
      setSuggestedName(data.imported.name);
      if (!name.trim() && data.imported.name) {
        setName(data.imported.name);
      }
      setStep('report');
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSave = async () => {
    if (readOnly || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.api.templates.import.$post({ json: buildRequestPayload(true) });
      const data = await readApiJson<ImportSaveResponse>(res);
      onImported(data.template, data.report);
      onOpenChange(false);
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="import-template-dialog" className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('templates.importTitle')}</DialogTitle>
          <DialogDescription>{t('templates.importDesc')}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 text-xs">
          <Badge variant={step === 'input' ? 'primary' : 'outline'}>{t('templates.importStepSource')}</Badge>
          <span className="text-text-muted">→</span>
          <Badge variant={step === 'report' ? 'primary' : 'outline'}>{t('templates.importStepReport')}</Badge>
        </div>

        {step === 'input' ? (
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  data-testid="import-format-ini"
                  variant={format === 'acl4ssr-ini' ? 'primary' : 'outline'}
                  onClick={() => setFormat('acl4ssr-ini')}
                >
                  subconverter (.ini)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  data-testid="import-format-yaml"
                  variant={format === 'mihomo-yaml' ? 'primary' : 'outline'}
                  onClick={() => setFormat('mihomo-yaml')}
                >
                  mihomo YAML
                </Button>
              </div>

              <div className="flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={sourceMode === 'content' ? 'primary' : 'outline'}
                  onClick={() => setSourceMode('content')}
                >
                  {t('templates.importModePaste')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={sourceMode === 'url' ? 'primary' : 'outline'}
                  onClick={() => setSourceMode('url')}
                >
                  {t('templates.importModeUrl')}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-text">
                <span>{t('templates.fieldName')}</span>
                <Input
                  data-testid="import-template-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('templates.fieldNameOptional')}
                  disabled={readOnly}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-text">
                <span>{t('templates.fieldSlug')}</span>
                <Input
                  data-testid="import-template-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder={t('templates.fieldSlugPlaceholder')}
                  disabled={readOnly}
                />
              </label>
            </div>

            {sourceMode === 'content' ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-text">{t('templates.importContentLabel')}</span>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-surface-muted px-2.5 py-1 text-xs font-medium text-text hover:bg-surface">
                    <FileUp className="h-3.5 w-3.5" />
                    <span>{t('templates.importUploadFile')}</span>
                    <input
                      type="file"
                      accept=".ini,.yaml,.yml,.txt"
                      data-testid="import-file-input"
                      onChange={handleFileUpload}
                      className="sr-only"
                    />
                  </label>
                </div>
                <textarea
                  data-testid="import-content-textarea"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={10}
                  disabled={readOnly}
                  placeholder={
                    format === 'acl4ssr-ini'
                      ? 'custom_proxy_group=🚀 节点选择`select`[]DIRECT`.*\nruleset=DIRECT,[]GEOIP,CN,no-resolve\nruleset=🚀 节点选择,[]FINAL'
                      : 'proxy-groups:\n  - name: Proxy\n    type: select\n    include-all: true\nrules:\n  - GEOSITE,cn,DIRECT\n  - MATCH,Proxy'
                  }
                  className="w-full rounded-[var(--radius-md)] border border-border bg-bg p-3 font-mono text-xs text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-primary"
                />
              </div>
            ) : (
              <label className="flex flex-col gap-1 text-xs font-medium text-text">
                <span>{t('templates.importSourceUrlLabel')}</span>
                <Input
                  data-testid="import-url-input"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://raw.githubusercontent.com/.../config.ini"
                  disabled={readOnly}
                />
              </label>
            )}

            <label className="flex flex-col gap-1 text-xs font-medium text-text">
              <span>{t('templates.fieldDescription')}</span>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('templates.fieldDescriptionPlaceholder')}
                disabled={readOnly}
              />
            </label>

            {error ? (
              <p role="alert" data-testid="import-error" className="text-xs text-danger">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                data-testid="import-preview-btn"
                disabled={readOnly || loading}
                onClick={handlePreview}
              >
                <Upload className="h-3.5 w-3.5" />
                <span>{loading ? t('common.loading') : t('templates.importAnalyzeBtn')}</span>
              </Button>
            </DialogFooter>
          </div>
        ) : previewReport ? (
          <div data-testid="import-compatibility-report" className="flex flex-col gap-4">
            <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface-muted px-3 py-2 text-xs">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              <span className="font-medium text-text">
                {t('templates.importReportReady')}: {name.trim() || suggestedName}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <div className="rounded-[var(--radius-md)] border border-border bg-surface p-2.5 text-center">
                <div className="text-lg font-semibold text-text" data-testid="import-stat-cards">
                  {previewReport.importedCards}
                </div>
                <div className="text-[11px] text-text-muted">{t('templates.importStatCards')}</div>
              </div>
              <div className="rounded-[var(--radius-md)] border border-border bg-surface p-2.5 text-center">
                <div className="text-lg font-semibold text-text">{previewReport.importedRegionGroups}</div>
                <div className="text-[11px] text-text-muted">{t('templates.importStatRegions')}</div>
              </div>
              <div className="rounded-[var(--radius-md)] border border-border bg-surface p-2.5 text-center">
                <div className="text-lg font-semibold text-text">{previewReport.importedMatchers}</div>
                <div className="text-[11px] text-text-muted">{t('templates.importStatMatchers')}</div>
              </div>
              <div className="rounded-[var(--radius-md)] border border-border bg-surface p-2.5 text-center">
                <div className="text-lg font-semibold text-warning">{previewReport.skippedCount}</div>
                <div className="text-[11px] text-text-muted">{t('templates.importStatSkipped')}</div>
              </div>
              <div className="rounded-[var(--radius-md)] border border-border bg-surface p-2.5 text-center">
                <div className="text-lg font-semibold text-accent">{previewReport.unrecognizedCount}</div>
                <div className="text-[11px] text-text-muted">{t('templates.importStatUnrecognized')}</div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-text">
                {t('templates.importReportItemsTitle')} ({previewReport.items.length})
              </div>
              {previewReport.items.length === 0 ? (
                <p className="rounded-[var(--radius-md)] border border-border bg-surface-muted p-3 text-xs text-text-muted">
                  {t('templates.importNoWarnings')}
                </p>
              ) : (
                <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto rounded-[var(--radius-md)] border border-border bg-bg p-2">
                  {previewReport.items.map((item, idx) => (
                    <li
                      key={`${item.code}-${idx}`}
                      className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-border/60 bg-surface px-2.5 py-2 text-xs"
                    >
                      {item.severity === 'warning' ? (
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                      ) : (
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={item.severity === 'warning' ? 'warning' : 'outline'}>{item.code}</Badge>
                          <span className="font-mono text-[11px] text-text-muted">{item.source}</span>
                        </div>
                        <p className="mt-0.5 text-text">{item.message}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error ? (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStep('input')}>
                {t('templates.importBackBtn')}
              </Button>
              <Button
                type="button"
                data-testid="import-confirm-save-btn"
                disabled={readOnly || saving}
                onClick={handleConfirmSave}
              >
                {saving ? t('common.loading') : t('templates.importConfirmSaveBtn')}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
