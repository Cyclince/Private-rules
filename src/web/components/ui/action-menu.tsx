import { useEffect, useRef, useState, type ReactNode } from 'react';

export type ActionMenuItem = {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  testId?: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect?: () => void;
};

type ActionMenuProps = {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  items: readonly ActionMenuItem[];
  align?: 'start' | 'end';
  menuTestId?: string;
  emptyContent?: ReactNode;
};

/**
 * Zero-dependency accessible popover menu used in place of Radix DropdownMenu
 * on lightweight routes to keep bundle budgets low.
 */
export function ActionMenu({ trigger, items, align = 'start', menuTestId, emptyContent }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-flex">
      {trigger({ open, toggle: () => setOpen((prev) => !prev) })}
      {open ? (
        <div
          role="menu"
          data-state="open"
          data-testid={menuTestId}
          className={`motion-popover absolute top-full z-50 mt-1 min-w-[11rem] overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface p-1 text-text shadow-md ${
            align === 'end' ? 'right-0' : 'left-0'
          }`}
        >
          {items.length > 0
            ? items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  data-testid={item.testId}
                  onClick={() => {
                    if (item.disabled) return;
                    setOpen(false);
                    item.onSelect?.();
                  }}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-sm transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                    item.danger ? 'text-danger hover:bg-danger/10' : 'text-text'
                  }`}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </button>
              ))
            : (emptyContent ?? null)}
        </div>
      ) : null}
    </div>
  );
}
