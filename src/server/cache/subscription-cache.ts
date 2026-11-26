import { listRulesetSlugs } from '../../application/rulesets';
import { subscriptionFileNamesForSlug } from '../../domain/formatters';
import type { Env, SubscriptionCacheStore } from '../../types';

const CACHE_ORIGIN = 'https://cache.private-rules.internal';
export const SUBSCRIPTION_CACHE_CONTROL = 'max-age=300';

function resolveCacheStore(env: Env): SubscriptionCacheStore | undefined {
  if (env.SUBSCRIPTION_CACHE) return env.SUBSCRIPTION_CACHE;
  const globalCaches = (globalThis as { caches?: { default?: SubscriptionCacheStore } }).caches;
  return globalCaches?.default;
}

function cacheKeyUrl(access: 'public' | 'token', file: string, token?: string): string {
  const normalizedFile = file.toLowerCase();
  if (access === 'token') {
    return `${CACHE_ORIGIN}/sub/${encodeURIComponent(token ?? '')}/${normalizedFile}`;
  }
  return `${CACHE_ORIGIN}/rules/${normalizedFile}`;
}

export async function computeSubscriptionEtag(body: string, contentType: string): Promise<string> {
  const payload = new TextEncoder().encode(`${contentType}\0${body}`);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `"${hex.slice(0, 24)}"`;
}

function normalizeEtag(value: string): string {
  return value.trim().replace(/^W\//i, '');
}

export function matchesIfNoneMatch(headerValue: string | undefined, etag: string): boolean {
  if (!headerValue?.trim()) return false;
  const target = normalizeEtag(etag);
  return headerValue
    .split(',')
    .map((item) => item.trim())
    .some((candidate) => candidate === '*' || normalizeEtag(candidate) === target);
}

export async function matchCachedSubscription(
  env: Env,
  access: 'public' | 'token',
  file: string,
  token?: string,
): Promise<Response | undefined> {
  const cache = resolveCacheStore(env);
  if (!cache) return undefined;
  return cache.match(new Request(cacheKeyUrl(access, file, token)));
}

export async function storeCachedSubscription(
  env: Env,
  access: 'public' | 'token',
  file: string,
  response: Response,
  token?: string,
): Promise<void> {
  const cache = resolveCacheStore(env);
  if (!cache) return;
  const putPromise = cache.put(new Request(cacheKeyUrl(access, file, token)), response.clone()).catch(() => undefined);
  if (env.BACKGROUND_TASKS) {
    env.BACKGROUND_TASKS.schedule(putPromise);
  } else {
    await putPromise;
  }
}

export async function purgeSubscriptionCacheForSlugs(env: Env, slugs: Iterable<string>): Promise<void> {
  const cache = resolveCacheStore(env);
  if (!cache) return;
  const uniqueSlugs = [...new Set([...slugs].filter(Boolean))];
  if (uniqueSlugs.length === 0) return;

  const deletions: Array<Promise<boolean>> = [];
  for (const slug of uniqueSlugs) {
    for (const fileName of subscriptionFileNamesForSlug(slug)) {
      deletions.push(cache.delete(new Request(cacheKeyUrl('public', fileName))));
      if (env.RULE_TOKEN) {
        deletions.push(cache.delete(new Request(cacheKeyUrl('token', fileName, env.RULE_TOKEN))));
      }
    }
  }
  await Promise.all(deletions).catch(() => undefined);
}

export async function purgeAllSubscriptionCaches(env: Env): Promise<void> {
  const cache = resolveCacheStore(env);
  if (!cache) return;
  const slugs = await listRulesetSlugs(env);
  await purgeSubscriptionCacheForSlugs(env, slugs);
}
