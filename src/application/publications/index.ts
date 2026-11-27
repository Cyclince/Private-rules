import { createRepositories, type NodeBindingRow } from '../../data/repositories';
import { id, slugify } from '../../domain/rules/slug';
import {
  applyOverlay,
  compileTemplate,
  lintTemplate,
  type CompiledConfigResult,
  type CompiledNodeSlotBinding,
  type LintReport,
} from '../../domain/templates';
import { decryptNodeSecret, encryptNodeSecret, maskSubscriptionUrl } from '../../infrastructure/crypto/node-secrets';
import { createLogger } from '../../infrastructure/logging/logger';
import { resolveSessionSecret } from '../../lib/runtime-secrets';
import {
  parsePublicationFile,
  SUPPORTED_TEMPLATE_CLIENTS,
  TEMPLATE_CLIENTS,
  type OutputProfile,
  type TemplateClientId,
} from '../../shared/clients';
import { AppError } from '../../shared/errors';
import type { Publication, PublicationAccess } from '../../shared/schemas/publication';
import type { TemplateBody, TemplateRecord } from '../../shared/schemas/template';
import type { Env } from '../../types';
import { loadCardLookup } from '../cards';
import { loadCatalogIndexMap } from '../catalog';
import { now } from '../rulesets';
import {
  collectReferencedRulesetIds,
  loadCachedIconPackEntries,
  loadTemplateRulesetContext,
  SUPPORTED_COMPILER_CLIENTS,
} from '../templates';
import {
  bindingAad,
  resolvePublicationSlotNodes,
  snapshotAad,
  type ResolveSlotNodesOptions,
  type ResolvedSlotNodesResult,
} from './nodes';

export {
  NODE_SNAPSHOT_TTL_MS,
  bindingAad,
  clearInFlightNodeFetches,
  fetchNodeSlotNames,
  resolvePublicationSlotNodes,
  resolveSlotNodes,
  sanitizeNodeFetchErrorMessage,
  snapshotAad,
  type NodeSlotPreviewResult,
  type ResolveSlotNodesOptions,
  type ResolvedSlotNodesResult,
} from './nodes';

const publicationLogger = createLogger({ component: 'publications' });

export type MaskedNodeBinding = {
  publicationId: string;
  slotId: string;
  maskedUrl: string;
  userAgent?: string;
  bound: true;
  needsRebind: boolean;
  lastFetchedAt?: string;
  lastStatus?: string;
  lastNodeCount?: number;
};

export type PublicationDetail = Publication & {
  templateName: string;
  templateSlug: string;
  templateCurrentVersion: number;
  effectiveVersion: number;
  effectiveOutput: OutputProfile;
  slots: TemplateBody['slots'];
  bindings: MaskedNodeBinding[];
  sessionSecretConfigured: boolean;
};

export type ListPublicationsOptions = {
  query?: string;
  templateId?: string;
  cursor?: string;
  limit?: number;
};

export type ListPublicationsResult = {
  publications: PublicationDetail[];
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
  sessionSecretConfigured: boolean;
};

export type CreatePublicationInput = {
  slug: string;
  templateId: string;
  pinnedVersion?: number;
  clients: TemplateClientId[];
  access: PublicationAccess;
  output?: OutputProfile;
  experimentalFullConfig?: boolean;
  /** Inherit encrypted slot bindings (and cached snapshots) from sibling publications of the same template. */
  inheritSlotBindings?: boolean;
};

export type UpdatePublicationInput = {
  slug?: string;
  templateId?: string;
  pinnedVersion?: number | null;
  clients?: TemplateClientId[];
  access?: PublicationAccess;
  output?: OutputProfile | null;
  experimentalFullConfig?: boolean;
};

export type UpsertNodeBindingInput = {
  subscriptionUrl: string;
  userAgent?: string | null;
};

export type PublicationCacheIdentity = {
  publicationId: string;
  slug: string;
  access: 'public' | 'token';
  tokenHash: string;
  templateId: string;
  templateVersion: number;
  client: TemplateClientId;
  output: OutputProfile;
  experimentalFullConfig?: boolean;
  bindingsVersion: string;
  depsVersion: string;
  /** Snapshot fingerprint for B-class deliveries (changes when snapshot refreshes or becomes stale). */
  snapshotsVersion?: string;
};

export type ResolvedPublicationDelivery =
  | { status: 'not_found'; message: string }
  | { status: 'unsupported_client'; client: TemplateClientId; message: string }
  | {
      status: 'ready';
      publication: Publication;
      template: TemplateRecord;
      templateVersion: number;
      resolvedBody: TemplateBody;
      output: OutputProfile;
      client: TemplateClientId;
      bindingRows: NodeBindingRow[];
      cacheIdentity: PublicationCacheIdentity;
      /** Pre-resolved encrypted node snapshots for B-class deliveries. */
      resolvedSnapshots?: Map<string, ResolvedSlotNodesResult>;
      /** Slot IDs whose resolved snapshot fell back to stale cached data. */
      staleSlotIds?: string[];
    };

function decodeOffsetCursor(raw?: string): number {
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AppError('VALIDATION_FAILED', '分页游标无效。');
  }
  return parsed;
}

async function sha256Short(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 20);
}

function validateSubscriptionUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  // eslint-disable-next-line no-control-regex
  if (!trimmed || /[\r\n\0\x00-\x1f\x7f\s]/.test(trimmed)) {
    throw new AppError('VALIDATION_FAILED', '订阅地址格式无效。');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError('VALIDATION_FAILED', '订阅地址必须是有效的 HTTP(S) URL。');
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    throw new AppError('VALIDATION_FAILED', '订阅地址仅支持 http 或 https 协议。');
  }
  return trimmed;
}

function validateBindingUserAgent(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // eslint-disable-next-line no-control-regex
  if (trimmed.length > 256 || /[\r\n\0\x00-\x1f\x7f]/.test(trimmed)) {
    throw new AppError('VALIDATION_FAILED', 'User-Agent 格式无效。');
  }
  return trimmed;
}

async function maskBindingRow(env: Env, row: NodeBindingRow): Promise<MaskedNodeBinding> {
  const secret = await resolveSessionSecret(env);
  let maskedUrl = '***';
  let needsRebind = false;

  try {
    const plaintext = await decryptNodeSecret(
      row.subscriptionUrlEnc,
      secret,
      bindingAad(row.publicationId, row.slotId),
    );
    maskedUrl = maskSubscriptionUrl(plaintext);
  } catch {
    needsRebind = true;
  }

  return {
    publicationId: row.publicationId,
    slotId: row.slotId,
    maskedUrl,
    ...(row.userAgent ? { userAgent: row.userAgent } : {}),
    bound: true,
    needsRebind,
    ...(row.lastFetchedAt ? { lastFetchedAt: row.lastFetchedAt } : {}),
    ...(row.lastStatus ? { lastStatus: row.lastStatus } : {}),
    ...(row.lastNodeCount !== null && row.lastNodeCount !== undefined ? { lastNodeCount: row.lastNodeCount } : {}),
  };
}

async function loadResolvedBodyForPublication(
  env: Env,
  template: TemplateRecord,
  pinnedVersion?: number,
): Promise<{ version: number; resolvedBody: TemplateBody }> {
  const targetVersion = pinnedVersion ?? template.currentVersion;
  const versionRow = await createRepositories(env.DB).templates.findVersion(template.id, targetVersion);
  if (versionRow) {
    return { version: versionRow.version, resolvedBody: versionRow.resolvedBody };
  }
  return {
    version: targetVersion,
    resolvedBody: applyOverlay(template.baseBody, template.overlay).resolved,
  };
}

async function buildPublicationDetail(
  env: Env,
  publication: Publication,
  template: TemplateRecord,
): Promise<PublicationDetail> {
  const repos = createRepositories(env.DB);
  const [{ version, resolvedBody }, bindingRows] = await Promise.all([
    loadResolvedBodyForPublication(env, template, publication.pinnedVersion),
    repos.nodeBindings.listByPublication(publication.id),
  ]);
  const bindings = await Promise.all(bindingRows.map((row) => maskBindingRow(env, row)));
  const sessionSecretConfigured = true;

  return {
    ...publication,
    templateName: template.name,
    templateSlug: template.slug,
    templateCurrentVersion: template.currentVersion,
    effectiveVersion: version,
    effectiveOutput: publication.output ?? resolvedBody.output,
    slots: resolvedBody.slots,
    bindings,
    sessionSecretConfigured,
  };
}

export async function listPublications(
  env: Env,
  options: ListPublicationsOptions = {},
): Promise<ListPublicationsResult> {
  const repos = createRepositories(env.DB);
  const [allPubs, allTemplates] = await Promise.all([repos.publications.listAll(), repos.templates.listAll()]);
  const templateById = new Map(allTemplates.map((tpl) => [tpl.id, tpl]));

  let filtered = allPubs;
  if (options.templateId) {
    filtered = filtered.filter((pub) => pub.templateId === options.templateId);
  }
  const query = options.query?.trim().toLowerCase();
  if (query) {
    filtered = filtered.filter((pub) => {
      const tpl = templateById.get(pub.templateId);
      return (
        pub.id.toLowerCase().includes(query) ||
        pub.slug.toLowerCase().includes(query) ||
        (tpl?.name.toLowerCase().includes(query) ?? false) ||
        (tpl?.slug.toLowerCase().includes(query) ?? false)
      );
    });
  }

  const total = filtered.length;
  const offset = decodeOffsetCursor(options.cursor);
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 200));
  const slice = filtered.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  const hasMore = nextOffset < total;

  const details: PublicationDetail[] = [];
  for (const pub of slice) {
    const template = templateById.get(pub.templateId);
    if (!template) continue;
    details.push(await buildPublicationDetail(env, pub, template));
  }

  return {
    publications: details,
    total,
    nextCursor: hasMore ? String(nextOffset) : null,
    hasMore,
    sessionSecretConfigured: true,
  };
}

export async function getPublicationById(env: Env, publicationId: string): Promise<PublicationDetail> {
  const repos = createRepositories(env.DB);
  const publication = await repos.publications.findById(publicationId);
  if (!publication) throw new AppError('PUBLICATION_NOT_FOUND', '发布配置不存在。');
  const template = await repos.templates.findById(publication.templateId);
  if (!template) throw new AppError('TEMPLATE_NOT_FOUND', '关联模板不存在。');
  return buildPublicationDetail(env, publication, template);
}

export async function createPublication(
  env: Env,
  input: CreatePublicationInput,
): Promise<{ publication: PublicationDetail; lint: LintReport }> {
  const repos = createRepositories(env.DB);
  const template = await repos.templates.findById(input.templateId);
  if (!template) throw new AppError('TEMPLATE_NOT_FOUND', '关联模板不存在。');

  const normalizedSlug = slugify(input.slug).toLowerCase();
  const duplicate = await repos.publications.findBySlug(normalizedSlug);
  if (duplicate) {
    throw new AppError('CONFLICT', `发布标识 ${normalizedSlug} 已存在。`);
  }

  if (input.pinnedVersion !== undefined) {
    const versionRow = await repos.templates.findVersion(template.id, input.pinnedVersion);
    if (!versionRow) {
      throw new AppError('VALIDATION_FAILED', `指定的模板版本 v${input.pinnedVersion} 不存在。`);
    }
  }

  const pubId = id('pub');
  const timestamp = now();
  const uniqueClients = [...new Set(input.clients)];

  await repos.publications.create({
    id: pubId,
    slug: normalizedSlug,
    templateId: template.id,
    pinnedVersion: input.pinnedVersion ?? null,
    clients: JSON.stringify(uniqueClients),
    access: input.access,
    output: input.output ?? null,
    experimentalFullConfig: input.experimentalFullConfig ? 1 : 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  if (input.inheritSlotBindings && input.access !== 'public') {
    const siblings = (await repos.publications.listAll()).filter(
      (pub) => pub.templateId === template.id && pub.id !== pubId,
    );
    const inheritedBySlot = new Map<string, NodeBindingRow>();
    for (const sibling of siblings) {
      const siblingBindings = await repos.nodeBindings.listByPublication(sibling.id);
      for (const row of siblingBindings) {
        if (!inheritedBySlot.has(row.slotId)) {
          inheritedBySlot.set(row.slotId, row);
        }
      }
    }

    if (inheritedBySlot.size > 0) {
      const secret = await resolveSessionSecret(env);
      for (const [slotId, sourceRow] of inheritedBySlot.entries()) {
        try {
          const plaintextUrl = await decryptNodeSecret(
            sourceRow.subscriptionUrlEnc,
            secret,
            bindingAad(sourceRow.publicationId, slotId),
          );
          const reEncryptedUrl = await encryptNodeSecret(plaintextUrl, secret, bindingAad(pubId, slotId));
          await repos.nodeBindings.upsert(
            {
              publicationId: pubId,
              slotId,
              subscriptionUrlEnc: reEncryptedUrl,
              userAgent: sourceRow.userAgent ?? null,
            },
            timestamp,
          );
          if (sourceRow.lastFetchedAt || sourceRow.lastStatus || sourceRow.lastNodeCount !== null) {
            await repos.nodeBindings.recordFetchMetadata(pubId, slotId, {
              lastFetchedAt: sourceRow.lastFetchedAt ?? timestamp,
              lastStatus: sourceRow.lastStatus ?? 'ok',
              lastNodeCount: sourceRow.lastNodeCount ?? null,
            });
          }
          const sourceSnapshot = await repos.nodeBindings.findNodeSnapshot(sourceRow.publicationId, slotId);
          if (sourceSnapshot) {
            const plaintextSnap = await decryptNodeSecret(
              sourceSnapshot.nodesEnc,
              secret,
              snapshotAad(sourceRow.publicationId, slotId),
            );
            const reEncryptedSnap = await encryptNodeSecret(plaintextSnap, secret, snapshotAad(pubId, slotId));
            await repos.nodeBindings.upsertNodeSnapshot({
              publicationId: pubId,
              slotId,
              nodesEnc: reEncryptedSnap,
              fetchedAt: sourceSnapshot.fetchedAt,
              expiresAt: sourceSnapshot.expiresAt,
            });
          }
        } catch {
          // Skip unreadable sibling binding (e.g. rotated key requiring rebind)
        }
      }
    }
  }

  const created = await repos.publications.findById(pubId);
  if (!created) throw new AppError('INTERNAL', '创建发布配置失败。');

  const [{ resolvedBody }, cards, catalogIndex] = await Promise.all([
    loadResolvedBodyForPublication(env, template, created.pinnedVersion),
    loadCardLookup(env),
    loadCatalogIndexMap(env),
  ]);
  const lint = lintTemplate({ body: resolvedBody, cards, clients: uniqueClients, catalogIndex });

  return {
    publication: await buildPublicationDetail(env, created, template),
    lint,
  };
}

export async function updatePublication(
  env: Env,
  publicationId: string,
  patch: UpdatePublicationInput,
): Promise<{ publication: PublicationDetail; previousSlug: string; lint: LintReport }> {
  const repos = createRepositories(env.DB);
  const existing = await repos.publications.findById(publicationId);
  if (!existing) throw new AppError('PUBLICATION_NOT_FOUND', '发布配置不存在。');

  const nextTemplateId = patch.templateId ?? existing.templateId;
  const template = await repos.templates.findById(nextTemplateId);
  if (!template) throw new AppError('TEMPLATE_NOT_FOUND', '关联模板不存在。');

  let nextSlug = existing.slug;
  if (patch.slug !== undefined) {
    const candidate = slugify(patch.slug).toLowerCase();
    if (candidate !== existing.slug) {
      const duplicate = await repos.publications.findBySlug(candidate);
      if (duplicate && duplicate.id !== existing.id) {
        throw new AppError('CONFLICT', `发布标识 ${candidate} 已存在。`);
      }
      nextSlug = candidate;
    }
  }

  const nextPinnedVersion = patch.pinnedVersion === undefined ? (existing.pinnedVersion ?? null) : patch.pinnedVersion;
  if (nextPinnedVersion !== null) {
    const versionRow = await repos.templates.findVersion(template.id, nextPinnedVersion);
    if (!versionRow) {
      throw new AppError('VALIDATION_FAILED', `指定的模板版本 v${nextPinnedVersion} 不存在。`);
    }
  }

  const nextClients = patch.clients ? [...new Set(patch.clients)] : existing.clients;
  const nextAccess = patch.access ?? existing.access;
  if (nextAccess === 'public') {
    const existingBindings = await repos.nodeBindings.listByPublication(existing.id);
    if (existingBindings.length > 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        '该发布已绑定节点订阅地址，为避免订阅地址明文泄露，访问方式只能为 token 或 disabled；如需公开访问请先移除所有节点绑定。',
      );
    }
  }
  const nextOutput = patch.output === undefined ? (existing.output ?? null) : patch.output;
  const nextExperimentalFullConfig =
    patch.experimentalFullConfig === undefined ? existing.experimentalFullConfig : patch.experimentalFullConfig;
  const timestamp = now();

  await repos.publications.update(existing.id, {
    slug: nextSlug,
    templateId: template.id,
    pinnedVersion: nextPinnedVersion,
    clients: JSON.stringify(nextClients),
    access: nextAccess,
    output: nextOutput,
    experimentalFullConfig: nextExperimentalFullConfig ? 1 : 0,
    updatedAt: timestamp,
  });

  const updated = await repos.publications.findById(existing.id);
  if (!updated) throw new AppError('PUBLICATION_NOT_FOUND', '发布配置不存在。');

  const [{ resolvedBody }, cards, catalogIndex] = await Promise.all([
    loadResolvedBodyForPublication(env, template, updated.pinnedVersion),
    loadCardLookup(env),
    loadCatalogIndexMap(env),
  ]);
  const lint = lintTemplate({ body: resolvedBody, cards, clients: nextClients, catalogIndex });

  return {
    publication: await buildPublicationDetail(env, updated, template),
    previousSlug: existing.slug,
    lint,
  };
}

export async function deletePublication(env: Env, publicationId: string): Promise<{ deletedId: string; slug: string }> {
  const repos = createRepositories(env.DB);
  const existing = await repos.publications.findById(publicationId);
  if (!existing) throw new AppError('PUBLICATION_NOT_FOUND', '发布配置不存在。');
  await repos.publications.deleteById(existing.id);
  return { deletedId: existing.id, slug: existing.slug };
}

/**
 * Encrypts and stores a node slot subscription URL using HKDF + AES-256-GCM
 * derived from `SESSION_SECRET` (explicit env var or auto-generated key).
 * Write-only: returns ONLY the masked URL, never plaintext or ciphertext.
 */
export async function upsertNodeSlotBinding(
  env: Env,
  publicationId: string,
  slotId: string,
  input: UpsertNodeBindingInput,
): Promise<{ binding: MaskedNodeBinding; publicationSlug: string }> {
  const repos = createRepositories(env.DB);
  const publication = await repos.publications.findById(publicationId);
  if (!publication) throw new AppError('PUBLICATION_NOT_FOUND', '发布配置不存在。');

  if (publication.access === 'public') {
    throw new AppError(
      'VALIDATION_FAILED',
      '公开访问（public）的发布禁止绑定节点订阅地址，以免配置文件泄露明文地址；请先将访问方式切换为 token 或 disabled。',
    );
  }

  const secret = await resolveSessionSecret(env);

  const template = await repos.templates.findById(publication.templateId);
  if (!template) throw new AppError('TEMPLATE_NOT_FOUND', '关联模板不存在。');

  const { resolvedBody } = await loadResolvedBodyForPublication(env, template, publication.pinnedVersion);
  const slotExists = resolvedBody.slots.some((slot) => slot.id === slotId);
  if (!slotExists) {
    throw new AppError('VALIDATION_FAILED', `模板中不存在节点槽位 ${slotId}。`);
  }

  const cleanUrl = validateSubscriptionUrl(input.subscriptionUrl);
  const cleanUserAgent = validateBindingUserAgent(input.userAgent);
  const encrypted = await encryptNodeSecret(cleanUrl, secret, bindingAad(publication.id, slotId));
  const timestamp = now();

  await repos.nodeBindings.upsert(
    {
      publicationId: publication.id,
      slotId,
      subscriptionUrlEnc: encrypted,
      userAgent: cleanUserAgent,
    },
    timestamp,
  );

  publicationLogger.info('updated encrypted node slot binding', {
    publicationId: publication.id,
    slotId,
    maskedHost: maskSubscriptionUrl(cleanUrl),
    hasUserAgent: Boolean(cleanUserAgent),
  });

  const savedRow = await repos.nodeBindings.findBySlot(publication.id, slotId);
  if (!savedRow) throw new AppError('INTERNAL', '保存节点槽位绑定失败。');

  return {
    binding: await maskBindingRow(env, savedRow),
    publicationSlug: publication.slug,
  };
}

export async function deleteNodeSlotBinding(
  env: Env,
  publicationId: string,
  slotId: string,
): Promise<{ publicationId: string; publicationSlug: string; slotId: string }> {
  const repos = createRepositories(env.DB);
  const publication = await repos.publications.findById(publicationId);
  if (!publication) throw new AppError('PUBLICATION_NOT_FOUND', '发布配置不存在。');

  await repos.nodeBindings.deleteBySlot(publication.id, slotId, now());
  publicationLogger.info('deleted node slot binding', {
    publicationId: publication.id,
    slotId,
  });

  return {
    publicationId: publication.id,
    publicationSlug: publication.slug,
    slotId,
  };
}

/**
 * Resolves publication metadata and constructs the exact cache identity WITHOUT
 * decrypting node secrets or compiling the configuration (fast path for cache
 * hits and ETag/304 responses).
 */
export async function resolvePublicationDelivery(
  env: Env,
  params: {
    slug: string;
    file: string;
    access: 'public' | 'token';
    token?: string;
    baseUrl: string;
    nodeResolveOptions?: ResolveSlotNodesOptions;
  },
): Promise<ResolvedPublicationDelivery> {
  const client = parsePublicationFile(params.file);
  if (!client) {
    return { status: 'not_found', message: '订阅文件不存在。' };
  }
  if (!SUPPORTED_COMPILER_CLIENTS.has(client)) {
    const supportedFiles = SUPPORTED_TEMPLATE_CLIENTS.map((id) => TEMPLATE_CLIENTS[id].fileName).join(' / ');
    return {
      status: 'unsupported_client',
      client,
      message: `客户端 ${TEMPLATE_CLIENTS[client].label}（${params.file}）尚未支持，当前版本仅支持 ${supportedFiles}。`,
    };
  }

  const repos = createRepositories(env.DB);
  const publication = await repos.publications.findBySlug(params.slug.toLowerCase());
  if (!publication || publication.access === 'disabled' || publication.access !== params.access) {
    return { status: 'not_found', message: '发布订阅不存在或未启用。' };
  }
  if (!publication.clients.includes(client)) {
    return { status: 'not_found', message: '该发布未启用此客户端输出。' };
  }

  const template = await repos.templates.findById(publication.templateId);
  if (!template) {
    return { status: 'not_found', message: '关联模板不存在。' };
  }

  const [{ version: templateVersion, resolvedBody }, bindingRows, cards, customCardTimestamps] = await Promise.all([
    loadResolvedBodyForPublication(env, template, publication.pinnedVersion),
    repos.nodeBindings.listByPublication(publication.id),
    loadCardLookup(env),
    repos.cards.listUpdatedTimestamps(),
  ]);

  // Defense-in-depth: never serve a public publication that has node bindings (design §14).
  if (params.access === 'public' && bindingRows.length > 0) {
    publicationLogger.warn('blocked public publication delivery with node bindings', {
      publicationId: publication.id,
      slug: publication.slug,
      bindingCount: bindingRows.length,
    });
    return { status: 'not_found', message: '发布订阅不存在或未启用。' };
  }

  const output: OutputProfile = publication.output ?? resolvedBody.output;

  // Bindings fingerprint hashes ciphertext + UA (changes on every write because AES-GCM uses a fresh IV)
  const bindingsMaterial = bindingRows
    .map((row) => `${row.slotId}\0${row.subscriptionUrlEnc}\0${row.userAgent ?? ''}`)
    .join('\n');
  const bindingsVersion = await sha256Short(bindingsMaterial || 'no-bindings');

  // Referenced rulesets + custom cards timestamps
  const referencedRulesetIds = collectReferencedRulesetIds(resolvedBody, cards);
  const rulesetStampParts: string[] = [];
  for (const ruleSetId of referencedRulesetIds) {
    const row = (await repos.rulesets.findById(ruleSetId)) ?? (await repos.rulesets.findBySlug(ruleSetId));
    rulesetStampParts.push(`${ruleSetId}:${row?.updatedAt ?? 'missing'}`);
  }
  const cardStampMap = new Map(customCardTimestamps.map((c) => [c.id, c.updatedAt]));
  const usedCardStamps = resolvedBody.cards
    .filter((ref) => ref.enabled && cardStampMap.has(ref.cardId))
    .map((ref) => `${ref.cardId}:${cardStampMap.get(ref.cardId)}`);

  const depsMaterial = [
    params.baseUrl,
    publication.updatedAt ?? '',
    template.updatedAt ?? '',
    ...usedCardStamps,
    ...rulesetStampParts,
  ].join('|');
  const depsVersion = await sha256Short(depsMaterial);
  const tokenHash = params.access === 'token' && params.token ? await sha256Short(params.token) : 'public';

  let resolvedSnapshots: Map<string, ResolvedSlotNodesResult> | undefined;
  let staleSlotIds: string[] | undefined;
  let snapshotsVersion: string | undefined;

  if (TEMPLATE_CLIENTS[client].nodeAccess === 'B' && bindingRows.length > 0) {
    resolvedSnapshots = await resolvePublicationSlotNodes(env, publication.id, params.nodeResolveOptions);
    const staleIds: string[] = [];
    const snapMaterial: string[] = [];
    for (const row of bindingRows) {
      const snap = resolvedSnapshots.get(row.slotId);
      if (snap) {
        if (snap.stale) staleIds.push(row.slotId);
        snapMaterial.push(`${row.slotId}\0${snap.fetchedAt}\0${snap.stale ? 'stale' : 'fresh'}\0${snap.nodes.length}`);
      }
    }
    staleSlotIds = staleIds;
    snapshotsVersion = await sha256Short(snapMaterial.join('\n') || 'no-snapshots');
  }

  return {
    status: 'ready',
    publication,
    template,
    templateVersion,
    resolvedBody,
    output,
    client,
    bindingRows,
    ...(resolvedSnapshots ? { resolvedSnapshots } : {}),
    ...(staleSlotIds ? { staleSlotIds } : {}),
    cacheIdentity: {
      publicationId: publication.id,
      slug: publication.slug,
      access: params.access,
      tokenHash,
      templateId: template.id,
      templateVersion,
      client,
      output,
      experimentalFullConfig: publication.experimentalFullConfig,
      bindingsVersion,
      depsVersion,
      ...(snapshotsVersion ? { snapshotsVersion } : {}),
    },
  };
}

/**
 * Compiles a ready publication delivery on cache miss:
 * - A-class clients: decrypts bound subscription URLs in-memory only (never logged).
 * - B-class clients (e.g. sing-box): uses encrypted parsed node snapshots from `nodes.ts`
 *   and passes stale/parse metadata into the compiler compatibility report.
 */
export async function compilePublicationDelivery(
  env: Env,
  delivery: Extract<ResolvedPublicationDelivery, { status: 'ready' }>,
  baseUrl: string,
  nodeResolveOptions?: ResolveSlotNodesOptions,
): Promise<CompiledConfigResult> {
  const slotBindings = new Map<string, CompiledNodeSlotBinding>();

  if (delivery.bindingRows.length > 0) {
    if (TEMPLATE_CLIENTS[delivery.client].nodeAccess === 'B') {
      const snapshots =
        delivery.resolvedSnapshots ??
        (await resolvePublicationSlotNodes(env, delivery.publication.id, nodeResolveOptions));
      for (const row of delivery.bindingRows) {
        const snap = snapshots.get(row.slotId);
        if (!snap) continue;
        slotBindings.set(row.slotId, {
          kind: 'snapshot',
          nodes: snap.nodes,
          report: snap.report,
          stale: snap.stale,
          staleReason: snap.staleReason,
          fetchedAt: snap.fetchedAt,
          expiresAt: snap.expiresAt,
        });
      }
    } else if (TEMPLATE_CLIENTS[delivery.client].nodeAccess === 'A') {
      const secret = await resolveSessionSecret(env);
      for (const row of delivery.bindingRows) {
        const decryptedUrl = await decryptNodeSecret(
          row.subscriptionUrlEnc,
          secret,
          bindingAad(row.publicationId, row.slotId),
        );
        slotBindings.set(row.slotId, {
          kind: 'http',
          url: decryptedUrl,
          ...(row.userAgent ? { userAgent: row.userAgent } : {}),
        });
      }
    }
  }

  const [cards, catalogIndex, iconPack] = await Promise.all([
    loadCardLookup(env),
    loadCatalogIndexMap(env),
    loadCachedIconPackEntries(env),
  ]);
  const rulesetCtx = await loadTemplateRulesetContext(env, delivery.resolvedBody, cards);

  return compileTemplate(delivery.client, {
    body: delivery.resolvedBody,
    cards,
    templateName: delivery.template.name,
    generatedAt: delivery.template.updatedAt,
    output: delivery.output,
    catalogIndex,
    rulesetBehaviors: rulesetCtx.rulesetBehaviors,
    baseUrl,
    slotBindings,
    iconPack,
    experimentalFullConfig: delivery.publication.experimentalFullConfig,
  });
}
