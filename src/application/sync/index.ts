import { createRepositories, type SourceRow } from '../../data/repositories';
import { compactRules } from '../../domain/rules/compactor';
import { parseBulkImport } from '../../domain/rules/parser';
import { id } from '../../domain/rules/slug';
import { safeFetchText } from '../../infrastructure/http/fetch';
import { createLogger, redactString } from '../../infrastructure/logging/logger';
import { loadGeositeRules } from '../../lib/geosite';
import { rewriteGithubUrl } from '../../lib/github-mirror';
import { AppError } from '../../shared/errors';
import type { Env } from '../../types';
import { now } from '../rulesets';
import { getSettings } from '../settings';

export type SyncResult = {
  sourceId: string;
  categoryId: string;
  name: string;
  ok: boolean;
  count: number;
  originalCount?: number;
  optimized?: boolean;
  error?: string;
  syncedAt: string;
};

export const MAX_CONCURRENT_HOSTS = 4;
const LEASE_TTL_MS = 15 * 60_000;
const STALE_SOURCE_ERROR = '来源已删除或所属分类已变更，已取消同步';

const logger = createLogger({ component: 'sync' });

export function isSourceDue(
  source: {
    last_synced_at?: string | null;
    lastSyncedAt?: string | null;
    sync_interval_minutes?: number | null;
    syncIntervalMinutes?: number | null;
  },
  force = false,
  nowMs = Date.now(),
): boolean {
  const lastSyncedAt = source.lastSyncedAt ?? source.last_synced_at;
  const intervalMinutes = source.syncIntervalMinutes ?? source.sync_interval_minutes ?? 60;
  if (force || !lastSyncedAt) return true;
  const lastSync = Date.parse(lastSyncedAt);
  return !Number.isFinite(lastSync) || nowMs - lastSync >= intervalMinutes * 60_000;
}

function normalizeUpstreamText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      let value = line.trim().replace(/^\uFEFF/, '');
      if (!value || /^(payload|rules|rule-providers)\s*:/i.test(value)) return '';
      value = value
        .replace(/^[-]\s*/, '')
        .replace(/^['"]|['"]$/g, '')
        .trim();
      value = value.replace(
        /^(HOST-SUFFIX|HOST-KEYWORD|HOST),/i,
        (type) => `${type.toUpperCase() === 'HOST' ? 'DOMAIN' : type.toUpperCase().replace('HOST', 'DOMAIN')},`,
      );
      const parts = value.split(',').map((part) => part.trim());
      if (
        /^(DOMAIN|DOMAIN-SUFFIX|DOMAIN-KEYWORD|DOMAIN-REGEX|IP-CIDR|IP-CIDR6|SRC-IP-CIDR|IP-ASN|DST-PORT|SRC-PORT|GEOSITE|GEOIP|PROCESS-NAME|USER-AGENT|URL-REGEX)$/i.test(
          parts[0],
        ) &&
        parts.length > 2
      ) {
        const hasNoResolve = parts.slice(2).some((part) => /^no-resolve$/i.test(part));
        value = hasNoResolve ? `${parts[0]},${parts[1]},no-resolve` : `${parts[0]},${parts[1]}`;
      }
      return value;
    })
    .filter(Boolean)
    .join('\n');
}

function staleSourceResult(source: SourceRow, syncedAt: string): SyncResult {
  return {
    sourceId: source.id,
    categoryId: source.categoryId,
    name: source.name,
    ok: false,
    count: 0,
    error: STALE_SOURCE_ERROR,
    syncedAt,
  };
}

function safeSyncError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '同步失败';
  return redactString(message).slice(0, 500);
}

export type PreviewSourceInput = {
  sourceType: 'url' | 'geosite' | 'geoip';
  url: string;
  geositeName: string | null;
  geoipName: string | null;
  userAgent: string;
  ruleOptimization: 'none' | 'conservative' | 'aggressive';
};

async function fetchSourceRules(source: PreviewSourceInput, githubMirrorUrl: string) {
  let text: string;
  if (source.sourceType === 'geosite' && source.geositeName) {
    text = await loadGeositeRules(source.geositeName, githubMirrorUrl);
  } else if (source.sourceType === 'geoip' && source.geoipName) {
    const textUrl = `https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(source.geoipName)}.txt`;
    const response = await safeFetchText(rewriteGithubUrl(textUrl, githubMirrorUrl), {
      headers: { accept: 'text/plain' },
    });
    if (!response.ok) throw new AppError('UPSTREAM_FAILED', `GeoIP ${source.geoipName} 返回 HTTP ${response.status}`);
    const networks = response.text
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean);
    text = networks.map((network) => `IP-CIDR,${network}`).join('\n');
  } else {
    const response = await safeFetchText(rewriteGithubUrl(source.url, githubMirrorUrl), {
      headers: {
        accept: 'text/plain, application/yaml, application/json;q=0.8',
        'user-agent': source.userAgent || 'clash-verge/v2.5.1',
      },
    });
    if (!response.ok) throw new AppError('UPSTREAM_FAILED', `上游返回 HTTP ${response.status}`);
    text = response.text;
  }

  const preview = parseBulkImport(
    source.sourceType === 'geosite' || source.sourceType === 'geoip' ? text : normalizeUpstreamText(text),
    [],
  );
  if (!preview.rules.length) throw new AppError('VALIDATION_FAILED', '未从上游识别出有效规则');
  const optimization = source.ruleOptimization;
  const optimized = source.sourceType === 'url' && (optimization === 'conservative' || optimization === 'aggressive');
  return {
    rules: optimized ? compactRules(preview.rules, optimization).rules : preview.rules,
    originalCount: preview.rules.length,
    optimized,
    invalidCount: preview.invalidValues.length,
  };
}

export async function previewSourceRules(env: Env, source: PreviewSourceInput) {
  const { githubMirrorUrl } = await getSettings(env);
  const preview = await fetchSourceRules(source, githubMirrorUrl);
  return {
    count: preview.rules.length,
    originalCount: preview.originalCount,
    optimized: preview.optimized,
    invalidCount: preview.invalidCount,
    rules: preview.rules.slice(0, 20).map((rule) => ({ type: rule.type, value: rule.value })),
  };
}

function sourceHostKey(source: SourceRow, githubMirrorUrl: string): string {
  const effectiveUrl = rewriteGithubUrl(source.url, githubMirrorUrl);
  try {
    return new URL(effectiveUrl).host.toLowerCase();
  } catch {
    return 'unknown-host';
  }
}

/**
 * Schedules tasks so items sharing a host key execute strictly serially while
 * distinct hosts execute concurrently up to `maxConcurrentHosts` (design §9.2).
 */
export async function runHostScheduled<TItem, TResult>(
  items: readonly TItem[],
  hostKeyOf: (item: TItem) => string,
  worker: (item: TItem) => Promise<TResult>,
  maxConcurrentHosts = MAX_CONCURRENT_HOSTS,
): Promise<TResult[]> {
  if (items.length === 0) return [];
  const results = new Array<TResult>(items.length);
  const queuesByHost = new Map<string, Array<{ item: TItem; index: number }>>();
  items.forEach((item, index) => {
    const key = hostKeyOf(item);
    const queue = queuesByHost.get(key) ?? [];
    queue.push({ item, index });
    queuesByHost.set(key, queue);
  });

  const hostQueues = [...queuesByHost.values()];
  let nextHostIndex = 0;
  const concurrency = Math.max(1, Math.min(maxConcurrentHosts, hostQueues.length));

  const runWorker = async () => {
    while (true) {
      const queueIndex = nextHostIndex;
      if (queueIndex >= hostQueues.length) return;
      nextHostIndex += 1;
      for (const entry of hostQueues[queueIndex]) {
        results[entry.index] = await worker(entry.item);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}

async function syncSource(env: Env, source: SourceRow, githubMirrorUrl: string): Promise<SyncResult> {
  const syncedAt = now();
  const ownerId = id('sync');
  const { sources } = createRepositories(env.DB);
  const expiresAt = new Date(Date.now() + LEASE_TTL_MS).toISOString();
  const claimed = await sources.claimLease(source.id, ownerId, syncedAt, expiresAt);
  if (!claimed) {
    return {
      sourceId: source.id,
      categoryId: source.categoryId,
      name: source.name,
      ok: false,
      count: 0,
      error: '任务正在执行',
      syncedAt,
    };
  }

  const stageId = id('stage');
  try {
    const rawOpt = source.ruleOptimization as 'none' | 'conservative' | 'aggressive' | 'balanced' | null;
    const preview = await fetchSourceRules(
      {
        sourceType: (source.sourceType ?? 'url') as 'url' | 'geosite' | 'geoip',
        url: source.url,
        geositeName: source.geositeName,
        geoipName: source.geoipName,
        userAgent: source.userAgent ?? 'clash-verge/v2.5.1',
        ruleOptimization: rawOpt === 'balanced' ? 'aggressive' : (rawOpt ?? 'none'),
      },
      githubMirrorUrl,
    );
    const syncedRules = preview.rules;
    if (!(await sources.existsEnabled(source.id, source.categoryId))) {
      return staleSourceResult(source, syncedAt);
    }

    await sources.stageRules(
      stageId,
      source.id,
      source.categoryId,
      syncedRules.map((rule) => ({ ...rule, stagedId: id('rule') })),
    );

    if (!(await sources.existsEnabled(source.id, source.categoryId))) {
      await sources.clearStaging(stageId).catch(() => undefined);
      return staleSourceResult(source, syncedAt);
    }

    await sources.commitStagedRules({
      stageId,
      sourceId: source.id,
      categoryId: source.categoryId,
      syncedAt,
      count: syncedRules.length,
      originalCount: preview.originalCount,
    });

    return {
      sourceId: source.id,
      categoryId: source.categoryId,
      name: source.name,
      ok: true,
      count: syncedRules.length,
      originalCount: preview.originalCount,
      optimized: preview.optimized,
      syncedAt,
    };
  } catch (cause) {
    const message = safeSyncError(cause);
    logger.warn('source sync failed', { sourceId: source.id, categoryId: source.categoryId, error: message });
    await sources.clearStaging(stageId).catch(() => undefined);
    await sources.recordSyncError(source.id, syncedAt, message);
    return {
      sourceId: source.id,
      categoryId: source.categoryId,
      name: source.name,
      ok: false,
      count: 0,
      error: message,
      syncedAt,
    };
  } finally {
    await sources.releaseLease(source.id, ownerId).catch(() => undefined);
  }
}

export async function syncRuleSources(env: Env, categoryId?: string, force = true): Promise<SyncResult[]> {
  const [{ githubMirrorUrl }, enabledSources] = await Promise.all([
    getSettings(env),
    createRepositories(env.DB).sources.listEnabledRows(categoryId),
  ]);
  const dueSources = enabledSources.filter((source) => isSourceDue(source, force));
  return runHostScheduled(
    dueSources,
    (source) => sourceHostKey(source, githubMirrorUrl),
    (source) => syncSource(env, source, githubMirrorUrl),
    MAX_CONCURRENT_HOSTS,
  );
}

export async function syncSourceById(env: Env, sourceId: string): Promise<SyncResult> {
  const [{ githubMirrorUrl }, source] = await Promise.all([
    getSettings(env),
    createRepositories(env.DB).sources.findEnabledRowById(sourceId),
  ]);
  if (!source) throw new AppError('SOURCE_NOT_FOUND', '来源不存在或已停用。');
  return syncSource(env, source, githubMirrorUrl);
}

export async function retryFailedSources(env: Env): Promise<SyncResult[]> {
  const [{ githubMirrorUrl }, failedSources] = await Promise.all([
    getSettings(env),
    createRepositories(env.DB).sources.listFailedRows(),
  ]);
  return runHostScheduled(
    failedSources,
    (source) => sourceHostKey(source, githubMirrorUrl),
    (source) => syncSource(env, source, githubMirrorUrl),
    MAX_CONCURRENT_HOSTS,
  );
}
