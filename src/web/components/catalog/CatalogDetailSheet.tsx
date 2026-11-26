import { useQuery } from '@tanstack/react-query';
import { BookOpen, Check, Copy, ExternalLink, FolderTree, GitBranch } from 'lucide-react';
import { useState } from 'react';
import type { CatalogItem } from '../../../application/catalog';
import type { CatalogProviderMetadata } from '../../../builtin';
import { useI18n, type MessageKey } from '../../i18n';
import { catalogEntryQueryOptions } from '../../lib/query';
import { useToast } from '../../lib/toast';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';

type CatalogDetailSheetProps = {
  open: boolean;
  entryId: string | null;
  initialItem: CatalogItem | null;
  allItems: CatalogItem[];
  providers: Readonly<Record<string, CatalogProviderMetadata>>;
  onSelectEntry: (entryId: string) => void;
  onOpenChange: (open: boolean) => void;
};

function routeBadgeVariant(route: CatalogItem['defaultRoute']): 'primary' | 'success' | 'danger' {
  if (route === 'direct') return 'success';
  if (route === 'reject') return 'danger';
  return 'primary';
}

export function CatalogDetailSheet({
  open,
  entryId,
  initialItem,
  allItems,
  providers,
  onSelectEntry,
  onOpenChange,
}: CatalogDetailSheetProps) {
  const { t } = useI18n();
  const { notify } = useToast();
  const [copiedUrl, setCopiedUrl] = useState(false);

  const detailQuery = useQuery({
    ...catalogEntryQueryOptions(entryId ?? ''),
    enabled: open && Boolean(entryId),
  });

  const entry = detailQuery.data?.entry ?? initialItem;
  const providerMeta = entry ? providers[entry.provider] : undefined;

  const parentItem = entry?.parentId ? allItems.find((item) => item.id === entry.parentId) : undefined;
  const childItems = entry ? allItems.filter((item) => item.parentId === entry.id) : [];

  const providerName = providerMeta
    ? providerMeta.name
    : entry?.kind === 'ruleset'
      ? t('catalog.detailSelfProvider')
      : entry?.kind === 'geosite' || entry?.kind === 'geoip'
        ? t('catalog.detailGeoProvider')
        : (entry?.provider ?? '—');

  const licenseText = providerMeta
    ? providerMeta.license
    : entry?.kind === 'ruleset'
      ? t('catalog.detailSelfLicense')
      : entry?.kind === 'geosite' || entry?.kind === 'geoip'
        ? t('catalog.detailGeoLicense')
        : '—';

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(true);
      notify({ title: t('common.copied'), variant: 'success' });
      window.setTimeout(() => setCopiedUrl(false), 1800);
    } catch {
      notify({ title: t('links.copyFailed'), variant: 'danger' });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto" data-testid="catalog-detail-sheet">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 pr-8">
            <BookOpen className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate">{entry?.name ?? t('catalog.detailTitle')}</span>
          </SheetTitle>
          <SheetDescription className="font-mono text-xs">{entry?.id ?? entryId ?? ''}</SheetDescription>
        </SheetHeader>

        {detailQuery.isLoading && !entry ? (
          <div className="flex flex-col gap-2.5">
            <div className="h-16 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
            <div className="h-24 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
          </div>
        ) : entry ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{t(`catalog.kind.${entry.kind}` as MessageKey)}</Badge>
              <Badge variant="outline">{t(`taxonomy.category.${entry.category}` as MessageKey)}</Badge>
              <Badge variant={routeBadgeVariant(entry.defaultRoute)}>
                {t('catalog.detailDefaultRoute')}: {t(`taxonomy.route.${entry.defaultRoute}` as MessageKey)}
              </Badge>
              {entry.behavior ? <Badge variant="outline">{entry.behavior}</Badge> : null}
              {entry.format ? <Badge variant="outline">{entry.format}</Badge> : null}
            </div>

            <dl className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface-muted/60 p-3.5 text-xs">
              <div className="flex flex-col gap-0.5">
                <dt className="font-medium text-text-muted">{t('catalog.detailProvider')}</dt>
                <dd data-testid="catalog-detail-provider" className="font-medium text-text">
                  {providerName}
                </dd>
              </div>

              {providerMeta?.repository ? (
                <div className="flex flex-col gap-0.5">
                  <dt className="font-medium text-text-muted">{t('catalog.detailRepository')}</dt>
                  <dd>
                    <a
                      href={providerMeta.repository}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="catalog-detail-repository"
                      className="inline-flex items-center gap-1 break-all font-mono text-primary hover:underline"
                    >
                      <span>{providerMeta.repository}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </dd>
                </div>
              ) : null}

              <div className="flex flex-col gap-0.5">
                <dt className="font-medium text-text-muted">{t('catalog.detailLicense')}</dt>
                <dd data-testid="catalog-detail-license" className="text-text">
                  {licenseText}
                </dd>
                {providerMeta?.attributionNote ? (
                  <p className="mt-0.5 text-[11px] text-text-muted">{providerMeta.attributionNote}</p>
                ) : null}
              </div>

              <div className="flex flex-col gap-0.5">
                <dt className="font-medium text-text-muted">{t('catalog.detailRuleCount')}</dt>
                <dd data-testid="catalog-detail-rule-count" className="font-mono text-text">
                  {typeof entry.ruleCount === 'number'
                    ? entry.ruleCount.toLocaleString()
                    : t('catalog.detailRuleCountRemote')}
                </dd>
              </div>

              {entry.behavior || entry.format ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <dt className="font-medium text-text-muted">{t('catalog.detailBehavior')}</dt>
                    <dd className="font-mono text-text">{entry.behavior ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-text-muted">{t('catalog.detailFormat')}</dt>
                    <dd className="font-mono text-text">{entry.format ?? '—'}</dd>
                  </div>
                </div>
              ) : null}
            </dl>

            {entry.sourceUrl ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-text-muted">{t('catalog.detailSourceUrl')}</span>
                  <Button size="sm" variant="outline" onClick={() => void handleCopyUrl(entry.sourceUrl!)}>
                    {copiedUrl ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedUrl ? t('common.copied') : t('common.copy')}</span>
                  </Button>
                </div>
                <code className="block break-all rounded-[var(--radius-sm)] border border-border bg-surface-muted px-2.5 py-2 font-mono text-[11px] text-text-muted">
                  {entry.sourceUrl}
                </code>
              </div>
            ) : null}

            {entry.aliases.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-text-muted">{t('catalog.detailAliases')}</span>
                <div className="flex flex-wrap gap-1.5">
                  {entry.aliases.map((alias) => (
                    <Badge key={alias} variant="outline" className="font-mono text-[11px]">
                      {alias}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {entry.parentId ? (
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
                  <FolderTree className="h-3.5 w-3.5" />
                  <span>{t('catalog.parentLabel')}</span>
                </span>
                <button
                  type="button"
                  data-testid="catalog-detail-parent-btn"
                  onClick={() => onSelectEntry(entry.parentId!)}
                  className="flex cursor-pointer items-center justify-between rounded-[var(--radius-md)] border border-border bg-surface-muted/60 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-muted"
                >
                  <span className="font-medium text-text">{parentItem?.name ?? entry.parentId}</span>
                  {parentItem ? <span className="font-mono text-[11px] text-primary">{entry.parentId}</span> : null}
                </button>
              </div>
            ) : null}

            {childItems.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
                  <GitBranch className="h-3.5 w-3.5" />
                  <span>
                    {t('catalog.childrenTitle')} ({childItems.length})
                  </span>
                </span>
                <div className="flex flex-col gap-1.5">
                  {childItems.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => onSelectEntry(child.id)}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-surface-muted/50 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-muted"
                    >
                      <span className="truncate font-medium text-text">{child.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-text-muted">{child.id}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
