import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { Globe, Menu, Moon, Sun } from 'lucide-react';
import { SUPPORTED_LOCALES, useI18n, type Locale } from '../../i18n';
import { authMeQueryOptions } from '../../lib/query';
import { useTheme } from '../../theme/ThemeProvider';
import { SIDEBAR_NAV_ITEMS } from './nav-items';

const topbarBtn =
  'items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-transparent text-text transition-colors duration-150 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary cursor-pointer';

export function Topbar({ onOpenTabletSidebar }: { onOpenTabletSidebar: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const authQuery = useQuery(authMeQueryOptions());

  const activeNav =
    SIDEBAR_NAV_ITEMS.find((item) => {
      const normalized = pathname.replace(/^\/preview/, '') || '/';
      return item.to === '/' ? normalized === '/' : normalized.startsWith(item.to);
    }) ?? SIDEBAR_NAV_ITEMS[0];

  const cycleLocale = () => {
    const idx = SUPPORTED_LOCALES.indexOf(locale);
    const next: Locale = SUPPORTED_LOCALES[(idx + 1) % SUPPORTED_LOCALES.length];
    setLocale(next);
  };

  return (
    <header
      data-testid="app-topbar"
      className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface/90 px-4 backdrop-blur sm:px-6"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={onOpenTabletSidebar}
          aria-label={t('layout.openMenu')}
          data-testid="tablet-sidebar-toggle"
          className={`${topbarBtn} hidden h-9 w-9 md:inline-flex lg:hidden`}
        >
          <Menu className="h-4 w-4" />
        </button>
        <h1 className="truncate text-base font-semibold tracking-tight text-text">{t(activeNav.labelKey)}</h1>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {authQuery.data ? (
          <span
            className={`hidden items-center rounded-full border px-2.5 py-0.5 text-xs font-medium sm:inline-flex ${
              authQuery.data.authenticated
                ? 'border-transparent bg-success text-success-foreground'
                : 'border-border bg-transparent text-text-muted'
            }`}
          >
            {authQuery.data.authenticated ? t('dashboard.authenticated') : t('dashboard.guest')}
          </span>
        ) : null}

        <button
          type="button"
          onClick={cycleLocale}
          aria-label={t('lang.label')}
          data-testid="locale-toggle"
          className={`inline-flex ${topbarBtn} h-8 px-2.5 text-xs font-medium`}
        >
          <Globe className="h-3.5 w-3.5" />
          <span>{t(`lang.${locale}`)}</span>
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={t('theme.toggle')}
          data-testid="theme-toggle"
          className={`inline-flex ${topbarBtn} h-9 w-9`}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}
