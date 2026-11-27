import { SlidingIndicator, useSlidingIndicator } from '../../ui/sliding-indicator';

export type TemplateDetailTabItem<T extends string> = { id: T; label: string; testId: string };

/**
 * Four-tab bar for the template detail page (design §8, M4a indicator).
 *
 * Mounts only after the template is loaded, so the indicator measures the real
 * buttons on its first layout pass (the page renders a skeleton first).
 */
export function TemplateDetailTabs<T extends string>({
  tabs,
  activeTab,
  ariaLabel,
  onSelect,
}: {
  tabs: ReadonlyArray<TemplateDetailTabItem<T>>;
  activeTab: T;
  ariaLabel: string;
  onSelect: (tab: T) => void;
}) {
  const { containerRef, rect } = useSlidingIndicator<HTMLElement>({ selector: '[data-state="active"]' });

  return (
    <nav
      ref={containerRef}
      aria-label={ariaLabel}
      data-testid="template-detail-tabs"
      data-active-tab={activeTab}
      className="relative grid grid-cols-4 gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1"
    >
      <SlidingIndicator rect={rect} dataTestId="template-detail-tab-indicator" className="bg-primary/12" />
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            data-testid={tab.testId}
            data-state={isActive ? 'active' : 'inactive'}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(tab.id)}
            className={`relative z-10 cursor-pointer rounded-[var(--radius-sm)] px-2 py-2 text-sm font-medium transition-colors ${
              isActive ? 'text-primary' : 'text-text-muted hover:bg-surface-muted hover:text-text'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
