import * as React from 'react';
import { cn } from '../../lib/cn';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Animated height container using the CSS grid-template-rows 0fr -> 1fr technique.
 * Keeps DOM mounted while collapsing so exit height transition completes smoothly.
 */
export function CollapsiblePanel({
  open,
  className,
  innerClassName,
  children,
}: {
  open: boolean;
  className?: string;
  innerClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('motion-collapsible', className)} data-open={open ? 'true' : 'false'} aria-hidden={!open}>
      <div className={cn('motion-collapsible-inner', innerClassName)}>{children}</div>
    </div>
  );
}

type CollapsibleDetailsProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  summary: (open: boolean) => React.ReactNode;
  summaryClassName?: string;
  contentClassName?: string;
  className?: string;
  'data-testid'?: string;
  children: React.ReactNode;
};

/**
 * Semantic `<details>` + `<summary>` disclosure with smooth CSS grid-row height
 * expansion and collapse while preserving native summary click targets.
 */
export function CollapsibleDetails({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  summary,
  summaryClassName,
  contentClassName,
  className,
  'data-testid': testId,
  children,
}: CollapsibleDetailsProps) {
  const isControlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const expanded = isControlled ? controlledOpen : uncontrolledOpen;

  const [renderedOpen, setRenderedOpen] = React.useState(expanded);
  const [visualOpen, setVisualOpen] = React.useState(expanded);

  React.useEffect(() => {
    if (expanded) {
      setRenderedOpen(true);
      if (prefersReducedMotion()) {
        setVisualOpen(true);
        return;
      }
      const frame = window.requestAnimationFrame(() => {
        setVisualOpen(true);
      });
      return () => window.cancelAnimationFrame(frame);
    }

    setVisualOpen(false);
    if (prefersReducedMotion()) {
      setRenderedOpen(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setRenderedOpen(false);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [expanded]);

  const handleToggle = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    const next = !expanded;
    if (!isControlled) {
      setUncontrolledOpen(next);
    }
    onOpenChange?.(next);
  };

  return (
    <details open={renderedOpen} data-testid={testId} data-expanded={expanded ? 'true' : 'false'} className={className}>
      <summary
        onClick={handleToggle}
        aria-expanded={expanded}
        className={cn(
          'flex cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden',
          summaryClassName,
        )}
      >
        {summary(expanded)}
      </summary>
      <div className="motion-collapsible" data-open={visualOpen ? 'true' : 'false'}>
        <div className="motion-collapsible-inner">
          <div className={contentClassName}>{children}</div>
        </div>
      </div>
    </details>
  );
}
