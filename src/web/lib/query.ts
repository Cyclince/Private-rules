import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { ListCardsResult } from '../../application/cards';
import type { CatalogItem, CatalogItemKind, ListCatalogResult } from '../../application/catalog';
import type { ListPublicationsResult } from '../../application/publications';
import type { ListTemplatesResult } from '../../application/templates';
import type { TemplateVersionRecord, TemplateVersionSummary } from '../../data/repositories';
import type { PublicationWithLinks } from '../../server/routes/publications';
import type { AppCard, CardOrigin, CatalogCategory, Stage } from '../../shared/schemas/card';
import type { TemplateBody, TemplateRecord } from '../../shared/schemas/template';
import type { ClientLink, DomainRule, RuleSettings, RuleSource, RulesData } from '../../types/domain-rules';
import { api, readApiJson, type ApiClient } from './api';
import {
  authMeQueryOptions,
  coreQueryKeys,
  createAppQueryClient,
  healthQueryOptions,
  invalidateAuth,
  invalidateRulesets,
  rulesetsListQueryOptions,
  type AuthMePayload,
  type HealthPayload,
  type RulesetSummaryPayload,
} from './query-core';

export {
  authMeQueryOptions,
  createAppQueryClient,
  healthQueryOptions,
  invalidateAuth,
  invalidateRulesets,
  rulesetsListQueryOptions,
  type AuthMePayload,
  type HealthPayload,
  type RulesetSummaryPayload,
};

export type ApiKeySummary = {
  id: string;
  note: string;
  keyPrefix: string;
  scopes?: string;
  createdAt: string;
  lastUsedAt?: string | null;
};

export type TelegramNotificationsPayload = {
  enabled: boolean;
  preferences: {
    mode: 'immediate' | 'digest' | 'off';
    muted: boolean;
    digestTime: string;
    syncFailed?: boolean;
    syncCompleted?: boolean;
    securityAlerts?: boolean;
  };
};

export type TelegramAuditLogItem = {
  id: string;
  telegram_user_id: string;
  chat_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  summary: string | null;
  result: string;
  created_at: string;
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

export type CatalogFilter = {
  q?: string;
  category?: CatalogCategory;
  provider?: string;
  kind?: CatalogItemKind;
  cursor?: string;
  limit?: number;
};

export type CardsFilter = {
  q?: string;
  category?: CatalogCategory;
  origin?: CardOrigin;
  stage?: Stage;
  cursor?: string;
  limit?: number;
};

export type TemplatesFilter = {
  q?: string;
  cursor?: string;
  limit?: number;
};

export type PublicationsFilter = {
  q?: string;
  templateId?: string;
  cursor?: string;
  limit?: number;
};

export type PublicationsListPayload = Omit<ListPublicationsResult, 'publications'> & {
  publications: PublicationWithLinks[];
  ruleTokenConfigured: boolean;
};

export const queryKeys = {
  auth: coreQueryKeys.auth,
  health: coreQueryKeys.health,
  rulesets: {
    ...coreQueryKeys.rulesets,
    rules: (id: string, filter?: RulesPageFilter) =>
      [...coreQueryKeys.rulesets.all, 'rules', id, filter ?? {}] as const,
  },
  catalog: {
    all: ['catalog'] as const,
    list: (filter?: CatalogFilter) => [...queryKeys.catalog.all, 'list', filter ?? {}] as const,
    detail: (id: string) => [...queryKeys.catalog.all, 'detail', id] as const,
  },
  cards: {
    all: ['cards'] as const,
    list: (filter?: CardsFilter) => [...queryKeys.cards.all, 'list', filter ?? {}] as const,
    detail: (id: string) => [...queryKeys.cards.all, 'detail', id] as const,
  },
  links: coreQueryKeys.links,
  settings: {
    all: ['settings'] as const,
    detail: () => [...queryKeys.settings.all, 'detail'] as const,
    apiKeys: () => [...queryKeys.settings.all, 'api-keys'] as const,
    telegramNotifications: () => [...queryKeys.settings.all, 'telegram-notifications'] as const,
    telegramAuditLogs: () => [...queryKeys.settings.all, 'telegram-audit-logs'] as const,
  },
  templates: {
    all: ['templates'] as const,
    list: (filter?: TemplatesFilter) => [...queryKeys.templates.all, 'list', filter ?? {}] as const,
    detail: (id: string) => [...queryKeys.templates.all, 'detail', id] as const,
    versions: (id: string) => [...queryKeys.templates.all, 'versions', id] as const,
    version: (id: string, version: number) => [...queryKeys.templates.all, 'versions', id, version] as const,
  },
  publications: {
    all: ['publications'] as const,
    list: (filter?: PublicationsFilter) => [...queryKeys.publications.all, 'list', filter ?? {}] as const,
    detail: (id: string) => [...queryKeys.publications.all, 'detail', id] as const,
  },
} as const;

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

export function rulesetSourcesQueryOptions(id: string, client: ApiClient = api) {
  return queryOptions({
    queryKey: queryKeys.rulesets.sources(id),
    queryFn: async () =>
      readApiJson<{ sources: RuleSource[] }>(await client.api.rulesets[':id'].sources.$get({ param: { id } })),
  });
}

export function settingsDetailQueryOptions(client: ApiClient = api) {
  return queryOptions({
    queryKey: queryKeys.settings.detail(),
    queryFn: async () =>
      readApiJson<{ settings: RuleSettings; meta?: RulesData['meta'] }>(await client.api.settings.$get()),
  });
}

export function apiKeysQueryOptions(client: ApiClient = api) {
  return queryOptions({
    queryKey: queryKeys.settings.apiKeys(),
    queryFn: async () => readApiJson<{ keys: ApiKeySummary[] }>(await client.api['api-keys'].$get()),
  });
}

export function telegramNotificationsQueryOptions(client: ApiClient = api) {
  return queryOptions({
    queryKey: queryKeys.settings.telegramNotifications(),
    queryFn: async () => readApiJson<TelegramNotificationsPayload>(await client.api.telegram.notifications.$get()),
  });
}

export function telegramAuditLogsQueryOptions(limit = 30, client: ApiClient = api) {
  return queryOptions({
    queryKey: queryKeys.settings.telegramAuditLogs(),
    queryFn: async () =>
      readApiJson<{ logs: TelegramAuditLogItem[] }>(
        await client.api.telegram['audit-logs'].$get({ query: { limit: String(limit) } }),
      ),
  });
}

export function linksQueryOptions(client: ApiClient = api) {
  return queryOptions({
    queryKey: queryKeys.links.all,
    queryFn: async () => readApiJson<{ links: Record<string, ClientLink[]> }>(await client.api.links.$get()),
  });
}

export function catalogListQueryOptions(filter: CatalogFilter = {}, client: ApiClient = api) {
  const normalized: CatalogFilter = {
    ...(filter.q ? { q: filter.q } : {}),
    ...(filter.category ? { category: filter.category } : {}),
    ...(filter.provider ? { provider: filter.provider } : {}),
    ...(filter.kind ? { kind: filter.kind } : {}),
    ...(filter.cursor ? { cursor: filter.cursor } : {}),
    limit: filter.limit ?? 200,
  };
  return queryOptions({
    queryKey: queryKeys.catalog.list(normalized),
    queryFn: async () =>
      readApiJson<ListCatalogResult>(
        await client.api.catalog.$get({
          query: {
            ...(normalized.q ? { q: normalized.q } : {}),
            ...(normalized.category ? { category: normalized.category } : {}),
            ...(normalized.provider ? { provider: normalized.provider } : {}),
            ...(normalized.kind ? { kind: normalized.kind } : {}),
            ...(normalized.cursor ? { cursor: normalized.cursor } : {}),
            limit: String(normalized.limit ?? 200),
          },
        }),
      ),
  });
}

export function catalogEntryQueryOptions(entryId: string, client: ApiClient = api) {
  return queryOptions({
    queryKey: queryKeys.catalog.detail(entryId),
    queryFn: async () =>
      readApiJson<{ entry: CatalogItem }>(
        await client.api.catalog[':entryId'].$get({ param: { entryId: encodeURIComponent(entryId) } }),
      ),
  });
}

export function cardsListQueryOptions(filter: CardsFilter = {}, client: ApiClient = api) {
  const normalized: CardsFilter = {
    ...(filter.q ? { q: filter.q } : {}),
    ...(filter.category ? { category: filter.category } : {}),
    ...(filter.origin ? { origin: filter.origin } : {}),
    ...(filter.stage ? { stage: filter.stage } : {}),
    ...(filter.cursor ? { cursor: filter.cursor } : {}),
    limit: filter.limit ?? 200,
  };
  return queryOptions({
    queryKey: queryKeys.cards.list(normalized),
    queryFn: async () =>
      readApiJson<ListCardsResult>(
        await client.api.cards.$get({
          query: {
            ...(normalized.q ? { q: normalized.q } : {}),
            ...(normalized.category ? { category: normalized.category } : {}),
            ...(normalized.origin ? { origin: normalized.origin } : {}),
            ...(normalized.stage ? { stage: normalized.stage } : {}),
            ...(normalized.cursor ? { cursor: normalized.cursor } : {}),
            limit: String(normalized.limit ?? 200),
          },
        }),
      ),
  });
}

export function cardDetailQueryOptions(id: string, client: ApiClient = api) {
  return queryOptions({
    queryKey: queryKeys.cards.detail(id),
    queryFn: async () => readApiJson<{ card: AppCard }>(await client.api.cards[':id'].$get({ param: { id } })),
  });
}

export function templatesListQueryOptions(filter: TemplatesFilter = {}, client: ApiClient = api) {
  const normalized: TemplatesFilter = {
    ...(filter.q ? { q: filter.q } : {}),
    ...(filter.cursor ? { cursor: filter.cursor } : {}),
    limit: filter.limit ?? 100,
  };
  return queryOptions({
    queryKey: queryKeys.templates.list(normalized),
    queryFn: async () =>
      readApiJson<ListTemplatesResult>(
        await client.api.templates.$get({
          query: {
            ...(normalized.q ? { q: normalized.q } : {}),
            ...(normalized.cursor ? { cursor: normalized.cursor } : {}),
            limit: String(normalized.limit ?? 100),
          },
        }),
      ),
  });
}

export function templateDetailQueryOptions(id: string, client: ApiClient = api) {
  return queryOptions({
    queryKey: queryKeys.templates.detail(id),
    queryFn: async () =>
      readApiJson<{ template: TemplateRecord; resolvedBody: TemplateBody }>(
        await client.api.templates[':id'].$get({ param: { id } }),
      ),
  });
}

export function templateVersionsQueryOptions(id: string, client: ApiClient = api) {
  return queryOptions({
    queryKey: queryKeys.templates.versions(id),
    queryFn: async () =>
      readApiJson<{ versions: TemplateVersionSummary[] }>(
        await client.api.templates[':id'].versions.$get({ param: { id } }),
      ),
  });
}

export function templateVersionDetailQueryOptions(id: string, version: number, client: ApiClient = api) {
  return queryOptions({
    queryKey: queryKeys.templates.version(id, version),
    queryFn: async () =>
      readApiJson<{ version: TemplateVersionRecord }>(
        await client.api.templates[':id'].versions[':v'].$get({ param: { id, v: String(version) } }),
      ),
  });
}

export function publicationsListQueryOptions(filter: PublicationsFilter = {}, client: ApiClient = api) {
  const normalized: PublicationsFilter = {
    ...(filter.q ? { q: filter.q } : {}),
    ...(filter.templateId ? { templateId: filter.templateId } : {}),
    ...(filter.cursor ? { cursor: filter.cursor } : {}),
    limit: filter.limit ?? 100,
  };
  return queryOptions({
    queryKey: queryKeys.publications.list(normalized),
    queryFn: async () =>
      readApiJson<PublicationsListPayload>(
        await client.api.publications.$get({
          query: {
            ...(normalized.q ? { q: normalized.q } : {}),
            ...(normalized.templateId ? { templateId: normalized.templateId } : {}),
            ...(normalized.cursor ? { cursor: normalized.cursor } : {}),
            limit: String(normalized.limit ?? 100),
          },
        }),
      ),
  });
}

export function publicationDetailQueryOptions(id: string, client: ApiClient = api) {
  return queryOptions({
    queryKey: queryKeys.publications.detail(id),
    queryFn: async () =>
      readApiJson<{ publication: PublicationWithLinks; ruleTokenConfigured: boolean }>(
        await client.api.publications[':id'].$get({ param: { id } }),
      ),
  });
}

export function invalidateSettings(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.settings.all });
}

export function invalidateCards(queryClient: QueryClient, id?: string) {
  if (id) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.cards.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.cards.detail(id) }),
    ]);
  }
  return queryClient.invalidateQueries({ queryKey: queryKeys.cards.all });
}

export function invalidateTemplates(queryClient: QueryClient, id?: string) {
  if (id) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.templates.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.templates.detail(id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.templates.versions(id) }),
    ]);
  }
  return queryClient.invalidateQueries({ queryKey: queryKeys.templates.all });
}

export function invalidatePublications(queryClient: QueryClient, id?: string) {
  if (id) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.publications.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.publications.detail(id) }),
    ]);
  }
  return queryClient.invalidateQueries({ queryKey: queryKeys.publications.all });
}
