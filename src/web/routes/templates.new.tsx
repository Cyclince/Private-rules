import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { loadPageTranslations } from '../i18n';
import { requireAuthBeforeLoad } from '../lib/auth-guard';

const QuickCreateWizard = lazy(() =>
  import('../components/templates/QuickCreateWizard').then((m) => ({ default: m.QuickCreateWizard })),
);

export const Route = createFileRoute('/templates/new')({
  beforeLoad: async ({ context, location }) => {
    await Promise.all([requireAuthBeforeLoad(context.queryClient, location.href), loadPageTranslations()]);
  },
  component: NewTemplateWizardPage,
});

function NewTemplateWizardPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 py-4">
          <div className="h-16 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
          <div className="h-72 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />
        </div>
      }
    >
      <QuickCreateWizard />
    </Suspense>
  );
}
