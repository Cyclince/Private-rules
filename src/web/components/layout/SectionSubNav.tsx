import { Link } from '@tanstack/react-router';
import type { MessageKey } from '../../i18n';
import { useI18n } from '../../i18n';
import type { NavRoutePath } from './nav-items';

type SectionTab = {
  to: NavRoutePath;
  labelKey: MessageKey;
  testId: string;
};

const RULES_TABS: readonly SectionTab[] = [
  { to: '/rulesets', labelKey: 'nav.rulesets', testId: 'subnav-rulesets' },
  { to: '/catalog', labelKey: 'nav.catalog', testId: 'subnav-catalog' },
];

const TEMPLATES_TABS: readonly SectionTab[] = [
  { to: '/cards', labelKey: 'nav.cards', testId: 'subnav-cards' },
  { to: '/templates', labelKey: 'nav.templates', testId: 'subnav-templates' },
  { to: '/publications', labelKey: 'nav.publications', testId: 'subnav-publications' },
];

export function SectionSubNav({ section }: { section: 'rules' | 'templates' }) {
  const { t } = useI18n();
  const tabs = section === 'rules' ? RULES_TABS : TEMPLATES_TABS;

  return (
    <nav
      data-testid={`section-subnav-${section}`}
      className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface p-1 md:hidden"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          data-testid={tab.testId}
          className="flex-1 rounded-[var(--radius-sm)] px-3 py-1.5 text-center text-xs font-medium text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
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
