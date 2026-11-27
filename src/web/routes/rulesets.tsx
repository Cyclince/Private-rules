import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/rulesets')({
  beforeLoad: ({ location }) => {
    const params = new URLSearchParams(location.searchStr);
    const selected = params.get('selected');
    if (selected) {
      throw redirect({
        to: '/rules/$id',
        params: { id: selected },
        replace: true,
      });
    }
    const q = params.get('q');
    const tab = params.get('tab');
    throw redirect({
      to: '/rules',
      search: {
        ...(q ? { q } : {}),
        ...(tab ? { tab } : {}),
      },
      replace: true,
    });
  },
});
