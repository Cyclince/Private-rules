import { BUILTIN_CARDS } from '../../builtin';
import { createRepositories, serializeCardBody, TEMPLATE_VERSION_RETENTION } from '../../data/repositories';
import {
  getRegionDefinition,
  groupPreviewNodesByRegion,
  toNodePreview,
  type NodePreviewItem,
  type ParsedNode,
} from '../../domain/nodes';
import { id, slugify } from '../../domain/rules/slug';
import {
  allocateSubscriptionSlotId,
  applyOverlay,
  applySimpleTemplatePatch,
  mapTemplateToSimpleRouting,
  normalizeSubscriptionName,
  type QuickCreateResolvedRuleset,
  type SimpleRoutingView,
  type SimpleRulesetRef,
} from '../../domain/templates';
import { decryptNodeSecret, encryptNodeSecret, maskSubscriptionUrl } from '../../infrastructure/crypto/node-secrets';
import { resolveSessionSecret } from '../../lib/runtime-secrets';
import {
  isTemplateClientSupported,
  TEMPLATE_CLIENTS,
  type OutputProfile,
  type TemplateClientId,
} from '../../shared/clients';
import { AppError } from '../../shared/errors';
import type { PublicationAccess } from '../../shared/schemas/publication';
import {
  MAX_TEMPLATE_SUBSCRIPTIONS,
  type NodeCombineMode,
  type QuickCreatePreviewSummary,
  type SimpleTemplatePatchInput,
  type WizardGroupMode,
} from '../../shared/schemas/quick-create';
import type { ComplexityTier, NodeSlot, TemplateBody, TemplateRecord } from '../../shared/schemas/template';
import type { Env } from '../../types';
import { loadCardLookup } from '../cards';
import { bindingAad, snapshotAad } from '../publications/nodes';
import { now } from '../rulesets';
import { validateSubscriptionUserAgent, validateWizardSubscriptionUrl } from './quick-create';

export type SimpleTemplateNodeRegionStat = {
  code: string;
  name: string;
  emoji: string;
  count: number;
};

export type SimpleTemplateSubscriptionItem = {
  slotId: string;
  name: string;
  bound: boolean;
  needsRebind: boolean;
  boundPublicationCount: number;
  totalPublicationCount: number;
  maskedUrl?: string;
  nodeCount: number | null;
  regions: SimpleTemplateNodeRegionStat[];
  lastFetchedAt?: string;
  lastStatus?: string;
};

export type SimpleTemplateNodesView = {
  hasMainSlot: boolean;
  bound: boolean;
  needsRebind: boolean;
  boundPublicationCount: number;
  totalPublicationCount: number;
  maskedUrl?: string;
  nodeCount: number | null;
  regions: SimpleTemplateNodeRegionStat[];
  lastFetchedAt?: string;
  lastStatus?: string;
  groupMode: WizardGroupMode;
  combineMode: NodeCombineMode;
  hasExtraSlots: boolean;
  subscriptions: SimpleTemplateSubscriptionItem[];
};

export type SimpleTemplateOutputLink = {
  client: TemplateClientId;
  label: string;
  displayName: string;
  fileName: string;
  supported: boolean;
  url: string | null;
};

export type SimpleTemplateOutputItem = {
  id: string;
  slug: string;
  clients: TemplateClientId[];
  access: PublicationAccess;
  output: OutputProfile;
  experimentalFullConfig: boolean;
  pinnedVersion: number | null;
  hasBindings: boolean;
  slotsCount: number;
  links: SimpleTemplateOutputLink[];
  updatedAt: string;
};

export type SimpleTemplateView = {
  template: {
    id: string;
    slug: string;
    name: string;
    description: string;
    currentVersion: number;
    baseKind: TemplateRecord['baseKind'];
    complexity: ComplexityTier;
    updatedAt: string;
    createdAt: string;
    createdByWizard: boolean;
  };
  routing: SimpleRoutingView;
  nodes: SimpleTemplateNodesView;
  outputs: SimpleTemplateOutputItem[];
  ruleTokenConfigured: boolean;
};

export type SimpleTemplateViewOptions = {
  baseUrl?: string;
  ruleToken?: string;
};

type StoredSnapshotLike = {
  v?: number;
  kind?: 'full' | 'preview';
  nodes?: unknown[];
};

function buildRegionStatsFromCounts(counts: Readonly<Record<string, number>>): SimpleTemplateNodeRegionStat[] {
  const stats: SimpleTemplateNodeRegionStat[] = [];
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

function summarizeDecryptedSnapshot(rawJson: string): {
  nodeCount: number;
  regions: SimpleTemplateNodeRegionStat[];
} | null {
  try {
    const parsed = JSON.parse(rawJson) as StoredSnapshotLike;
    if (!parsed || !Array.isArray(parsed.nodes)) return null;
    let previewNodes: NodePreviewItem[];
    if (parsed.kind === 'full') {
      previewNodes = (parsed.nodes as ParsedNode[]).map(toNodePreview);
    } else if (parsed.kind === 'preview') {
      previewNodes = parsed.nodes as NodePreviewItem[];
    } else {
      return null;
    }

    const nonInfoCount = previewNodes.filter((item) => !item.isInfo).length;
    const grouped = groupPreviewNodesByRegion(previewNodes);
    const counts: Record<string, number> = {};
    for (const [code, names] of Object.entries(grouped)) {
      if (names.length > 0) counts[code] = names.length;
    }

    return {
      nodeCount: nonInfoCount > 0 ? nonInfoCount : previewNodes.length,
      regions: buildRegionStatsFromCounts(counts),
    };
  } catch {
    return null;
  }
}

function buildOutputLinks(params: {
  slug: string;
  clients: readonly TemplateClientId[];
  access: PublicationAccess;
  hasBindings: boolean;
  baseUrl: string;
  ruleToken?: string;
  clientLabels?: Partial<Record<TemplateClientId, string>>;
}): SimpleTemplateOutputLink[] {
  const encodedSlug = encodeURIComponent(params.slug);
  const encodedToken = params.ruleToken ? encodeURIComponent(params.ruleToken) : '';

  return params.clients.map((client) => {
    const meta = TEMPLATE_CLIENTS[client];
    const supported = isTemplateClientSupported(client);
    let url: string | null = null;

    if (supported && params.access === 'public' && !params.hasBindings) {
      url = `${params.baseUrl}/p/${encodedSlug}/${meta.fileName}`;
    } else if (supported && params.access === 'token' && encodedToken) {
      url = `${params.baseUrl}/t/${encodedToken}/${encodedSlug}/${meta.fileName}`;
    }

    return {
      client,
      label: meta.label,
      displayName: params.clientLabels?.[client] ?? meta.label,
      fileName: meta.fileName,
      supported,
      url,
    };
  });
}

async function assembleSimpleTemplateView(
  env: Env,
  template: TemplateRecord,
  resolvedBody: TemplateBody,
  options: SimpleTemplateViewOptions = {},
): Promise<SimpleTemplateView> {
  const repos = createRepositories(env.DB);
  const [cards, allRulesets, allPublications] = await Promise.all([
    loadCardLookup(env),
    repos.rulesets.listAll(),
    repos.publications.listAll(),
  ]);

  const rulesetMap = new Map<string, SimpleRulesetRef>(
    allRulesets.map((rs) => [
      rs.id,
      {
        id: rs.id,
        name: rs.name,
        slug: rs.slug,
      },
    ]),
  );

  const routing = mapTemplateToSimpleRouting(resolvedBody, cards, rulesetMap);
  const templatePubs = allPublications.filter((pub) => pub.templateId === template.id);
  const baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
  const clientLabels = resolvedBody.wizardMeta?.clientLabels;
  const secret = templatePubs.length > 0 ? await resolveSessionSecret(env) : null;

  // Load bindings for all publications of this template
  const bindingsByPub = new Map<string, Awaited<ReturnType<typeof repos.nodeBindings.listByPublication>>>();
  const outputs: SimpleTemplateOutputItem[] = [];

  for (const pub of templatePubs) {
    const bindings = await repos.nodeBindings.listByPublication(pub.id);
    bindingsByPub.set(pub.id, bindings);
    const hasBindings = bindings.length > 0;

    outputs.push({
      id: pub.id,
      slug: pub.slug,
      clients: pub.clients,
      access: pub.access,
      output: pub.output ?? resolvedBody.output,
      experimentalFullConfig: pub.experimentalFullConfig,
      pinnedVersion: pub.pinnedVersion ?? null,
      hasBindings,
      slotsCount: resolvedBody.slots.length,
      links: buildOutputLinks({
        slug: pub.slug,
        clients: pub.clients,
        access: pub.access,
        hasBindings,
        baseUrl,
        ruleToken: options.ruleToken,
        clientLabels,
      }),
      updatedAt: pub.updatedAt ?? '',
    });
  }

  // Assemble per-subscription status from existing bindings & encrypted snapshots ONLY (no outbound fetch)
  const subscriptions: SimpleTemplateSubscriptionItem[] = [];
  const activeSlotIds = new Set(resolvedBody.slots.map((s) => s.id));

  for (const slot of resolvedBody.slots) {
    let slotBoundPubCount = 0;
    let slotNeedsRebind = false;
    let slotMaskedUrl: string | undefined;
    let bestSnapshotFetchedAt: string | undefined;
    let snapshotSummary: { nodeCount: number; regions: SimpleTemplateNodeRegionStat[] } | null = null;
    let fallbackNodeCount: number | null = null;
    let slotLastFetchedAt: string | undefined;
    let slotLastStatus: string | undefined;

    for (const pub of templatePubs) {
      const bindings = bindingsByPub.get(pub.id) ?? [];
      const binding = bindings.find((b) => b.slotId === slot.id);
      if (!binding || !secret) continue;

      slotBoundPubCount += 1;
      if (!slotMaskedUrl) {
        try {
          const plaintext = await decryptNodeSecret(
            binding.subscriptionUrlEnc,
            secret,
            bindingAad(binding.publicationId, binding.slotId),
          );
          slotMaskedUrl = maskSubscriptionUrl(plaintext);
        } catch {
          slotNeedsRebind = true;
        }
      }
      if (binding.lastFetchedAt && (!slotLastFetchedAt || binding.lastFetchedAt > slotLastFetchedAt)) {
        slotLastFetchedAt = binding.lastFetchedAt;
        slotLastStatus = binding.lastStatus ?? undefined;
      } else if (!slotLastStatus && binding.lastStatus) {
        slotLastStatus = binding.lastStatus;
      }
      if (fallbackNodeCount === null && binding.lastNodeCount !== null && binding.lastNodeCount !== undefined) {
        fallbackNodeCount = binding.lastNodeCount;
      }

      // Read existing encrypted snapshot only — NEVER trigger an outbound fetch.
      const snapRow = await repos.nodeBindings.findNodeSnapshot(pub.id, slot.id);
      if (snapRow && (!bestSnapshotFetchedAt || snapRow.fetchedAt > bestSnapshotFetchedAt)) {
        try {
          const decryptedSnap = await decryptNodeSecret(snapRow.nodesEnc, secret, snapshotAad(pub.id, slot.id));
          const summarized = summarizeDecryptedSnapshot(decryptedSnap);
          if (summarized) {
            snapshotSummary = summarized;
            bestSnapshotFetchedAt = snapRow.fetchedAt;
          }
        } catch {
          // Ignore unreadable snapshot
        }
      }
    }

    const slotBound = slotBoundPubCount > 0;
    let slotNodeCount: number | null = snapshotSummary?.nodeCount ?? fallbackNodeCount;
    let slotRegions: SimpleTemplateNodeRegionStat[] = snapshotSummary?.regions ?? [];

    const slotPreviewFallback =
      resolvedBody.wizardMeta?.subscriptionPreviews?.[slot.id] ??
      (slot.id === 'slot-main' && resolvedBody.slots.length === 1
        ? resolvedBody.wizardMeta?.previewSummary
        : undefined);

    if (slotBound && !slotNeedsRebind && slotNodeCount === null && slotPreviewFallback) {
      slotNodeCount = slotPreviewFallback.nodeCount;
      slotRegions = buildRegionStatsFromCounts(slotPreviewFallback.regions);
      if (!slotLastFetchedAt && slotPreviewFallback.checkedAt) {
        slotLastFetchedAt = slotPreviewFallback.checkedAt;
      }
      if (!slotLastStatus && slotPreviewFallback.status) {
        slotLastStatus = slotPreviewFallback.status;
      }
    } else if (slotBound && !slotNeedsRebind && slotRegions.length === 0 && slotPreviewFallback) {
      slotRegions = buildRegionStatsFromCounts(slotPreviewFallback.regions);
    }

    subscriptions.push({
      slotId: slot.id,
      name: slot.name,
      bound: slotBound,
      needsRebind: slotNeedsRebind,
      boundPublicationCount: slotBoundPubCount,
      totalPublicationCount: templatePubs.length,
      ...(slotMaskedUrl ? { maskedUrl: slotMaskedUrl } : {}),
      nodeCount: slotNodeCount,
      regions: slotRegions,
      ...(slotLastFetchedAt ? { lastFetchedAt: slotLastFetchedAt } : {}),
      ...(slotLastStatus ? { lastStatus: slotLastStatus } : {}),
    });
  }

  // Compute aggregated top-level nodes summary (backward compatible with beta.2 UI & consumers)
  const bound = subscriptions.some((s) => s.bound);
  const needsRebind = subscriptions.some((s) => s.needsRebind);
  const boundPublicationCount = templatePubs.filter((pub) =>
    (bindingsByPub.get(pub.id) ?? []).some((b) => activeSlotIds.has(b.slotId)),
  ).length;

  const primarySub =
    subscriptions.find((s) => s.slotId === 'slot-main' && s.maskedUrl) ?? subscriptions.find((s) => s.maskedUrl);
  const maskedUrl = primarySub?.maskedUrl;

  let totalNodeCount: number | null = null;
  const mergedRegionCounts: Record<string, number> = {};
  let lastFetchedAt: string | undefined;
  let lastStatus: string | undefined;

  for (const sub of subscriptions) {
    if (sub.nodeCount !== null) {
      totalNodeCount = (totalNodeCount ?? 0) + sub.nodeCount;
    }
    for (const stat of sub.regions) {
      mergedRegionCounts[stat.code] = (mergedRegionCounts[stat.code] ?? 0) + stat.count;
    }
    if (sub.lastFetchedAt && (!lastFetchedAt || sub.lastFetchedAt > lastFetchedAt)) {
      lastFetchedAt = sub.lastFetchedAt;
      lastStatus = sub.lastStatus;
    } else if (!lastStatus && sub.lastStatus) {
      lastStatus = sub.lastStatus;
    }
  }

  const regions = buildRegionStatsFromCounts(mergedRegionCounts);

  // Merge any regions seen in existing snapshots into availableRegions so the route selector includes them.
  if (regions.length > 0) {
    const existingCodes = new Set(routing.availableRegions.map((r) => r.code));
    for (const stat of regions) {
      if (existingCodes.has(stat.code)) continue;
      existingCodes.add(stat.code);
      routing.availableRegions.push({ code: stat.code, name: stat.name, emoji: stat.emoji });
    }
  }

  const hasMainSlot = resolvedBody.slots.some((slot) => slot.id === 'slot-main');
  const hasExtraSlots = resolvedBody.slots.some((slot) => slot.id !== 'slot-main');
  const combineMode: NodeCombineMode = resolvedBody.combineMode ?? resolvedBody.wizardMeta?.combineMode ?? 'merge';

  return {
    template: {
      id: template.id,
      slug: template.slug,
      name: template.name,
      description: template.description,
      currentVersion: template.currentVersion,
      baseKind: template.baseKind,
      complexity: routing.complexity,
      updatedAt: template.updatedAt ?? '',
      createdAt: template.createdAt ?? '',
      createdByWizard: Boolean(resolvedBody.wizardMeta?.createdByWizard),
    },
    routing,
    nodes: {
      hasMainSlot,
      bound,
      needsRebind,
      boundPublicationCount,
      totalPublicationCount: templatePubs.length,
      ...(maskedUrl ? { maskedUrl } : {}),
      nodeCount: totalNodeCount,
      regions,
      ...(lastFetchedAt ? { lastFetchedAt } : {}),
      ...(lastStatus ? { lastStatus } : {}),
      groupMode: routing.groupMode,
      combineMode,
      hasExtraSlots,
      subscriptions,
    },
    outputs,
    ruleTokenConfigured: Boolean(env.RULE_TOKEN),
  };
}

/**
 * B3 + R3: Reads a template as a plain-language 3-section view (`routing`, `nodes`, `outputs`).
 * Reads existing encrypted node snapshots only and never performs outbound HTTP fetches.
 */
export async function getSimpleTemplateView(
  env: Env,
  templateId: string,
  options: SimpleTemplateViewOptions = {},
): Promise<SimpleTemplateView> {
  const repos = createRepositories(env.DB);
  const template = await repos.templates.findById(templateId);
  if (!template) throw new AppError('TEMPLATE_NOT_FOUND', '模板不存在。');

  const resolvedBody = applyOverlay(template.baseBody, template.overlay).resolved;
  return assembleSimpleTemplateView(env, template, resolvedBody, options);
}

/**
 * B3 + R3: Applies simple-view edits (scenario toggles/routes, My Rules list/order/routes,
 * node selection mode, combineMode, subscription add/rename/remove/replaceUrl, optional template rename)
 * as a new template version while preserving all custom cards, custom scenario overrides,
 * DNS, modules, and client patches verbatim.
 */
export async function patchSimpleTemplateView(
  env: Env,
  templateId: string,
  input: SimpleTemplatePatchInput,
  options: SimpleTemplateViewOptions = {},
): Promise<{ view: SimpleTemplateView; version: number }> {
  const repos = createRepositories(env.DB);
  const existing = await repos.templates.findById(templateId);
  if (!existing) throw new AppError('TEMPLATE_NOT_FOUND', '模板不存在。');

  const currentResolved = applyOverlay(existing.baseBody, existing.overlay).resolved;
  const [cards, allRulesets, allPublications] = await Promise.all([
    loadCardLookup(env),
    repos.rulesets.listAll(),
    repos.publications.listAll(),
  ]);
  const rulesetById = new Map(allRulesets.map((rs) => [rs.id, rs]));
  const rulesetMap = new Map<string, SimpleRulesetRef>(
    allRulesets.map((rs) => [
      rs.id,
      {
        id: rs.id,
        name: rs.name,
        slug: rs.slug,
      },
    ]),
  );

  const templatePubs = allPublications.filter((pub) => pub.templateId === existing.id);

  // Process subscription slot mutations upfront (all validation before any DB write)
  let nextSlots: NodeSlot[] = structuredClone(currentResolved.slots);
  let slotsChanged = false;
  const nextSubscriptionPreviews: Record<string, QuickCreatePreviewSummary> = {
    ...(currentResolved.wizardMeta?.subscriptionPreviews ?? {}),
  };
  let subscriptionPreviewsChanged = false;

  const removedSlotIds: string[] = [];
  if (input.removeSlotIds && input.removeSlotIds.length > 0) {
    const removeSet = new Set(input.removeSlotIds);
    const beforeLen = nextSlots.length;
    nextSlots = nextSlots.filter((slot) => !removeSet.has(slot.id));
    if (nextSlots.length !== beforeLen) {
      slotsChanged = true;
    }
    for (const slotId of removeSet) {
      removedSlotIds.push(slotId);
      if (slotId in nextSubscriptionPreviews) {
        delete nextSubscriptionPreviews[slotId];
        subscriptionPreviewsChanged = true;
      }
    }
  }

  if (input.renameSubscriptions && input.renameSubscriptions.length > 0) {
    const slotById = new Map(nextSlots.map((slot) => [slot.id, slot]));
    for (const item of input.renameSubscriptions) {
      const target = slotById.get(item.slotId);
      if (!target) {
        throw new AppError('VALIDATION_FAILED', `节点来源「${item.slotId}」不存在，无法重命名。`);
      }
      target.name = item.name.trim();
      slotsChanged = true;
    }
    // Deduplicate names across all remaining slots
    const usedNames = new Set<string>();
    nextSlots = nextSlots.map((slot, idx) => ({
      ...slot,
      name: normalizeSubscriptionName(slot.name, idx, usedNames),
    }));
  }

  type PendingBindingUpsert = {
    slotId: string;
    url: string;
    userAgent: string | null;
    previewSummary?: QuickCreatePreviewSummary;
  };
  const pendingUpserts: PendingBindingUpsert[] = [];

  if (input.addSubscriptions && input.addSubscriptions.length > 0) {
    if (nextSlots.length + input.addSubscriptions.length > MAX_TEMPLATE_SUBSCRIPTIONS) {
      throw new AppError('VALIDATION_FAILED', `最多支持 ${MAX_TEMPLATE_SUBSCRIPTIONS} 条机场订阅。`);
    }
    const usedSlotIds = new Set(nextSlots.map((slot) => slot.id));
    const usedNames = new Set(nextSlots.map((slot) => slot.name));

    for (const item of input.addSubscriptions) {
      const validatedUrl = validateWizardSubscriptionUrl(item.url);
      const userAgent = validateSubscriptionUserAgent(item.userAgent);
      const slotId = allocateSubscriptionSlotId(usedSlotIds);
      const name = normalizeSubscriptionName(item.name, nextSlots.length, usedNames);
      nextSlots.push({
        id: slotId,
        name,
        excludeInfo: true,
        udp: true,
      });
      slotsChanged = true;
      pendingUpserts.push({
        slotId,
        url: validatedUrl,
        userAgent,
        previewSummary: item.previewSummary,
      });
      if (item.previewSummary) {
        nextSubscriptionPreviews[slotId] = item.previewSummary;
        subscriptionPreviewsChanged = true;
      }
    }
  }

  if (input.replaceSubscriptionUrls && input.replaceSubscriptionUrls.length > 0) {
    const slotIdSet = new Set(nextSlots.map((slot) => slot.id));
    for (const item of input.replaceSubscriptionUrls) {
      if (!slotIdSet.has(item.slotId)) {
        throw new AppError('VALIDATION_FAILED', `节点来源「${item.slotId}」不存在，无法更换地址。`);
      }
      const validatedUrl = validateWizardSubscriptionUrl(item.url);
      const userAgent = validateSubscriptionUserAgent(item.userAgent);
      pendingUpserts.push({
        slotId: item.slotId,
        url: validatedUrl,
        userAgent,
        previewSummary: item.previewSummary,
      });
      if (item.previewSummary) {
        nextSubscriptionPreviews[item.slotId] = item.previewSummary;
        subscriptionPreviewsChanged = true;
      } else if (item.slotId in nextSubscriptionPreviews) {
        delete nextSubscriptionPreviews[item.slotId];
        subscriptionPreviewsChanged = true;
      }
    }
  }

  if (pendingUpserts.length > 0 && templatePubs.some((pub) => pub.access === 'public')) {
    throw new AppError('VALIDATION_FAILED', '该模板存在公开访问链接，请先将发布改为令牌保护后再绑定机场订阅。');
  }

  // Resolve encryption key & pre-encrypt all pending bindings before writing to DB
  const secret = templatePubs.length > 0 ? await resolveSessionSecret(env) : null;
  const preparedUpserts: Array<{
    publicationId: string;
    slotId: string;
    subscriptionUrlEnc: string;
    userAgent: string | null;
    previewSummary?: QuickCreatePreviewSummary;
  }> = [];

  if (pendingUpserts.length > 0 && templatePubs.length > 0 && secret) {
    for (const pub of templatePubs) {
      for (const item of pendingUpserts) {
        const encrypted = await encryptNodeSecret(item.url, secret, bindingAad(pub.id, item.slotId));
        preparedUpserts.push({
          publicationId: pub.id,
          slotId: item.slotId,
          subscriptionUrlEnc: encrypted,
          userAgent: item.userAgent,
          previewSummary: item.previewSummary,
        });
      }
    }
  }

  // Determine whether any remaining slot has bindings & collect detected regions across remaining slots
  const remainingSlotIds = new Set(nextSlots.map((s) => s.id));
  const upsertedSlotIds = new Set(pendingUpserts.map((u) => u.slotId));
  let hasSubscription = pendingUpserts.length > 0;
  const detectedRegionsSet = new Set<string>();

  for (const [slotId, summary] of Object.entries(nextSubscriptionPreviews)) {
    if (!remainingSlotIds.has(slotId)) continue;
    for (const code of Object.keys(summary.regions)) {
      detectedRegionsSet.add(code.toUpperCase());
    }
  }
  if (
    detectedRegionsSet.size === 0 &&
    remainingSlotIds.has('slot-main') &&
    currentResolved.wizardMeta?.previewSummary
  ) {
    for (const code of Object.keys(currentResolved.wizardMeta.previewSummary.regions)) {
      detectedRegionsSet.add(code.toUpperCase());
    }
  }

  for (const pub of templatePubs) {
    const bindings = await repos.nodeBindings.listByPublication(pub.id);
    for (const binding of bindings) {
      if (!remainingSlotIds.has(binding.slotId)) continue;
      hasSubscription = true;
      if (upsertedSlotIds.has(binding.slotId)) continue;
      if (secret) {
        const snapRow = await repos.nodeBindings.findNodeSnapshot(pub.id, binding.slotId);
        if (snapRow) {
          try {
            const decryptedSnap = await decryptNodeSecret(
              snapRow.nodesEnc,
              secret,
              snapshotAad(pub.id, binding.slotId),
            );
            const summarized = summarizeDecryptedSnapshot(decryptedSnap);
            if (summarized) {
              for (const r of summarized.regions) detectedRegionsSet.add(r.code);
            }
          } catch {
            // Ignore unreadable snapshot
          }
        }
      }
    }
  }

  let resolvedRulesets: QuickCreateResolvedRuleset[] | undefined;
  if (input.rulesets !== undefined) {
    resolvedRulesets = [];
    const seen = new Set<string>();
    const existingSimple = mapTemplateToSimpleRouting(currentResolved, cards, rulesetMap);
    const existingCardByRulesetId = new Map(existingSimple.rulesets.map((item) => [item.rulesetId, item.cardId]));
    for (const item of input.rulesets) {
      if (seen.has(item.rulesetId)) continue;
      seen.add(item.rulesetId);
      const found = rulesetById.get(item.rulesetId);
      if (!found) {
        throw new AppError('VALIDATION_FAILED', `所选规则「${item.rulesetId}」不存在。`);
      }
      const reusedCardId = existingCardByRulesetId.get(found.id);
      const reusedCard = reusedCardId ? cards.get(reusedCardId) : undefined;
      const cardId = reusedCard?.id ?? id();
      const rawSlug = slugify(`ruleset-${found.slug || found.name}`) || `ruleset-${cardId.slice(-6)}`;
      const cardSlug = reusedCard?.slug ?? `${rawSlug.slice(0, 64)}-${cardId.slice(-6)}`;
      resolvedRulesets.push({
        rulesetId: found.id,
        name: found.name,
        slug: found.slug,
        route: item.route,
        cardId,
        cardSlug,
      });
    }
  }

  const detectedRegions = detectedRegionsSet.size > 0 ? Array.from(detectedRegionsSet) : undefined;
  const patched = applySimpleTemplatePatch({
    currentBody: currentResolved,
    cardMap: cards,
    builtinCards: BUILTIN_CARDS,
    rulesetMap,
    patch: {
      complexity: input.complexity,
      scenarios: input.scenarios,
      rulesets: resolvedRulesets,
      groupMode: input.groupMode,
      combineMode: input.combineMode,
      ...(slotsChanged ? { slots: nextSlots } : {}),
      ...(subscriptionPreviewsChanged ? { subscriptionPreviews: nextSubscriptionPreviews } : {}),
    },
    hasSubscription,
    detectedRegions,
  });

  const timestamp = now();
  for (const card of patched.generatedCards) {
    const alreadyExists = await repos.cards.findById(card.id);
    if (alreadyExists) continue;
    let uniqueSlug = card.slug;
    const slugConflict = await repos.cards.findBySlug(uniqueSlug);
    if (slugConflict && slugConflict.id !== card.id) {
      uniqueSlug = `${card.slug}-${card.id.slice(-6)}`.slice(0, 80);
    }
    await repos.cards.create({
      id: card.id,
      slug: uniqueSlug,
      name: card.name,
      icon: card.icon ?? null,
      category: card.category,
      origin: card.origin,
      forkedFrom: card.forkedFrom ?? null,
      body: serializeCardBody(card),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  const nextName = input.name?.trim() || existing.name;
  const nextVersion = existing.currentVersion + 1;

  await repos.templates.saveWithNewVersion({
    id: existing.id,
    slug: existing.slug,
    name: nextName,
    description: existing.description,
    baseKind: existing.baseKind,
    baseSourceUrl: existing.baseSourceUrl ?? null,
    baseBody: JSON.stringify(patched.body),
    overlay: '[]',
    version: nextVersion,
    resolvedBody: patched.body,
    note: input.note?.trim() || '更新普通视图配置',
    updatedAt: timestamp,
    maxVersions: TEMPLATE_VERSION_RETENTION,
  });

  // Apply slot binding deletions & upserts across all publications of this template
  for (const pub of templatePubs) {
    for (const slotId of removedSlotIds) {
      await repos.nodeBindings.deleteBySlot(pub.id, slotId, timestamp);
    }
  }

  for (const item of preparedUpserts) {
    await repos.nodeBindings.upsert(
      {
        publicationId: item.publicationId,
        slotId: item.slotId,
        subscriptionUrlEnc: item.subscriptionUrlEnc,
        userAgent: item.userAgent,
      },
      timestamp,
    );
    if (item.previewSummary) {
      await repos.nodeBindings.recordFetchMetadata(item.publicationId, item.slotId, {
        lastFetchedAt: item.previewSummary.checkedAt ?? timestamp,
        lastStatus: item.previewSummary.status === 'error' ? 'error' : 'ok',
        lastNodeCount: item.previewSummary.status !== 'error' ? item.previewSummary.nodeCount : null,
      });
    }
  }

  const updated = await repos.templates.findById(existing.id);
  if (!updated) throw new AppError('TEMPLATE_NOT_FOUND', '模板不存在。');

  const view = await assembleSimpleTemplateView(env, updated, patched.body, options);
  return { view, version: nextVersion };
}
