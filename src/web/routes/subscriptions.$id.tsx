import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, Check, ChevronDown, Copy, FileText, Info, Settings, ShieldAlert } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { CategoryIcon } from '../components/subscriptions/CategoryIcon';
import { SubscriptionExample } from '../components/subscriptions/SubscriptionExample';
import {
  accessPolicyToPatch,
  buildSubscriptionFormatGroups,
  preferHttpsLink,
  resolveAccessPolicy,
  type AccessPolicy,
  type FormatLinkEntry,
} from '../components/subscriptions/subscription-helpers';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { EmptyState } from '../components/ui/empty-state';
import { loadPageTranslations, useI18n, type MessageKey } from '../i18n';
import { api, formatApiError, readApiJson } from '../lib/api';
import { isTelegramSession, requireAuthBeforeLoad } from '../lib/auth-guard';
import {
  authMeQueryOptions,
  invalidateRulesets,
  rulesetsListQueryOptions,
  type RulesetSummaryPayload,
} from '../lib/query-core';
import { useToast } from '../lib/toast';

export const Route = createFileRoute('/subscriptions/$id')({
  beforeLoad: async ({ context, location }) => {
    await Promise.all([requireAuthBeforeLoad(context.queryClient, location.href), loadPageTranslations()]);
  },
  component: SubscriptionDetailPage,
});

function formatToneClass(tone: FormatLinkEntry['tone']): string {
  switch (tone) {
    case 'primary':
      return 'bg-primary/15 text-primary';
    case 'accent':
      return 'bg-accent/15 text-accent';
    case 'warning':
      return 'bg-warning/15 text-warning';
    case 'success':
      return 'bg-success/15 text-success';
  }
}

function readonlyPolicyLabelKey(policy: AccessPolicy): MessageKey {
  if (policy === 'token') return 'subscriptions.policyReadonlyToken';
  if (policy === 'public') return 'subscriptions.policyReadonlyPublic';
  return 'subscriptions.policyReadonlyDisabled';
}

function SubscriptionDetailPage() {
  const { id } = Route.useParams();
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const authQuery = useQuery(authMeQueryOptions());
  const summaryQuery = useQuery(rulesetsListQueryOptions());

  const isTelegram = isTelegramSession(authQuery.data);
  const canEditPolicy = !isTelegram;

  const categories = summaryQuery.data?.data.categories ?? [];
  const selectedCategory = useMemo(() => categories.find((item) => item.id === id) ?? null, [categories, id]);
  const selectedLinks = useMemo(
    () => (selectedCategory ? (summaryQuery.data?.links[selectedCategory.id] ?? []) : []),
    [summaryQuery.data, selectedCategory],
  );

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const urlRefs = useRef<Map<string, HTMLElement>>(new Map());

  const updatePolicyMutation = useMutation({
    mutationFn: async (policy: AccessPolicy) => {
      if (!selectedCategory) throw new Error('Category not found');
      return readApiJson<RulesetSummaryPayload>(
        await api.api.rulesets[':id'].$patch({
          param: { id: selectedCategory.id },
          json: accessPolicyToPatch(policy),
        }),
      );
    },
    onSuccess: async () => {
      if (selectedCategory) {
        await invalidateRulesets(queryClient, selectedCategory.id);
      } else {
        await invalidateRulesets(queryClient);
      }
      notify({ title: t('subscriptions.policyUpdated'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const groups = useMemo(() => buildSubscriptionFormatGroups(selectedLinks), [selectedLinks]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleCopy = async (linkId: string, rawUrl: string) => {
    if (!rawUrl) {
      notify({ title: t('subscriptions.disabledNotice'), variant: 'danger' });
      return;
    }
    const url = preferHttpsLink(rawUrl);
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(url);
      setCopiedId(linkId);
      notify({ title: t('subscriptions.copiedToast'), variant: 'success' });
      window.setTimeout(() => {
        setCopiedId((prev) => (prev === linkId ? null : prev));
      }, 2000);
    } catch {
      const codeEl = urlRefs.current.get(linkId);
      if (codeEl && typeof window !== 'undefined' && typeof document !== 'undefined') {
        const range = document.createRange();
        range.selectNodeContents(codeEl);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      notify({ title: t('subscriptions.copyFailed'), variant: 'danger' });
    }
  };

  if (summaryQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4" data-testid="subscription-detail-page">
        <div className="h-5 w-32 animate-pulse rounded bg-surface-muted" />
        <div className="h-16 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
        <div className="h-24 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
      </div>
    );
  }

  if (!selectedCategory) {
    return (
      <div className="flex flex-col gap-5" data-testid="subscription-detail-page">
        <div>
          <Link
            to="/subscriptions"
            data-testid="subscriptions-back-link"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{t('subscriptions.backToCenter')}</span>
          </Link>
        </div>
        <div data-testid="subscription-not-found">
          <EmptyState
            title={t('subscriptions.notFoundTitle')}
            description={t('subscriptions.notFoundDesc')}
            action={
              <Button asChild size="sm">
                <Link to="/subscriptions">{t('subscriptions.backToCenter')}</Link>
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const accessPolicy = resolveAccessPolicy(selectedCategory);
  const categoryEnabled = selectedCategory.enabled !== false;
  const hasAvailableLinks =
    categoryEnabled && accessPolicy !== 'disabled' && selectedLinks.some((link) => Boolean(link.recommendedUrl));

  const bannerText =
    accessPolicy === 'token'
      ? t('subscriptions.bannerToken')
      : accessPolicy === 'public'
        ? t('subscriptions.bannerPublic')
        : t('subscriptions.bannerDisabled');

  const scopeText = t('subscriptions.accessPolicyScope').replace('{name}', selectedCategory.name);

  return (
    <div className="flex flex-col gap-5" data-testid="subscription-detail-page">
      <header className="flex flex-col gap-3">
        <div>
          <Link
            to="/subscriptions"
            data-testid="subscriptions-back-link"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{t('subscriptions.backToCenter')}</span>
          </Link>
        </div>

        <div className="flex items-center gap-3.5">
          <CategoryIcon icon={selectedCategory.icon} name={selectedCategory.name} size={56} className="text-base" />
          <div className="min-w-0">
            <h2
              data-testid="subscription-detail-title"
              className="truncate text-2xl font-bold tracking-tight text-text sm:text-3xl"
            >
              {selectedCategory.name} {t('subscriptions.detailTitleSuffix')}
            </h2>
            <p className="mt-0.5 text-sm text-text-muted">{t('subscriptions.choose')}</p>
          </div>
        </div>
      </header>

      <Card data-testid="subscription-access-card">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-primary/15 text-primary">
              <Settings className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold tracking-tight text-text">
                {t('subscriptions.accessPolicyTitle')}
              </h3>
              <p className="mt-0.5 text-sm text-text-muted">{scopeText}</p>
            </div>
          </div>

          {canEditPolicy ? (
            <select
              aria-label={t('subscriptions.accessPolicyTitle')}
              data-testid="subscription-access-select"
              value={accessPolicy}
              disabled={updatePolicyMutation.isPending}
              onChange={(event) => updatePolicyMutation.mutate(event.target.value as AccessPolicy)}
              className="h-10 w-full cursor-pointer rounded-[var(--radius-md)] border border-border bg-surface px-3 text-sm font-medium text-text focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 sm:w-56"
            >
              <option value="token">{t('subscriptions.policyOptionToken')}</option>
              <option value="public">{t('subscriptions.policyOptionPublic')}</option>
              <option value="disabled">{t('subscriptions.policyOptionDisabled')}</option>
            </select>
          ) : (
            <strong
              data-testid="subscription-access-readonly"
              className="inline-flex items-center rounded-[var(--radius-md)] border border-border bg-surface-muted px-3 py-2 text-sm font-semibold text-text"
            >
              {t(readonlyPolicyLabelKey(accessPolicy))}
            </strong>
          )}
        </CardContent>
      </Card>

      <div
        data-testid="subscription-access-banner"
        className={`flex flex-col gap-1 rounded-[var(--radius-md)] border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
          hasAvailableLinks
            ? 'border-primary/30 bg-primary/10 text-primary'
            : 'border-border bg-surface-muted text-text-muted'
        }`}
      >
        <span className="inline-flex items-center gap-2 font-medium">
          <Info className="h-4 w-4 shrink-0" />
          <span>{bannerText}</span>
        </span>
        <small className="text-xs text-text-muted">{t('subscriptions.bannerHint')}</small>
      </div>

      {!hasAvailableLinks ? (
        <Card data-testid="subscription-links-disabled" className="border-warning/40 bg-surface-muted/60">
          <CardHeader className="flex flex-row items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="min-w-0">
              <CardTitle className="text-base">{t('subscriptions.disabledNotice')}</CardTitle>
              <CardDescription className="mt-1">
                {!categoryEnabled
                  ? t('subscriptions.disabledRuleHint')
                  : accessPolicy === 'token' && !authQuery.data?.ruleTokenConfigured
                    ? t('subscriptions.missingTokenHint')
                    : t('subscriptions.bannerHint')}
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      ) : (
        <div className="flex flex-col gap-3" data-testid="subscription-format-groups">
          {groups.map((group) => {
            const expanded = expandedGroups.has(group.id);
            return (
              <section
                key={group.id}
                data-format-group={group.id}
                data-testid={`subscription-group-${group.id}`}
                className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface shadow-sm"
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`subscription-format-${group.id}`}
                  data-testid={`subscription-group-toggle-${group.id}`}
                  onClick={() => toggleGroup(group.id)}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-muted/50 focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span className="flex items-center gap-2.5">
                    <strong className="text-sm font-semibold text-text sm:text-base">{t(group.titleKey)}</strong>
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-text-muted">
                      {group.formats.length}
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-text-muted transition-transform duration-150 ${
                      expanded ? 'rotate-180 text-primary' : ''
                    }`}
                  />
                </button>

                {expanded ? (
                  <div
                    id={`subscription-format-${group.id}`}
                    data-testid={`subscription-group-content-${group.id}`}
                    className="border-t border-border bg-bg/40 p-4"
                  >
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {group.formats.map((format) => {
                        const rawUrl = format.link.recommendedUrl;
                        const displayUrl = rawUrl ? preferHttpsLink(rawUrl) : '';
                        const isCopied = copiedId === format.id;
                        const title = format.titleKey ? t(format.titleKey) : format.fallbackTitle;
                        const description = format.descriptionKey
                          ? t(format.descriptionKey)
                          : format.fallbackDescription;

                        return (
                          <article
                            key={format.id}
                            data-testid={`subscription-link-${format.id}`}
                            className="flex flex-col justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4 shadow-sm"
                          >
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] ${formatToneClass(format.tone)}`}
                                >
                                  <FileText className="h-4 w-4" />
                                </span>
                                <code className="rounded-[var(--radius-sm)] bg-surface-muted px-2 py-0.5 font-mono text-xs text-text-muted">
                                  {format.suffix}
                                </code>
                              </div>

                              <div>
                                <h4 className="text-sm font-semibold text-text">{title}</h4>
                                <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{description}</p>
                              </div>

                              <span className="truncate font-mono text-[11px] text-text-muted">
                                {format.link.fileName}
                              </span>

                              {displayUrl ? (
                                <code
                                  ref={(el) => {
                                    if (el) urlRefs.current.set(format.id, el);
                                    else urlRefs.current.delete(format.id);
                                  }}
                                  data-testid={`subscription-link-url-${format.id}`}
                                  className="block break-all select-all rounded-[var(--radius-sm)] border border-border bg-surface-muted/70 px-2.5 py-1.5 font-mono text-[11px] text-text-muted"
                                >
                                  {displayUrl}
                                </code>
                              ) : null}
                            </div>

                            <Button
                              size="sm"
                              variant={isCopied ? 'secondary' : 'primary'}
                              disabled={!displayUrl}
                              data-testid={`copy-subscription-link-${format.id}`}
                              onClick={() => void handleCopy(format.id, rawUrl)}
                              className="w-full"
                            >
                              {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                              <span>{isCopied ? t('common.copied') : t('subscriptions.copyButton')}</span>
                            </Button>
                          </article>
                        );
                      })}
                    </div>
                    <SubscriptionExample
                      group={group}
                      name={selectedCategory.name}
                      policyName={summaryQuery.data?.data.settings.policyName}
                    />
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
