import { useMemo, useState } from 'react';
import { previewPoolMatch } from '../../../domain/nodes/pool-preview';
import type { GroupType } from '../../../shared/schemas/card';
import type { NodePool } from '../../../shared/schemas/template';
import { useI18n, type MessageKey } from '../../i18n';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { buildCustomPool, POOL_TYPE_OPTIONS } from './detail/pool-presets';

type NodeSlotOption = { id: string; name: string };

type TemplateNodePoolEditorProps = {
  /** `null` creates a new pool. */
  pool: NodePool | null;
  slots: readonly NodeSlotOption[];
  nodeNames: readonly string[];
  readOnly: boolean;
  onCancel: () => void;
  onSubmit: (pool: NodePool) => void;
};

/**
 * Professional-tier node pool editor (design §3.3, D17 = A).
 *
 * This is the only ordinary screen that exposes regular-expression vocabulary;
 * it lives in its own module so the plain-language copy scan can allow it.
 */
export function TemplateNodePoolEditor({
  pool,
  slots,
  nodeNames,
  readOnly,
  onCancel,
  onSubmit,
}: TemplateNodePoolEditorProps) {
  const { t } = useI18n();
  const isNew = pool === null;

  const [name, setName] = useState(pool?.name ?? '');
  const [sourceValue, setSourceValue] = useState(() => {
    if (pool?.sources === 'all' || pool?.sources === undefined) return 'all';
    return pool.sources[0] ?? 'all';
  });
  const [include, setInclude] = useState(pool?.include ?? '');
  const [exclude, setExclude] = useState(pool?.exclude ?? '');
  const [type, setType] = useState<GroupType>(pool?.type ?? 'url-test');
  const [visible, setVisible] = useState(pool ? !pool.hidden : false);
  const [regexProbe, setRegexProbe] = useState('');
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(
    () => previewPoolMatch(nodeNames, include, exclude, { limit: 40 }),
    [exclude, include, nodeNames],
  );

  const probe = useMemo(() => {
    const trimmed = regexProbe.trim();
    if (!trimmed) return null;
    return previewPoolMatch(nodeNames, trimmed, null, { limit: 20 });
  }, [nodeNames, regexProbe]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t('templateDetail.poolNameRequired'));
      return;
    }
    if (preview.invalid) {
      setError(t('templateDetail.poolRegexInvalid').replace('{message}', preview.error ?? ''));
      return;
    }
    const id = pool?.id ?? `pool-custom-${Date.now().toString(36)}`;
    onSubmit(
      buildCustomPool({
        id,
        name: trimmedName,
        include: include.trim() || undefined,
        exclude: exclude.trim() || undefined,
        sources: sourceValue === 'all' ? 'all' : [sourceValue],
        type,
        visible,
        test: pool?.test,
      }),
    );
  };

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="node-pool-editor"
      className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-primary/40 bg-bg p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-text">
          {isNew ? t('templateDetail.poolCreateTitle') : t('templateDetail.poolEditTitle')}
        </h4>
        <Badge variant="outline">{t('templateDetail.poolProBadge')}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-text">
            <span>{t('templateDetail.poolNameLabel')}</span>
            <Input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              placeholder={t('templateDetail.poolNamePlaceholder')}
              data-testid="node-pool-name-input"
              disabled={readOnly}
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-text">
              <span>{t('templateDetail.poolSourceLabel')}</span>
              <select
                value={sourceValue}
                onChange={(event) => setSourceValue(event.target.value)}
                data-testid="node-pool-source-select"
                disabled={readOnly}
                className="h-9 rounded-[var(--radius-sm)] border border-border bg-surface px-2.5 text-xs text-text focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
              >
                <option value="all">{t('templateDetail.poolSourceAll')}</option>
                {slots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slot.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-text">
              <span>{t('templateDetail.poolSelectionLabel')}</span>
              <select
                value={type}
                onChange={(event) => setType(event.target.value as GroupType)}
                data-testid="node-pool-type-select"
                disabled={readOnly}
                className="h-9 rounded-[var(--radius-sm)] border border-border bg-surface px-2.5 text-xs text-text focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
              >
                {POOL_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey as MessageKey)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium text-text">
            <span>{t('templateDetail.poolIncludeLabel')}</span>
            <Input
              value={include}
              onChange={(event) => {
                setInclude(event.target.value);
                setError(null);
              }}
              placeholder={t('templateDetail.poolIncludePlaceholder')}
              data-testid="node-pool-include-input"
              disabled={readOnly}
              aria-invalid={preview.invalid === 'include' || undefined}
              className="font-mono text-xs"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-text">
            <span>{t('templateDetail.poolExcludeLabel')}</span>
            <Input
              value={exclude}
              onChange={(event) => {
                setExclude(event.target.value);
                setError(null);
              }}
              placeholder={t('templateDetail.poolExcludePlaceholder')}
              data-testid="node-pool-exclude-input"
              disabled={readOnly}
              aria-invalid={preview.invalid === 'exclude' || undefined}
              className="font-mono text-xs"
            />
          </label>

          <p className="text-[11px] text-text-muted">{t('templateDetail.poolRegexHint')}</p>

          <label className="flex flex-col gap-1 text-xs font-medium text-text">
            <span>{t('templateDetail.poolRegexTestLabel')}</span>
            <Input
              value={regexProbe}
              onChange={(event) => setRegexProbe(event.target.value)}
              placeholder={t('templateDetail.poolRegexTestPlaceholder')}
              data-testid="node-pool-regex-test-input"
              disabled={readOnly}
              className="font-mono text-xs"
            />
          </label>
          {probe?.invalid ? (
            <p className="text-[11px] text-danger" data-testid="node-pool-regex-test-error">
              {t('templateDetail.poolRegexInvalid').replace('{message}', probe.error ?? '')}
            </p>
          ) : probe ? (
            <p className="text-[11px] text-text-muted" data-testid="node-pool-regex-test-result">
              {t('templateDetail.poolPreviewMatched')
                .replace('{count}', String(probe.matched.length))
                .replace('{total}', String(probe.total))}
            </p>
          ) : null}

          <label className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-xs font-medium text-text">
            <span>{t('templateDetail.poolVisibilityLabel')}</span>
            <Switch
              checked={visible}
              disabled={readOnly}
              data-testid="node-pool-visibility-switch"
              aria-label={t('templateDetail.poolVisibilityLabel')}
              onCheckedChange={setVisible}
            />
          </label>
        </div>

        <div
          className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3"
          data-testid="node-pool-preview"
        >
          <h5 className="text-xs font-semibold text-text">{t('templateDetail.poolPreviewTitle')}</h5>
          {preview.invalid ? (
            <p className="text-[11px] text-danger">
              {t('templateDetail.poolRegexInvalid').replace('{message}', preview.error ?? '')}
            </p>
          ) : nodeNames.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-text-muted">{t('templateDetail.poolPreviewNoSnapshot')}</p>
          ) : preview.matched.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-warning" data-testid="node-pool-preview-empty">
              {t('templateDetail.poolPreviewEmpty')}
            </p>
          ) : (
            <>
              <p className="text-[11px] text-text-muted" data-testid="node-pool-preview-count">
                {t('templateDetail.poolPreviewMatched')
                  .replace('{count}', String(preview.matched.length))
                  .replace('{total}', String(preview.total))}
              </p>
              <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto text-[11px] text-text">
                {preview.matched.map((nodeName) => (
                  <li key={nodeName} className="truncate rounded-[var(--radius-sm)] bg-surface-muted/60 px-2 py-1">
                    {nodeName}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {error ? (
        <p className="text-xs text-danger" data-testid="node-pool-error">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="node-pool-cancel-btn"
          onClick={onCancel}
          disabled={readOnly}
        >
          {t('common.cancel')}
        </Button>
        <Button type="submit" size="sm" data-testid="node-pool-save-btn" disabled={readOnly}>
          {isNew ? t('templateDetail.poolCreateBtn') : t('common.save')}
        </Button>
      </div>
    </form>
  );
}
