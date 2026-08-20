import { useCallback, useEffect, useState } from 'react';
import type { ClientLink, DomainRule, DomainRuleType, GeoSourceSuggestion, ImportPreview, ManualRuleOptimizationPreview, RuleConflict, RulesData } from '../../types/domain-rules';
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
  settings: { baseUrl: '', policyName: 'PROXY', githubMirrorUrl: '', publicLinksEnabled: true, tokenLinksEnabled: true, customIconPackUrls: [], customIconPackNames: {}, iconPackAutoUpdate: true, iconPackUpdateIntervalHours: 24, iconPackLastUpdatedAt: '' },
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
    appVersion: '1.0.5',
    authType: undefined as 'session' | 'telegram' | undefined,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);

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
      if (!response.ok) throw new Error('无法加载规则数据，请检查数据库连接');
      const payload = (await response.json()) as { data: RulesData; links: LinksByCategory };
      setData(payload.data);
      setLinks(payload.links);
      if (meResponse.ok) {
        const me = (await meResponse.json()) as typeof meta;
        setMeta(me);
        if (me.authType !== 'telegram') {
          const apiKeysResponse = await fetch('/api/api-keys');
          if (apiKeysResponse.ok) setApiKeys(((await apiKeysResponse.json()) as { keys?: ApiKeySummary[] }).keys ?? []);
        } else {
          setApiKeys([]);
        }
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

  const sourceRequest = useCallback(async (url: string, options: RequestInit) => {
    const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(payload.error ?? '来源操作失败');
    }
    return response.json() as Promise<Record<string, unknown>>;
  }, []);

  const updateCategoryWithSources = useCallback(async (categoryId: string, rawInput: Record<string, unknown>) => {
    const input = { ...rawInput };
    const hasSources = ['sourceUrls', 'geositeNames', 'geoipNames'].some((key) => Object.hasOwn(input, key));
    if (hasSources) {
      const category = data?.categories.find((item) => item.id === categoryId);
      if (!category) throw new Error('分类不存在。');
      const interval = Number(input.syncIntervalMinutes ?? category.syncIntervalMinutes ?? 60);
      const userAgent = String(input.userAgent ?? 'clash-verge/v2.5.1');
      const optimization = input.ruleOptimization as 'none' | 'conservative' | 'aggressive' | undefined;
      const desired = [
        ...((input.sourceUrls as string[] | undefined) ?? []).map((url) => ({ sourceType: 'url' as const, url, userAgent, ruleOptimization: optimization, syncIntervalMinutes: interval })),
        ...((input.geositeNames as string[] | undefined) ?? []).map((geositeName) => ({ sourceType: 'geosite' as const, geositeName, syncIntervalMinutes: interval })),
        ...((input.geoipNames as string[] | undefined) ?? []).map((geoipName) => ({ sourceType: 'geoip' as const, geoipName, syncIntervalMinutes: interval })),
      ];
      const unused = [...(category.sources ?? [])];
      for (const sourceInput of desired) {
        const exactIndex = unused.findIndex((source) => source.sourceType === sourceInput.sourceType
          && (sourceInput.sourceType === 'url' ? source.url === sourceInput.url
            : sourceInput.sourceType === 'geosite' ? source.geositeName === sourceInput.geositeName : source.geoipName === sourceInput.geoipName));
        const sameTypeIndex = unused.findIndex((source) => source.sourceType === sourceInput.sourceType);
        const index = exactIndex >= 0 ? exactIndex : sameTypeIndex;
        const existing = index >= 0 ? unused.splice(index, 1)[0] : undefined;
        if (existing) {
          await sourceRequest(`/api/categories/${categoryId}/sources/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ ...sourceInput, name: existing.name, enabled: existing.enabled }) });
        } else {
          await sourceRequest(`/api/categories/${categoryId}/sources`, { method: 'POST', body: JSON.stringify(sourceInput) });
        }
      }
      // The editor is a complete snapshot of the category's sources. Anything
      // left in `unused` was removed by the user and must be deleted together
      // with its mirrored rules.
      for (const source of unused) {
        await sourceRequest(`/api/categories/${categoryId}/sources/${source.id}`, { method: 'DELETE' });
      }
      for (const key of ['sourceUrls', 'geositeNames', 'geoipNames', 'syncIntervalMinutes', 'userAgent', 'ruleOptimization']) delete input[key];
    }
    await mutate(`/api/categories/${categoryId}`, { method: 'PATCH', body: JSON.stringify(input) });
  }, [data, mutate, sourceRequest]);

  return {
    data,
    links,
    loading,
    error,
    clearError: () => setError(''),
    meta,
    apiKeys,
    can: (_scope: string) => true,
    refresh,
    createCategory: (input: { name: string; icon?: string; description?: string; sourceUrls?: string[]; geositeNames?: string[]; geoipNames?: string[]; syncIntervalMinutes?: number; userAgent?: string; ruleOptimization?: 'none' | 'conservative' | 'aggressive'; tokenLinksEnabled?: boolean; publicLinksEnabled?: boolean }) =>
      mutate('/api/categories', { method: 'POST', body: JSON.stringify(input) }),
    updateCategory: updateCategoryWithSources,
    updateSettings: (input: Record<string, unknown>) =>
      mutate('/api/settings', { method: 'PATCH', body: JSON.stringify(input) }),
    refreshIconPacks: async () => {
      const response = await fetch('/api/icon-packs/refresh', { method: 'POST' });
      const payload = await response.json().catch(() => ({})) as { error?: string; updatedAt?: string; results?: Array<{ url: string; ok: boolean; count: number; error?: string }> };
      if (!response.ok || !payload.updatedAt) throw new Error(payload.error ?? '图标包更新失败');
      return { updatedAt: payload.updatedAt, results: payload.results ?? [] };
    },
    previewManualRuleOptimization: async () => {
      const response = await fetch('/api/settings/manual-rule-optimization');
      const payload = await response.json().catch(() => ({})) as { error?: string; preview?: ManualRuleOptimizationPreview };
      if (!response.ok || !payload.preview) throw new Error(payload.error ?? '规则优化分析失败');
      return payload.preview;
    },
    optimizeManualRules: async () => {
      const response = await mutate('/api/settings/manual-rule-optimization', { method: 'POST' });
      return ((await response.json()) as { preview: ManualRuleOptimizationPreview }).preview;
    },
    deleteCategory: (id: string) => mutate(`/api/categories/${id}`, { method: 'DELETE' }),
    syncAll: () => mutate('/api/sync', { method: 'POST' }),
    syncCategory: (id: string) => mutate(`/api/categories/${id}/sync`, { method: 'POST' }),
    searchGeoSources: async (query: string) => {
      const response = await fetch(`/api/geo/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error('Geo 数据索引加载失败');
      return ((await response.json()) as { results: GeoSourceSuggestion[] }).results;
    },
    loadRules,
    addRule: async (categoryId: string, input: { value: string; type?: DomainRuleType; note?: string; replaceConflicts?: boolean }) => {
      const response = await fetch(`/api/categories/${categoryId}/rules`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      const payload = await response.json().catch(() => ({})) as { error?: string; conflicts?: RuleConflict[]; replaced?: number };
      if (response.status === 409) return { conflicts: payload.conflicts ?? [], replaced: 0 };
      if (!response.ok) throw new Error(payload.error ?? '规则添加失败');
      await refresh(true);
      return { conflicts: [] as RuleConflict[], replaced: payload.replaced ?? 0 };
    },
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
    confirmImport: (categoryId: string, text: string, replaceConflicts = false) =>
      mutate(`/api/categories/${categoryId}/rules/bulk-import`, {
        method: 'POST',
        body: JSON.stringify({ text, confirm: true, replaceConflicts }),
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
    createSource: async (categoryId: string, input: Record<string, unknown>) => {
      const result = await sourceRequest(`/api/categories/${categoryId}/sources`, { method: 'POST', body: JSON.stringify(input) });
      await refresh(true);
      return result;
    },
    previewSource: (categoryId: string, input: Record<string, unknown>) =>
      sourceRequest(`/api/categories/${categoryId}/sources/preview`, { method: 'POST', body: JSON.stringify(input) }),
    updateSource: async (categoryId: string, sourceId: string, input: Record<string, unknown>) => {
      const result = await sourceRequest(`/api/categories/${categoryId}/sources/${sourceId}`, { method: 'PATCH', body: JSON.stringify(input) });
      await refresh(true);
      return result;
    },
    toggleSource: async (categoryId: string, sourceId: string, enabled: boolean) => {
      const result = await sourceRequest(`/api/categories/${categoryId}/sources/${sourceId}/toggle`, { method: 'POST', body: JSON.stringify({ enabled }) });
      await refresh(true);
      return result;
    },
    updateSourceInterval: async (categoryId: string, sourceId: string, syncIntervalMinutes: number) => {
      const result = await sourceRequest(`/api/categories/${categoryId}/sources/${sourceId}/interval`, { method: 'POST', body: JSON.stringify({ syncIntervalMinutes }) });
      await refresh(true);
      return result;
    },
    syncSource: async (categoryId: string, sourceId: string) => {
      const result = await sourceRequest(`/api/categories/${categoryId}/sources/${sourceId}/sync`, { method: 'POST' });
      await refresh(true);
      return result;
    },
    deleteSource: async (categoryId: string, sourceId: string) => {
      const result = await sourceRequest(`/api/categories/${categoryId}/sources/${sourceId}`, { method: 'DELETE' });
      await refresh(true);
      return result;
    },
  };
}
