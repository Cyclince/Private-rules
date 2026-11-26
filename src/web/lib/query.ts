import { QueryClient, queryOptions } from '@tanstack/react-query';
import { api, readApiJson, type ApiClient } from './api';

export const queryKeys = {
  auth: {
    all: ['auth'] as const,
    me: () => [...queryKeys.auth.all, 'me'] as const,
  },
  health: {
    all: ['health'] as const,
    status: () => [...queryKeys.health.all, 'status'] as const,
  },
  rulesets: {
    all: ['rulesets'] as const,
    list: () => [...queryKeys.rulesets.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.rulesets.all, 'detail', id] as const,
    rules: (id: string, filter?: { q?: string; source?: string }) =>
      [...queryKeys.rulesets.all, 'rules', id, filter ?? {}] as const,
    sources: (id: string) => [...queryKeys.rulesets.all, 'sources', id] as const,
  },
  links: {
    all: ['links'] as const,
  },
  settings: {
    all: ['settings'] as const,
    detail: () => [...queryKeys.settings.all, 'detail'] as const,
    apiKeys: () => [...queryKeys.settings.all, 'api-keys'] as const,
  },
  templates: {
    all: ['templates'] as const,
    list: () => [...queryKeys.templates.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.templates.all, 'detail', id] as const,
  },
  publications: {
    all: ['publications'] as const,
    list: () => [...queryKeys.publications.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.publications.all, 'detail', id] as const,
  },
} as const;

export type AuthMePayload = {
  authenticated: boolean;
  authType?: 'session' | 'telegram';
  passwordConfigured: boolean;
  ruleTokenConfigured: boolean;
  sessionSecretConfigured: boolean;
  apiKeyConfigured: boolean;
  d1Ready: boolean;
  appVersion: string;
};

export type HealthPayload = {
  ok: boolean;
  database: 'ok' | 'unavailable';
  runtime: string;
  version: string;
};

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function authMeQueryOptions(client: ApiClient = api) {
  return queryOptions({
    queryKey: queryKeys.auth.me(),
    queryFn: async () => readApiJson<AuthMePayload>(await client.api.auth.me.$get()),
  });
}

export function healthQueryOptions(client: ApiClient = api) {
  return queryOptions({
    queryKey: queryKeys.health.status(),
    queryFn: async () => readApiJson<HealthPayload>(await client.health.$get()),
  });
}

export function rulesetsListQueryOptions(client: ApiClient = api) {
  return queryOptions({
    queryKey: queryKeys.rulesets.list(),
    queryFn: async () =>
      readApiJson<{
        data: { categories: Array<{ id: string; name: string; slug: string; ruleCount?: number }> };
      }>(await client.api.rulesets.$get()),
  });
}

export function invalidateAuth(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.auth.all });
}

export function invalidateRulesets(queryClient: QueryClient, id?: string) {
  if (id) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.rulesets.list() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.rulesets.detail(id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.links.all }),
    ]);
  }
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.rulesets.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.links.all }),
  ]);
}

export function invalidateSettings(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.settings.all });
}
