import { createFileRoute } from '@tanstack/react-router';
import { QuickCreateWizard } from '../components/templates/QuickCreateWizard';
import { loadPageTranslations } from '../i18n';
import { requireAuthBeforeLoad } from '../lib/auth-guard';

export const Route = createFileRoute('/templates/new')({
  beforeLoad: async ({ context, location }) => {
    await Promise.all([requireAuthBeforeLoad(context.queryClient, location.href), loadPageTranslations()]);
  },
  component: NewTemplateWizardPage,
});

function NewTemplateWizardPage() {
  return <QuickCreateWizard />;
}
