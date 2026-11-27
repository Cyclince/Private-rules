import { Link } from '@tanstack/react-router';
import { useI18n } from '../../i18n';
import { SlidingIndicator, useSlidingIndicator } from '../ui/sliding-indicator';
import { MOBILE_NAV_ITEMS } from './nav-items';

export function BottomNav() {
  const { t } = useI18n();
  const { containerRef, rect } = useSlidingIndicator<HTMLElement>({ selector: 'a[data-status="active"]' });
  return (
    <nav
      ref={containerRef}
      data-testid="mobile-bottom-nav"
      aria-label={t('layout.navigation')}
      className="shell-bottom-nav fixed inset-x-0 bottom-0 z-30 grid h-16 grid-cols-5 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <SlidingIndicator rect={rect} dataTestId="bottom-nav-active-indicator" className="bg-primary/12" />
      {MOBILE_NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.to === '/' }}
            className="motion-press relative z-10 flex flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium text-text-muted hover:text-text"
            activeProps={{
              className: 'text-primary nav-item-active',
            }}
          >
            <Icon className="nav-icon h-5 w-5 shrink-0" />
            <span className="truncate">{t(item.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
