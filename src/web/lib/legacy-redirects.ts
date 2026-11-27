import { redirect } from '@tanstack/react-router';

/**
 * Legacy 1.0.x dashboard deep links (`?view=rules|sources|links|settings`).
 *
 * Loaded on demand from the dashboard route's `beforeLoad` so this branchy
 * redirect table does not sit in the first-screen bundle: only old bookmarks
 * pay for it.
 */
export function legacyDashboardRedirect(
  view: string | undefined,
  category: string | undefined,
): ReturnType<typeof redirect> | null {
  if (view !== 'rules' && view !== 'sources' && view !== 'links' && view !== 'settings') return null;

  if (view === 'rules' || view === 'sources') {
    if (category) {
      return redirect({ to: '/rules/$id', params: { id: category }, replace: true });
    }
    return redirect({ to: '/rules', search: {}, replace: true });
  }
  if (view === 'links') {
    if (category) {
      return redirect({ to: '/subscriptions/$id', params: { id: category }, replace: true });
    }
    return redirect({ to: '/subscriptions', replace: true });
  }
  return redirect({ to: '/settings', search: {}, replace: true });
}
