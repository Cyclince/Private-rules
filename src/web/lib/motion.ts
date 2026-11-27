/**
 * View Transitions integration helpers (M4a), entry-shell edition.
 *
 * Direction is published on `<html data-motion-nav>` by the route-motion bridge,
 * so CSS can style `::view-transition-old(root)` without relying on
 * `:active-view-transition-type()` support. Shared-element helpers live in
 * `shared-element.ts` so lazy route chunks carry them, not the entry shell.
 */

import { prefersReducedMotion } from './reduced-motion';

export function supportsViewTransitions(): boolean {
  return typeof document !== 'undefined' && typeof document.startViewTransition === 'function';
}

export { prefersReducedMotion } from './reduced-motion';

/** View Transitions are skipped entirely for users who ask for reduced motion. */
export function startThemeViewTransition(update: () => void): boolean {
  if (!supportsViewTransitions() || prefersReducedMotion()) return false;
  document.startViewTransition(update);
  return true;
}

/**
 * Wraps `document.startViewTransition` before the router mounts:
 * - skips an in-flight transition when a new navigation starts, so fast
 *   successive navigations are not delayed by the previous page's animation;
 * - consumes the `ready` rejection Chrome raises for skipped transitions. The
 *   router only awaits `updateCallbackDone`, so otherwise that rejection shows
 *   up as an unhandled page error even though the navigation succeeds.
 */
export function installViewTransitionTuning(): void {
  if (!supportsViewTransitions()) return;
  type StartViewTransition = Document['startViewTransition'];
  const original = document.startViewTransition.bind(document);
  let active: ViewTransition | null = null;

  document.startViewTransition = ((callbackOptions?: Parameters<StartViewTransition>[0]) => {
    active?.skipTransition();
    active = null;
    const transition = original(callbackOptions);
    active = transition;
    void transition.ready.catch(() => undefined);
    void transition.finished
      .then(() => {
        if (active === transition) active = null;
      })
      .catch(() => undefined);
    return transition;
  }) as StartViewTransition;
}

/** Marks the document as View-Transitions capable so CSS can pick the right page animation. */
export function markViewTransitionSupport(): void {
  if (typeof document === 'undefined') return;
  if (supportsViewTransitions()) {
    document.documentElement.classList.add('vt-ready');
  } else {
    document.documentElement.classList.remove('vt-ready');
  }
}
