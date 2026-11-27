import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/rulesets')({
  beforeLoad: ({ location }) => {
    const params = new URLSearchParams(location.searchStr);
    const search: Record<string, string> = {};
    params.forEach((value, key) => {
      search[key] = value;
    });
    throw redirect({
      to: '/rules',
      search: search as never,
      replace: true,
    });
  },
});
