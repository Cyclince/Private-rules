import { QueryClient, queryOptions } from '@tanstack/react-query';
import type { ClientLink, RulesData } from '../../types/domain-rules';
import { api, readApiJson, type ApiClient } from './api';

export type RulesetSummaryPayload = {
  data: RulesData;
  links: Record<string, ClientLink[]>;
};

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

export const coreQueryKeys = {
  auth: {
    all: ['auth'] as const,
    me: () => ['auth', 'me'] as const,
  },
  health: {
    all: ['health'] as const,
    status: () => ['health', 'status'] as const,
  },
  rulesets: {
    all: ['rulesets'] as const,
    list: () => ['rulesets', 'list'] as const,
    detail: (id: string) => ['rulesets', 'detail', id] as const,
    rulesPrefix: (id: string) => ['rulesets', 'rules', id] as const,
    sources: (id: string) => ['rulesets', 'sources', id] as const,
  },
  links: {
    all: ['links'] as const,
  },
} as const;

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
    queryKey: coreQueryKeys.auth.me(),
    queryFn: async () => readApiJson<AuthMePayload>(await client.api.auth.me.$get()),
  });
}

export function healthQueryOptions(client: ApiClient = api) {
  return queryOptions({
    queryKey: coreQueryKeys.health.status(),
    queryFn: async () => readApiJson<HealthPayload>(await client.health.$get()),
  });
}

export function rulesetsListQueryOptions(client: ApiClient = api) {
  return queryOptions({
    queryKey: coreQueryKeys.rulesets.list(),
    queryFn: async () =>
      readApiJson<RulesetSummaryPayload>(await client.api.rulesets.$get({ query: { summary: '1' } })),
  });
}

export function invalidateAuth(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: coreQueryKeys.auth.all });
}

export function invalidateRulesets(queryClient: QueryClient, id?: string) {
  if (id) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: coreQueryKeys.rulesets.list() }),
      queryClient.invalidateQueries({ queryKey: coreQueryKeys.rulesets.detail(id) }),
      queryClient.invalidateQueries({ queryKey: coreQueryKeys.rulesets.rulesPrefix(id) }),
      queryClient.invalidateQueries({ queryKey: coreQueryKeys.rulesets.sources(id) }),
      queryClient.invalidateQueries({ queryKey: coreQueryKeys.links.all }),
    ]);
  }
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: coreQueryKeys.rulesets.all }),
    queryClient.invalidateQueries({ queryKey: coreQueryKeys.links.all }),
  ]);
}
