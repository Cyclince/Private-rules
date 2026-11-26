import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { api, readApiJson, type ApiClient } from './api';
import { authMeQueryOptions, queryKeys, type AuthMePayload } from './query';
import { isTelegramMiniApp } from './telegram/webapp';

export const TELEGRAM_HIDDEN_SETTINGS_TABS = new Set(['api-keys', 'backup']);

export function isTelegramSession(auth?: AuthMePayload | null): boolean {
  return auth?.authType === 'telegram' || isTelegramMiniApp();
}

export async function ensureAuthenticatedSession(
  queryClient: QueryClient,
  client: ApiClient = api,
): Promise<AuthMePayload> {
  if (isTelegramMiniApp()) {
    try {
      const { authenticateTelegramMiniApp } = await import('./telegram/auth');
      const telegramMe = await authenticateTelegramMiniApp(queryClient, client);
      if (telegramMe?.authenticated) return telegramMe;
    } catch {
      // Fall through to standard auth/me check so invalid initData redirects to login.
    }
  }
  return queryClient.ensureQueryData(authMeQueryOptions(client));
}

export async function requireAuthBeforeLoad(
  queryClient: QueryClient,
  redirectPath: string,
  client: ApiClient = api,
): Promise<AuthMePayload> {
  const me = await ensureAuthenticatedSession(queryClient, client);
  if (!me.authenticated) {
    const cleanRedirect = redirectPath.replace(/^\/admin/, '') || '/';
    throw redirect({
      to: '/login',
      search: cleanRedirect === '/' ? {} : { redirect: cleanRedirect },
    });
  }
  return me;
}

export async function performLogout(
  queryClient: QueryClient,
  authType?: 'session' | 'telegram',
  client: ApiClient = api,
  onNavigate?: () => Promise<void> | void,
): Promise<void> {
  if (authType === 'telegram' || isTelegramMiniApp()) {
    await readApiJson(await client.api.telegram.session.logout.$post());
  } else {
    await readApiJson(await client.api.auth.logout.$post());
  }
  await queryClient.cancelQueries();
  queryClient.setQueryData<AuthMePayload | undefined>(queryKeys.auth.me(), (prev) =>
    prev ? { ...prev, authenticated: false, authType: undefined } : undefined,
  );
  if (onNavigate) {
    await onNavigate();
  }
  queryClient.clear();
}
