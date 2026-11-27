import { createFileRoute, redirect } from '@tanstack/react-router';
import { requireAuthBeforeLoad } from '../lib/auth-guard';
import { publicationDetailQueryOptions } from '../lib/query';

export const Route = createFileRoute('/publications')({
  beforeLoad: async ({ context, location, search }) => {
    await requireAuthBeforeLoad(context.queryClient, location.href);
    const raw = (search ?? {}) as Record<string, unknown>;
    const pubId =
      (typeof raw.selected === 'string' && raw.selected) || (typeof raw.id === 'string' && raw.id) || undefined;

    if (pubId) {
      try {
        const detail = await context.queryClient.ensureQueryData(publicationDetailQueryOptions(pubId));
        if (detail.publication?.templateId) {
          throw redirect({
            to: '/templates/$id',
            params: { id: detail.publication.templateId },
            search: { tab: 'output' },
            replace: true,
          });
        }
      } catch (err) {
        // Re-throw TanStack Router redirect; fall through to /templates if lookup failed
        if (err && typeof err === 'object' && 'options' in err) {
          throw err;
        }
      }
    }

    throw redirect({
      to: '/templates',
      replace: true,
    });
  },
  component: () => null,
});
