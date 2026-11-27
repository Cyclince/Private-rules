import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export type SlidingIndicatorRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type ActiveSelectorOptions = {
  /** Selector for the active child, defaults to Radix tabs state. */
  selector?: string;
  /** Attribute names watched for changes so the indicator follows state updates. */
  watchedAttributes?: string[];
};

/**
 * Measures the active child of a tab/nav list so a single indicator can slide
 * between items. Returns `null` until a layout pass finds an active element.
 *
 * Deliberately avoids `cn`/tailwind-merge: this hook ships in the entry shell
 * (sidebar + bottom nav), which must stay inside the first-screen JS budget.
 */
export function useSlidingIndicator<T extends HTMLElement>({
  selector = '[data-state="active"]',
  watchedAttributes = ['data-state', 'data-active', 'data-status', 'aria-selected', 'aria-checked', 'aria-current'],
}: ActiveSelectorOptions = {}) {
  const containerRef = useRef<T | null>(null);
  const [rect, setRect] = useState<SlidingIndicatorRect | null>(null);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      setRect(null);
      return;
    }
    const active = container.querySelector<HTMLElement>(selector);
    if (!active) {
      setRect(null);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.width === 0 && activeRect.height === 0) {
      setRect(null);
      return;
    }
    const next = {
      left: activeRect.left - containerRect.left - container.clientLeft,
      top: activeRect.top - containerRect.top - container.clientTop,
      width: activeRect.width,
      height: activeRect.height,
    };
    setRect((previous) =>
      previous &&
      Math.abs(previous.left - next.left) < 0.5 &&
      Math.abs(previous.top - next.top) < 0.5 &&
      Math.abs(previous.width - next.width) < 0.5 &&
      Math.abs(previous.height - next.height) < 0.5
        ? previous
        : next,
    );
  }, [selector]);

  useLayoutEffect(() => {
    measure();
    const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(measure) : null;
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [measure]);

  const attributeKey = watchedAttributes.join(',');

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(measure);
    observer.observe(container, { attributes: true, attributeFilter: attributeKey.split(','), subtree: true });
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    resize?.observe(container);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [attributeKey, measure]);

  return { containerRef, rect, measure };
}

export function SlidingIndicator({
  rect,
  className,
  dataTestId,
}: {
  rect: SlidingIndicatorRect | null;
  className?: string;
  dataTestId?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-testid={dataTestId}
      data-visible={rect ? 'true' : 'false'}
      className={[
        'motion-indicator pointer-events-none absolute left-0 top-0 rounded-[var(--radius-sm)]',
        rect ? 'opacity-100' : 'opacity-0',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        rect
          ? {
              width: `${rect.width}px`,
              height: `${rect.height}px`,
              transform: `translate3d(${rect.left}px, ${rect.top}px, 0)`,
            }
          : undefined
      }
    />
  );
}
