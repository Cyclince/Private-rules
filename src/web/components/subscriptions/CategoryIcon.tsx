import { cn } from '../../lib/cn';

export function CategoryIcon({
  icon,
  name,
  size = 44,
  className,
}: {
  icon?: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const trimmed = icon?.trim() ?? '';
  const isUrl = Boolean(trimmed && /^https?:\/\//i.test(trimmed));
  const monogram = trimmed || name.trim().slice(0, 2).toUpperCase() || 'PR';

  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-muted text-sm font-bold tracking-tight text-primary',
        className,
      )}
    >
      {isUrl ? (
        <img src={trimmed} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
      ) : (
        <span className="truncate px-1">{monogram}</span>
      )}
    </span>
  );
}
