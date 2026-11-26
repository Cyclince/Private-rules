import { QueryClient, queryOptions } from '@tanstack/react-query';
import type { ClientLink, DomainRule, RulesData } from '../../types/domain-rules';
import { api, readApiJson, type ApiClient } from './api';

export type RulesetSummaryPayload = {
  data: RulesData;
  links: Record<string, ClientLink[]>;
};

export type RulesPageFilter = {
  q?: string;
  source?: 'manual' | 'upstream' | 'url' | 'geo';
  cursor?: string;
  limit?: number;
};

export type RulesPagePayload = {
  rules: DomainRule[];
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
};

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
    rulesPrefix: (id: string) => [...queryKeys.rulesets.all, 'rules', id] as const,
    rules: (id: string, filter?: RulesPageFilter) => [...queryKeys.rulesets.all, 'rules', id, filter ?? {}] as const,
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
      readApiJson<RulesetSummaryPayload>(await client.api.rulesets.$get({ query: { summary: '1' } })),
  });
}

export function rulesetRulesQueryOptions(id: string, filter: RulesPageFilter = {}, client: ApiClient = api) {
  const normalized: RulesPageFilter = {
    ...(filter.q ? { q: filter.q } : {}),
    ...(filter.source ? { source: filter.source } : {}),
    ...(filter.cursor ? { cursor: filter.cursor } : {}),
    limit: filter.limit ?? 50,
  };
  return queryOptions({
    queryKey: queryKeys.rulesets.rules(id, normalized),
    queryFn: async () =>
      readApiJson<RulesPagePayload>(
        await client.api.rulesets[':id'].rules.$get({
          param: { id },
          query: {
            ...(normalized.q ? { q: normalized.q } : {}),
            ...(normalized.source ? { source: normalized.source } : {}),
            ...(normalized.cursor ? { cursor: normalized.cursor } : {}),
            limit: String(normalized.limit ?? 50),
          },
        }),
      ),
  });
}

export function linksQueryOptions(client: ApiClient = api) {
  return queryOptions({
    queryKey: queryKeys.links.all,
    queryFn: async () => readApiJson<{ links: Record<string, ClientLink[]> }>(await client.api.links.$get()),
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
      queryClient.invalidateQueries({ queryKey: queryKeys.rulesets.rulesPrefix(id) }),
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
