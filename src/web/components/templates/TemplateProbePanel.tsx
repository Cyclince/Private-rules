import { AlertTriangle, ArrowRight, Globe, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { probeTemplate, type ProbeResult } from '../../../domain/templates/probe';
import { getStageMetadata } from '../../../domain/templates/stages';
import type { AppCard, CatalogEntry } from '../../../shared/schemas/card';
import type { TemplateBody } from '../../../shared/schemas/template';
import { useI18n } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

type TemplateProbePanelProps = {
  templateId: string;
  body: TemplateBody;
  cardMap: ReadonlyMap<string, AppCard>;
  catalogIndex: readonly CatalogEntry[];
};

const QUICK_SAMPLES = ['api.openai.com', 'www.youtube.com', 'www.baidu.com', '192.168.1.1', '1.1.1.1'] as const;

export function TemplateProbePanel({ templateId, body, cardMap, catalogIndex }: TemplateProbePanelProps) {
  const { t, locale } = useI18n();
  const [target, setTarget] = useState('api.openai.com');
  const [dstPort, setDstPort] = useState('');
  const [resolvedIp, setResolvedIp] = useState('');
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [sourceMode, setSourceMode] = useState<'local' | 'server' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const runProbe = async (nextTarget: string) => {
    const trimmed = nextTarget.trim();
    if (!trimmed) return;
    setError('');
    const parsedPort = dstPort.trim() ? Number(dstPort.trim()) : undefined;
    const meta = {
      ...(parsedPort && Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535
        ? { dstPort: parsedPort }
        : {}),
      ...(resolvedIp.trim() ? { resolvedIp: resolvedIp.trim() } : {}),
    };

    // Instant local feedback first
    try {
      const localRes = probeTemplate({
        target: trimmed,
        body,
        cards: cardMap,
        meta,
        caches: { catalogIndex },
      });
      setResult(localRes);
      setSourceMode('local');
    } catch {
      // Fallback to server probe error below
    }

    // Refine with server probe (includes DB ruleset & catalog rule caches)
    setLoading(true);
    try {
      const res = await api.api.templates[':id'].probe.$post({
        param: { id: templateId },
        json: {
          target: trimmed,
          ...(Object.keys(meta).length > 0 ? { meta } : {}),
          body,
        },
      });
      const data = await readApiJson<{ result: ProbeResult }>(res);
      setResult(data.result);
      setSourceMode('server');
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void runProbe(target);
  };

  const stageMeta = result ? getStageMetadata(result.stage) : null;

  return (
    <div data-testid="editor-probe-panel" className="flex flex-col gap-3">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <div className="flex gap-1.5">
          <Input
            data-testid="probe-target-input"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={t('templates.probePlaceholder')}
            className="h-8 flex-1 font-mono text-xs"
          />
          <Button type="submit" size="sm" data-testid="probe-submit-btn" disabled={loading} className="h-8">
            <Search className="h-3.5 w-3.5" />
            <span>{t('templates.probeRunBtn')}</span>
          </Button>
        </div>

        <div className="flex flex-wrap gap-1">
          {QUICK_SAMPLES.map((sample) => (
            <button
              key={sample}
              type="button"
              data-testid={`probe-sample-${sample}`}
              onClick={() => {
                setTarget(sample);
                void runProbe(sample);
              }}
              className="cursor-pointer rounded-full border border-border bg-bg px-2 py-0.5 font-mono text-[10px] text-text-muted hover:border-primary hover:text-text"
            >
              {sample}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <Input
            value={dstPort}
            onChange={(e) => setDstPort(e.target.value)}
            placeholder={t('templates.probeDstPortPlaceholder')}
            className="h-7 font-mono text-[11px]"
          />
          <Input
            value={resolvedIp}
            onChange={(e) => setResolvedIp(e.target.value)}
            placeholder={t('templates.probeResolvedIpPlaceholder')}
            className="h-7 font-mono text-[11px]"
          />
        </div>
      </form>

      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}

      {result ? (
        <div
          data-testid="probe-result-card"
          className="flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-border bg-bg p-3 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-primary" />
              <span className="font-mono font-semibold text-text">{result.target.raw}</span>
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                {result.target.kind}
              </Badge>
            </div>
            {sourceMode ? (
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                {sourceMode === 'server' ? t('templates.probeSourceServer') : t('templates.probeSourceLocal')}
              </Badge>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-2 rounded-[var(--radius-sm)] border border-border/70 bg-surface p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-text-muted">{t('templates.probeMatchedRule')}</span>
              <span data-testid="probe-matched-rule" className="truncate font-mono font-medium text-text">
                {result.matchedRule.summary}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-text-muted">{t('templates.probeStageLayer')}</span>
              <Badge data-testid="probe-matched-stage" variant="primary">
                {stageMeta ? (locale === 'en' ? stageMeta.labelEn : stageMeta.labelZh) : result.stage}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-text-muted">{t('templates.probeMatchedCard')}</span>
              <span data-testid="probe-matched-card" className="font-medium text-text">
                {result.cardName ?? (result.matchedByFinal ? t('templates.probeMatchedByFinal') : '—')}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-text-muted">{t('templates.probePolicyChain')}</span>
            <div data-testid="probe-policy-chain" className="flex flex-wrap items-center gap-1">
              {result.policyChain.map((hop, idx) => (
                <span key={`${hop.label}-${idx}`} className="inline-flex items-center gap-1">
                  <Badge variant={idx === result.policyChain.length - 1 ? 'success' : 'outline'}>{hop.label}</Badge>
                  {idx < result.policyChain.length - 1 ? <ArrowRight className="h-3 w-3 text-text-muted" /> : null}
                </span>
              ))}
            </div>
          </div>

          {result.dnsResolutionPoints.length > 0 ? (
            <div
              data-testid="probe-dns-hints"
              className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-warning/60 bg-warning/10 p-2.5"
            >
              <div className="flex items-center gap-1.5 font-semibold text-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {t('templates.probeDnsHintsTitle')} ({result.dnsResolutionPoints.length})
                </span>
              </div>
              <ul className="flex flex-col gap-1 text-[11px] text-text">
                {result.dnsResolutionPoints.map((pt, idx) => (
                  <li key={`${pt.cardId}-${idx}`}>
                    <span className="font-mono text-text-muted">[{pt.cardName}]</span> {pt.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div data-testid="probe-dns-clean" className="text-[11px] text-text-muted">
              {t('templates.probeDnsNoEarlyLookup')}
            </div>
          )}

          {result.unresolvedSources.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-[var(--radius-sm)] border border-border bg-surface-muted/50 p-2 text-[11px] text-text-muted">
              <div className="font-medium text-text">
                {t('templates.probeUnresolvedTitle')} ({result.unresolvedSources.length})
              </div>
              {result.unresolvedSources.slice(0, 5).map((src, idx) => (
                <div key={`${src.cardId}-${idx}`} className="truncate">
                  {src.cardName}: {src.sourceLabel}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="rounded-[var(--radius-md)] border border-dashed border-border bg-bg p-4 text-center text-xs text-text-muted">
          {t('templates.probeEmptyHint')}
        </p>
      )}
    </div>
  );
}
