import * as React from 'react';
import { cn } from '../../lib/cn';
import { prefersReducedMotion } from '../../lib/motion';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-[var(--radius-sm)] bg-surface-muted', className)} {...props} />;
}

/**
 * Skeleton -> content cross-fade (M4a).
 *
 * The skeleton stays mounted for one short beat while its replacement fades in,
 * so the swap never flashes an empty area. Only opacity/transform animate and
 * reduced-motion users get an instant swap.
 */
export function SkeletonSwap({
  loading,
  skeleton,
  children,
  className,
  testId,
}: {
  loading: boolean;
  skeleton: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  const [showSkeleton, setShowSkeleton] = React.useState(loading);

  React.useEffect(() => {
    if (loading) {
      setShowSkeleton(true);
      return;
    }
    if (!showSkeleton) return;
    const timer = window.setTimeout(() => setShowSkeleton(false), prefersReducedMotion() ? 0 : 120);
    return () => window.clearTimeout(timer);
  }, [loading, showSkeleton]);

  return (
    <div className={cn('relative', className)} data-testid={testId} data-loading={loading ? 'true' : 'false'}>
      <div className={loading ? 'opacity-0' : 'motion-content-in'} aria-busy={loading || undefined}>
        {children}
      </div>
      {showSkeleton ? (
        <div
          aria-hidden={loading ? undefined : 'true'}
          data-state={loading ? 'loading' : 'closing'}
          className={cn(
            'pointer-events-none',
            loading ? 'relative' : 'motion-skeleton-out absolute inset-0 overflow-hidden',
          )}
        >
          {skeleton}
        </div>
      ) : null}
    </div>
  );
}
