import type { CSSProperties, SyntheticEvent } from 'react';
import { supportsViewTransitions } from './motion';

/**
 * Shared-element + list entrance helpers (M4a). Kept out of `motion.ts` because
 * they are only used by lazy route chunks and must not weigh down the entry shell.
 */

export const SHARED_ELEMENT_NAMES = {
  rulesIcon: 'shared-rules-icon',
  rulesTitle: 'shared-rules-title',
  subscriptionIcon: 'shared-subscription-icon',
  subscriptionTitle: 'shared-subscription-title',
} as const;

/** Inline style helper: only names elements when the API exists (keeps the fallback DOM clean). */
export function sharedElementStyle(name: string): { viewTransitionName: string } | undefined {
  return supportsViewTransitions() ? { viewTransitionName: name } : undefined;
}

type PrimedElement = { element: HTMLElement; previous: string };

/**
 * Assigns `view-transition-name` to the list card icon/title that was just
 * activated so it morphs into the detail header. Names stay unique because only
 * the clicked card is primed, and the inline style is cleared right after the
 * transition window.
 */
export function primeSharedElements(
  event: Pick<SyntheticEvent, 'currentTarget'>,
  names: { icon?: string; title?: string },
): void {
  if (!supportsViewTransitions()) return;
  const root = event.currentTarget as HTMLElement | null;
  if (!root?.querySelectorAll) return;

  const primed: PrimedElement[] = [];
  const pairs: ReadonlyArray<[string, string | undefined]> = [
    ['[data-shared-icon]', names.icon],
    ['[data-shared-title]', names.title],
  ];
  for (const [selector, name] of pairs) {
    if (!name) continue;
    const element = root.querySelector<HTMLElement>(selector);
    if (!element) continue;
    primed.push({ element, previous: element.style.getPropertyValue('view-transition-name') });
    element.style.setProperty('view-transition-name', name);
  }
  if (primed.length === 0) return;

  window.setTimeout(() => {
    for (const { element, previous } of primed) {
      if (previous) element.style.setProperty('view-transition-name', previous);
      else element.style.removeProperty('view-transition-name');
    }
  }, 600);
}

/** Adds the `--stagger-index` custom property used by the list entrance animation. */
export function staggerStyle(index: number): CSSProperties {
  return { '--stagger-index': String(Math.min(Math.max(index, 0), 7)) } as unknown as CSSProperties;
}
