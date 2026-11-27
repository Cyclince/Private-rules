import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/catalog')({
  beforeLoad: ({ search }) => {
    const raw = (search ?? {}) as Record<string, unknown>;
    const nextSearch: Record<string, string> = {};
    for (const key of ['q', 'category'] as const) {
      const value = raw[key];
      if (typeof value === 'string' && value) nextSearch[key] = value;
    }
    throw redirect({
      to: '/templates/scenes',
      search: nextSearch,
      replace: true,
    });
  },
  component: () => null,
});
