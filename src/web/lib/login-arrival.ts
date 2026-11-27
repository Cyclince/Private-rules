/**
 * Login → shell arrival choreography flag.
 *
 * Lives in its own module so the login route can set the flag without importing
 * the application shell (sidebar/topbar/bottom nav) into its own chunk.
 */
export const LOGIN_ARRIVAL_STORAGE_KEY = 'private-rules-login-arrival';

export function markLoginArrival(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(LOGIN_ARRIVAL_STORAGE_KEY, '1');
  } catch {
    // Storage can be unavailable; the arrival animation is optional.
  }
}

/** Reads and clears the flag, returning false for reduced-motion users. */
export function consumeLoginArrivalFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const flag = window.sessionStorage.getItem(LOGIN_ARRIVAL_STORAGE_KEY);
    if (!flag) return false;
    window.sessionStorage.removeItem(LOGIN_ARRIVAL_STORAGE_KEY);
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
