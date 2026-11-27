import type { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export function createAppRouter(queryClient: QueryClient, basepath = '/admin') {
  return createRouter({
    routeTree,
    basepath,
    context: { queryClient },
    defaultPreload: 'intent',
    // M4a: wrap navigations in the View Transitions API where available. Direction is
    // published by useRouteMotion before the snapshot; unsupported browsers use CSS.
    defaultViewTransition: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
