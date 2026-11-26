import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { lazy, Suspense, useState } from 'react';
import { I18nProvider } from './i18n';
import { createAppQueryClient } from './lib/query';
import { ToastStateProvider } from './lib/toast';
import { createAppRouter } from './router';
import { ThemeProvider } from './theme/ThemeProvider';

const PwaInstallPage = lazy(() => import('./pages/PwaInstallPage').then((m) => ({ default: m.PwaInstallPage })));

function isPwaInstallPath(): boolean {
  return typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/pwa-install';
}

export function App() {
  const [queryClient] = useState(() => createAppQueryClient());
  const [router] = useState(() => createAppRouter(queryClient));

  if (isPwaInstallPath()) {
    return (
      <ThemeProvider>
        <I18nProvider>
          <Suspense fallback={null}>
            <PwaInstallPage />
          </Suspense>
        </I18nProvider>
      </ThemeProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <ToastStateProvider>
            <RouterProvider router={router} />
          </ToastStateProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
