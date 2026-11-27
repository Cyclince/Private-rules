import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { useRouteMotion } from '../lib/route-motion';

export type RouterContext = {
  queryClient: QueryClient;
};

/**
 * The application chrome (sidebar, topbar, bottom nav, active-item indicators) is
 * not needed to match a route: splitting it keeps those layout modules out of the
 * first-screen bundle. The chunk is requested as soon as the root renders — in
 * parallel with the route's own auth check — so the first paint is unchanged.
 */
const AppShell = lazy(() => import('../components/layout/AppShell').then((module) => ({ default: module.AppShell })));

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const motion = useRouteMotion();
  const isLoginRoute = pathname === '/login' || pathname === '/admin/login';

  if (isLoginRoute) {
    return <Outlet />;
  }

  return (
    <Suspense fallback={<div aria-hidden="true" className="min-h-screen w-full bg-bg" />}>
      <AppShell>
        <div key={pathname} className="motion-page" data-motion={motion}>
          <Outlet />
        </div>
      </AppShell>
    </Suspense>
  );
}
