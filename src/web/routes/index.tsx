import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import loginBgUrl from '../assets/miku-login-bg.webp';
import { useI18n } from '../i18n';
import { authMeQueryOptions, healthQueryOptions } from '../lib/query';

type DashboardRange = '24h' | '7d' | '30d';

type DashboardSearch = {
  range?: DashboardRange;
};

const VALID_RANGES = new Set<DashboardRange>(['24h', '7d', '30d']);

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): DashboardSearch => {
    const raw = typeof search.range === 'string' ? (search.range as DashboardRange) : undefined;
    return raw && VALID_RANGES.has(raw) ? { range: raw } : {};
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const range: DashboardRange = search.range ?? '7d';
  const navigate = Route.useNavigate();
  const authQuery = useQuery(authMeQueryOptions());
  const healthQuery = useQuery(healthQueryOptions());

  return (
    <div className="flex flex-col gap-5">
      <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface text-text shadow-sm">
        <div className="relative h-40 w-full overflow-hidden border-b border-border bg-surface-muted sm:h-48">
          <img
            src={loginBgUrl}
            alt={t('dashboard.title')}
            className="h-full w-full object-cover object-center opacity-85"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-bg/95 via-bg/50 to-transparent" />
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
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-2">
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
          <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-text-muted">
            range={range}
          </span>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-sm">
          <h3 className="text-base font-semibold leading-snug tracking-tight">{t('dashboard.authStatus')}</h3>
          <p className="mt-1 text-sm text-text-muted">/api/auth/me (deduplicated via TanStack Query)</p>
          <div className="mt-4">
            {authQuery.isLoading ? (
              <div className="h-6 w-28 animate-pulse rounded-[var(--radius-sm)] bg-surface-muted" />
            ) : (
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  authQuery.data?.authenticated
                    ? 'bg-success text-success-foreground'
                    : 'bg-warning text-warning-foreground'
                }`}
              >
                {authQuery.data?.authenticated ? t('dashboard.authenticated') : t('dashboard.guest')}
              </span>
            )}
          </div>
        </section>

        <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-sm">
          <h3 className="text-base font-semibold leading-snug tracking-tight">Runtime</h3>
          <p className="mt-1 text-sm text-text-muted">/health</p>
          <div className="mt-4">
            {healthQuery.isLoading ? (
              <div className="h-6 w-28 animate-pulse rounded-[var(--radius-sm)] bg-surface-muted" />
            ) : (
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    healthQuery.data?.ok ? 'bg-success text-success-foreground' : 'bg-danger text-danger-foreground'
                  }`}
                >
                  {healthQuery.data?.database ?? 'unknown'}
                </span>
                <span className="text-xs text-text-muted">{healthQuery.data?.runtime ?? '-'}</span>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-sm sm:col-span-2 lg:col-span-1">
          <h3 className="text-base font-semibold leading-snug tracking-tight">{t('nav.rulesets')}</h3>
          <p className="mt-1 text-sm text-text-muted">{t('preview.subtitle')}</p>
          <div className="mt-4">
            <span className="inline-flex items-center rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
              M2.2 Shell Ready
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
