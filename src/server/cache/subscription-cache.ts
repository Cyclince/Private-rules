import type { PublicationCacheIdentity } from '../../application/publications';
import { listRulesetSlugs } from '../../application/rulesets';
import {
  SUBSCRIPTION_FILE_SUFFIXES,
  subscriptionFileCandidates,
  subscriptionFileNamesForSlug,
} from '../../domain/formatters';
import { slugify } from '../../domain/rules/slug';
import type { Env, SubscriptionCacheStore } from '../../types';

const CACHE_ORIGIN = 'https://cache.private-rules.internal';
export const SUBSCRIPTION_CACHE_CONTROL = 'max-age=300';

type TrackedPublicationKey = {
  url: string;
  publicationId: string;
  slug: string;
  templateId: string;
};

type TrackedSubscriptionKey = {
  url: string;
  slugLower: string;
};

// Tracks recently cached publication keys per store instance so mutations can
// actively call `cache.delete` on affected entries while composite keys also
// prevent stale hits across Worker isolates.
const trackedPublicationKeys = new WeakMap<SubscriptionCacheStore, Map<string, TrackedPublicationKey>>();
const trackedSubscriptionKeys = new WeakMap<SubscriptionCacheStore, Map<string, TrackedSubscriptionKey>>();

function getTrackedMap(cache: SubscriptionCacheStore): Map<string, TrackedPublicationKey> {
  let map = trackedPublicationKeys.get(cache);
  if (!map) {
    map = new Map();
    trackedPublicationKeys.set(cache, map);
  }
  return map;
}

function getTrackedSubscriptionMap(cache: SubscriptionCacheStore): Map<string, TrackedSubscriptionKey> {
  let map = trackedSubscriptionKeys.get(cache);
  if (!map) {
    map = new Map();
    trackedSubscriptionKeys.set(cache, map);
  }
  return map;
}

function resolveCacheStore(env: Env): SubscriptionCacheStore | undefined {
  if (env.SUBSCRIPTION_CACHE) return env.SUBSCRIPTION_CACHE;
  const globalCaches = (globalThis as { caches?: { default?: SubscriptionCacheStore } }).caches;
  return globalCaches?.default;
}

/**
 * Normalizes only the subscription suffix to lowercase while preserving the
 * slug portion's case, preventing cache collisions when two rulesets share a
 * case-insensitive slug (e.g. `Foo` and `foo`).
 */
function normalizeSubscriptionCacheFile(file: string): string {
  const lower = file.toLowerCase();
  for (const [suffix] of SUBSCRIPTION_FILE_SUFFIXES) {
    const lowerSuffix = suffix.toLowerCase();
    if (lower.endsWith(lowerSuffix) && file.length > suffix.length) {
      return `${file.slice(0, -suffix.length)}${lowerSuffix}`;
    }
  }
  return file;
}

function cacheKeyUrl(access: 'public' | 'token', file: string, token?: string): string {
  const normalizedFile = normalizeSubscriptionCacheFile(file);
  if (access === 'token') {
    return `${CACHE_ORIGIN}/sub/${encodeURIComponent(token ?? '')}/${normalizedFile}`;
  }
  return `${CACHE_ORIGIN}/rules/${normalizedFile}`;
}

/**
 * Builds the deterministic cache key URL for a template publication delivery,
 * incorporating publication ID/slug, template version, client, output profile,
 * binding version, and dependency versions (design §15).
 */
export function publicationCacheKeyUrl(identity: PublicationCacheIdentity): string {
  const parts = [
    CACHE_ORIGIN,
    'pub',
    identity.access,
    encodeURIComponent(identity.tokenHash),
    encodeURIComponent(identity.publicationId),
    encodeURIComponent(identity.slug.toLowerCase()),
    `v${identity.templateVersion}`,
    encodeURIComponent(identity.client),
    encodeURIComponent(identity.output),
    identity.experimentalFullConfig ? 'exp-full' : 'safe',
    encodeURIComponent(identity.bindingsVersion),
    encodeURIComponent(identity.depsVersion),
  ];
  if (identity.snapshotsVersion) {
    parts.push(encodeURIComponent(identity.snapshotsVersion));
  }
  return parts.join('/');
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
  matchedSlug?: string,
): Promise<void> {
  const cache = resolveCacheStore(env);
  if (!cache) return;
  const url = cacheKeyUrl(access, file, token);
  const trackedSlug = matchedSlug || subscriptionFileCandidates(file)[0]?.slug || file;
  getTrackedSubscriptionMap(cache).set(url, {
    url,
    slugLower: slugify(trackedSlug).toLowerCase(),
  });
  const putPromise = cache.put(new Request(url), response.clone()).catch(() => undefined);
  if (env.BACKGROUND_TASKS) {
    env.BACKGROUND_TASKS.schedule(putPromise);
  } else {
    await putPromise;
  }
}

export async function matchCachedPublication(
  env: Env,
  identity: PublicationCacheIdentity,
): Promise<Response | undefined> {
  const cache = resolveCacheStore(env);
  if (!cache) return undefined;
  return cache.match(new Request(publicationCacheKeyUrl(identity)));
}

export async function storeCachedPublication(
  env: Env,
  identity: PublicationCacheIdentity,
  response: Response,
): Promise<void> {
  const cache = resolveCacheStore(env);
  if (!cache) return;
  const url = publicationCacheKeyUrl(identity);
  getTrackedMap(cache).set(url, {
    url,
    publicationId: identity.publicationId,
    slug: identity.slug.toLowerCase(),
    templateId: identity.templateId,
  });
  const putPromise = cache.put(new Request(url), response.clone()).catch(() => undefined);
  if (env.BACKGROUND_TASKS) {
    env.BACKGROUND_TASKS.schedule(putPromise);
  } else {
    await putPromise;
  }
}

async function deleteTrackedPublicationEntries(
  cache: SubscriptionCacheStore,
  predicate: (entry: TrackedPublicationKey) => boolean,
): Promise<void> {
  const map = getTrackedMap(cache);
  const matched: string[] = [];
  for (const [url, entry] of map.entries()) {
    if (predicate(entry)) {
      matched.push(url);
      map.delete(url);
    }
  }
  if (matched.length === 0) return;
  await Promise.all(matched.map((url) => cache.delete(new Request(url)))).catch(() => undefined);
}

export async function purgePublicationCacheForIds(env: Env, publicationIds: Iterable<string>): Promise<void> {
  const cache = resolveCacheStore(env);
  if (!cache) return;
  const ids = new Set([...publicationIds].filter(Boolean));
  if (ids.size === 0) return;
  await deleteTrackedPublicationEntries(cache, (entry) => ids.has(entry.publicationId));
}

export async function purgePublicationCacheForSlugs(env: Env, slugs: Iterable<string>): Promise<void> {
  const cache = resolveCacheStore(env);
  if (!cache) return;
  const normalized = new Set([...slugs].filter(Boolean).map((s) => s.toLowerCase()));
  if (normalized.size === 0) return;
  await deleteTrackedPublicationEntries(cache, (entry) => normalized.has(entry.slug));
}

export async function purgePublicationCacheForTemplate(env: Env, templateId: string): Promise<void> {
  const cache = resolveCacheStore(env);
  if (!cache || !templateId) return;
  await deleteTrackedPublicationEntries(cache, (entry) => entry.templateId === templateId);
}

export async function purgeAllPublicationCaches(env: Env): Promise<void> {
  const cache = resolveCacheStore(env);
  if (!cache) return;
  await deleteTrackedPublicationEntries(cache, () => true);
}

export async function purgeSubscriptionCacheForSlugs(env: Env, slugs: Iterable<string>): Promise<void> {
  const cache = resolveCacheStore(env);
  if (!cache) return;
  const uniqueSlugs = [...new Set([...slugs].filter(Boolean))];
  if (uniqueSlugs.length === 0) return;

  const deleteUrls = new Set<string>();
  const normalizedLowerSlugs = new Set<string>();
  for (const slug of uniqueSlugs) {
    const base = slugify(slug);
    const lowerBase = base.toLowerCase();
    normalizedLowerSlugs.add(lowerBase);
    const variants = base === lowerBase ? [base] : [base, lowerBase];
    for (const variant of variants) {
      for (const fileName of subscriptionFileNamesForSlug(variant)) {
        deleteUrls.add(cacheKeyUrl('public', fileName));
        if (env.RULE_TOKEN) {
          deleteUrls.add(cacheKeyUrl('token', fileName, env.RULE_TOKEN));
        }
      }
    }
  }

  const trackedMap = getTrackedSubscriptionMap(cache);
  for (const [url, entry] of trackedMap.entries()) {
    if (normalizedLowerSlugs.has(entry.slugLower)) {
      deleteUrls.add(url);
      trackedMap.delete(url);
    }
  }

  await Promise.all([...deleteUrls].map((url) => cache.delete(new Request(url)))).catch(() => undefined);
  // Ruleset mutations can also affect publications that reference those rulesets.
  await purgeAllPublicationCaches(env);
}

export async function purgeAllSubscriptionCaches(env: Env): Promise<void> {
  const cache = resolveCacheStore(env);
  if (!cache) return;
  const slugs = await listRulesetSlugs(env);
  await purgeSubscriptionCacheForSlugs(env, slugs);
  await purgeAllPublicationCaches(env);
}
