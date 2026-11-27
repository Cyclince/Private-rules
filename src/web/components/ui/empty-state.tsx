import type * as React from 'react';
import emptyStateUrl from '../../assets/miku-empty-state.webp';
import { cn } from '../../lib/cn';

export type EmptyStateProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
  'data-testid'?: string;
};

export function EmptyState({
  title,
  description,
  action,
  compact = false,
  className,
  'data-testid': testId,
}: EmptyStateProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'flex flex-col items-center justify-center rounded-[var(--radius-md)] border border-dashed border-border bg-surface-muted/40 text-center',
        compact ? 'gap-2.5 px-4 py-6' : 'gap-3 px-6 py-8',
        className,
      )}
    >
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border/70 bg-[#f7fcfc] p-1.5 shadow-sm">
        <img
          src={emptyStateUrl}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className={cn('block h-auto rounded-[var(--radius-md)] object-contain', compact ? 'w-40' : 'w-44 sm:w-48')}
        />
      </div>
      <div className="flex max-w-md flex-col gap-1">
        <p className="text-sm font-medium text-text">{title}</p>
        {description ? <p className="text-xs text-text-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
