import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, Upload } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { useI18n } from '../../i18n';
import { api, ApiClientError, formatApiError, readApiJson } from '../../lib/api';
import { invalidateRulesets, invalidateSettings, rulesetsListQueryOptions } from '../../lib/query';
import { useToast } from '../../lib/toast';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';

type BackupValidationSummary = {
  valid: true;
  version: 1 | 2;
  categories: number;
  rules: number;
  sources: number;
  cards?: number;
  templates?: number;
  publications?: number;
  preservesExistingTemplatesAndCards: boolean;
};

export function BackupTab() {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const summaryQuery = useQuery(rulesetsListQueryOptions());
  const currentCategories = summaryQuery.data?.data.categories ?? [];
  const currentRulesCount = currentCategories.reduce((sum, item) => sum + (item.manualRuleCount ?? 0), 0);
  const currentSourcesCount = currentCategories.reduce((sum, item) => sum + (item.sources?.length ?? 0), 0);

  const [rawJson, setRawJson] = useState('');
  const [parsedPayload, setParsedPayload] = useState<unknown>(null);
  const [validation, setValidation] = useState<BackupValidationSummary | null>(null);
  const [validationError, setValidationError] = useState<{ message: string; problems: string[] } | null>(null);
  const [validating, setValidating] = useState(false);

  const exportMutation = useMutation({
    mutationFn: async () => readApiJson<Record<string, unknown>>(await api.api.backup.$get()),
    onSuccess: (payload) => {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `private-rules-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      notify({ title: t('backup.exportedToast'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawJson(text);
    setValidation(null);
    setValidationError(null);
    setParsedPayload(null);
  };

  const handleValidate = async () => {
    setValidation(null);
    setValidationError(null);
    setParsedPayload(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      const msg = t('error.BACKUP_INVALID');
      setValidationError({ message: msg, problems: ['JSON syntax error'] });
      notify({ title: msg, variant: 'danger' });
      return;
    }

    setValidating(true);
    try {
      const response = await fetch('/api/backup/validate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const summary = await readApiJson<BackupValidationSummary>(response);
      setParsedPayload(parsed);
      setValidation(summary);
    } catch (error) {
      const message = formatApiError(error, locale);
      const problems =
        error instanceof ApiClientError &&
        error.details &&
        typeof error.details === 'object' &&
        Array.isArray((error.details as { problems?: unknown }).problems)
          ? (error.details as { problems: string[] }).problems
          : [];
      setValidationError({ message, problems });
      notify({ title: message, variant: 'danger' });
    } finally {
      setValidating(false);
    }
  };

  const restoreMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/backup', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsedPayload),
      });
      return readApiJson(response);
    },
    onSuccess: async () => {
      setValidation(null);
      setParsedPayload(null);
      setRawJson('');
      await Promise.all([invalidateRulesets(queryClient), invalidateSettings(queryClient)]);
      notify({ title: t('backup.restoredToast'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  return (
    <div className="flex flex-col gap-4" data-testid="settings-backup-tab">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{t('backup.exportTitle')}</CardTitle>
            <CardDescription>{t('backup.exportDesc')}</CardDescription>
          </div>
          <Button
            size="sm"
            data-testid="backup-export-btn"
            disabled={exportMutation.isPending}
            onClick={() => exportMutation.mutate()}
          >
            <Download className="h-4 w-4" />
            <span>{exportMutation.isPending ? t('common.loading') : t('backup.exportBtn')}</span>
          </Button>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" />
            <span>{t('backup.importTitle')}</span>
          </CardTitle>
          <CardDescription>{t('backup.importDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="backup-file-input" className="text-xs font-medium">
              {t('backup.uploadFile')}
            </label>
            <input
              id="backup-file-input"
              type="file"
              accept="application/json,.json"
              data-testid="backup-file-input"
              onChange={(event) => void handleFileUpload(event)}
              className="block w-full text-xs text-text-muted file:mr-3 file:cursor-pointer file:rounded-[var(--radius-sm)] file:border file:border-border file:bg-surface-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-text"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="backup-json-textarea" className="text-xs font-medium">
              {t('backup.pasteLabel')}
            </label>
            <textarea
              id="backup-json-textarea"
              rows={7}
              data-testid="backup-json-textarea"
              value={rawJson}
              onChange={(event) => {
                setRawJson(event.target.value);
                setValidation(null);
                setValidationError(null);
              }}
              placeholder='{"version": 2, "settings": {}, "categories": []}'
              className="w-full rounded-[var(--radius-sm)] border border-border bg-surface p-3 font-mono text-xs text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-primary"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              data-testid="backup-validate-btn"
              disabled={!rawJson.trim() || validating}
              onClick={() => void handleValidate()}
            >
              {validating ? t('common.loading') : t('backup.validateBtn')}
            </Button>
          </div>

          {validationError ? (
            <div
              role="alert"
              data-testid="backup-validation-error"
              className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-danger bg-surface-muted p-3.5 text-xs"
            >
              <div className="flex items-center gap-2 font-semibold text-danger">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{t('backup.invalidTitle')}</span>
              </div>
              <p className="text-text-muted">{validationError.message}</p>
              {validationError.problems.length > 0 ? (
                <ul className="list-disc pl-5 font-mono text-[11px] text-danger">
                  {validationError.problems.slice(0, 8).map((item, idx) => (
                    <li key={`${item}-${idx}`}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {validation ? (
            <div
              data-testid="backup-validation-preview"
              className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-success bg-surface-muted p-4 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-success">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{t('backup.validTitle')}</span>
                </div>
                <Badge variant="primary">
                  {t('backup.formatVersion')}: v{validation.version}
                </Badge>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded bg-surface p-2.5">
                  <div className="text-[11px] text-text-muted">{t('dashboard.statRulesets')}</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold">
                    {t('backup.currentLabel')} {currentCategories.length} → {t('backup.incomingLabel')}{' '}
                    {validation.categories}
                  </div>
                </div>
                <div className="rounded bg-surface p-2.5">
                  <div className="text-[11px] text-text-muted">{t('rulesets.filterManual')}</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold">
                    {t('backup.currentLabel')} {currentRulesCount} → {t('backup.incomingLabel')} {validation.rules}
                  </div>
                </div>
                <div className="rounded bg-surface p-2.5">
                  <div className="text-[11px] text-text-muted">{t('dashboard.statSources')}</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold">
                    {t('backup.currentLabel')} {currentSourcesCount} → {t('backup.incomingLabel')} {validation.sources}
                  </div>
                </div>
              </div>

              {validation.preservesExistingTemplatesAndCards ? (
                <p className="rounded bg-surface px-3 py-2 text-text-muted">{t('backup.preservesNotice')}</p>
              ) : (
                <div className="flex flex-wrap gap-2 text-text-muted">
                  {validation.cards !== undefined ? <Badge variant="outline">Cards: {validation.cards}</Badge> : null}
                  {validation.templates !== undefined ? (
                    <Badge variant="outline">Templates: {validation.templates}</Badge>
                  ) : null}
                  {validation.publications !== undefined ? (
                    <Badge variant="outline">Publications: {validation.publications}</Badge>
                  ) : null}
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="danger"
                  data-testid="backup-confirm-import-btn"
                  disabled={restoreMutation.isPending}
                  onClick={() => restoreMutation.mutate()}
                >
                  {restoreMutation.isPending ? t('common.loading') : t('backup.confirmImportBtn')}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
