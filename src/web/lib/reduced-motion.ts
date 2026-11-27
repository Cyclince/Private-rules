/**
 * Tiny reduced-motion probe shared by the entry shell and lazy chunks.
 *
 * Kept separate from `motion.ts` on purpose: the entry shell (theme provider)
 * needs only this check, and must not statically pull the View Transitions
 * helpers into the first-screen bundle (M4a follow-up).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
