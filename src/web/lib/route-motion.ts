import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  readHistoryIndex,
  resolveNavigationMotion,
  type NavigationLocation,
  type NavigationMotion,
} from './navigation-motion';

type RouterLocationLike = {
  pathname: string;
  state?: { __TSR_index?: unknown } | null;
};

function toNavigationLocation(location: RouterLocationLike | undefined | null): NavigationLocation | null {
  if (!location) return null;
  return { pathname: location.pathname, historyIndex: readHistoryIndex(location.state) };
}

/**
 * Router bridge for M4a page transitions.
 *
 * The router wraps navigations in `document.startViewTransition` (see
 * `defaultViewTransition` in router.ts). This hook runs on `onBeforeNavigate`,
 * which fires before the transition snapshot is taken, and:
 *   - publishes the direction on `<html data-motion-nav>` for the VT pseudo CSS,
 *   - returns the direction for the keyed page wrapper (CSS fallback),
 *   - disables View Transitions for search-only updates (tabs, filters) so those
 *     screens keep their own local motion.
 */
export function useRouteMotion(): NavigationMotion {
  const router = useRouter();
  const [motion, setMotion] = useState<NavigationMotion>('fade');

  useEffect(() => {
    return router.subscribe('onBeforeNavigate', ({ fromLocation, toLocation }) => {
      const previous = toNavigationLocation(fromLocation);
      const next = toNavigationLocation(toLocation);
      if (!next) return;
      const kind = resolveNavigationMotion(previous, next);
      setMotion(kind);
      if (typeof document === 'undefined') return;
      document.documentElement.dataset.motionNav = kind;
      if (previous && previous.pathname === next.pathname) {
        // Same route, only search/hash changed: no full-page snapshot.
        router.shouldViewTransition = false;
        return;
      }
      // Chromium suppresses hit-testing while a view-transition overlay is alive,
      // so any transition still running when the user clicks again delays that
      // click (Playwright waits too, which breaks the unchanged 10k-rule route
      // budget). Keep View Transitions for the direction-rich "enter detail"
      // case where the shared element morph matters; sections, returns and
      // lateral moves use the CSS fallback animations on `.motion-page`.
      router.shouldViewTransition = kind === 'forward';
    });
  }, [router]);

  return motion;
}
