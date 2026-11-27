import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../../lib/motion';

const DEFAULT_DURATION_MS = 320;

type AnimatedNumberProps = {
  value: number;
  /** Formats the running value; defaults to locale-grouped digits. */
  format?: (value: number) => string;
  durationMs?: number;
  className?: string;
  testId?: string;
};

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

/**
 * Counts from the previous value to the next one in <= 320ms. Reduced motion
 * users get the final value immediately; the value is always the source of
 * truth, the animation only affects the rendered text.
 */
export function AnimatedNumber({
  value,
  format = (next) => next.toLocaleString(),
  durationMs = DEFAULT_DURATION_MS,
  className,
  testId,
}: AnimatedNumberProps) {
  const target = Number.isFinite(value) ? value : 0;
  const [display, setDisplay] = useState(0);
  const displayRef = useRef(0);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    const from = displayRef.current;
    if (from === target || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      setDisplay(target);
      return;
    }
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / Math.max(durationMs, 1));
      const next = Math.round(from + (target - from) * easeOutCubic(progress));
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return (
    <span className={className} data-testid={testId}>
      {format(display)}
    </span>
  );
}
