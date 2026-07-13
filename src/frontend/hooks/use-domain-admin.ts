import { useCallback, useEffect, useState } from 'react';
import type { ClientLink, DomainRule, DomainRuleType, GeoSourceSuggestion, ImportPreview, RulesData } from '../../types/domain-rules';

type LinksByCategory = Record<string, ClientLink[]>;

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
  settings: { baseUrl: '', policyName: 'PROXY', publicLinksEnabled: true, tokenLinksEnabled: true, customIconPackUrls: [], customIconPackNames: {} },
  meta: { d1Ready: false, adminPasswordConfigured: true, ruleTokenConfigured: true, sessionSecretConfigured: true },
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
    d1Ready: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [response, meResponse] = await Promise.all([fetch('/api/categories'), fetch('/api/auth/me')]);
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
      if (!response.ok) throw new Error('无法加载域名数据，请检查 D1 数据库绑定');
      const payload = (await response.json()) as { data: RulesData; links: LinksByCategory };
      setData(payload.data);
      setLinks(payload.links);
      if (meResponse.ok) {
        const me = (await meResponse.json()) as typeof meta;
        setMeta(me);
      }
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

  return {
    data,
    links,
    loading,
    error,
    clearError: () => setError(''),
    meta,
    refresh,
    createCategory: (input: { name: string; icon?: string; description?: string; sourceUrls?: string[]; geositeNames?: string[]; geoipNames?: string[]; syncIntervalMinutes?: number }) =>
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
    addRule: (categoryId: string, input: { value: string; type?: DomainRuleType; note?: string }) =>
      mutate(`/api/categories/${categoryId}/rules`, { method: 'POST', body: JSON.stringify(input) }),
    updateRule: (categoryId: string, rule: DomainRule) =>
      mutate(`/api/categories/${categoryId}/rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify(rule) }),
    deleteRule: (categoryId: string, ruleId: string) =>
      mutate(`/api/categories/${categoryId}/rules/${ruleId}`, { method: 'DELETE' }),
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
      return JSON.stringify(await response.json(), null, 2);
    },
    importData: (json: string) => mutate('/api/data', { method: 'PUT', body: json }),
  };
}
