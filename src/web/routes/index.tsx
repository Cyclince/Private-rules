import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, FolderKanban, Globe, Layers, RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import loginBgUrl from '../assets/miku-login-bg.webp';
import { useI18n } from '../i18n';
import { api, formatApiError, readApiJson } from '../lib/api';
import { requireAuthBeforeLoad } from '../lib/auth-guard';
import { healthQueryOptions, invalidateRulesets, rulesetsListQueryOptions } from '../lib/query';
import { useToast } from '../lib/toast';

type DashboardRange = '24h' | '7d' | '30d';
type LegacyView = 'dashboard' | 'rules' | 'sources' | 'links' | 'settings';

type DashboardSearch = {
  range?: DashboardRange;
  view?: LegacyView;
  category?: string;
  source?: string;
};

const VALID_RANGES = new Set<DashboardRange>(['24h', '7d', '30d']);
const VALID_LEGACY_VIEWS = new Set<LegacyView>(['dashboard', 'rules', 'sources', 'links', 'settings']);

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): DashboardSearch => {
    const raw = typeof search.range === 'string' ? (search.range as DashboardRange) : undefined;
    const rawView = typeof search.view === 'string' ? (search.view as LegacyView) : undefined;
    const category = typeof search.category === 'string' && search.category ? search.category : undefined;
    const source = typeof search.source === 'string' && search.source ? search.source : undefined;
    return {
      ...(raw && VALID_RANGES.has(raw) ? { range: raw } : {}),
      ...(rawView && VALID_LEGACY_VIEWS.has(rawView) ? { view: rawView } : {}),
      ...(category ? { category } : {}),
      ...(source ? { source } : {}),
    };
  },
  beforeLoad: async ({ context, location, search }) => {
    await requireAuthBeforeLoad(context.queryClient, location.href);
    if (search.view === 'rules') {
      throw redirect({
        to: '/rulesets',
        search: search.category ? { selected: search.category } : {},
        replace: true,
      });
    }
    if (search.view === 'sources') {
      throw redirect({
        to: '/rulesets',
        search: { ...(search.category ? { selected: search.category } : {}), tab: 'sources' },
        replace: true,
      });
    }
    if (search.view === 'links') {
      throw redirect({
        to: '/rulesets',
        search: { ...(search.category ? { selected: search.category } : {}), links: '1' },
        replace: true,
      });
    }
    if (search.view === 'settings') {
      throw redirect({ to: '/settings', search: {}, replace: true });
    }
  },
  component: DashboardPage,
});

function formatTimestamp(iso: string | undefined, fallback: string): string {
  if (!iso) return fallback;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return fallback;
  return new Date(time).toLocaleString();
}

function DashboardPage() {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const range: DashboardRange = search.range ?? '7d';
  const navigate = Route.useNavigate();

  const healthQuery = useQuery(healthQueryOptions());
  const summaryQuery = useQuery(rulesetsListQueryOptions());
  const [syncing, setSyncing] = useState(false);

  const handleSyncAll = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await readApiJson<{ results: Array<{ ok: boolean }> }>(await api.api.sync.$post());
      await invalidateRulesets(queryClient);
      notify({ title: t('dashboard.syncDone'), variant: 'success' });
    } catch (error) {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    } finally {
      setSyncing(false);
    }
  };

  const categories = summaryQuery.data?.data.categories ?? [];
  const enabledRulesets = categories.filter((c) => c.enabled !== false).length;
  const totalRules = categories.reduce((sum, c) => sum + (c.ruleCount ?? 0), 0);
  const manualRules = categories.reduce((sum, c) => sum + (c.manualRuleCount ?? 0), 0);
  const upstreamRules = Math.max(0, totalRules - manualRules);

  const allSources = categories.flatMap((category) =>
    (category.sources ?? []).map((source) => ({
      ...source,
      categoryName: category.name,
      categoryId: category.id,
    })),
  );
  const errorSources = allSources
    .filter((source) => source.lastStatus === 'error')
    .sort((a, b) => (b.lastSyncedAt ?? '').localeCompare(a.lastSyncedAt ?? ''));
  const healthySources = allSources.filter((source) => source.lastStatus !== 'error').length;
  const lastSyncedAt = summaryQuery.data?.data.lastSyncedAt;

  return (
    <div className="flex flex-col gap-5" data-testid="dashboard-page">
      <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface text-text shadow-sm">
        <div className="relative h-40 w-full overflow-hidden border-b border-border bg-surface-muted sm:h-44">
          <img
            src={loginBgUrl}
            alt={t('dashboard.title')}
            className="h-full w-full object-cover object-center opacity-85"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-bg/95 via-bg/55 to-transparent" />
          <div className="absolute bottom-4 left-5 right-5 flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium text-primary">
                Private Rules · {healthQuery.data?.version ?? '1.1.0'}
              </span>
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-text">{t('dashboard.title')}</h2>
            <p className="text-sm text-text-muted">{t('dashboard.subtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-text-muted">{t('dashboard.rangeLabel')}:</span>
            {(['24h', '7d', '30d'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => navigate({ search: { range: item }, replace: true })}
                className={`inline-flex h-8 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border px-3 text-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-primary ${
                  range === item
                    ? 'border-transparent bg-primary text-primary-foreground shadow-sm hover:shadow-glow'
                    : 'border-border bg-transparent text-text hover:bg-surface-muted'
                }`}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="dashboard-sync-all"
              disabled={syncing}
              onClick={() => void handleSyncAll()}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-surface-muted px-3 text-xs font-medium text-text transition-colors hover:bg-surface disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? t('dashboard.syncing') : t('dashboard.syncAll')}
            </button>
            <Link
              to="/rulesets"
              data-testid="dashboard-manage-rulesets"
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-shadow hover:shadow-glow"
            >
              <FolderKanban className="h-3.5 w-3.5" />
              {t('dashboard.manageRulesets')}
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <section
          data-testid="stat-card-rulesets"
          className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-sm"
        >
          <div className="flex items-center justify-between text-xs font-medium text-text-muted">
            <span>{t('dashboard.statRulesets')}</span>
            <FolderKanban className="h-4 w-4 text-primary" />
          </div>
          {summaryQuery.isLoading ? (
            <div className="mt-3 h-7 w-20 animate-pulse rounded bg-surface-muted" />
          ) : (
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight" data-testid="stat-rulesets-count">
                {enabledRulesets}
              </span>
              <span className="text-xs text-text-muted">/ {categories.length}</span>
            </div>
          )}
          <p className="mt-1 text-xs text-text-muted">{t('dashboard.statRulesetsHint')}</p>
        </section>

        <section
          data-testid="stat-card-rules"
          className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-sm"
        >
          <div className="flex items-center justify-between text-xs font-medium text-text-muted">
            <span>{t('dashboard.statRules')}</span>
            <Layers className="h-4 w-4 text-primary" />
          </div>
          {summaryQuery.isLoading ? (
            <div className="mt-3 h-7 w-24 animate-pulse rounded bg-surface-muted" />
          ) : (
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight" data-testid="stat-rules-count">
                {totalRules.toLocaleString()}
              </span>
            </div>
          )}
          <p className="mt-1 text-xs text-text-muted">
            {t('dashboard.statRulesHint')}: {manualRules.toLocaleString()} / {upstreamRules.toLocaleString()}
          </p>
        </section>

        <section
          data-testid="stat-card-sources"
          className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-sm"
        >
          <div className="flex items-center justify-between text-xs font-medium text-text-muted">
            <span>{t('dashboard.statSources')}</span>
            <Globe className="h-4 w-4 text-primary" />
          </div>
          {summaryQuery.isLoading ? (
            <div className="mt-3 h-7 w-20 animate-pulse rounded bg-surface-muted" />
          ) : (
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight" data-testid="stat-sources-count">
                {allSources.length}
              </span>
              {errorSources.length > 0 ? (
                <span className="inline-flex items-center rounded-full bg-danger px-2 py-0.5 text-[11px] font-medium text-danger-foreground">
                  {errorSources.length}
                </span>
              ) : null}
            </div>
          )}
          <p className="mt-1 text-xs text-text-muted">
            {t('dashboard.statSourcesHint')}: {healthySources} / {errorSources.length}
          </p>
        </section>

        <section
          data-testid="stat-card-sync"
          className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-sm"
        >
          <div className="flex items-center justify-between text-xs font-medium text-text-muted">
            <span>{t('dashboard.statSync')}</span>
            {errorSources.length > 0 ? (
              <AlertTriangle className="h-4 w-4 text-danger" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-success" />
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                healthQuery.data?.ok ? 'bg-success text-success-foreground' : 'bg-danger text-danger-foreground'
              }`}
            >
              {healthQuery.data?.database ?? '…'}
            </span>
            <span className="text-xs text-text-muted">{healthQuery.data?.runtime ?? '-'}</span>
          </div>
          <p className="mt-1.5 truncate text-xs text-text-muted">
            {formatTimestamp(lastSyncedAt, t('dashboard.neverSynced'))}
          </p>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          data-testid="dashboard-recent-errors"
          className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold tracking-tight">{t('dashboard.recentErrors')}</h3>
            {errorSources.length > 0 ? (
              <span className="inline-flex items-center rounded-full bg-danger px-2.5 py-0.5 text-xs font-medium text-danger-foreground">
                {errorSources.length} {t('dashboard.recentErrorsCount')}
              </span>
            ) : null}
          </div>
          {errorSources.length === 0 ? (
            <div className="mt-4 flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface-muted p-4">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
              <div>
                <div className="text-sm font-medium">{t('dashboard.syncHealthy')}</div>
                <p className="text-xs text-text-muted">{t('dashboard.syncHealthyHint')}</p>
              </div>
            </div>
          ) : (
            <ul className="mt-4 flex flex-col gap-2.5">
              {errorSources.slice(0, 8).map((source) => (
                <li
                  key={source.id}
                  data-testid={`dashboard-error-${source.id}`}
                  className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-danger/40 bg-surface-muted p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {source.categoryName} · {source.name}
                    </span>
                    <Link
                      to="/rulesets"
                      search={{ selected: source.categoryId }}
                      className="shrink-0 text-xs font-medium text-primary hover:underline"
                    >
                      {t('dashboard.viewRuleset')}
                    </Link>
                  </div>
                  <p className="break-words text-xs text-danger">{source.lastError || 'Sync failed'}</p>
                  <span className="text-[11px] text-text-muted">
                    {formatTimestamp(source.lastSyncedAt, t('dashboard.neverSynced'))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          data-testid="dashboard-ruleset-snapshot"
          className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold tracking-tight">{t('dashboard.rulesetSnapshot')}</h3>
            <Link to="/rulesets" className="text-xs font-medium text-primary hover:underline">
              {t('dashboard.manageRulesets')}
            </Link>
          </div>
          {summaryQuery.isLoading ? (
            <div className="mt-4 flex flex-col gap-2">
              <div className="h-12 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
              <div className="h-12 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />
            </div>
          ) : categories.length === 0 ? (
            <p className="mt-4 rounded-[var(--radius-md)] border border-border bg-surface-muted p-4 text-sm text-text-muted">
              {t('dashboard.noRulesets')}
            </p>
          ) : (
            <div className="mt-4 flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
              {categories.map((category) => (
                <Link
                  key={category.id}
                  to="/rulesets"
                  search={{ selected: category.id }}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-surface-muted/60 px-3.5 py-2.5 transition-colors hover:bg-surface-muted"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{category.name}</div>
                    <div className="truncate font-mono text-xs text-text-muted">{category.slug}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-text-muted">
                      {(category.ruleCount ?? 0).toLocaleString()}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        category.enabled === false
                          ? 'bg-surface text-text-muted'
                          : category.tokenLinksEnabled
                            ? 'bg-primary text-primary-foreground'
                            : category.publicLinksEnabled
                              ? 'bg-success text-success-foreground'
                              : 'bg-surface text-text-muted'
                      }`}
                    >
                      {category.enabled === false
                        ? t('common.disabled')
                        : category.tokenLinksEnabled
                          ? t('rulesets.policyToken')
                          : category.publicLinksEnabled
                            ? t('rulesets.policyPublic')
                            : t('rulesets.policyOff')}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
