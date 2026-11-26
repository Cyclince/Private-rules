import { Check, Copy, Link2, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import type { ClientLink, RuleCategory } from '../../../types/domain-rules';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';

type SubscriptionLinksDrawerProps = {
  open: boolean;
  ruleset: RuleCategory | null;
  links: ClientLink[];
  onOpenChange: (open: boolean) => void;
};

export function SubscriptionLinksDrawer({ open, ruleset, links, onOpenChange }: SubscriptionLinksDrawerProps) {
  const { t } = useI18n();
  const { notify } = useToast();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const validLinks = links.filter((item) => Boolean(item.recommendedUrl || item.tokenUrl || item.publicUrl));

  const copyUrl = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      notify({ title: t('links.copiedToast'), variant: 'success' });
      window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
    } catch {
      notify({ title: t('links.copyFailed'), variant: 'danger' });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto" data-testid="subscription-links-drawer">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            <span>
              {t('links.title')} · {ruleset?.name ?? ''}
            </span>
          </SheetTitle>
          <SheetDescription>{t('links.subtitle')}</SheetDescription>
        </SheetHeader>

        {ruleset ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={ruleset.enabled === false ? 'outline' : 'success'}>
              {ruleset.enabled === false ? t('common.disabled') : t('common.enabled')}
            </Badge>
            {ruleset.tokenLinksEnabled ? (
              <Badge variant="primary">{t('rulesets.policyToken')}</Badge>
            ) : ruleset.publicLinksEnabled ? (
              <Badge variant="success">{t('rulesets.policyPublic')}</Badge>
            ) : (
              <Badge variant="outline">{t('rulesets.policyOff')}</Badge>
            )}
          </div>
        ) : null}

        {validLinks.length === 0 ? (
          <div
            data-testid="subscription-links-empty"
            className="flex items-start gap-3 rounded-[var(--radius-md)] border border-warning/50 bg-surface-muted p-4"
          >
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="text-xs">
              <div className="font-semibold text-text">{t('links.noValidLinks')}</div>
              <p className="mt-1 text-text-muted">{t('links.noValidLinksHint')}</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5" data-testid="subscription-links-list">
            {validLinks.map((link) => {
              const activeUrl = link.recommendedUrl || link.tokenUrl || link.publicUrl;
              const isToken = Boolean(link.tokenUrl);
              const isCopied = copiedId === link.id;
              return (
                <div
                  key={link.id}
                  data-testid={`subscription-link-${link.id}`}
                  className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-surface-muted/60 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">{link.name}</span>
                        <Badge variant={isToken ? 'primary' : 'success'}>
                          {isToken ? t('links.tokenBadge') : t('links.publicBadge')}
                        </Badge>
                      </div>
                      <div className="truncate text-[11px] text-text-muted">{link.fileName}</div>
                    </div>
                    <Button
                      size="sm"
                      variant={isCopied ? 'secondary' : 'outline'}
                      data-testid={`copy-link-${link.id}`}
                      onClick={() => void copyUrl(link.id, activeUrl)}
                    >
                      {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{isCopied ? t('common.copied') : t('common.copy')}</span>
                    </Button>
                  </div>
                  <code className="block break-all rounded-[var(--radius-sm)] bg-surface px-2.5 py-1.5 font-mono text-[11px] text-text-muted">
                    {activeUrl}
                  </code>
                </div>
              );
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
