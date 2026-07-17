import { useCallback, useEffect, useState } from 'react';
import type { ClientLink, DomainRule, DomainRuleType, GeoSourceSuggestion, ImportPreview, RulesData } from '../../types/domain-rules';
import { UPSTREAM_RULE_PREVIEW_LIMIT } from '../../types/domain-rules';

type LinksByCategory = Record<string, ClientLink[]>;
export type ApiKeySummary = { id: string; note: string; keyPrefix: string; createdAt: string; lastUsedAt?: string };

const demoCategories = ['AI', 'Apple', 'Google', 'YouTube', 'GitHub', 'Cloudflare'].map((name, categoryIndex) => ({
  id: name.toLowerCase(), name, slug: name, icon: name.slice(0, 2).toUpperCase(),
  description: `${name} 相关服务和域名规则`, enabled: true, sortOrder: categoryIndex,
  createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
  rules: Array.from({ length: 3 + categoryIndex }, (_, ruleIndex) => ({
    id: `${name}-${ruleIndex}`, categoryId: name.toLowerCase(), value: `${ruleIndex ? `api${ruleIndex}.` : ''}${name.toLowerCase()}.com`,
    type: 'DOMAIN-SUFFIX' as const, enabled: ruleIndex !== 2, sortOrder: ruleIndex,
    createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
  })),
}));

const localDemoData: RulesData = {
  version: 1,
  settings: { baseUrl: '', policyName: 'PROXY', githubMirrorUrl: '', publicLinksEnabled: true, tokenLinksEnabled: true, customIconPackUrls: [], customIconPackNames: {} },
  meta: { d1Ready: false, adminPasswordConfigured: true, ruleTokenConfigured: true, sessionSecretConfigured: true, apiKeyConfigured: false },
  categories: demoCategories,
  updatedAt: '2026-07-13T00:00:00.000Z',
};

export function useDomainAdmin() {
  const [data, setData] = useState<RulesData | null>(null);
  const [links, setLinks] = useState<LinksByCategory>({});
  const [meta, setMeta] = useState({
    authenticated: false,
    passwordConfigured: false,
    ruleTokenConfigured: false,
    sessionSecretConfigured: false,
    apiKeyConfigured: false,
    d1Ready: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [response, meResponse, apiKeysResponse] = await Promise.all([fetch('/api/categories'), fetch('/api/auth/me'), fetch('/api/api-keys')]);
      if (response.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      if (!response.ok && import.meta.env.DEV) {
        setData(localDemoData);
        setLinks({});
        setError('');
        return;
      }
      if (!response.ok) throw new Error('无法加载规则数据，请检查数据库连接');
      const payload = (await response.json()) as { data: RulesData; links: LinksByCategory };
      setData(payload.data);
      setLinks(payload.links);
      if (meResponse.ok) {
        const me = (await meResponse.json()) as typeof meta;
        setMeta(me);
      }
      if (apiKeysResponse.ok) setApiKeys(((await apiKeysResponse.json()) as { keys?: ApiKeySummary[] }).keys ?? []);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (url: string, options: RequestInit) => {
      const response = await fetch(url, {
        ...options,
        headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        const message = payload.error ?? '操作失败';
        setError(message);
        throw new Error(message);
      }
      await refresh(true);
      return response;
    },
    [refresh],
  );

  const loadRules = useCallback(async (options: { categoryId?: string; query?: string; source?: 'manual' | 'upstream' | 'url' | 'geo'; all?: boolean }, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (options.categoryId) params.set('categoryId', options.categoryId);
    if (options.query) params.set('q', options.query);
    if (options.source) params.set('source', options.source);
    if (options.all) params.set('all', '1');
    else params.set('limit', String(UPSTREAM_RULE_PREVIEW_LIMIT));
    const response = await fetch(`/api/rules?${params.toString()}`, { signal });
    if (!response.ok) throw new Error('规则加载失败');
    return ((await response.json()) as { rules: DomainRule[] }).rules;
  }, []);

  return {
    data,
    links,
    loading,
    error,
    clearError: () => setError(''),
    meta,
    apiKeys,
    refresh,
    createCategory: (input: { name: string; icon?: string; description?: string; sourceUrls?: string[]; geositeNames?: string[]; geoipNames?: string[]; syncIntervalMinutes?: number; userAgent?: string; ruleOptimization?: 'none' | 'conservative' | 'aggressive'; tokenLinksEnabled?: boolean; publicLinksEnabled?: boolean }) =>
      mutate('/api/categories', { method: 'POST', body: JSON.stringify(input) }),
    updateCategory: (id: string, input: Record<string, unknown>) =>
      mutate(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    updateSettings: (input: Record<string, unknown>) =>
      mutate('/api/settings', { method: 'PATCH', body: JSON.stringify(input) }),
    deleteCategory: (id: string) => mutate(`/api/categories/${id}`, { method: 'DELETE' }),
    syncAll: () => mutate('/api/sync', { method: 'POST' }),
    syncCategory: (id: string) => mutate(`/api/categories/${id}/sync`, { method: 'POST' }),
    searchGeoSources: async (query: string) => {
      const response = await fetch(`/api/geo/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error('Geo 数据索引加载失败');
      return ((await response.json()) as { results: GeoSourceSuggestion[] }).results;
    },
    loadRules,
    addRule: (categoryId: string, input: { value: string; type?: DomainRuleType; note?: string }) =>
      mutate(`/api/categories/${categoryId}/rules`, { method: 'POST', body: JSON.stringify(input) }),
    updateRule: (categoryId: string, rule: DomainRule) =>
      mutate(`/api/categories/${categoryId}/rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify(rule) }),
    deleteRule: (categoryId: string, ruleId: string) =>
      mutate(`/api/categories/${categoryId}/rules/${ruleId}`, { method: 'DELETE' }),
    batchRules: (categoryId: string, ruleIds: string[], action: 'enable' | 'disable' | 'delete') =>
      mutate(`/api/categories/${categoryId}/rules/batch`, { method: 'POST', body: JSON.stringify({ ruleIds, action }) }),
    importPreview: async (categoryId: string, text: string) => {
      const response = await fetch(`/api/categories/${categoryId}/rules/bulk-import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, confirm: false }),
      });
      return response.json() as Promise<{ preview: ImportPreview }>;
    },
    confirmImport: (categoryId: string, text: string) =>
      mutate(`/api/categories/${categoryId}/rules/bulk-import`, {
        method: 'POST',
        body: JSON.stringify({ text, confirm: true }),
      }),
    exportData: async () => {
      const response = await fetch('/api/data');
      if (!response.ok) throw new Error('备份导出失败');
      return JSON.stringify(await response.json());
    },
    importData: (json: string) => mutate('/api/data', { method: 'PUT', body: json }),
    createApiKey: async (note: string) => {
      const response = await fetch('/api/api-keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note }) });
      const payload = (await response.json().catch(() => ({}))) as { id?: string; apiKey?: string; note?: string; keyPrefix?: string; createdAt?: string; error?: string };
      if (!response.ok || !payload.apiKey) throw new Error(payload.error ?? 'API Key 生成失败');
      await refresh(true);
      return payload;
    },
    deleteApiKey: (keyId: string) => mutate(`/api/api-keys/${keyId}`, { method: 'DELETE' }),
    updateApiKeyNote: (keyId: string, note: string) => mutate(`/api/api-keys/${keyId}`, { method: 'PATCH', body: JSON.stringify({ note }) }),
  };
}
