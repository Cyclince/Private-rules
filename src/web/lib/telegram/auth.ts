import type { QueryClient } from '@tanstack/react-query';
import { api, readApiJson, type ApiClient } from '../api';
import { authMeQueryOptions, invalidateAuth, type AuthMePayload } from '../query';
import { applyTelegramTheme } from './theme';
import { getTelegramWebApp } from './webapp';

let pendingTelegramAuth: Promise<AuthMePayload | null> | null = null;

/**
 * Exchanges Telegram Mini App `initData` for a short-lived private session
 * cookie via `/api/telegram/session` and hydrates the shared TanStack Query
 * `auth.me` cache (deduplicated across concurrent route guards).
 */
export async function authenticateTelegramMiniApp(
  queryClient: QueryClient,
  client: ApiClient = api,
): Promise<AuthMePayload | null> {
  const webApp = getTelegramWebApp();
  if (!webApp?.initData) return null;

  applyTelegramTheme(webApp);

  if (pendingTelegramAuth) return pendingTelegramAuth;

  pendingTelegramAuth = (async () => {
    const existing = await queryClient.ensureQueryData(authMeQueryOptions(client));
    if (existing.authenticated && existing.authType === 'telegram') {
      return existing;
    }

    const res = await client.api.telegram.session.$post({
      json: { initData: webApp.initData },
    });
    await readApiJson<{ user: { telegramUserId: string }; expiresIn: number }>(res);
    await invalidateAuth(queryClient);
    return queryClient.fetchQuery(authMeQueryOptions(client));
  })().finally(() => {
    pendingTelegramAuth = null;
  });

  return pendingTelegramAuth;
}
