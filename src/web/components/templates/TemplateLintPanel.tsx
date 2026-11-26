import { AlertTriangle, CheckCircle2, Info, RefreshCw, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import type { LintReport, LintSeverity } from '../../../domain/templates';
import type { TemplateBody } from '../../../shared/schemas/template';
import { useI18n } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

type TemplateLintPanelProps = {
  templateId: string;
  body: TemplateBody;
  previousBody: TemplateBody;
  localReport: LintReport;
};

export function TemplateLintPanel({ templateId, body, previousBody, localReport }: TemplateLintPanelProps) {
  const { t, locale } = useI18n();
  const [severityFilter, setSeverityFilter] = useState<'all' | LintSeverity>('all');
  const [serverReport, setServerReport] = useState<LintReport | null>(null);
  const [checkingServer, setCheckingServer] = useState(false);
  const [serverError, setServerError] = useState('');

  const report = serverReport ?? localReport;

  const filteredIssues =
    severityFilter === 'all' ? report.issues : report.issues.filter((item) => item.severity === severityFilter);

  const handleServerDeepLint = async () => {
    setCheckingServer(true);
    setServerError('');
    try {
      const res = await api.api.templates[':id'].lint.$post({
        param: { id: templateId },
        json: {
          body,
          previousBody,
        },
      });
      const data = await readApiJson<{ report: LintReport }>(res);
      setServerReport(data.report);
    } catch (err) {
      setServerError(formatApiError(err, locale));
    } finally {
      setCheckingServer(false);
    }
  };

  return (
    <div data-testid="editor-lint-panel" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={report.errorCount > 0 ? 'danger' : 'success'} data-testid="lint-error-count">
            {t('templates.lintErrors')}: {report.errorCount}
          </Badge>
          <Badge variant={report.warningCount > 0 ? 'warning' : 'outline'} data-testid="lint-warning-count">
            {t('templates.lintWarnings')}: {report.warningCount}
          </Badge>
          <Badge variant="outline" data-testid="lint-info-count">
            {t('templates.lintInfos')}: {report.infoCount}
          </Badge>
        </div>

        <Button
          size="sm"
          variant="outline"
          data-testid="lint-server-check-btn"
          disabled={checkingServer}
          onClick={handleServerDeepLint}
          className="h-7 px-2 text-xs"
        >
          <RefreshCw className={`h-3 w-3 ${checkingServer ? 'animate-spin' : ''}`} />
          <span>{t('templates.lintDeepCheckBtn')}</span>
        </Button>
      </div>

      {serverReport ? (
        <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-border bg-bg px-2.5 py-1.5 text-[11px] text-text-muted">
          <span>{t('templates.lintServerSnapshotNote')}</span>
          <button
            type="button"
            onClick={() => setServerReport(null)}
            className="cursor-pointer font-medium text-primary hover:underline"
          >
            {t('templates.lintBackToLive')}
          </button>
        </div>
      ) : null}

      {serverError ? (
        <p role="alert" className="text-xs text-danger">
          {serverError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1">
        {(['all', 'error', 'warning', 'info'] as const).map((sev) => (
          <button
            key={sev}
            type="button"
            data-testid={`lint-filter-${sev}`}
            onClick={() => setSeverityFilter(sev)}
            className={`cursor-pointer rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
              severityFilter === sev
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-bg text-text-muted hover:text-text'
            }`}
          >
            {sev === 'all'
              ? t('templates.tierAll')
              : sev === 'error'
                ? t('templates.lintErrors')
                : sev === 'warning'
                  ? t('templates.lintWarnings')
                  : t('templates.lintInfos')}
          </button>
        ))}
      </div>

      {filteredIssues.length === 0 ? (
        <div
          data-testid="lint-all-clear"
          className="flex items-center gap-2 rounded-[var(--radius-md)] border border-success/40 bg-success/10 px-3 py-3 text-xs text-text"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
          <span>{t('templates.lintAllClear')}</span>
        </div>
      ) : (
        <ul data-testid="lint-issues-list" className="flex max-h-[58vh] flex-col gap-2 overflow-y-auto pr-0.5">
          {filteredIssues.map((issue, idx) => (
            <li
              key={`${issue.code}-${issue.location.cardId ?? ''}-${idx}`}
              data-testid={`lint-issue-${issue.code}`}
              className={`rounded-[var(--radius-md)] border px-3 py-2 text-xs ${
                issue.severity === 'error'
                  ? 'border-danger/60 bg-danger/5'
                  : issue.severity === 'warning'
                    ? 'border-warning/60 bg-warning/5'
                    : 'border-border bg-bg'
              }`}
            >
              <div className="flex items-start gap-2">
                {issue.severity === 'error' ? (
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                ) : issue.severity === 'warning' ? (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                ) : (
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant={
                        issue.severity === 'error' ? 'danger' : issue.severity === 'warning' ? 'warning' : 'outline'
                      }
                      className="px-1.5 py-0 font-mono text-[10px]"
                    >
                      {issue.code}
                    </Badge>
                    {issue.location.cardId ? (
                      <span className="font-mono text-[10px] text-text-muted">{issue.location.cardId}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-text">{issue.message}</p>
                  {issue.suggestion ? <p className="mt-1 text-[11px] text-text-muted">{issue.suggestion}</p> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
