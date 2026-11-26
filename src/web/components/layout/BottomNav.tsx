import { Link } from '@tanstack/react-router';
import { useI18n } from '../../i18n';
import { MOBILE_NAV_ITEMS } from './nav-items';

export function BottomNav() {
  const { t } = useI18n();
  return (
    <nav
      data-testid="mobile-bottom-nav"
      aria-label={t('layout.navigation')}
      className="fixed inset-x-0 bottom-0 z-30 grid h-16 grid-cols-4 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {MOBILE_NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.to === '/' }}
            className="flex flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium text-text-muted transition-colors hover:text-text"
            activeProps={{
              className: 'text-primary',
            }}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className="truncate">{t(item.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
