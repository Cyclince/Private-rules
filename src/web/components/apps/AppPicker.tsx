import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { APPS, getApp, type AppDefinition, type AppPlatform, type AppStatus } from '../../../shared/apps';
import { useI18n, type MessageKey } from '../../i18n';
import { AppIcon } from './AppIcon';

export const APP_PICKER_PLATFORMS = ['iphone', 'mac', 'windows', 'android', 'linux-router'] as const;
export type AppPickerPlatform = (typeof APP_PICKER_PLATFORMS)[number];
export type AppPickerMode = 'single' | 'multiple';

export const APP_PICKER_STORAGE_KEY = 'private-rules-app-platform';

const PLATFORM_MATCH: Record<AppPickerPlatform, readonly AppPlatform[]> = {
  iphone: ['ios', 'ipados'],
  mac: ['macos'],
  windows: ['windows'],
  android: ['android'],
  'linux-router': ['linux', 'router'],
};

/** One or two familiar names per platform; text only, never download links (design §3). */
export const APP_PICKER_RECOMMENDATIONS: Record<AppPickerPlatform, readonly string[]> = {
  iphone: ['shadowrocket', 'loon'],
  mac: ['clash-verge-rev', 'surge'],
  windows: ['clash-verge-rev', 'flclash'],
  android: ['flclash', 'clash-meta-android'],
  'linux-router': ['clash-verge-rev', 'openclash'],
};

export function guessAppPickerPlatform(userAgent: string, maxTouchPoints = 0): AppPickerPlatform {
  const ua = userAgent.toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipod') || ua.includes('ipad')) return 'iphone';
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('macintosh') || ua.includes('mac os x')) {
    // iPadOS reports a Macintosh user agent; multi-touch distinguishes it from a real Mac.
    return maxTouchPoints > 1 ? 'iphone' : 'mac';
  }
  if (ua.includes('linux') || ua.includes('x11') || ua.includes('cros')) return 'linux-router';
  return 'iphone';
}

export function readStoredAppPickerPlatform(): AppPickerPlatform | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(APP_PICKER_STORAGE_KEY);
    return stored && (APP_PICKER_PLATFORMS as readonly string[]).includes(stored)
      ? (stored as AppPickerPlatform)
      : null;
  } catch {
    return null;
  }
}

export function writeStoredAppPickerPlatform(platform: AppPickerPlatform): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(APP_PICKER_STORAGE_KEY, platform);
  } catch {
    // Storage can be unavailable (private mode, quota); remembering the platform is optional.
  }
}

export function appMatchesPickerPlatform(app: AppDefinition, platform: AppPickerPlatform): boolean {
  return PLATFORM_MATCH[platform].some((item) => app.platforms.includes(item));
}

export function searchApps(apps: readonly AppDefinition[], query: string): AppDefinition[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...apps];
  return apps.filter(
    (app) =>
      app.name.toLowerCase().includes(needle) || app.aliases.some((alias) => alias.toLowerCase().includes(needle)),
  );
}

/** Visible catalog for a platform: planned software is hidden entirely. */
export function visibleApps(
  platform: AppPickerPlatform,
  query: string,
  apps: readonly AppDefinition[] = APPS,
): AppDefinition[] {
  return searchApps(
    apps.filter((app) => app.status !== 'planned' && appMatchesPickerPlatform(app, platform)),
    query,
  );
}

export function isAppSelectable(app: AppDefinition, mode: AppPickerMode): boolean {
  if (app.status === 'planned') return false;
  // Rules-only software cannot produce a full client config, so it is disabled in template picking.
  return !(mode === 'multiple' && app.status === 'rules-only');
}

export function toggleAppSelection(mode: AppPickerMode, selected: readonly string[], app: AppDefinition): string[] {
  if (app.status === 'planned') return [...selected];
  if (mode === 'single') return [app.id];
  if (!isAppSelectable(app, mode)) return [...selected];
  return selected.includes(app.id) ? selected.filter((id) => id !== app.id) : [...selected, app.id];
}

export type AppPickerKeyAction = { type: 'move'; index: number } | { type: 'select'; index: number } | null;

/** Roving-focus keyboard model for the option list (arrows wrap, Home/End jump, Enter/Space select). */
export function appPickerKeyAction(key: string, activeIndex: number, navigable: readonly number[]): AppPickerKeyAction {
  if (!navigable.length) return null;
  if (key === 'Home') return { type: 'move', index: navigable[0] };
  if (key === 'End') return { type: 'move', index: navigable[navigable.length - 1] };
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
  const position = navigable.indexOf(activeIndex);
  if (step) {
    const base = position >= 0 ? position : step > 0 ? -1 : 0;
    return { type: 'move', index: navigable[(base + step + navigable.length) % navigable.length] };
  }
  if ((key === 'Enter' || key === ' ' || key === 'Spacebar') && position >= 0) {
    return { type: 'select', index: navigable[position] };
  }
  return null;
}

export type AppPickerProps = {
  mode: AppPickerMode;
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** Optional override; storage and user-agent guessing are used otherwise. */
  initialPlatform?: AppPickerPlatform;
  className?: string;
};

/**
 * Shared "which software do you use?" picker (design §3). Controlled component:
 * the parent owns the selection; only the platform choice is remembered locally.
 */
export function AppPicker({ mode, value, onChange, initialPlatform, className = '' }: AppPickerProps) {
  const { t } = useI18n();
  const titleId = useId();
  const searchId = useId();
  const [platform, setPlatform] = useState<AppPickerPlatform>(
    () =>
      initialPlatform ??
      readStoredAppPickerPlatform() ??
      guessAppPickerPlatform(
        typeof navigator === 'undefined' ? '' : navigator.userAgent,
        typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
      ),
  );
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());

  const apps = useMemo(() => visibleApps(platform, query), [platform, query]);
  const navigableIds = useMemo(
    () => apps.filter((app) => isAppSelectable(app, mode)).map((app) => app.id),
    [apps, mode],
  );
  const navigableIndexes = useMemo(
    () => apps.flatMap((app, index) => (isAppSelectable(app, mode) ? [index] : [])),
    [apps, mode],
  );

  useEffect(() => {
    setActiveId((current) => (current && apps.some((app) => app.id === current) ? current : (navigableIds[0] ?? null)));
  }, [apps, navigableIds]);

  const recommendations = useMemo(
    () =>
      APP_PICKER_RECOMMENDATIONS[platform].map((id) => getApp(id)).filter((app): app is AppDefinition => Boolean(app)),
    [platform],
  );

  const selectApp = (app: AppDefinition) => {
    setActiveId(app.id);
    onChange(toggleAppSelection(mode, value, app));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const action = appPickerKeyAction(
      event.key,
      apps.findIndex((app) => app.id === activeId),
      navigableIndexes,
    );
    if (!action) return;
    event.preventDefault();
    const app = apps[action.index];
    if (!app) return;
    if (action.type === 'move') {
      setActiveId(app.id);
      optionRefs.current.get(app.id)?.focus();
      return;
    }
    selectApp(app);
  };

  return (
    <section className={`flex flex-col gap-4 ${className}`} data-testid="app-picker" aria-labelledby={titleId}>
      <div className="flex flex-col gap-1">
        <h3 id={titleId} className="text-base font-semibold text-text">
          {t('apps.picker.title')}
        </h3>
        <p className="text-xs text-text-muted">
          {mode === 'multiple' ? t('apps.picker.multipleHint') : t('apps.picker.singleHint')}
        </p>
      </div>

      <div role="group" aria-label={t('apps.picker.platformLabel')} className="flex flex-wrap gap-2">
        {APP_PICKER_PLATFORMS.map((item) => {
          const selected = platform === item;
          return (
            <button
              key={item}
              type="button"
              aria-pressed={selected}
              data-testid={`app-picker-platform-${item}`}
              onClick={() => {
                setPlatform(item);
                writeStoredAppPickerPlatform(item);
                setQuery('');
              }}
              className={`motion-btn inline-flex h-9 items-center rounded-[var(--radius-sm)] border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary ${
                selected
                  ? 'border-primary bg-primary/15 text-text'
                  : 'border-border bg-surface text-text-muted hover:bg-surface-muted'
              }`}
            >
              {t(`apps.picker.platform.${item}` as MessageKey)}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={searchId} className="sr-only">
          {t('apps.picker.searchLabel')}
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('apps.picker.searchPlaceholder')}
          data-testid="app-picker-search"
          className="h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-sm text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-primary"
        />
      </div>

      {apps.length === 0 ? (
        <p role="status" data-testid="app-picker-empty" className="text-sm text-text-muted">
          {t('apps.picker.emptySearch')}
        </p>
      ) : (
        <div
          role="listbox"
          aria-labelledby={titleId}
          aria-multiselectable={mode === 'multiple' ? true : undefined}
          data-testid="app-picker-list"
          onKeyDown={handleKeyDown}
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
        >
          {apps.map((app) => {
            const selected = value.includes(app.id);
            const selectable = isAppSelectable(app, mode);
            return (
              <button
                key={app.id}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={selectable ? undefined : true}
                tabIndex={activeId === app.id ? 0 : -1}
                ref={(element) => {
                  if (element) optionRefs.current.set(app.id, element);
                  else optionRefs.current.delete(app.id);
                }}
                data-testid={`app-option-${app.id}`}
                onFocus={() => {
                  // A disabled option must never become the roving tab stop.
                  if (selectable) setActiveId(app.id);
                }}
                onClick={() => {
                  if (selectable) selectApp(app);
                }}
                className={`motion-card flex flex-col items-center gap-2 rounded-[var(--radius-md)] border p-3 text-center focus-visible:outline-2 focus-visible:outline-primary ${
                  selected ? 'border-primary bg-primary/10' : 'border-border bg-surface hover:bg-surface-muted/60'
                } ${selectable ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
              >
                <AppIcon app={app} size="md" />
                <span className="min-w-0 text-xs font-medium text-text">{app.name}</span>
                {selected ? (
                  <span aria-hidden="true" className="text-[11px] font-semibold text-primary">
                    ✓
                  </span>
                ) : null}
                {!selectable ? (
                  <span
                    data-testid={`app-option-rules-only-${app.id}`}
                    className="text-[11px] leading-snug text-text-muted"
                  >
                    {t('apps.picker.rulesOnlyHint')}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {mode === 'multiple' ? (
        <p className="text-xs text-text-muted" data-testid="app-picker-selected-count">
          {t('apps.picker.selectedCount').replace('{count}', String(value.length))}
        </p>
      ) : null}

      <details className="rounded-[var(--radius-md)] border border-border bg-surface-muted/40 px-3.5 py-2.5">
        <summary className="cursor-pointer text-sm font-medium text-text">{t('apps.picker.notSureTitle')}</summary>
        <div className="mt-2 flex flex-col gap-3 text-xs leading-relaxed text-text-muted">
          <p>{t('apps.picker.notSureBody')}</p>
          <div>
            <h4 className="text-xs font-semibold text-text">{t('apps.picker.noAppTitle')}</h4>
            <p className="mt-1">{t('apps.picker.noAppBody')}</p>
            <ul data-testid="app-picker-recommendations" className="mt-2 flex flex-wrap gap-1.5">
              {recommendations.map((app) => (
                <li key={app.id} className="rounded-full border border-border bg-surface px-2.5 py-1 text-text">
                  {app.name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </section>
  );
}

/** Re-exported for callers that need the catalog's status vocabulary. */
export type AppPickerStatus = AppStatus;
