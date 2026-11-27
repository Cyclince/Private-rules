import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router';
import { AppShell } from '../components/layout/AppShell';

export type RouterContext = {
  queryClient: QueryClient;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isLoginRoute = pathname === '/login' || pathname === '/admin/login';

  if (isLoginRoute) {
    return <Outlet />;
  }

  return (
    <AppShell>
      <div key={pathname} className="motion-page">
        <Outlet />
      </div>
    </AppShell>
  );
}
