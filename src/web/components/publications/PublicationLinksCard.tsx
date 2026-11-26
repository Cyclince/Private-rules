import { Check, Copy, Link2, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import type { PublicationWithLinks } from '../../../server/routes/publications';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

type PublicationLinksCardProps = {
  publication: PublicationWithLinks;
  ruleTokenConfigured: boolean;
};

export function PublicationLinksCard({ publication, ruleTokenConfigured }: PublicationLinksCardProps) {
  const { t } = useI18n();
  const { notify } = useToast();
  const [copiedClient, setCopiedClient] = useState<string | null>(null);

  const hasBindings = publication.bindings.length > 0;

  const copyUrl = async (client: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedClient(client);
      notify({ title: t('links.copiedToast'), variant: 'success' });
      window.setTimeout(() => setCopiedClient((prev) => (prev === client ? null : prev)), 1800);
    } catch {
      notify({ title: t('links.copyFailed'), variant: 'danger' });
    }
  };

  return (
    <div data-testid="publication-links-panel" className="flex flex-col gap-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
          <Link2 className="h-4 w-4 text-primary" />
          <span>{t('publications.linksTitle')}</span>
        </h3>
        <p className="text-xs text-text-muted">{t('publications.linksDesc')}</p>
      </div>

      {publication.access === 'disabled' ? (
        <div
          data-testid="pub-links-disabled-notice"
          className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-warning/50 bg-surface-muted p-3.5 text-xs text-text-muted"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>{t('publications.linksDisabledHint')}</span>
        </div>
      ) : publication.access === 'token' && !ruleTokenConfigured ? (
        <div
          data-testid="pub-links-token-missing-notice"
          className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-warning/50 bg-surface-muted p-3.5 text-xs text-text-muted"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>{t('publications.linksTokenMissingHint')}</span>
        </div>
      ) : publication.access === 'public' && hasBindings ? (
        <div
          data-testid="pub-links-public-blocked-notice"
          className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-danger/50 bg-danger/10 p-3.5 text-xs text-text"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <span>{t('publications.linksPublicBlockedHint')}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {publication.links.map((link) => {
            const isCopied = copiedClient === link.client;
            if (!link.supported) {
              return (
                <div
                  key={link.client}
                  data-testid={`pub-link-coming-soon-${link.client}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-surface-muted/40 p-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-text">{link.label}</span>
                      <span className="font-mono text-[11px] text-text-muted">{link.fileName}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-text-muted">{t('publications.linksComingSoonHint')}</p>
                  </div>
                  <Badge variant="outline">{t('taxonomy.clientComingSoon')}</Badge>
                </div>
              );
            }

            if (!link.url) return null;

            return (
              <div
                key={link.client}
                data-testid={`pub-link-item-${link.client}`}
                className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-surface-muted/50 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="text-sm font-medium text-text">{link.label}</span>
                    <Badge variant={publication.access === 'token' ? 'primary' : 'success'}>
                      {publication.access === 'token' ? t('links.tokenBadge') : t('links.publicBadge')}
                    </Badge>
                    <span className="truncate font-mono text-[11px] text-text-muted">{link.fileName}</span>
                  </div>
                  <Button
                    size="sm"
                    variant={isCopied ? 'secondary' : 'outline'}
                    data-testid={`pub-link-copy-${link.client}`}
                    onClick={() => void copyUrl(link.client, link.url!)}
                  >
                    {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{isCopied ? t('common.copied') : t('common.copy')}</span>
                  </Button>
                </div>
                <code
                  data-testid={`pub-link-url-${link.client}`}
                  className="block break-all rounded-[var(--radius-sm)] bg-surface px-2.5 py-1.5 font-mono text-[11px] text-text-muted"
                >
                  {link.url}
                </code>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
