import { createFileRoute, redirect } from '@tanstack/react-router';

/** Legacy `/templates/scenes` route: the library is now called policy groups (design revision r2 §4.1). */
export const Route = createFileRoute('/templates/scenes')({
  beforeLoad: ({ search }) => {
    const raw = (search ?? {}) as Record<string, unknown>;
    const nextSearch: Record<string, string> = {};
    for (const key of ['q', 'origin', 'category', 'selected'] as const) {
      const value = raw[key];
      if (typeof value === 'string' && value) nextSearch[key] = value;
    }
    throw redirect({
      to: '/templates/groups',
      search: nextSearch,
      replace: true,
    });
  },
  component: () => null,
});
