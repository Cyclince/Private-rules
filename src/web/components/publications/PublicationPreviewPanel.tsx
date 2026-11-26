import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCircle2, Code2, Copy, Info, RefreshCw, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CompiledConfigResult, CompatibilitySeverity } from '../../../domain/templates/compilers';
import type { PublicationWithLinks } from '../../../server/routes/publications';
import {
  isTemplateClientSupported,
  OUTPUT_PROFILES,
  TEMPLATE_CLIENT_IDS,
  TEMPLATE_CLIENTS,
  type OutputProfile,
  type TemplateClientId,
} from '../../../shared/clients';
import { useI18n, type MessageKey } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

type PublicationPreviewPanelProps = {
  publication: PublicationWithLinks;
};

function severityBadgeVariant(severity: CompatibilitySeverity): 'danger' | 'warning' | 'outline' {
  if (severity === 'error') return 'danger';
  if (severity === 'warning') return 'warning';
  return 'outline';
}

export function PublicationPreviewPanel({ publication }: PublicationPreviewPanelProps) {
  const { t, locale } = useI18n();
  const { notify } = useToast();

  const defaultClient = publication.clients.find((c) => isTemplateClientSupported(c)) ?? 'mihomo';
  const [client, setClient] = useState<TemplateClientId>(defaultClient);
  const [output, setOutput] = useState<OutputProfile>(publication.effectiveOutput);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOutput(publication.effectiveOutput);
  }, [publication.id, publication.effectiveOutput]);

  const supported = isTemplateClientSupported(client);
  const isSafeDefaultClient = client === 'loon' || client === 'quantumult-x';
  const experimentalFullConfig = Boolean(publication.experimentalFullConfig);

  const previewQuery = useQuery({
    queryKey: ['template-preview', publication.templateId, client, output, experimentalFullConfig] as const,
    enabled: supported && Boolean(publication.templateId),
    queryFn: async () =>
      readApiJson<{ preview: CompiledConfigResult }>(
        await api.api.templates[':id'].preview.$post({
          param: { id: publication.templateId },
          query: { client },
          json: { output, experimentalFullConfig },
        }),
      ),
  });

  const preview = previewQuery.data?.preview;

  const handleCopy = async () => {
    if (!preview?.content) return;
    try {
      await navigator.clipboard.writeText(preview.content);
      setCopied(true);
      notify({ title: t('publications.previewCopiedToast'), variant: 'success' });
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      notify({ title: t('links.copyFailed'), variant: 'danger' });
    }
  };

  const reportItems = preview?.report.items ?? [];
  const errorCount = reportItems.filter((item) => item.severity === 'error').length;
  const warningCount = reportItems.filter((item) => item.severity === 'warning').length;
  const infoCount = reportItems.filter((item) => item.severity === 'info').length;

  return (
    <div data-testid="publication-preview-panel" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
            <Code2 className="h-4 w-4 text-primary" />
            <span>{t('publications.previewTitle')}</span>
          </h3>
          <p className="text-xs text-text-muted">{t('publications.previewDesc')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {OUTPUT_PROFILES.map((profile) => (
            <Button
              key={profile}
              size="sm"
              variant={output === profile ? 'primary' : 'outline'}
              data-testid={`preview-output-${profile}`}
              onClick={() => setOutput(profile)}
            >
              {t(`publications.output.${profile}` as MessageKey)}
            </Button>
          ))}
          {supported ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={previewQuery.isFetching}
                data-testid="preview-refresh-btn"
                onClick={() => void previewQuery.refetch()}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${previewQuery.isFetching ? 'animate-spin' : ''}`} />
                <span>{t('common.refresh')}</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!preview?.content}
                data-testid="preview-copy-btn"
                onClick={() => void handleCopy()}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? t('common.copied') : t('publications.previewCopyCode')}</span>
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {TEMPLATE_CLIENT_IDS.map((clientId) => {
          const meta = TEMPLATE_CLIENTS[clientId];
          const isClientSupported = isTemplateClientSupported(clientId);
          return (
            <Button
              key={clientId}
              size="sm"
              variant={client === clientId ? 'primary' : 'outline'}
              data-testid={`preview-client-${clientId}`}
              onClick={() => setClient(clientId)}
            >
              <span>{meta.label}</span>
              {!isClientSupported ? (
                <Badge
                  variant="outline"
                  data-testid={`preview-client-coming-soon-${clientId}`}
                  className="ml-1 px-1.5 py-0 text-[10px]"
                >
                  {t('taxonomy.clientComingSoon')}
                </Badge>
              ) : null}
            </Button>
          );
        })}
      </div>

      {isSafeDefaultClient ? (
        <div
          data-testid="publication-preview-mode-banner"
          className={`flex items-start gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-xs ${
            experimentalFullConfig
              ? 'border-warning bg-warning/10 text-text'
              : 'border-border bg-surface-muted/60 text-text-muted'
          }`}
        >
          {experimentalFullConfig ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          )}
          <span>
            {experimentalFullConfig
              ? t('publications.previewExperimentalBanner')
              : t('publications.previewSafeRulesOnlyBanner')}
          </span>
        </div>
      ) : null}

      {!supported ? (
        <div
          data-testid="preview-unsupported-notice"
          className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface-muted/60 p-4 text-xs text-text-muted"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>{t('publications.previewClientUnsupported')}</span>
        </div>
      ) : previewQuery.isLoading ? (
        <div className="h-64 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
      ) : previewQuery.isError ? (
        <div className="rounded-[var(--radius-md)] border border-danger/50 bg-danger/10 p-3.5 text-xs text-danger">
          {formatApiError(previewQuery.error, locale)}
        </div>
      ) : preview ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {isSafeDefaultClient ? (
              <Badge variant={experimentalFullConfig ? 'warning' : 'success'}>
                {experimentalFullConfig ? t('publications.experimentalBadge') : t('publications.safeRulesOnlyBadge')}
              </Badge>
            ) : null}
            <Badge variant="outline">
              {t('publications.previewStatsGroups')}: {preview.report.stats.proxyGroups}
            </Badge>
            <Badge variant="outline">
              {t('publications.previewStatsRuleProviders')}: {preview.report.stats.ruleProviders}
            </Badge>
            <Badge variant="outline">
              {t('publications.previewStatsRules')}: {preview.report.stats.rules}
            </Badge>
            {preview.report.stats.skippedRules > 0 ? (
              <Badge variant="warning">
                {t('publications.previewStatsSkipped')}: {preview.report.stats.skippedRules}
              </Badge>
            ) : null}
          </div>

          <pre
            data-testid="publication-preview-code"
            className="max-h-[420px] overflow-auto rounded-[var(--radius-md)] border border-border bg-bg p-3.5 font-mono text-xs leading-relaxed text-text"
          >
            <code>{preview.content}</code>
          </pre>

          <div
            data-testid="publication-preview-compat-report"
            className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-surface-muted/40 p-3 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-text">
                {t('publications.previewCompatReportTitle')} ({reportItems.length})
              </span>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {errorCount > 0 ? (
                  <Badge variant="danger">
                    {t('publications.previewCompatErrors')}: {errorCount}
                  </Badge>
                ) : null}
                {warningCount > 0 ? (
                  <Badge variant="warning">
                    {t('publications.previewCompatWarnings')}: {warningCount}
                  </Badge>
                ) : null}
                {infoCount > 0 ? (
                  <Badge variant="outline">
                    {t('publications.previewCompatInfos')}: {infoCount}
                  </Badge>
                ) : null}
                {reportItems.length === 0 ? (
                  <Badge variant="success">
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    {t('publications.previewCompatAllClear')}
                  </Badge>
                ) : null}
              </div>
            </div>

            {preview.report.stats.appliedModules.length > 0 || preview.report.stats.skippedModules.length > 0 ? (
              <div className="flex flex-wrap gap-3 text-[11px] text-text-muted">
                {preview.report.stats.appliedModules.length > 0 ? (
                  <span>
                    {t('publications.previewAppliedModules')}:{' '}
                    <code className="font-mono text-text">{preview.report.stats.appliedModules.join(', ')}</code>
                  </span>
                ) : null}
                {preview.report.stats.skippedModules.length > 0 ? (
                  <span>
                    {t('publications.previewSkippedModules')}:{' '}
                    <code className="font-mono text-text">{preview.report.stats.skippedModules.join(', ')}</code>
                  </span>
                ) : null}
              </div>
            ) : null}

            {reportItems.length > 0 ? (
              <ul className="flex max-h-44 flex-col gap-1.5 overflow-y-auto">
                {reportItems.map((item, idx) => (
                  <li
                    key={`${item.code}-${idx}`}
                    data-testid={`compat-report-item-${item.code}`}
                    className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-border/60 bg-surface px-2.5 py-1.5 text-[11px]"
                  >
                    <Badge variant={severityBadgeVariant(item.severity)} className="shrink-0 font-mono text-[10px]">
                      {item.code}
                    </Badge>
                    <span className="text-text-muted">{item.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
