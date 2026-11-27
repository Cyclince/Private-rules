import type { AppDefinition } from '../../../shared/apps';

export type AppIconSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<AppIconSize, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-14 w-14 text-lg',
};

/**
 * Existing design-token accent pairs. Each background has a matching foreground token,
 * and both themes are audited by tests/unit/contrast.test.ts at WCAG AA (>= 4.5:1).
 */
export const APP_ICON_TONES = [
  { background: 'var(--primary)', foreground: 'var(--primary-foreground)' },
  { background: 'var(--accent)', foreground: 'var(--accent-foreground)' },
  { background: 'var(--success)', foreground: 'var(--success-foreground)' },
  { background: 'var(--warning)', foreground: 'var(--warning-foreground)' },
  { background: 'var(--danger)', foreground: 'var(--danger-foreground)' },
] as const;

/** Stable, dependency-free hash so an app always gets the same tone across sessions. */
export function appToneIndex(id: string): number {
  let hash = 0;
  for (const character of id) {
    hash = (Math.imul(hash, 31) + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash % APP_ICON_TONES.length;
}

export function appInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase() : '?';
}

type AppIconProps = {
  app: Pick<AppDefinition, 'id' | 'name'> & { icon?: string };
  size?: AppIconSize;
  className?: string;
};

/**
 * Shows licensed artwork when present, otherwise a letter/Han badge (design §2.1 fallback).
 * The badge is decorative; callers always render the software name next to it.
 */
export function AppIcon({ app, size = 'md', className = '' }: AppIconProps) {
  const tone = APP_ICON_TONES[appToneIndex(app.id)];
  return (
    <span
      data-testid={`app-icon-${app.id}`}
      data-tone={appToneIndex(app.id)}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-border ${SIZE_CLASS[size]} ${className}`}
      style={app.icon ? undefined : { backgroundColor: tone.background, color: tone.foreground }}
    >
      {app.icon ? (
        <img src={app.icon} alt={app.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden="true" className="font-semibold leading-none">
          {appInitial(app.name)}
        </span>
      )}
    </span>
  );
}
