import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, RefreshCw, Sparkles } from 'lucide-react';
import { dashboardTemplatesQueryOptions } from '../lib/dashboard';
import { useState } from 'react';
import dashboardBannerUrl from '../assets/miku-dashboard-banner.webp';
import { loadPageTranslations, useI18n } from '../i18n';
import { api, formatApiError, readApiJson } from '../lib/api';
import { requireAuthBeforeLoad } from '../lib/auth-guard';
import { healthQueryOptions, invalidateRulesets, rulesetsListQueryOptions } from '../lib/query-core';
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
    await Promise.all([requireAuthBeforeLoad(context.queryClient, location.href), loadPageTranslations()]);
    if (search.view === 'rules' || search.view === 'sources') {
      if (search.category) {
        throw redirect({
          to: '/rules/$id',
          params: { id: search.category },
          replace: true,
        });
      }
      throw redirect({
        to: '/rules',
        search: {},
        replace: true,
      });
    }
    if (search.view === 'links') {
      if (search.category) {
        throw redirect({
          to: '/subscriptions/$id',
          params: { id: search.category },
          replace: true,
        });
      }
      throw redirect({
        to: '/subscriptions',
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

const ACTION_CLASS =
  'motion-btn motion-btn-lift inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed';

function DashboardPage() {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const healthQuery = useQuery(healthQueryOptions());
  const summaryQuery = useQuery(rulesetsListQueryOptions());
  const templatesQuery = useQuery(dashboardTemplatesQueryOptions(queryClient));
  const [syncing, setSyncing] = useState(false);
  const categories = summaryQuery.data?.data.categories ?? [];
  const totalRules = categories.reduce((sum, category) => sum + (category.ruleCount ?? 0), 0);
  const allSources = categories.flatMap((category) =>
    (category.sources ?? []).map((source) => ({ ...source, categoryName: category.name, categoryId: category.id })),
  );
  const errorSources = allSources
    .filter((source) => source.lastStatus === 'error')
    .sort((a, b) => (b.lastSyncedAt ?? '').localeCompare(a.lastSyncedAt ?? ''));
  const lastSyncedAt = summaryQuery.data?.data.lastSyncedAt;
  const templateStats = templatesQuery.data;

  const handleSyncAll = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await readApiJson<{ results: Array<{ ok: boolean }> }>(await api.api.sync.$post());
      await invalidateRulesets(queryClient);
      notify({
        title: t(result.results.some((item) => !item.ok) ? 'dashboard.syncPartial' : 'dashboard.syncDone'),
        variant: result.results.some((item) => !item.ok) ? 'danger' : 'success',
      });
    } catch (error) {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="dashboard-page">
      <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface text-text shadow-sm">
        <div className="relative h-40 w-full overflow-hidden border-b border-border bg-[#0b1418] sm:h-44">
          <img
            src={dashboardBannerUrl}
            alt={t('dashboard.title')}
            decoding="async"
            className="h-full w-full object-cover object-[85%_25%] opacity-95"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0b1418]/92 via-[#0b1418]/65 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#0b1418]/75 to-transparent" />
          <div className="absolute bottom-4 left-5 right-5 flex max-w-xl flex-col gap-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#39c5bb]" />
              <span className="text-xs font-medium text-[#39c5bb]">
                Private Rules · {healthQuery.data?.version ?? '1.1.0'}
              </span>
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-[#e8f4f4]">{t('dashboard.title')}</h2>
            <p className="text-sm text-[#b7d3d9]">{t('dashboard.subtitle')}</p>
          </div>
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2" data-testid="dashboard-modules">
        <section
          className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-border bg-surface p-5"
          data-testid="dashboard-rules-panel"
        >
          <h3 className="text-lg font-semibold text-text">{t('dashboard.rulesModule')}</h3>
          {summaryQuery.isError ? (
            <p role="alert" className="text-sm text-danger">
              {t('dashboard.loadFailed')}
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div data-testid="stat-card-rulesets">
                <dt className="text-xs text-text-muted">{t('dashboard.rulesCount')}</dt>
                <dd className="mt-1 text-2xl font-semibold" data-testid="stat-rulesets-count">
                  {summaryQuery.isLoading ? '…' : categories.length}
                </dd>
              </div>
              <div data-testid="stat-card-rules">
                <dt className="text-xs text-text-muted">{t('dashboard.ruleEntries')}</dt>
                <dd className="mt-1 text-2xl font-semibold" data-testid="stat-rules-count">
                  {summaryQuery.isLoading ? '…' : totalRules.toLocaleString()}
                </dd>
              </div>
              <div data-testid="stat-card-sources">
                <dt className="text-xs text-text-muted">{t('dashboard.statSources')}</dt>
                <dd className="mt-1 text-2xl font-semibold" data-testid="stat-sources-count">
                  {summaryQuery.isLoading ? '…' : allSources.length}
                </dd>
                <span className={errorSources.length ? 'text-xs text-danger' : 'text-xs text-text-muted'}>
                  {t('dashboard.sourceErrors').replace('{count}', String(errorSources.length))}
                </span>
              </div>
            </dl>
          )}
          <div className="flex flex-wrap gap-2">
            <Link
              className={ACTION_CLASS + ' bg-primary text-primary-foreground'}
              to="/rules"
              search={{}}
              data-testid="dashboard-manage-rulesets"
            >
              {t('dashboard.newRule')}
            </Link>
            <Link
              className={ACTION_CLASS + ' bg-surface text-text hover:bg-surface-muted'}
              to="/subscriptions"
              data-testid="dashboard-copy-subscription"
            >
              {t('dashboard.copySubscription')}
            </Link>
          </div>
          {categories.length > 0 ? (
            <div
              className="flex max-h-52 flex-col gap-1 overflow-y-auto border-t border-border pt-3"
              data-testid="dashboard-ruleset-snapshot"
            >
              {categories.map((category) => (
                <Link
                  key={category.id}
                  to="/rules/$id"
                  params={{ id: category.id }}
                  className="motion-card flex items-center justify-between gap-3 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm text-text hover:bg-surface-muted"
                >
                  <span className="min-w-0 truncate">{category.name}</span>
                  <span className="shrink-0 text-xs text-text-muted">{(category.ruleCount ?? 0).toLocaleString()}</span>
                </Link>
              ))}
            </div>
          ) : null}
        </section>
        <section
          className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-border bg-surface p-5"
          data-testid="dashboard-templates-panel"
        >
          <h3 className="text-lg font-semibold text-text">{t('dashboard.templatesModule')}</h3>
          {templatesQuery.isLoading ? (
            <p className="text-sm text-text-muted">{t('common.loading')}</p>
          ) : templatesQuery.isError ? (
            <p role="alert" className="text-sm text-danger">
              {t('dashboard.loadFailed')}
            </p>
          ) : templateStats?.templateCount === 0 ? (
            <p className="text-sm text-text-muted" data-testid="dashboard-templates-empty">
              {t('dashboard.templatesIntro')}
            </p>
          ) : templateStats ? (
            <>
              <dl className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-xs text-text-muted">{t('dashboard.templateCount')}</dt>
                  <dd className="mt-1 text-2xl font-semibold" data-testid="dashboard-template-count">
                    {templateStats.templateCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-text-muted">{t('dashboard.outputCount')}</dt>
                  <dd className="mt-1 text-2xl font-semibold" data-testid="dashboard-output-count">
                    {templateStats.outputCount}
                  </dd>
                </div>
              </dl>
              <div className="text-sm text-text-muted" data-testid="dashboard-airport-status">
                <span>{t('dashboard.airportStatus')}：</span>
                {(['ok', 'bound', 'error', 'empty'] as const)
                  .filter((status) => templateStats.airports[status] > 0)
                  .map((status) => (
                    <span key={status} className={status === 'error' ? 'mr-3 text-danger' : 'mr-3'}>
                      {t(`dashboard.airport.${status}`).replace('{count}', String(templateStats.airports[status]))}
                    </span>
                  ))}
              </div>
            </>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Link
              className={ACTION_CLASS + ' bg-primary text-primary-foreground'}
              to="/templates/new"
              data-testid="dashboard-new-template"
            >
              {t('dashboard.newTemplate')}
            </Link>
            {templateStats && templateStats.templateCount > 0 ? (
              <Link
                className={ACTION_CLASS + ' bg-surface text-text hover:bg-surface-muted'}
                to="/templates"
                data-testid="dashboard-copy-template-link"
              >
                {t('dashboard.copyLinks')}
              </Link>
            ) : null}
          </div>
        </section>
      </div>
      <section
        className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-border bg-surface px-5 py-4"
        data-testid="stat-card-sync"
      >
        <p className="text-sm text-text-muted">
          {t('dashboard.statSync')} · {formatTimestamp(lastSyncedAt, t('dashboard.neverSynced'))}
        </p>
        <button
          type="button"
          className={ACTION_CLASS + ' bg-surface text-text hover:bg-surface-muted disabled:opacity-50'}
          data-testid="dashboard-sync-all"
          disabled={syncing}
          onClick={() => void handleSyncAll()}
        >
          <RefreshCw className={syncing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          {t(syncing ? 'dashboard.syncing' : 'dashboard.syncAll')}
        </button>
      </section>
      <details
        key={errorSources.map((source) => source.id).join(',')}
        open={errorSources.length > 0}
        className="rounded-[var(--radius-lg)] border border-border bg-surface"
        data-testid="dashboard-recent-errors"
      >
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-text">
          {t('dashboard.recentErrors')}
          {errorSources.length > 0 ? <span className="ml-2 text-danger">{errorSources.length}</span> : null}
        </summary>
        <div className="border-t border-border p-5">
          {errorSources.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-text-muted">
              <CheckCircle2 className="h-4 w-4 text-success" />
              {t('dashboard.syncHealthy')}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {errorSources.slice(0, 8).map((source) => (
                <li
                  key={source.id}
                  data-testid={'dashboard-error-' + source.id}
                  className="rounded-[var(--radius-md)] border border-danger/30 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm text-text">
                      <AlertTriangle className="mr-1 inline h-4 w-4 text-danger" />
                      {source.categoryName} · {source.name}
                    </span>
                    <Link to="/rules/$id" params={{ id: source.categoryId }} className="shrink-0 text-xs text-primary">
                      {t('dashboard.viewRuleset')}
                    </Link>
                  </div>
                  <p className="mt-1 break-words text-xs text-danger">
                    {source.lastError || t('dashboard.syncPartial')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
        <span>{t('dashboard.rangeLabel')}:</span>
        {(['24h', '7d', '30d'] as const).map((range) => (
          <button
            key={range}
            type="button"
            onClick={() => navigate({ search: { range }, replace: true })}
            aria-pressed={(search.range ?? '7d') === range}
            className="rounded-[var(--radius-sm)] border border-border px-2 py-1"
          >
            {range}
          </button>
        ))}
      </div>
    </div>
  );
}
