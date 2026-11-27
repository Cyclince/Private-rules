import { useRef, useState } from 'react';
import { buildSubscriptionExample } from '../../../shared/subscription-example';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Button } from '../ui/button';
import { preferHttpsLink, type FormatLinkGroup } from './subscription-helpers';

export function SubscriptionExample({
  group,
  name,
  policyName,
}: {
  group: FormatLinkGroup;
  name: string;
  policyName?: string;
}) {
  const { t } = useI18n();
  const { notify } = useToast();
  const [selectedId, setSelectedId] = useState('');
  const codeRef = useRef<HTMLElement | null>(null);
  const policyHint = t('subscriptions.examplePolicyHint').replace('{policy}', policyName?.trim() || 'PROXY');
  const candidates = group.formats.flatMap((format) => {
    const example = buildSubscriptionExample({
      client: format.link.id,
      url: preferHttpsLink(format.link.recommendedUrl),
      name,
      policyName,
      policyHint,
    });
    return example ? [{ format, example }] : [];
  });
  const selected = candidates.find(({ format }) => format.id === selectedId) ?? candidates[0];
  if (!selected || group.id === 'txt') return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selected.example.code);
      notify({ title: t('subscriptions.exampleCopied'), variant: 'success' });
    } catch {
      if (codeRef.current) {
        const range = document.createRange();
        range.selectNodeContents(codeRef.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      notify({ title: t('subscriptions.copyFailed'), variant: 'danger' });
    }
  };

  return (
    <details
      className="mt-4 rounded-[var(--radius-md)] border border-border bg-surface"
      data-testid={`subscription-example-${group.id}`}
    >
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-text">
        {t('subscriptions.exampleTitle')}
      </summary>
      <div className="flex min-w-0 flex-col gap-3 border-t border-border p-4">
        <p className="text-xs text-text-muted">{t('subscriptions.exampleHint')}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <select
            aria-label={t('subscriptions.exampleClient')}
            value={selected.format.id}
            onChange={(event) => setSelectedId(event.target.value)}
            data-testid={`subscription-example-client-${group.id}`}
            className="max-w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-xs text-text"
          >
            {candidates.map(({ format }) => (
              <option key={format.id} value={format.id}>
                {format.titleKey ? t(format.titleKey) : format.fallbackTitle}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleCopy()}
            data-testid={`subscription-example-copy-${group.id}`}
          >
            {t('subscriptions.exampleCopy')}
          </Button>
        </div>
        {selected.example.language === 'json' ? (
          <p data-testid="subscription-example-policy-hint-json" className="text-xs text-text-muted">
            {policyHint}
          </p>
        ) : null}
        <pre className="max-w-full overflow-x-auto rounded-[var(--radius-sm)] bg-surface-muted p-3 text-xs text-text">
          <code ref={codeRef} data-testid={`subscription-example-code-${group.id}`}>
            {selected.example.code}
          </code>
        </pre>
      </div>
    </details>
  );
}
