import { AlertTriangle, Check, Copy, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { compileMihomo } from '../../../domain/templates/compilers/mihomo';
import type { CompiledConfigResult } from '../../../domain/templates/compilers/types';
import {
  isTemplateClientSupported,
  TEMPLATE_CLIENT_IDS,
  TEMPLATE_CLIENTS,
  type OutputProfile,
  type TemplateClientId,
} from '../../../shared/clients';
import type { AppCard, CatalogEntry } from '../../../shared/schemas/card';
import type { TemplateBody } from '../../../shared/schemas/template';
import { useI18n } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { CodeMirrorEditor } from './CodeMirrorEditor';

type TemplatePreviewPanelProps = {
  templateId: string;
  templateName: string;
  body: TemplateBody;
  cardMap: ReadonlyMap<string, AppCard>;
  catalogIndex: readonly CatalogEntry[];
};

export function TemplatePreviewPanel({
  templateId,
  templateName,
  body,
  cardMap,
  catalogIndex,
}: TemplatePreviewPanelProps) {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const [client, setClient] = useState<TemplateClientId>('mihomo');
  const [outputOverride, setOutputOverride] = useState<'inherit' | OutputProfile>('inherit');
  const [serverPreview, setServerPreview] = useState<CompiledConfigResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const supported = isTemplateClientSupported(client);

  // Instant local compilation for mihomo so the preview updates immediately without waiting for network
  const localPreview = useMemo<CompiledConfigResult | null>(() => {
    if (client !== 'mihomo') return null;
    try {
      return compileMihomo({
        body,
        cards: cardMap,
        templateName,
        output: outputOverride === 'inherit' ? body.output : outputOverride,
        catalogIndex,
      });
    } catch {
      return null;
    }
  }, [body, cardMap, catalogIndex, client, outputOverride, templateName]);

  const fetchServerPreview = async () => {
    if (!supported) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.api.templates[':id'].preview.$post({
        param: { id: templateId },
        query: {
          client,
          ...(outputOverride !== 'inherit' ? { output: outputOverride } : {}),
        },
        json: {
          body,
          ...(outputOverride !== 'inherit' ? { output: outputOverride } : {}),
        },
      });
      const data = await readApiJson<{ preview: CompiledConfigResult }>(res);
      setServerPreview(data.preview);
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setServerPreview(null);
    if (!supported) return;
    const timer = window.setTimeout(() => {
      void fetchServerPreview();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [templateId, client, outputOverride, body]);

  const activePreview = serverPreview ?? localPreview;

  const handleCopy = async () => {
    if (!activePreview) return;
    try {
      await navigator.clipboard.writeText(activePreview.content);
      setCopied(true);
      notify({ title: t('publications.previewCopiedToast'), variant: 'success' });
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures.
    }
  };

  return (
    <div data-testid="editor-preview-panel" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {TEMPLATE_CLIENT_IDS.map((clientId) => {
            const item = TEMPLATE_CLIENTS[clientId];
            return (
              <button
                key={clientId}
                type="button"
                data-testid={`preview-client-${clientId}`}
                onClick={() => setClient(clientId)}
                className={`cursor-pointer rounded-[var(--radius-sm)] border px-2 py-1 text-[11px] font-medium transition-colors ${
                  client === clientId
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-bg text-text-muted hover:text-text'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {(['inherit', 'full', 'minimal'] as const).map((out) => (
            <button
              key={out}
              type="button"
              data-testid={`preview-output-${out}`}
              onClick={() => setOutputOverride(out)}
              className={`cursor-pointer rounded-[var(--radius-sm)] border px-2 py-0.5 text-[11px] font-medium ${
                outputOverride === out
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-bg text-text-muted hover:text-text'
              }`}
            >
              {out === 'inherit' ? t('publications.output.inherit') : out}
            </button>
          ))}
        </div>

        {supported ? (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void fetchServerPreview()}
              disabled={loading}
              className="h-7 px-2 text-xs"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="preview-copy-btn"
              disabled={!activePreview}
              onClick={() => void handleCopy()}
              className="h-7 px-2 text-xs"
            >
              {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
              <span>{t('common.copy')}</span>
            </Button>
          </div>
        ) : null}
      </div>

      {!supported ? (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border bg-bg p-3 text-xs text-text-muted">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>{t('publications.previewClientUnsupported')}</span>
        </div>
      ) : (
        <>
          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}

          {activePreview ? (
            <>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <Badge variant="outline">
                  {t('publications.previewStatsGroups')}: {activePreview.report.stats.proxyGroups}
                </Badge>
                <Badge variant="outline">
                  {t('publications.previewStatsRuleProviders')}: {activePreview.report.stats.ruleProviders}
                </Badge>
                <Badge variant="outline">
                  {t('publications.previewStatsRules')}: {activePreview.report.stats.rules}
                </Badge>
                {activePreview.report.stats.skippedRules > 0 ? (
                  <Badge variant="warning">
                    {t('publications.previewStatsSkipped')}: {activePreview.report.stats.skippedRules}
                  </Badge>
                ) : null}
              </div>

              <CodeMirrorEditor
                testId="editor-preview-codemirror"
                ariaLabel={`${TEMPLATE_CLIENTS[client].label} preview`}
                value={activePreview.content}
                readOnly
                language={client === 'surge' ? 'text' : 'yaml'}
                minHeight="280px"
                maxHeight="460px"
              />

              {activePreview.report.items.length > 0 ? (
                <div className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-border bg-bg p-2.5 text-[11px]">
                  <div className="font-medium text-text">
                    {t('templates.previewCompatNotes')} ({activePreview.report.items.length})
                  </div>
                  <ul className="flex max-h-28 flex-col gap-1 overflow-y-auto text-text-muted">
                    {activePreview.report.items.map((item, idx) => (
                      <li key={`${item.code}-${idx}`}>
                        <span className="font-mono text-text">[{item.code}]</span> {item.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <div className="h-48 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
          )}
        </>
      )}
    </div>
  );
}
