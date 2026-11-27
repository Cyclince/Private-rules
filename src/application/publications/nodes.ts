import { createRepositories, type NodeBindingRow, type NodeSnapshotRow } from '../../data/repositories';
import {
  groupPreviewNodesByRegion,
  parseNodeSubscription,
  toNodePreview,
  type NodeParseReport,
  type NodePreviewItem,
  type ParsedNode,
} from '../../domain/nodes';
import { decryptNodeSecret, encryptNodeSecret, maskSubscriptionUrl } from '../../infrastructure/crypto/node-secrets';
import {
  DEFAULT_FETCH_MAX_BYTES,
  DEFAULT_FETCH_TIMEOUT_MS,
  safeFetchText,
  type DnsResolver,
} from '../../infrastructure/http/fetch';
import { createLogger, redactString } from '../../infrastructure/logging/logger';
import { resolveSessionSecret } from '../../lib/runtime-secrets';
import { TEMPLATE_CLIENTS } from '../../shared/clients';
import { AppError } from '../../shared/errors';
import type { Env } from '../../types';

const nodeLogger = createLogger({ component: 'publications:nodes' });

export const NODE_SNAPSHOT_TTL_MS = 30 * 60 * 1000;

export function bindingAad(publicationId: string, slotId: string): string {
  return `publication:${publicationId}:slot:${slotId}`;
}

export function snapshotAad(publicationId: string, slotId: string): string {
  return `${bindingAad(publicationId, slotId)}:snapshot`;
}

type StoredFullSnapshotPayload = {
  v: 1;
  kind: 'full';
  nodes: ParsedNode[];
  report: NodeParseReport;
};

type StoredPreviewSnapshotPayload = {
  v: 1;
  kind: 'preview';
  nodes: NodePreviewItem[];
  report: NodeParseReport;
};

type StoredSnapshotPayload = StoredFullSnapshotPayload | StoredPreviewSnapshotPayload;

export type ResolveSlotNodesOptions = {
  /** Force an upstream refresh even if a non-expired cached snapshot exists. */
  forceRefresh?: boolean;
  /** Override snapshot TTL in milliseconds (defaults to 30 minutes). */
  ttlMs?: number;
  /** Maximum subscription entries to parse (defaults to parser default 1000). */
  maxEntries?: number;
  /** Fetch timeout in ms (defaults to 15s). */
  timeoutMs?: number;
  /** Fetch response byte cap (defaults to 20MB). */
  maxBytes?: number;
  /** Injectable clock for deterministic tests (defaults to `Date.now`). */
  now?: () => number;
  /** Injectable fetch implementation for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable DNS resolver for tests. */
  resolveDns?: DnsResolver;
};

export type ResolvedSlotNodesResult = {
  publicationId: string;
  slotId: string;
  nodes: ParsedNode[];
  report: NodeParseReport;
  fetchedAt: string;
  expiresAt: string;
  stale: boolean;
  fromCache: boolean;
  staleReason?: string;
};

export type NodeSlotPreviewResult = {
  slotId: string;
  /** Plain node names list for UI badges & empty-group linting. */
  nodeNames: string[];
  /** Safe node summaries (name, protocol, regions, isInfo) — NEVER includes server/port/credentials. */
  nodes: NodePreviewItem[];
  /** Non-info node names grouped by detected ISO region code. */
  regions: Record<string, string[]>;
  count: number;
  fetchedAt: string;
  expiresAt: string;
  stale: boolean;
  fromCache: boolean;
  staleReason?: string;
  report: NodeParseReport;
};

const PROXY_URI_REDACT_PATTERN = /\b(?:ss|shadowsocks|vmess|vless|trojan|hysteria2|hy2|tuic|ssr):\/\/[^\s'"`<>)]+/gi;
const HTTP_URL_REDACT_PATTERN = /https?:\/\/[^\s'"`<>)]+/gi;

/**
 * Redacts subscription URLs (including full path and query), arbitrary HTTP(S)
 * URLs, proxy URIs, and secret key-value patterns from upstream error messages.
 */
export function sanitizeNodeFetchErrorMessage(rawMessage: string, secretUrl?: string): string {
  let sanitized = rawMessage;

  if (secretUrl) {
    const masked = maskSubscriptionUrl(secretUrl);
    sanitized = sanitized.split(secretUrl).join(masked);
    try {
      const parsed = new URL(secretUrl);
      const sensitiveTail = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      if (sensitiveTail.length >= 4 && sensitiveTail !== '/') {
        sanitized = sanitized.split(sensitiveTail).join('/***');
      }
      if (parsed.search && parsed.search.length >= 2) {
        sanitized = sanitized.split(parsed.search).join('?***');
      }
    } catch {
      // Ignore malformed secretUrl when redacting
    }
  }

  sanitized = sanitized.replace(HTTP_URL_REDACT_PATTERN, (match) => maskSubscriptionUrl(match));
  sanitized = sanitized.replace(PROXY_URI_REDACT_PATTERN, '[REDACTED_NODE_URI]');
  sanitized = redactString(sanitized);
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x00-\x1f\x7f]+/g, ' ').trim();

  if (!sanitized) return '拉取节点订阅失败。';
  return sanitized.length > 240 ? `${sanitized.slice(0, 237)}...` : sanitized;
}

function isStoredSnapshotPayload(value: unknown): value is StoredSnapshotPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.v !== 1) return false;
  if (record.kind !== 'full' && record.kind !== 'preview') return false;
  if (!Array.isArray(record.nodes)) return false;
  if (!record.report || typeof record.report !== 'object' || Array.isArray(record.report)) return false;
  return true;
}

async function tryDecryptSnapshotRow(
  row: NodeSnapshotRow | null,
  explicitSecret: string,
  publicationId: string,
  slotId: string,
): Promise<{ payload: StoredSnapshotPayload; fetchedAt: string; expiresAt: string } | null> {
  if (!row) return null;
  try {
    const rawJson = await decryptNodeSecret(row.nodesEnc, explicitSecret, snapshotAad(publicationId, slotId));
    const parsed = JSON.parse(rawJson) as unknown;
    if (!isStoredSnapshotPayload(parsed)) return null;
    return {
      payload: parsed,
      fetchedAt: row.fetchedAt,
      expiresAt: row.expiresAt,
    };
  } catch {
    return null;
  }
}

function isSnapshotFresh(expiresAt: string, nowMs: number): boolean {
  const expiresMs = Date.parse(expiresAt);
  return Number.isFinite(expiresMs) && expiresMs > nowMs;
}

function projectSnapshotToPreview(
  slotId: string,
  payload: StoredSnapshotPayload,
  meta: { fetchedAt: string; expiresAt: string; stale: boolean; fromCache: boolean; staleReason?: string },
): NodeSlotPreviewResult {
  const previewNodes: NodePreviewItem[] = payload.kind === 'full' ? payload.nodes.map(toNodePreview) : payload.nodes;
  return {
    slotId,
    nodeNames: previewNodes.map((item) => item.name),
    nodes: previewNodes,
    regions: groupPreviewNodesByRegion(previewNodes),
    count: previewNodes.length,
    fetchedAt: meta.fetchedAt,
    expiresAt: meta.expiresAt,
    stale: meta.stale,
    fromCache: meta.fromCache,
    ...(meta.staleReason ? { staleReason: meta.staleReason } : {}),
    report: payload.report,
  };
}

// Single-flight deduplication keyed per DatabasePort instance + publicationId + slotId + kind
const dbInstanceIds = new WeakMap<object, number>();
let nextDbInstanceId = 1;

function getDbInstanceId(db: object): number {
  let existing = dbInstanceIds.get(db);
  if (existing === undefined) {
    existing = nextDbInstanceId;
    nextDbInstanceId += 1;
    dbInstanceIds.set(db, existing);
  }
  return existing;
}

type InFlightEntry =
  | { kind: 'full'; promise: Promise<ResolvedSlotNodesResult> }
  | { kind: 'preview'; promise: Promise<NodeSlotPreviewResult> };

const inFlightFetches = new Map<string, InFlightEntry>();

function makeFlightKey(db: object, publicationId: string, slotId: string, kind: 'full' | 'preview'): string {
  return `${getDbInstanceId(db)}\0${publicationId}\0${slotId}\0${kind}`;
}

/** Clears in-flight deduplication state (primarily useful for test teardown). */
export function clearInFlightNodeFetches(): void {
  inFlightFetches.clear();
}

async function fetchAndParseBinding(
  binding: NodeBindingRow,
  explicitSecret: string,
  options: ResolveSlotNodesOptions,
): Promise<{ nodes: ParsedNode[]; report: NodeParseReport }> {
  const subscriptionUrl = await decryptNodeSecret(
    binding.subscriptionUrlEnc,
    explicitSecret,
    bindingAad(binding.publicationId, binding.slotId),
  );

  try {
    const response = await safeFetchText(subscriptionUrl, {
      headers: {
        ...(binding.userAgent ? { 'user-agent': binding.userAgent } : {}),
        accept: 'text/yaml, text/plain, */*',
      },
      timeoutMs: options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
      maxBytes: options.maxBytes ?? DEFAULT_FETCH_MAX_BYTES,
      fetchImpl: options.fetchImpl,
      resolveDns: options.resolveDns,
    });

    if (!response.ok) {
      throw new AppError('UPSTREAM_FAILED', `拉取节点订阅失败（HTTP ${response.status}）。`, {
        httpStatus: response.status,
      });
    }

    return parseNodeSubscription(response.text, { maxEntries: options.maxEntries });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : '拉取节点订阅失败。';
    const sanitized = sanitizeNodeFetchErrorMessage(rawMessage, subscriptionUrl);
    if (error instanceof AppError) {
      const statusDetail =
        error.details && typeof error.details === 'object' && 'httpStatus' in error.details
          ? { httpStatus: (error.details as { httpStatus?: unknown }).httpStatus }
          : undefined;
      throw new AppError(error.code, sanitized, statusDetail);
    }
    throw new AppError('UPSTREAM_FAILED', sanitized);
  }
}

function deriveFailureStatus(error: unknown): string {
  if (
    error instanceof AppError &&
    error.details &&
    typeof error.details === 'object' &&
    'httpStatus' in error.details
  ) {
    const status = (error.details as { httpStatus?: unknown }).httpStatus;
    if (typeof status === 'number') return `http_${status}`;
  }
  return 'error';
}

async function executeResolveFullSlotNodes(
  env: Env,
  explicitSecret: string,
  publicationId: string,
  slotId: string,
  options: ResolveSlotNodesOptions,
): Promise<ResolvedSlotNodesResult> {
  const repos = createRepositories(env.DB);
  const publication = await repos.publications.findById(publicationId);
  if (!publication) throw new AppError('PUBLICATION_NOT_FOUND', '发布配置不存在。');

  const binding = await repos.nodeBindings.findBySlot(publication.id, slotId);
  if (!binding) throw new AppError('NOT_FOUND', `节点槽位 ${slotId} 尚未绑定订阅地址。`);

  const nowMs = (options.now ?? Date.now)();
  const ttlMs = options.ttlMs ?? NODE_SNAPSHOT_TTL_MS;

  const existingRow = await repos.nodeSnapshots.findBySlot(publication.id, slotId);
  const existing = await tryDecryptSnapshotRow(existingRow, explicitSecret, publication.id, slotId);
  const previousFull = existing && existing.payload.kind === 'full' ? existing : null;

  if (!options.forceRefresh && previousFull && isSnapshotFresh(previousFull.expiresAt, nowMs)) {
    return {
      publicationId: publication.id,
      slotId,
      nodes: (previousFull.payload as StoredFullSnapshotPayload).nodes,
      report: previousFull.payload.report,
      fetchedAt: previousFull.fetchedAt,
      expiresAt: previousFull.expiresAt,
      stale: false,
      fromCache: true,
    };
  }

  const attemptIso = new Date(nowMs).toISOString();

  try {
    const parsed = await fetchAndParseBinding(binding, explicitSecret, options);
    const expiresAt = new Date(nowMs + ttlMs).toISOString();
    const payload: StoredFullSnapshotPayload = {
      v: 1,
      kind: 'full',
      nodes: parsed.nodes,
      report: parsed.report,
    };
    const nodesEnc = await encryptNodeSecret(
      JSON.stringify(payload),
      explicitSecret,
      snapshotAad(publication.id, slotId),
    );

    await repos.nodeSnapshots.upsert({
      publicationId: publication.id,
      slotId,
      nodesEnc,
      fetchedAt: attemptIso,
      expiresAt,
    });
    await repos.nodeBindings.recordFetchMetadata(publication.id, slotId, {
      lastFetchedAt: attemptIso,
      lastStatus: 'ok',
      lastNodeCount: parsed.nodes.length,
    });

    nodeLogger.info('refreshed encrypted node snapshot', {
      publicationId: publication.id,
      slotId,
      format: parsed.report.format,
      nodeCount: parsed.nodes.length,
      skippedCount: parsed.report.skippedCount,
      truncated: parsed.report.truncated,
    });

    return {
      publicationId: publication.id,
      slotId,
      nodes: parsed.nodes,
      report: parsed.report,
      fetchedAt: attemptIso,
      expiresAt,
      stale: false,
      fromCache: false,
    };
  } catch (error) {
    const reason = error instanceof AppError ? error.message : sanitizeNodeFetchErrorMessage('拉取节点订阅失败。');

    if (previousFull) {
      const fullPayload = previousFull.payload as StoredFullSnapshotPayload;
      await repos.nodeBindings.recordFetchMetadata(publication.id, slotId, {
        lastFetchedAt: attemptIso,
        lastStatus: 'stale',
        lastNodeCount: fullPayload.nodes.length,
      });
      nodeLogger.warn('node snapshot refresh failed; serving stale snapshot', {
        publicationId: publication.id,
        slotId,
        staleFallback: true,
        cachedNodeCount: fullPayload.nodes.length,
        reason,
      });
      return {
        publicationId: publication.id,
        slotId,
        nodes: fullPayload.nodes,
        report: fullPayload.report,
        fetchedAt: previousFull.fetchedAt,
        expiresAt: previousFull.expiresAt,
        stale: true,
        fromCache: true,
        staleReason: reason,
      };
    }

    await repos.nodeBindings.recordFetchMetadata(publication.id, slotId, {
      lastFetchedAt: attemptIso,
      lastStatus: deriveFailureStatus(error),
      lastNodeCount: binding.lastNodeCount ?? null,
    });
    nodeLogger.warn('node snapshot fetch failed without fallback', {
      publicationId: publication.id,
      slotId,
      staleFallback: false,
      reason,
    });

    if (error instanceof AppError) throw error;
    throw new AppError('UPSTREAM_FAILED', reason);
  }
}

async function executeFetchPreviewSlotNodes(
  env: Env,
  explicitSecret: string,
  publicationId: string,
  slotId: string,
  options: ResolveSlotNodesOptions,
): Promise<NodeSlotPreviewResult> {
  const repos = createRepositories(env.DB);
  const publication = await repos.publications.findById(publicationId);
  if (!publication) throw new AppError('PUBLICATION_NOT_FOUND', '发布配置不存在。');

  const binding = await repos.nodeBindings.findBySlot(publication.id, slotId);
  if (!binding) throw new AppError('NOT_FOUND', `节点槽位 ${slotId} 尚未绑定订阅地址。`);

  // If the publication includes any B-class client (e.g. sing-box), reuse the full
  // snapshot pipeline and project down to safe preview fields.
  const usesClassB = publication.clients.some((client) => TEMPLATE_CLIENTS[client]?.nodeAccess === 'B');
  if (usesClassB) {
    const resolved = await resolveSlotNodes(env, publication.id, slotId, options);
    return projectSnapshotToPreview(
      slotId,
      { v: 1, kind: 'full', nodes: resolved.nodes, report: resolved.report },
      {
        fetchedAt: resolved.fetchedAt,
        expiresAt: resolved.expiresAt,
        stale: resolved.stale,
        fromCache: resolved.fromCache,
        staleReason: resolved.staleReason,
      },
    );
  }

  const nowMs = (options.now ?? Date.now)();
  const ttlMs = options.ttlMs ?? NODE_SNAPSHOT_TTL_MS;

  const existingRow = await repos.nodeSnapshots.findBySlot(publication.id, slotId);
  const existing = await tryDecryptSnapshotRow(existingRow, explicitSecret, publication.id, slotId);

  if (!options.forceRefresh && existing && isSnapshotFresh(existing.expiresAt, nowMs)) {
    return projectSnapshotToPreview(slotId, existing.payload, {
      fetchedAt: existing.fetchedAt,
      expiresAt: existing.expiresAt,
      stale: false,
      fromCache: true,
    });
  }

  const attemptIso = new Date(nowMs).toISOString();

  try {
    const parsed = await fetchAndParseBinding(binding, explicitSecret, options);
    const previewNodes = parsed.nodes.map(toNodePreview);
    const expiresAt = new Date(nowMs + ttlMs).toISOString();
    // Design §11.4: for A/C-only publications, persist ONLY encrypted preview metadata (no credentials).
    const payload: StoredPreviewSnapshotPayload = {
      v: 1,
      kind: 'preview',
      nodes: previewNodes,
      report: parsed.report,
    };
    const nodesEnc = await encryptNodeSecret(
      JSON.stringify(payload),
      explicitSecret,
      snapshotAad(publication.id, slotId),
    );

    await repos.nodeSnapshots.upsert({
      publicationId: publication.id,
      slotId,
      nodesEnc,
      fetchedAt: attemptIso,
      expiresAt,
    });
    await repos.nodeBindings.recordFetchMetadata(publication.id, slotId, {
      lastFetchedAt: attemptIso,
      lastStatus: 'ok',
      lastNodeCount: previewNodes.length,
    });

    nodeLogger.info('fetched node name preview', {
      publicationId: publication.id,
      slotId,
      format: parsed.report.format,
      nodeCount: previewNodes.length,
      skippedCount: parsed.report.skippedCount,
      truncated: parsed.report.truncated,
    });

    return projectSnapshotToPreview(slotId, payload, {
      fetchedAt: attemptIso,
      expiresAt,
      stale: false,
      fromCache: false,
    });
  } catch (error) {
    const reason = error instanceof AppError ? error.message : sanitizeNodeFetchErrorMessage('拉取节点订阅失败。');

    if (existing) {
      const cachedCount = existing.payload.nodes.length;
      await repos.nodeBindings.recordFetchMetadata(publication.id, slotId, {
        lastFetchedAt: attemptIso,
        lastStatus: 'stale',
        lastNodeCount: cachedCount,
      });
      nodeLogger.warn('node preview fetch failed; serving stale snapshot', {
        publicationId: publication.id,
        slotId,
        staleFallback: true,
        cachedNodeCount: cachedCount,
        reason,
      });
      return projectSnapshotToPreview(slotId, existing.payload, {
        fetchedAt: existing.fetchedAt,
        expiresAt: existing.expiresAt,
        stale: true,
        fromCache: true,
        staleReason: reason,
      });
    }

    await repos.nodeBindings.recordFetchMetadata(publication.id, slotId, {
      lastFetchedAt: attemptIso,
      lastStatus: deriveFailureStatus(error),
      lastNodeCount: binding.lastNodeCount ?? null,
    });
    nodeLogger.warn('failed to fetch node name preview', {
      publicationId: publication.id,
      slotId,
      staleFallback: false,
      reason,
    });

    if (error instanceof AppError) throw error;
    throw new AppError('UPSTREAM_FAILED', reason);
  }
}

/**
 * Resolves parsed B-class proxy nodes for a single bound publication slot:
 * - Decrypts the bound subscription URL with configured or auto-generated `SESSION_SECRET`
 * - Uses 30-minute encrypted `node_snapshots` cache
 * - Deduplicates concurrent fetches for the same `(db, publicationId, slotId)`
 * - Falls back to the previous encrypted snapshot with `stale: true` on upstream failure
 */
export async function resolveSlotNodes(
  env: Env,
  publicationId: string,
  slotId: string,
  options: ResolveSlotNodesOptions = {},
): Promise<ResolvedSlotNodesResult> {
  const secret = await resolveSessionSecret(env);
  const key = makeFlightKey(env.DB, publicationId, slotId, 'full');
  const existing = inFlightFetches.get(key);
  if (existing && existing.kind === 'full') {
    return existing.promise;
  }

  const promise = executeResolveFullSlotNodes(env, secret, publicationId, slotId, options).finally(() => {
    const current = inFlightFetches.get(key);
    if (current?.promise === promise) {
      inFlightFetches.delete(key);
    }
  });

  inFlightFetches.set(key, { kind: 'full', promise });
  return promise;
}

/**
 * Resolves all bound slots of a publication in parallel (each slot deduplicated
 * independently) for B-class client compilation.
 */
export async function resolvePublicationSlotNodes(
  env: Env,
  publicationId: string,
  options: ResolveSlotNodesOptions = {},
): Promise<Map<string, ResolvedSlotNodesResult>> {
  const repos = createRepositories(env.DB);
  const bindings = await repos.nodeBindings.listByPublication(publicationId);
  const entries = await Promise.all(
    bindings.map(async (binding) => {
      const resolved = await resolveSlotNodes(env, publicationId, binding.slotId, options);
      return [binding.slotId, resolved] as const;
    }),
  );
  return new Map(entries);
}

/**
 * Fetches safe node preview metadata (name, protocol, region classification) for
 * the publication UI and empty-group checks (design §11.4). Never returns server
 * addresses, ports, passwords, UUIDs, TLS keys, or subscription URLs.
 */
export async function fetchNodeSlotNames(
  env: Env,
  publicationId: string,
  slotId: string,
  options: ResolveSlotNodesOptions = {},
): Promise<NodeSlotPreviewResult> {
  const secret = await resolveSessionSecret(env);

  // If a full B-class fetch for the same slot is already in flight, coalesce onto it
  const fullKey = makeFlightKey(env.DB, publicationId, slotId, 'full');
  const fullInFlight = inFlightFetches.get(fullKey);
  if (fullInFlight && fullInFlight.kind === 'full') {
    const resolved = await fullInFlight.promise;
    return projectSnapshotToPreview(
      slotId,
      { v: 1, kind: 'full', nodes: resolved.nodes, report: resolved.report },
      {
        fetchedAt: resolved.fetchedAt,
        expiresAt: resolved.expiresAt,
        stale: resolved.stale,
        fromCache: resolved.fromCache,
        staleReason: resolved.staleReason,
      },
    );
  }

  const previewKey = makeFlightKey(env.DB, publicationId, slotId, 'preview');
  const existing = inFlightFetches.get(previewKey);
  if (existing && existing.kind === 'preview') {
    return existing.promise;
  }

  const promise = executeFetchPreviewSlotNodes(env, secret, publicationId, slotId, options).finally(() => {
    const current = inFlightFetches.get(previewKey);
    if (current?.promise === promise) {
      inFlightFetches.delete(previewKey);
    }
  });

  inFlightFetches.set(previewKey, { kind: 'preview', promise });
  return promise;
}
