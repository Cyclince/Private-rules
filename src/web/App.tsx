import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { I18nProvider } from './i18n';
import { createAppQueryClient } from './lib/query';
import { createAppRouter } from './router';
import { ThemeProvider } from './theme/ThemeProvider';

export function App() {
  const [queryClient] = useState(() => createAppQueryClient());
  const [router] = useState(() => createAppRouter(queryClient));

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <RouterProvider router={router} />
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
