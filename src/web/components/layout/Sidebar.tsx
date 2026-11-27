import { Link } from '@tanstack/react-router';
import { ArrowUpRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import aboutEmblemUrl from '../../assets/miku-about-emblem.webp';
import { useI18n } from '../../i18n';
import { SIDEBAR_NAV_SECTIONS } from './nav-items';

function SidebarBrand() {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 px-4 py-4">
      <img
        src={aboutEmblemUrl}
        alt={t('app.name')}
        className="h-9 w-9 shrink-0 rounded-[var(--radius-sm)] border border-border object-cover"
      />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold tracking-tight text-text">{t('app.name')}</span>
          <span className="inline-flex items-center rounded-full bg-primary px-1.5 py-0 text-[10px] font-medium text-primary-foreground">
            1.1
          </span>
        </div>
        <p className="truncate text-xs text-text-muted">{t('app.previewBadge')}</p>
      </div>
    </div>
  );
}

function SidebarNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t('layout.navigation')} className="flex flex-1 flex-col gap-1 px-3 py-2">
      {SIDEBAR_NAV_SECTIONS.map((section, sectionIndex) => (
        <div
          key={section.id}
          data-testid={`sidebar-section-${section.id}`}
          className={sectionIndex > 0 ? 'mt-2 flex flex-col gap-1' : 'flex flex-col gap-1'}
        >
          {section.groupLabelKey ? (
            <div className="px-3 pb-1 pt-1.5 text-[11px] font-semibold tracking-wider text-text-muted">
              {t(section.groupLabelKey)}
            </div>
          ) : sectionIndex > 0 ? (
            <div className="mx-1 mb-1.5 h-px bg-border" />
          ) : null}
          {section.items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === '/' }}
                onClick={onNavigate}
                className="motion-press flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-medium text-text-muted hover:bg-surface-muted hover:text-text"
                activeProps={{
                  className: 'bg-surface-muted text-primary shadow-sm',
                }}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter() {
  const { locale } = useI18n();
  return (
    <div className="border-t border-border p-3">
      <a
        href="/pwa-install"
        className="motion-press flex items-center justify-between rounded-[var(--radius-md)] px-3 py-2 text-xs font-medium text-text-muted hover:bg-surface-muted hover:text-text"
      >
        <span>{locale === 'en' ? 'Install PWA App' : '安装 PWA 应用'}</span>
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
      </a>
    </div>
  );
}

export function DesktopSidebar() {
  return (
    <aside
      data-testid="desktop-sidebar"
      className="shell-sidebar hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface lg:sticky lg:top-0 lg:flex"
    >
      <SidebarBrand />
      <div className="mx-4 h-px bg-border" />
      <SidebarNavLinks />
      <SidebarFooter />
    </aside>
  );
}

export function TabletSidebarDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [rendered, setRendered] = useState(open);

  useEffect(() => {
    if (open) {
      setRendered(true);
      return;
    }
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setRendered(false);
      return;
    }
    const timer = window.setTimeout(() => setRendered(false), 120);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!rendered) return null;

  const state = open ? 'open' : 'closed';

  return (
    <div
      className="fixed inset-0 z-50 flex lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={t('layout.navigation')}
    >
      <button
        type="button"
        aria-label={t('layout.closeMenu')}
        onClick={onClose}
        data-state={state}
        className="motion-overlay fixed inset-0 bg-black/55 backdrop-blur-[1px]"
      />
      <aside
        data-testid="tablet-sidebar-drawer"
        data-side="left"
        data-state={state}
        className="motion-sheet relative z-10 flex h-full w-64 max-w-[80vw] flex-col border-r border-border bg-surface shadow-lg"
      >
        <div className="flex items-center justify-between pr-2">
          <SidebarBrand />
          <button
            type="button"
            onClick={onClose}
            aria-label={t('layout.closeMenu')}
            className="motion-press inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[var(--radius-md)] text-text-muted hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mx-4 h-px bg-border" />
        <SidebarNavLinks onNavigate={onClose} />
        <SidebarFooter />
      </aside>
    </div>
  );
}
