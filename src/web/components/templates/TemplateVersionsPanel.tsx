import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, GitCompare, History, RefreshCw, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { TemplateVersionSummary } from '../../../data/repositories';
import type { ConflictResolution, ImportSourceFormat, OverlayConflict, RebaseDiff } from '../../../domain/templates';
import type { TemplateBody, TemplateRecord } from '../../../shared/schemas/template';
import { useI18n } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { templateVersionDetailQueryOptions } from '../../lib/query';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { buildRetargetResolution, diffTemplateBodies, formatOverlayOpSummary } from './template-editor-helpers';

type RebasePreviewResult = {
  applied: false;
  resolvedBody: TemplateBody;
  diff: RebaseDiff;
  conflicts: OverlayConflict[];
  hasConflicts: boolean;
};

type RebaseAppliedResult = {
  applied: true;
  template: TemplateRecord;
  resolvedBody: TemplateBody;
  version: number;
  diff: RebaseDiff;
  conflicts: OverlayConflict[];
};

type TemplateVersionsPanelProps = {
  template: TemplateRecord;
  versions: readonly TemplateVersionSummary[];
  readOnly?: boolean;
  onRestored: (payload: { template: TemplateRecord; resolvedBody: TemplateBody; version: number }) => Promise<void>;
  onRebased: (payload: { template: TemplateRecord; resolvedBody: TemplateBody; version: number }) => Promise<void>;
};

type ConflictDraftChoice = {
  action: 'keep' | 'drop' | 'retarget';
  targetId: string;
};

export function TemplateVersionsPanel({
  template,
  versions,
  readOnly = false,
  onRestored,
  onRebased,
}: TemplateVersionsPanelProps) {
  const { t, locale } = useI18n();
  const [section, setSection] = useState<'history' | 'rebase'>('history');

  // Version compare state
  const [compareFrom, setCompareFrom] = useState<number | null>(null);
  const [compareTo, setCompareTo] = useState<number | null>(null);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const [versionError, setVersionError] = useState('');

  // Rebase state
  const [rebaseFormat, setRebaseFormat] = useState<ImportSourceFormat>(
    template.baseKind === 'mihomo-yaml' ? 'mihomo-yaml' : 'acl4ssr-ini',
  );
  const [rebaseUrl, setRebaseUrl] = useState(template.baseSourceUrl ?? '');
  const [rebaseContent, setRebaseContent] = useState('');
  const [rebaseLoading, setRebaseLoading] = useState(false);
  const [rebaseApplying, setRebaseApplying] = useState(false);
  const [rebaseError, setRebaseError] = useState('');
  const [rebasePreview, setRebasePreview] = useState<RebasePreviewResult | null>(null);
  const [conflictChoices, setConflictChoices] = useState<Record<number, ConflictDraftChoice>>({});

  useEffect(() => {
    if (versions.length >= 2) {
      setCompareTo((prev) => prev ?? versions[0].version);
      setCompareFrom((prev) => prev ?? versions[1].version);
    } else if (versions.length === 1) {
      setCompareTo(versions[0].version);
      setCompareFrom(null);
    }
  }, [versions]);

  const fromVersionQuery = useQuery({
    ...templateVersionDetailQueryOptions(template.id, compareFrom ?? 1),
    enabled: Boolean(compareFrom && compareTo && compareFrom !== compareTo),
  });
  const toVersionQuery = useQuery({
    ...templateVersionDetailQueryOptions(template.id, compareTo ?? 1),
    enabled: Boolean(compareFrom && compareTo && compareFrom !== compareTo),
  });

  const versionDiff = useMemo(() => {
    if (!fromVersionQuery.data || !toVersionQuery.data) return null;
    return diffTemplateBodies(fromVersionQuery.data.version.resolvedBody, toVersionQuery.data.version.resolvedBody);
  }, [fromVersionQuery.data, toVersionQuery.data]);

  const handleRestore = async (version: number) => {
    if (readOnly || restoringVersion !== null) return;
    setRestoringVersion(version);
    setVersionError('');
    try {
      const res = await api.api.templates[':id'].versions[':v'].restore.$post({
        param: { id: template.id, v: String(version) },
        json: {},
      });
      const data = await readApiJson<{ template: TemplateRecord; resolvedBody: TemplateBody; version: number }>(res);
      await onRestored(data);
    } catch (err) {
      setVersionError(formatApiError(err, locale));
    } finally {
      setRestoringVersion(null);
    }
  };

  const handlePreviewRebase = async () => {
    if (readOnly || rebaseLoading) return;
    if (!rebaseContent.trim() && !rebaseUrl.trim()) {
      setRebaseError(t('templates.rebaseInputRequired'));
      return;
    }
    setRebaseLoading(true);
    setRebaseError('');
    try {
      const res = await api.api.templates[':id'].rebase.$post({
        param: { id: template.id },
        json: {
          format: rebaseFormat,
          ...(rebaseContent.trim() ? { content: rebaseContent } : {}),
          ...(rebaseUrl.trim() ? { sourceUrl: rebaseUrl.trim() } : {}),
          apply: false,
        },
      });
      const data = await readApiJson<RebasePreviewResult>(res);
      setRebasePreview(data);

      // Initialize default conflict choices
      const defaults: Record<number, ConflictDraftChoice> = {};
      const fallbackCardId = data.resolvedBody.cards[0]?.cardId ?? '';
      for (const conflict of data.conflicts) {
        const defaultAction = conflict.suggestedActions[0] ?? 'drop';
        defaults[conflict.opIndex] = {
          action: defaultAction,
          targetId: fallbackCardId,
        };
      }
      setConflictChoices(defaults);
    } catch (err) {
      setRebaseError(formatApiError(err, locale));
    } finally {
      setRebaseLoading(false);
    }
  };

  const handleApplyRebase = async () => {
    if (readOnly || !rebasePreview || rebaseApplying) return;
    setRebaseApplying(true);
    setRebaseError('');
    try {
      const resolutions: ConflictResolution[] = rebasePreview.conflicts.map((conflict) => {
        const choice = conflictChoices[conflict.opIndex] ?? { action: 'drop', targetId: '' };
        if (choice.action === 'retarget' && choice.targetId) {
          return buildRetargetResolution(conflict, choice.targetId);
        }
        return { opIndex: conflict.opIndex, action: choice.action === 'retarget' ? 'drop' : choice.action };
      });

      const res = await api.api.templates[':id'].rebase.$post({
        param: { id: template.id },
        json: {
          format: rebaseFormat,
          ...(rebaseContent.trim() ? { content: rebaseContent } : {}),
          ...(rebaseUrl.trim() ? { sourceUrl: rebaseUrl.trim() } : {}),
          resolutions,
          apply: true,
        },
      });
      const data = await readApiJson<RebaseAppliedResult>(res);
      if (data.applied) {
        setRebasePreview(null);
        setRebaseContent('');
        await onRebased({ template: data.template, resolvedBody: data.resolvedBody, version: data.version });
      }
    } catch (err) {
      setRebaseError(formatApiError(err, locale));
    } finally {
      setRebaseApplying(false);
    }
  };

  const retargetTargetOptions = useMemo(() => {
    if (!rebasePreview) return [];
    return rebasePreview.resolvedBody.cards.map((c) => c.cardId);
  }, [rebasePreview]);

  return (
    <div data-testid="editor-versions-panel" className="flex flex-col gap-3">
      <div className="flex gap-1.5">
        <Button
          size="sm"
          data-testid="versions-subtab-history"
          variant={section === 'history' ? 'primary' : 'outline'}
          onClick={() => setSection('history')}
          className="h-7 flex-1 text-xs"
        >
          <History className="h-3.5 w-3.5" />
          <span>{t('templates.versionsTabHistory')}</span>
        </Button>
        <Button
          size="sm"
          data-testid="versions-subtab-rebase"
          variant={section === 'rebase' ? 'primary' : 'outline'}
          onClick={() => setSection('rebase')}
          className="h-7 flex-1 text-xs"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>{t('templates.versionsTabRebase')}</span>
        </Button>
      </div>

      {section === 'history' ? (
        <div className="flex flex-col gap-3">
          {versionError ? (
            <p role="alert" className="text-xs text-danger">
              {versionError}
            </p>
          ) : null}

          <div data-testid="versions-list" className="flex max-h-52 flex-col gap-1.5 overflow-y-auto pr-0.5">
            {versions.map((ver) => {
              const isCurrent = ver.version === template.currentVersion;
              return (
                <div
                  key={ver.version}
                  data-testid={`version-item-v${ver.version}`}
                  className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-bg px-2.5 py-2 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Badge variant={isCurrent ? 'primary' : 'outline'}>v{ver.version}</Badge>
                      {isCurrent ? (
                        <span className="text-[10px] font-medium text-primary">{t('templates.versionCurrent')}</span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate text-text">{ver.note || t('templates.versionNoNote')}</div>
                    <div className="text-[10px] text-text-muted">{new Date(ver.createdAt).toLocaleString()}</div>
                  </div>
                  {!isCurrent && !readOnly ? (
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`version-restore-v${ver.version}`}
                      disabled={restoringVersion !== null}
                      onClick={() => void handleRestore(ver.version)}
                      className="h-7 shrink-0 px-2 text-xs"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>{t('templates.versionRestoreBtn')}</span>
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>

          {versions.length >= 2 ? (
            <div
              data-testid="version-compare-section"
              className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-bg p-2.5 text-xs"
            >
              <div className="flex items-center gap-1.5 font-semibold text-text">
                <GitCompare className="h-3.5 w-3.5 text-primary" />
                <span>{t('templates.versionCompareTitle')}</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <select
                  data-testid="version-compare-from"
                  value={compareFrom ?? ''}
                  onChange={(e) => setCompareFrom(Number(e.target.value))}
                  className="h-7 rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-xs text-text"
                >
                  {versions.map((ver) => (
                    <option key={ver.version} value={ver.version}>
                      v{ver.version}
                    </option>
                  ))}
                </select>
                <select
                  data-testid="version-compare-to"
                  value={compareTo ?? ''}
                  onChange={(e) => setCompareTo(Number(e.target.value))}
                  className="h-7 rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-xs text-text"
                >
                  {versions.map((ver) => (
                    <option key={ver.version} value={ver.version}>
                      v{ver.version}
                    </option>
                  ))}
                </select>
              </div>

              {versionDiff ? (
                <div data-testid="version-diff-output" className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap gap-1">
                    {versionDiff.addedCards.length > 0 ? (
                      <Badge variant="success">+{versionDiff.addedCards.length} cards</Badge>
                    ) : null}
                    {versionDiff.removedCards.length > 0 ? (
                      <Badge variant="danger">-{versionDiff.removedCards.length} cards</Badge>
                    ) : null}
                    {versionDiff.reorderedCards ? (
                      <Badge variant="warning">{t('templates.versionDiffReordered')}</Badge>
                    ) : null}
                    {versionDiff.groupModeChanged ? <Badge variant="outline">groupMode</Badge> : null}
                    {versionDiff.outputChanged ? <Badge variant="outline">output</Badge> : null}
                    {versionDiff.modulesChanged ? <Badge variant="outline">modules</Badge> : null}
                  </div>

                  <div className="max-h-44 overflow-y-auto rounded-[var(--radius-sm)] border border-border bg-surface p-2 font-mono text-[11px]">
                    {versionDiff.lines
                      .filter((line) => line.kind !== 'same')
                      .map((line, idx) => (
                        <div
                          key={idx}
                          className={
                            line.kind === 'added'
                              ? 'text-success'
                              : line.kind === 'removed'
                                ? 'text-danger'
                                : 'text-text-muted'
                          }
                        >
                          {line.kind === 'added' ? '+ ' : '- '}
                          {line.text}
                        </div>
                      ))}
                    {versionDiff.lines.every((l) => l.kind === 'same') ? (
                      <span className="text-text-muted">{t('templates.versionDiffIdentical')}</span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div data-testid="editor-rebase-section" className="flex flex-col gap-2.5 text-xs">
          <p className="text-text-muted">{t('templates.rebaseDesc')}</p>

          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant={rebaseFormat === 'acl4ssr-ini' ? 'primary' : 'outline'}
              onClick={() => setRebaseFormat('acl4ssr-ini')}
              className="h-7 flex-1 text-xs"
            >
              subconverter (.ini)
            </Button>
            <Button
              size="sm"
              variant={rebaseFormat === 'mihomo-yaml' ? 'primary' : 'outline'}
              onClick={() => setRebaseFormat('mihomo-yaml')}
              className="h-7 flex-1 text-xs"
            >
              mihomo YAML
            </Button>
          </div>

          <Input
            data-testid="rebase-url-input"
            value={rebaseUrl}
            onChange={(e) => setRebaseUrl(e.target.value)}
            placeholder={t('templates.rebaseUrlPlaceholder')}
            disabled={readOnly}
            className="h-8 text-xs"
          />

          <textarea
            data-testid="rebase-content-textarea"
            value={rebaseContent}
            onChange={(e) => setRebaseContent(e.target.value)}
            rows={5}
            disabled={readOnly}
            placeholder={t('templates.rebaseContentPlaceholder')}
            className="w-full rounded-[var(--radius-md)] border border-border bg-bg p-2 font-mono text-[11px] text-text placeholder:text-text-muted"
          />

          {rebaseError ? (
            <p role="alert" className="text-danger">
              {rebaseError}
            </p>
          ) : null}

          <Button
            size="sm"
            variant="outline"
            data-testid="rebase-preview-btn"
            disabled={readOnly || rebaseLoading}
            onClick={() => void handlePreviewRebase()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${rebaseLoading ? 'animate-spin' : ''}`} />
            <span>{t('templates.rebaseCheckBtn')}</span>
          </Button>

          {rebasePreview ? (
            <div
              data-testid="rebase-preview-result"
              className="flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-border bg-bg p-2.5"
            >
              <div className="flex flex-wrap gap-1">
                <Badge variant="success">+{rebasePreview.diff.addedCards.length} cards</Badge>
                <Badge variant="danger">-{rebasePreview.diff.removedCards.length} cards</Badge>
                <Badge variant={rebasePreview.conflicts.length > 0 ? 'warning' : 'success'}>
                  {t('templates.rebaseConflictsCount')}: {rebasePreview.conflicts.length}
                </Badge>
              </div>

              {rebasePreview.conflicts.length > 0 ? (
                <div data-testid="rebase-conflicts-list" className="flex flex-col gap-2">
                  {rebasePreview.conflicts.map((conflict) => {
                    const choice = conflictChoices[conflict.opIndex] ?? { action: 'drop', targetId: '' };
                    return (
                      <div
                        key={conflict.opIndex}
                        data-testid={`rebase-conflict-${conflict.opIndex}`}
                        className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-warning/60 bg-warning/5 p-2"
                      >
                        <div className="flex items-start gap-1.5">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-[10px] text-text-muted">
                              #{conflict.opIndex} {formatOverlayOpSummary(conflict.op)}
                            </div>
                            <div className="text-text">{conflict.message}</div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1">
                          {(['keep', 'drop', 'retarget'] as const).map((action) => (
                            <button
                              key={action}
                              type="button"
                              data-testid={`rebase-conflict-${conflict.opIndex}-${action}`}
                              onClick={() =>
                                setConflictChoices((prev) => ({
                                  ...prev,
                                  [conflict.opIndex]: { ...choice, action },
                                }))
                              }
                              className={`cursor-pointer rounded-[var(--radius-sm)] border px-2 py-0.5 text-[11px] font-medium ${
                                choice.action === action
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-border bg-surface text-text-muted hover:text-text'
                              }`}
                            >
                              {action === 'keep'
                                ? t('templates.rebaseActionKeep')
                                : action === 'drop'
                                  ? t('templates.rebaseActionDrop')
                                  : t('templates.rebaseActionRetarget')}
                            </button>
                          ))}
                        </div>

                        {choice.action === 'retarget' && retargetTargetOptions.length > 0 ? (
                          <select
                            data-testid={`rebase-conflict-${conflict.opIndex}-target`}
                            value={choice.targetId}
                            onChange={(e) =>
                              setConflictChoices((prev) => ({
                                ...prev,
                                [conflict.opIndex]: { ...choice, targetId: e.target.value },
                              }))
                            }
                            className="h-7 rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-[11px] text-text"
                          >
                            {retargetTargetOptions.map((cid) => (
                              <option key={cid} value={cid}>
                                {cid}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <Button
                size="sm"
                data-testid="rebase-apply-btn"
                disabled={readOnly || rebaseApplying}
                onClick={() => void handleApplyRebase()}
              >
                {rebaseApplying ? t('common.loading') : t('templates.rebaseApplyBtn')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
