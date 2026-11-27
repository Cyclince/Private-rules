import { BUILTIN_CARDS, buildComplexityStarterTemplate } from '../../builtin';
import { createRepositories, serializeCardBody } from '../../data/repositories';
import {
  getRegionDefinition,
  groupPreviewNodesByRegion,
  parseNodeSubscription,
  toNodePreview,
} from '../../domain/nodes';
import { id, slugify } from '../../domain/rules/slug';
import {
  applyOverlay,
  buildNormalizedQuickCreateSlots,
  buildQuickCreateTemplateBody,
  normalizeSubscriptionName,
  serializeTemplateBodyForStorage,
  validateModuleCombination,
  type QuickCreateResolvedRuleset,
} from '../../domain/templates';
import { encryptNodeSecret, maskSubscriptionUrl } from '../../infrastructure/crypto/node-secrets';
import {
  DEFAULT_FETCH_MAX_BYTES,
  DEFAULT_FETCH_TIMEOUT_MS,
  safeFetchText,
  validateRemoteSourceUrl,
  type DnsResolver,
} from '../../infrastructure/http/fetch';
import { resolveSessionSecret } from '../../lib/runtime-secrets';
import { isTemplateClientSupported, TEMPLATE_CLIENTS, type TemplateClientId } from '../../shared/clients';
import { AppError } from '../../shared/errors';
import {
  MAX_TEMPLATE_SUBSCRIPTIONS,
  type NodeCombineMode,
  type PreviewSubscriptionBatchInput,
  type PreviewSubscriptionErrorCode,
  type PreviewSubscriptionInput,
  type PreviewSubscriptionSingleInput,
  type QuickCreatePreviewSummary,
  type QuickCreateTemplateInput,
} from '../../shared/schemas/quick-create';
import type { TemplateBody, TemplateRecord } from '../../shared/schemas/template';
import type { Env } from '../../types';
import type { DatabaseStatement } from '../ports/database';
import { bindingAad, sanitizeNodeFetchErrorMessage } from '../publications/nodes';
import { now } from '../rulesets';

const DEFAULT_PREVIEW_USER_AGENT = 'clash.meta/1.19.0';
const UA_REQUIRED_HTTP_STATUSES = new Set([401, 403, 406, 451]);

export type QuickCreateSubscriptionSummary = {
  slotId: string;
  name: string;
  maskedUrl: string;
};

export type QuickCreatePublicationLink = {
  id: string;
  slug: string;
  client: TemplateClientId;
  clientLabel: string;
  fileName: string;
  supported: boolean;
  access: 'token';
  experimentalFullConfig: boolean;
  url: string | null;
  maskedSubscriptionUrl?: string;
};

export type QuickCreateTemplateOptions = {
  baseUrl?: string;
  ruleToken?: string;
  /** Internal test hook to append extra statements into the same atomic DB batch. */
  extraBatchStatements?: DatabaseStatement[];
};

export type QuickCreateTemplateServiceInput = Omit<QuickCreateTemplateInput, 'combineMode'> & {
  combineMode?: NodeCombineMode;
};

export type QuickCreateTemplateResult = {
  template: TemplateRecord;
  resolvedBody: TemplateBody;
  publications: QuickCreatePublicationLink[];
  ruleTokenConfigured: boolean;
  hasSubscription: boolean;
  combineMode: NodeCombineMode;
  subscriptions: QuickCreateSubscriptionSummary[];
};

export type PreviewSubscriptionOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxEntries?: number;
  fetchImpl?: typeof fetch;
  resolveDns?: DnsResolver;
};

export type PreviewSubscriptionRegionStat = {
  code: string;
  name: string;
  emoji: string;
  count: number;
};

export type PreviewSubscriptionResult = {
  nodeCount: number;
  totalParsedCount: number;
  infoNodeCount: number;
  format: string;
  regions: PreviewSubscriptionRegionStat[];
  regionCounts: Record<string, number>;
  checkedAt: string;
};

export type PreviewSubscriptionBatchItemResult = {
  name: string;
  ok: boolean;
  nodeCount: number;
  regions: PreviewSubscriptionRegionStat[];
  regionCounts: Record<string, number>;
  errorCode?: PreviewSubscriptionErrorCode;
  error?: string;
  checkedAt: string;
  format?: string;
  totalParsedCount?: number;
  infoNodeCount?: number;
};

export type PreviewSubscriptionBatchResult = {
  items: PreviewSubscriptionBatchItemResult[];
  totalNodeCount: number;
  regions: PreviewSubscriptionRegionStat[];
  regionCounts: Record<string, number>;
  checkedAt: string;
};

function allocateUniqueSlug(base: string, taken: Set<string>, fallback: string): string {
  const cleanBase = slugify(base).toLowerCase().slice(0, 64) || fallback;
  if (!taken.has(cleanBase)) {
    taken.add(cleanBase);
    return cleanBase;
  }
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${cleanBase.slice(0, 58)}-${i}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  const unique = `${cleanBase.slice(0, 50)}-${id().slice(0, 8)}`.toLowerCase();
  taken.add(unique);
  return unique;
}

export function validateWizardSubscriptionUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  // eslint-disable-next-line no-control-regex
  if (!trimmed || /[\r\n\0\x00-\x1f\x7f\s]/.test(trimmed)) {
    throw new AppError('VALIDATION_FAILED', '订阅链接格式无效，请检查后重试。', {
      previewErrorCode: 'LINK_INVALID' satisfies PreviewSubscriptionErrorCode,
    });
  }
  try {
    return validateRemoteSourceUrl(trimmed);
  } catch (error) {
    if (error instanceof AppError) {
      const sanitized = sanitizeNodeFetchErrorMessage(error.message, trimmed);
      throw new AppError(error.code, sanitized || '订阅链接格式无效，请检查后重试。', {
        previewErrorCode: 'LINK_INVALID' satisfies PreviewSubscriptionErrorCode,
      });
    }
    throw new AppError('VALIDATION_FAILED', '订阅链接格式无效，请检查后重试。', {
      previewErrorCode: 'LINK_INVALID' satisfies PreviewSubscriptionErrorCode,
    });
  }
}

export function validateSubscriptionUserAgent(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // eslint-disable-next-line no-control-regex
  if (trimmed.length > 256 || /[\r\n\0\x00-\x1f\x7f]/.test(trimmed)) {
    throw new AppError('VALIDATION_FAILED', 'User-Agent 格式无效。', {
      previewErrorCode: 'LINK_INVALID' satisfies PreviewSubscriptionErrorCode,
    });
  }
  return trimmed;
}

function resolvePreviewUserAgent(value?: string | null): string {
  return validateSubscriptionUserAgent(value) ?? DEFAULT_PREVIEW_USER_AGENT;
}

function buildRegionStatsFromCounts(counts: Readonly<Record<string, number>>): PreviewSubscriptionRegionStat[] {
  const stats: PreviewSubscriptionRegionStat[] = [];
  for (const [rawCode, count] of Object.entries(counts)) {
    if (!Number.isFinite(count) || count <= 0) continue;
    const code = rawCode.toUpperCase();
    const def = getRegionDefinition(code);
    stats.push({
      code,
      name: def?.nameZh ?? code,
      emoji: def?.flag ?? '🌐',
      count,
    });
  }
  stats.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  return stats;
}

function buildQuickCreateSubscriptionUrl(options: {
  baseUrl?: string;
  ruleToken?: string;
  slug: string;
  client: TemplateClientId;
}): string | null {
  if (!isTemplateClientSupported(options.client)) return null;
  if (!options.ruleToken) return null;
  const base = (options.baseUrl ?? '').replace(/\/+$/, '');
  const meta = TEMPLATE_CLIENTS[options.client];
  const path = `/t/${encodeURIComponent(options.ruleToken)}/${encodeURIComponent(options.slug)}/${meta.fileName}`;
  return base ? `${base}${path}` : path;
}

/**
 * B1 + R3: `POST /api/templates/quick-create`
 *
 * Atomically creates:
 * 1. User app cards for referenced rule sets (prepended in exact input order)
 * 2. Template (starting from built-in "标准模板", marked with `wizardMeta.createdByWizard`) + v1 snapshot
 * 3. One token-protected publication per deduplicated client (Loon / Quantumult X keep rules-only default)
 * 4. Optional encrypted node bindings for all subscriptions (up to 10) across every publication
 *
 * All database writes execute in a single `env.DB.batch([...])` transaction so any failure rolls back completely.
 */
export async function quickCreateTemplate(
  env: Env,
  input: QuickCreateTemplateServiceInput,
  options: QuickCreateTemplateOptions = {},
): Promise<QuickCreateTemplateResult> {
  const repos = createRepositories(env.DB);
  const timestamp = now();
  const combineMode: NodeCombineMode = input.combineMode ?? 'merge';

  // Deduplicate target clients while preserving order
  const uniqueClients: TemplateClientId[] = [];
  const seenClients = new Set<TemplateClientId>();
  for (const client of input.clients) {
    if (seenClients.has(client)) continue;
    seenClients.add(client);
    uniqueClients.push(client);
  }
  if (uniqueClients.length === 0) {
    throw new AppError('VALIDATION_FAILED', '请至少选择一个客户端。');
  }

  // Deduplicate referenced rulesets while preserving exact user order
  const dedupedRulesetInputs: QuickCreateTemplateServiceInput['rulesets'] = [];
  const seenRulesetIds = new Set<string>();
  for (const item of input.rulesets) {
    if (seenRulesetIds.has(item.rulesetId)) continue;
    seenRulesetIds.add(item.rulesetId);
    dedupedRulesetInputs.push(item);
  }

  // Normalize subscriptions list (supports both `subscriptions[]` and legacy `subscriptionUrl`)
  const rawSubscriptions =
    input.subscriptions && input.subscriptions.length > 0
      ? input.subscriptions
      : input.subscriptionUrl
        ? [{ url: input.subscriptionUrl, previewSummary: input.previewSummary }]
        : [];

  if (rawSubscriptions.length > MAX_TEMPLATE_SUBSCRIPTIONS) {
    throw new AppError('VALIDATION_FAILED', `最多支持 ${MAX_TEMPLATE_SUBSCRIPTIONS} 条机场订阅。`);
  }

  // Validate all subscription URLs (SSRF + syntax) and userAgents upfront before any DB work
  const validatedSubscriptions: Array<{
    url: string;
    maskedUrl: string;
    userAgent: string | null;
    name?: string;
    previewSummary?: QuickCreatePreviewSummary;
  }> = [];

  for (let i = 0; i < rawSubscriptions.length; i += 1) {
    const item = rawSubscriptions[i];
    const normalizedUrl = validateWizardSubscriptionUrl(item.url);
    const userAgent = validateSubscriptionUserAgent('userAgent' in item ? item.userAgent : undefined);
    const previewSummary = item.previewSummary ?? (rawSubscriptions.length === 1 ? input.previewSummary : undefined);
    validatedSubscriptions.push({
      url: normalizedUrl,
      maskedUrl: maskSubscriptionUrl(normalizedUrl),
      userAgent,
      name: 'name' in item ? item.name : undefined,
      previewSummary,
    });
  }

  const sessionSecret = validatedSubscriptions.length > 0 ? await resolveSessionSecret(env) : undefined;
  const normalizedSlots =
    validatedSubscriptions.length > 0
      ? buildNormalizedQuickCreateSlots(validatedSubscriptions.map((sub) => ({ name: sub.name })))
      : [];

  // Load existing slugs & verify all referenced rulesets exist
  const [existingCards, existingTemplates, existingPublications, resolvedCategories] = await Promise.all([
    repos.cards.listAll(),
    repos.templates.listAll(),
    repos.publications.listAll(),
    Promise.all(dedupedRulesetInputs.map((item) => repos.rulesets.findById(item.rulesetId))),
  ]);

  const takenCardSlugs = new Set<string>([
    ...BUILTIN_CARDS.map((card) => card.slug.toLowerCase()),
    ...existingCards.map((card) => card.slug.toLowerCase()),
  ]);
  const takenTemplateSlugs = new Set<string>(existingTemplates.map((tpl) => tpl.slug.toLowerCase()));
  const takenPublicationSlugs = new Set<string>(existingPublications.map((pub) => pub.slug.toLowerCase()));

  const resolvedRulesets: QuickCreateResolvedRuleset[] = [];
  for (let i = 0; i < dedupedRulesetInputs.length; i += 1) {
    const item = dedupedRulesetInputs[i];
    const category = resolvedCategories[i];
    if (!category) {
      throw new AppError('RULESET_NOT_FOUND', `引用的规则集不存在：${item.rulesetId}`);
    }
    const cardId = id();
    const cardSlug = allocateUniqueSlug(`rs-${category.slug || category.name}`, takenCardSlugs, 'ruleset-card');
    resolvedRulesets.push({
      rulesetId: category.id,
      name: category.name,
      slug: category.slug,
      route: item.route,
      cardId,
      cardSlug,
    });
  }

  const templateName = input.name.trim() || '我的配置';
  const templateId = id();
  const templateSlug = allocateUniqueSlug(templateName, takenTemplateSlugs, 'template');

  // Build per-slot preview summaries & merged detected regions
  const subscriptionPreviews: Record<string, QuickCreatePreviewSummary> = {};
  const mergedRegionCounts: Record<string, number> = {};
  let aggregatedNodeCount = 0;
  let hasAggregatedPreview = false;
  let latestPreviewCheckedAt: string | undefined;

  for (let i = 0; i < normalizedSlots.length; i += 1) {
    const slot = normalizedSlots[i];
    const sub = validatedSubscriptions[i];
    if (!sub.previewSummary) continue;
    subscriptionPreviews[slot.id] = sub.previewSummary;
    if (sub.previewSummary.status !== 'error') {
      hasAggregatedPreview = true;
      aggregatedNodeCount += sub.previewSummary.nodeCount;
      for (const [code, count] of Object.entries(sub.previewSummary.regions)) {
        const upper = code.toUpperCase();
        mergedRegionCounts[upper] = (mergedRegionCounts[upper] ?? 0) + count;
      }
      if (
        sub.previewSummary.checkedAt &&
        (!latestPreviewCheckedAt || sub.previewSummary.checkedAt > latestPreviewCheckedAt)
      ) {
        latestPreviewCheckedAt = sub.previewSummary.checkedAt;
      }
    }
  }

  const effectivePreviewSummary: QuickCreatePreviewSummary | undefined =
    input.previewSummary ??
    (hasAggregatedPreview
      ? {
          nodeCount: aggregatedNodeCount,
          regions: mergedRegionCounts,
          status: 'ok',
          ...(latestPreviewCheckedAt ? { checkedAt: latestPreviewCheckedAt } : {}),
        }
      : undefined);

  const detectedRegionSet = new Set<string>();
  if (input.detectedRegions && input.detectedRegions.length > 0) {
    for (const code of input.detectedRegions) detectedRegionSet.add(code.toUpperCase());
  } else {
    if (input.previewSummary) {
      for (const code of Object.keys(input.previewSummary.regions)) detectedRegionSet.add(code.toUpperCase());
    }
    for (const code of Object.keys(mergedRegionCounts)) detectedRegionSet.add(code);
  }
  const detectedRegions = detectedRegionSet.size > 0 ? Array.from(detectedRegionSet) : undefined;

  const complexity = input.complexity ?? 'simple';
  const starterBase = buildComplexityStarterTemplate(complexity === 'simple' ? 'advanced' : complexity);
  const { body, generatedCards } = buildQuickCreateTemplateBody({
    standardBaseBody: starterBase.baseBody,
    builtinCards: BUILTIN_CARDS,
    complexity,
    scenarios: input.scenarios,
    rulesets: resolvedRulesets,
    groupMode: input.groupMode,
    combineMode,
    slots: normalizedSlots.length > 0 ? normalizedSlots : undefined,
    hasSubscription: validatedSubscriptions.length > 0,
    detectedRegions,
    clientDisplayNames: input.clientDisplayNames,
    clientLabels: input.clientLabels,
    previewSummary: effectivePreviewSummary,
    subscriptionPreviews: Object.keys(subscriptionPreviews).length > 0 ? subscriptionPreviews : undefined,
    nodePoolOptions: input.nodePoolOptions,
    modules: input.modules,
  });

  if (complexity === 'pro' && body.modules && body.modules.length > 0) {
    const moduleCheck = validateModuleCombination(body.modules);
    if (!moduleCheck.ok) {
      throw new AppError('VALIDATION_FAILED', moduleCheck.errors[0]?.message ?? '增强模块配置存在冲突。', {
        errors: moduleCheck.errors,
        conflicts: moduleCheck.conflicts,
      });
    }
  }

  const resolvedBody = applyOverlay(body, []).resolved;

  // Prepare per-client publications and encrypted bindings for every subscription
  const preparedPublications: Array<{
    id: string;
    slug: string;
    client: TemplateClientId;
    bindings: Array<{
      slotId: string;
      encryptedSubscriptionUrl: string;
      userAgent: string | null;
      lastFetchedAt: string | null;
      lastStatus: string | null;
      lastNodeCount: number | null;
    }>;
  }> = [];

  for (const client of uniqueClients) {
    const pubId = id();
    const pubSlug = allocateUniqueSlug(`${templateSlug}-${client}`, takenPublicationSlugs, client);
    const bindings: Array<{
      slotId: string;
      encryptedSubscriptionUrl: string;
      userAgent: string | null;
      lastFetchedAt: string | null;
      lastStatus: string | null;
      lastNodeCount: number | null;
    }> = [];

    if (validatedSubscriptions.length > 0 && sessionSecret) {
      for (let i = 0; i < validatedSubscriptions.length; i += 1) {
        const sub = validatedSubscriptions[i];
        const slot = normalizedSlots[i];
        const encryptedSubscriptionUrl = await encryptNodeSecret(sub.url, sessionSecret, bindingAad(pubId, slot.id));
        const summary = sub.previewSummary;
        bindings.push({
          slotId: slot.id,
          encryptedSubscriptionUrl,
          userAgent: sub.userAgent,
          lastFetchedAt: summary ? (summary.checkedAt ?? timestamp) : null,
          lastStatus: summary ? (summary.status === 'error' ? 'error' : 'ok') : null,
          lastNodeCount: summary && summary.status !== 'error' ? summary.nodeCount : null,
        });
      }
    }

    preparedPublications.push({
      id: pubId,
      slug: pubSlug,
      client,
      bindings,
    });
  }

  // Assemble single atomic transaction batch across app_cards, templates, template_versions, publications, node_bindings
  const statements: DatabaseStatement[] = [];

  for (const card of generatedCards) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO app_cards
          (id, slug, name, icon, category, body, origin, forked_from, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        card.id,
        card.slug,
        card.name,
        card.icon ?? null,
        card.category,
        serializeCardBody(card),
        card.origin,
        card.forkedFrom ?? null,
        timestamp,
        timestamp,
      ),
    );
  }

  const baseBodyJson = serializeTemplateBodyForStorage(body, { starterTier: complexity });
  const resolvedBodyJson = serializeTemplateBodyForStorage(resolvedBody, { starterTier: complexity });

  statements.push(
    env.DB.prepare(
      `INSERT INTO templates
        (id, slug, name, description, base_kind, base_source_url, base_body, overlay, current_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(templateId, templateSlug, templateName, '', 'builtin', null, baseBodyJson, '[]', 1, timestamp, timestamp),
  );

  statements.push(
    env.DB.prepare(
      `INSERT INTO template_versions (template_id, version, resolved_body, note, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(templateId, 1, resolvedBodyJson, 'quick-create', timestamp),
  );

  for (const pub of preparedPublications) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO publications
          (id, slug, template_id, pinned_version, clients, access, output, experimental_full_config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        pub.id,
        pub.slug,
        templateId,
        null,
        JSON.stringify([pub.client]),
        'token',
        'full',
        0,
        timestamp,
        timestamp,
      ),
    );

    for (const binding of pub.bindings) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO node_bindings
            (publication_id, slot_id, subscription_url_enc, user_agent, last_fetched_at, last_status, last_node_count)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          pub.id,
          binding.slotId,
          binding.encryptedSubscriptionUrl,
          binding.userAgent,
          binding.lastFetchedAt,
          binding.lastStatus,
          binding.lastNodeCount,
        ),
      );
    }
  }

  if (options.extraBatchStatements && options.extraBatchStatements.length > 0) {
    statements.push(...options.extraBatchStatements);
  }

  await env.DB.batch(statements);

  const template: TemplateRecord = {
    id: templateId,
    slug: templateSlug,
    name: templateName,
    description: '',
    baseKind: 'builtin',
    baseBody: body,
    overlay: [],
    currentVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const firstMaskedUrl = validatedSubscriptions[0]?.maskedUrl;
  const effectiveToken = options.ruleToken;

  const publications: QuickCreatePublicationLink[] = preparedPublications.map((pub) => {
    const meta = TEMPLATE_CLIENTS[pub.client];
    return {
      id: pub.id,
      slug: pub.slug,
      client: pub.client,
      clientLabel: input.clientLabels?.[pub.client] ?? meta.label,
      fileName: meta.fileName,
      supported: isTemplateClientSupported(pub.client),
      access: 'token',
      experimentalFullConfig: false,
      url: buildQuickCreateSubscriptionUrl({
        baseUrl: options.baseUrl,
        ruleToken: effectiveToken,
        slug: pub.slug,
        client: pub.client,
      }),
      ...(firstMaskedUrl ? { maskedSubscriptionUrl: firstMaskedUrl } : {}),
    };
  });

  const subscriptions: QuickCreateSubscriptionSummary[] = normalizedSlots.map((slot, index) => ({
    slotId: slot.id,
    name: slot.name,
    maskedUrl: validatedSubscriptions[index].maskedUrl,
  }));

  return {
    template,
    resolvedBody,
    publications,
    ruleTokenConfigured: Boolean(effectiveToken),
    hasSubscription: validatedSubscriptions.length > 0,
    combineMode,
    subscriptions,
  };
}

async function previewSingleSubscription(
  input: PreviewSubscriptionSingleInput,
  options: PreviewSubscriptionOptions = {},
): Promise<PreviewSubscriptionResult> {
  const validatedUrl = validateWizardSubscriptionUrl(input.subscriptionUrl);
  const userAgent = resolvePreviewUserAgent(input.userAgent);

  let responseText: string;
  try {
    const response = await safeFetchText(validatedUrl, {
      headers: {
        'user-agent': userAgent,
        accept: 'text/yaml, text/plain, */*',
      },
      timeoutMs: options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
      maxBytes: options.maxBytes ?? DEFAULT_FETCH_MAX_BYTES,
      fetchImpl: options.fetchImpl,
      resolveDns: options.resolveDns,
    });

    if (!response.ok) {
      if (UA_REQUIRED_HTTP_STATUSES.has(response.status)) {
        throw new AppError('UPSTREAM_FAILED', '该订阅需要特定客户端标识（User-Agent）才能读取。', {
          previewErrorCode: 'NEEDS_USER_AGENT' satisfies PreviewSubscriptionErrorCode,
          httpStatus: response.status,
        });
      }
      throw new AppError('UPSTREAM_FAILED', '订阅链接已失效或服务器无法访问。', {
        previewErrorCode: 'LINK_INVALID' satisfies PreviewSubscriptionErrorCode,
        httpStatus: response.status,
      });
    }

    responseText = response.text;
  } catch (error) {
    if (
      error instanceof AppError &&
      error.details &&
      typeof error.details === 'object' &&
      'previewErrorCode' in error.details
    ) {
      throw error;
    }

    const rawMessage = error instanceof Error ? error.message : '';
    const sanitized = sanitizeNodeFetchErrorMessage(rawMessage, validatedUrl);
    const isTimeout =
      (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
      /超时|timeout|aborted/i.test(sanitized);

    if (isTimeout) {
      throw new AppError('UPSTREAM_FAILED', '读取订阅超时，请稍后重试或先直接生成配置。', {
        previewErrorCode: 'TIMEOUT' satisfies PreviewSubscriptionErrorCode,
      });
    }

    if (error instanceof AppError && error.code === 'VALIDATION_FAILED') {
      throw new AppError('VALIDATION_FAILED', sanitized || '订阅链接地址不被允许。', {
        previewErrorCode: 'LINK_INVALID' satisfies PreviewSubscriptionErrorCode,
      });
    }

    throw new AppError('UPSTREAM_FAILED', '订阅链接失效或暂时无法访问，请检查链接是否正确。', {
      previewErrorCode: 'LINK_INVALID' satisfies PreviewSubscriptionErrorCode,
    });
  }

  const parsed = parseNodeSubscription(responseText, { maxEntries: options.maxEntries });
  const previewNodes = parsed.nodes.map(toNodePreview);

  if (previewNodes.length === 0) {
    throw new AppError('VALIDATION_FAILED', '链接返回的不是有效的节点订阅内容（可能是网页或过期提示）。', {
      previewErrorCode: 'NOT_SUBSCRIPTION' satisfies PreviewSubscriptionErrorCode,
    });
  }

  const nonInfoCount = previewNodes.filter((item) => !item.isInfo).length;
  const groupedRegions = groupPreviewNodesByRegion(previewNodes);
  const regionCounts: Record<string, number> = {};
  const regions: PreviewSubscriptionRegionStat[] = [];

  for (const [code, names] of Object.entries(groupedRegions)) {
    if (names.length === 0) continue;
    regionCounts[code] = names.length;
    const def = getRegionDefinition(code);
    regions.push({
      code,
      name: def?.nameZh ?? code,
      emoji: def?.flag ?? '🌐',
      count: names.length,
    });
  }

  regions.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  return {
    nodeCount: nonInfoCount > 0 ? nonInfoCount : previewNodes.length,
    totalParsedCount: previewNodes.length,
    infoNodeCount: previewNodes.length - nonInfoCount,
    format: parsed.report.format,
    regions,
    regionCounts,
    checkedAt: now(),
  };
}

/**
 * B2 + R3: `POST /api/templates/preview-subscription`
 *
 * Fetches and parses up to 10 airport subscription URLs on the fly without persisting
 * anything to the database and without logging raw subscription URLs.
 * - Batch payload (`{ subscriptions }`): returns per-item `{ name, ok, nodeCount, regions, errorCode }`
 *   where a single subscription failure never breaks the remaining items.
 * - Legacy single payload (`{ subscriptionUrl }`): preserves exact single-item result & error contract.
 */
export async function previewSubscription(
  input: PreviewSubscriptionSingleInput,
  options?: PreviewSubscriptionOptions,
): Promise<PreviewSubscriptionResult>;
export async function previewSubscription(
  input: PreviewSubscriptionBatchInput,
  options?: PreviewSubscriptionOptions,
): Promise<PreviewSubscriptionBatchResult>;
export async function previewSubscription(
  input: PreviewSubscriptionInput,
  options?: PreviewSubscriptionOptions,
): Promise<PreviewSubscriptionResult | PreviewSubscriptionBatchResult>;
export async function previewSubscription(
  input: PreviewSubscriptionInput,
  options: PreviewSubscriptionOptions = {},
): Promise<PreviewSubscriptionResult | PreviewSubscriptionBatchResult> {
  if (!('subscriptions' in input)) {
    return previewSingleSubscription(input, options);
  }

  if (input.subscriptions.length === 0) {
    throw new AppError('VALIDATION_FAILED', '请至少提供一条订阅地址。');
  }
  if (input.subscriptions.length > MAX_TEMPLATE_SUBSCRIPTIONS) {
    throw new AppError('VALIDATION_FAILED', `一次最多预览 ${MAX_TEMPLATE_SUBSCRIPTIONS} 条订阅。`);
  }

  const usedNames = new Set<string>();
  const namedItems = input.subscriptions.map((item, index) => ({
    name: normalizeSubscriptionName(item.name, index, usedNames),
    url: item.url,
    userAgent: item.userAgent,
  }));

  const results = await Promise.all(
    namedItems.map(async (item): Promise<PreviewSubscriptionBatchItemResult> => {
      try {
        const single = await previewSingleSubscription(
          { subscriptionUrl: item.url, userAgent: item.userAgent },
          options,
        );
        return {
          name: item.name,
          ok: true,
          nodeCount: single.nodeCount,
          regions: single.regions,
          regionCounts: single.regionCounts,
          checkedAt: single.checkedAt,
          format: single.format,
          totalParsedCount: single.totalParsedCount,
          infoNodeCount: single.infoNodeCount,
        };
      } catch (error) {
        let errorCode: PreviewSubscriptionErrorCode = 'LINK_INVALID';
        let errorMessage = '订阅链接失效或暂时无法访问，请检查链接是否正确。';
        if (error instanceof AppError) {
          if (
            error.details &&
            typeof error.details === 'object' &&
            'previewErrorCode' in error.details &&
            typeof error.details.previewErrorCode === 'string'
          ) {
            errorCode = error.details.previewErrorCode as PreviewSubscriptionErrorCode;
          }
          errorMessage = sanitizeNodeFetchErrorMessage(error.message, item.url) || errorMessage;
        }
        return {
          name: item.name,
          ok: false,
          nodeCount: 0,
          regions: [],
          regionCounts: {},
          errorCode,
          error: errorMessage,
          checkedAt: now(),
        };
      }
    }),
  );

  const mergedRegionCounts: Record<string, number> = {};
  let totalNodeCount = 0;
  for (const item of results) {
    if (!item.ok) continue;
    totalNodeCount += item.nodeCount;
    for (const [code, count] of Object.entries(item.regionCounts)) {
      mergedRegionCounts[code] = (mergedRegionCounts[code] ?? 0) + count;
    }
  }

  return {
    items: results,
    totalNodeCount,
    regions: buildRegionStatsFromCounts(mergedRegionCounts),
    regionCounts: mergedRegionCounts,
    checkedAt: now(),
  };
}
