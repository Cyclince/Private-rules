import { Link } from '@tanstack/react-router';
import type { MessageKey } from '../../i18n';
import { useI18n } from '../../i18n';
import type { NavRoutePath } from './nav-items';

type SectionTab = {
  to: NavRoutePath;
  labelKey: MessageKey;
  testId: string;
  exact?: boolean;
};

const TEMPLATES_TABS: readonly SectionTab[] = [
  { to: '/templates', labelKey: 'nav.templates', testId: 'subnav-templates', exact: true },
  { to: '/templates/groups', labelKey: 'nav.cards', testId: 'subnav-groups' },
];

export function SectionSubNav({ section }: { section: 'templates' }) {
  const { t } = useI18n();
  const tabs = TEMPLATES_TABS;

  return (
    <nav
      data-testid={`section-subnav-${section}`}
      className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface p-1"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          activeOptions={tab.exact ? { exact: true } : undefined}
          data-testid={tab.testId}
          className="motion-press flex-1 whitespace-nowrap rounded-[var(--radius-sm)] px-3 py-1.5 text-center text-xs font-medium text-text-muted hover:bg-surface-muted hover:text-text"
          activeProps={{
            className: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground',
          }}
        >
          {t(tab.labelKey)}
        </Link>
      ))}
    </nav>
  );
}
