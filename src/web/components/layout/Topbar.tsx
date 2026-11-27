import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { LogOut, Menu } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../i18n';
import { isTelegramSession, performLogout } from '../../lib/auth-guard';
import { authMeQueryOptions } from '../../lib/query-core';
import { ROUTE_TITLE_ENTRIES } from './nav-items';

const topbarBtn =
  'items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-transparent text-text transition-colors duration-150 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary cursor-pointer';

export function Topbar({ onOpenTabletSidebar }: { onOpenTabletSidebar: () => void }) {
  const { t } = useI18n();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const authQuery = useQuery(authMeQueryOptions());
  const [loggingOut, setLoggingOut] = useState(false);

  const inTelegram = isTelegramSession(authQuery.data);

  const activeNav =
    ROUTE_TITLE_ENTRIES.find((item) => {
      const normalized = pathname.replace(/^\/admin/, '') || '/';
      return item.path === '/' ? normalized === '/' : normalized.startsWith(item.path);
    }) ?? ROUTE_TITLE_ENTRIES[0];

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await performLogout(queryClient, authQuery.data?.authType, undefined, async () => {
        await navigate({ to: '/login', replace: true });
      });
    } finally {
      setLoggingOut(false);
    }
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
        {authQuery.data?.authenticated ? (
          <span
            data-testid="session-status-badge"
            className="inline-flex items-center rounded-full border border-transparent bg-success px-2.5 py-0.5 text-xs font-medium text-success-foreground"
          >
            {inTelegram ? t('auth.telegramBadge') : t('dashboard.authenticated')}
          </span>
        ) : null}

        {authQuery.data?.authenticated ? (
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            aria-label={t('auth.logout')}
            data-testid="logout-button"
            className={`inline-flex ${topbarBtn} h-8 px-2.5 text-xs font-medium disabled:opacity-50`}
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('auth.logout')}</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}
