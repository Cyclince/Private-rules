import { useCallback, useState } from 'react';
import { getApp, type AppDefinition } from '../../../shared/apps';

/**
 * The software chosen on the subscription pages (design revision r1 §6: pick once, reuse everywhere).
 * Stored next to the picker's platform memory so the list and the detail page share one choice.
 */
export const SELECTED_APP_STORAGE_KEY = 'private-rules-selected-app';

export function readStoredSelectedAppId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(SELECTED_APP_STORAGE_KEY);
    return stored && getApp(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function writeStoredSelectedAppId(appId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (appId) window.localStorage.setItem(SELECTED_APP_STORAGE_KEY, appId);
    else window.localStorage.removeItem(SELECTED_APP_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode, quota); remembering the app is optional.
  }
}

export type SelectedAppState = {
  appId: string | null;
  app: AppDefinition | null;
  selectApp: (appId: string | null) => void;
};

/** Shared hook: reads the remembered software once and keeps writing it back on change. */
export function useSelectedApp(): SelectedAppState {
  const [appId, setAppId] = useState<string | null>(() => readStoredSelectedAppId());

  const selectApp = useCallback((next: string | null) => {
    setAppId(next);
    writeStoredSelectedAppId(next);
  }, []);

  return { appId, app: appId ? (getApp(appId) ?? null) : null, selectApp };
}
