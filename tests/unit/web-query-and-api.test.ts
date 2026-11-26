import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import type { Env } from '../../src/types';
import { loadLocaleDictionary } from '../../src/web/i18n';
import { ApiClientError, createApiClient, formatApiError, readApiJson } from '../../src/web/lib/api';
import {
  authMeQueryOptions,
  createAppQueryClient,
  healthQueryOptions,
  invalidateAuth,
  invalidateRulesets,
  queryKeys,
  rulesetsListQueryOptions,
} from '../../src/web/lib/query';

describe('M2.2 TanStack Query deduplication and Hono RPC hc<AppType> error mapping', () => {
  it('deduplicates concurrent and cached fetches for the same query key (solving 1.0.x double fetch)', async () => {
    let authMeFetchCount = 0;
    const fakeFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/api/auth/me')) {
        authMeFetchCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 15));
        return new Response(
          JSON.stringify({
            authenticated: true,
            authType: 'session',
            passwordConfigured: true,
            ruleTokenConfigured: true,
            sessionSecretConfigured: true,
            apiKeyConfigured: false,
            d1Ready: true,
            appVersion: '1.1.0-alpha.0',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: false, error: 'not found', code: 'NOT_FOUND' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    };

    const client = createApiClient('http://localhost', fakeFetch);
    const queryClient = createAppQueryClient();

    // Simulate Topbar + DashboardPage + route loader subscribing concurrently
    const [a, b, c] = await Promise.all([
      queryClient.ensureQueryData(authMeQueryOptions(client)),
      queryClient.ensureQueryData(authMeQueryOptions(client)),
      queryClient.fetchQuery(authMeQueryOptions(client)),
    ]);
    expect(a.authenticated).toBe(true);
    expect(b.appVersion).toBe('1.1.0-alpha.0');
    expect(c.d1Ready).toBe(true);
    expect(authMeFetchCount).toBe(1);

    // Subsequent read within staleTime reuses cached data without a second network request
    await queryClient.ensureQueryData(authMeQueryOptions(client));
    expect(authMeFetchCount).toBe(1);

    // Explicit invalidation triggers a fresh fetch on next read
    await invalidateAuth(queryClient);
    await queryClient.fetchQuery(authMeQueryOptions(client));
    expect(authMeFetchCount).toBe(2);
  });

  it('invalidates targeted ruleset detail + list + links without busting unrelated detail caches', async () => {
    const queryClient = createAppQueryClient();
    queryClient.setQueryData(queryKeys.rulesets.list(), { data: { categories: [] } });
    queryClient.setQueryData(queryKeys.rulesets.detail('rs-1'), { id: 'rs-1' });
    queryClient.setQueryData(queryKeys.rulesets.detail('rs-2'), { id: 'rs-2' });
    queryClient.setQueryData(queryKeys.links.all, { links: {} });

    await invalidateRulesets(queryClient, 'rs-1');

    expect(queryClient.getQueryState(queryKeys.rulesets.list())?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.rulesets.detail('rs-1'))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.links.all)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.rulesets.detail('rs-2'))?.isInvalidated).toBe(false);
  });

  it('maps real Hono AppType API errors to localized zh-CN / zh-TW / en messages by ErrorCode', async () => {
    await Promise.all([loadLocaleDictionary('zh-TW'), loadLocaleDictionary('en')]);
    const app = createApp();
    const env = {
      DB: { ping: async () => true },
      ASSETS: { fetch: async () => new Response('<html></html>') },
      RUNTIME: 'node',
      APP_VERSION: '1.1.0-alpha.0',
    } as Env;

    const client = createApiClient('http://localhost', (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return Promise.resolve(app.request(url, init, env));
    });

    const queryClient = createAppQueryClient();
    const health = await queryClient.fetchQuery(healthQueryOptions(client));
    expect(health).toMatchObject({ ok: true, database: 'ok', version: '1.1.0-alpha.0' });

    // Unauthenticated call to /api/rulesets -> 401 UNAUTHENTICATED
    let caught: unknown;
    try {
      await queryClient.fetchQuery(rulesetsListQueryOptions(client));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiClientError);
    const apiErr = caught as ApiClientError;
    expect(apiErr.status).toBe(401);
    expect(apiErr.code).toBe('UNAUTHENTICATED');
    expect(formatApiError(apiErr, 'zh-CN')).toContain('登录');
    expect(formatApiError(apiErr, 'zh-TW')).toContain('登入');
    expect(formatApiError(apiErr, 'en')).toContain('session');

    // Direct 403 CSRF_REJECTED parsing
    const csrfRes = new Response(JSON.stringify({ ok: false, error: 'blocked', code: 'CSRF_REJECTED' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
    await expect(readApiJson(csrfRes)).rejects.toMatchObject({
      status: 403,
      code: 'CSRF_REJECTED',
    });
    expect(formatApiError(new ApiClientError(403, 'CSRF_REJECTED', 'blocked'), 'en')).toContain('Cross-site');
  });
});
