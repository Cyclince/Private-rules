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
  applyOverlay,
  applySimpleTemplatePatch,
  mapTemplateToSimpleRouting,
  type QuickCreateResolvedRuleset,
  type SimpleRoutingView,
  type SimpleRulesetRef,
} from '../../domain/templates';
import { decryptNodeSecret, maskSubscriptionUrl } from '../../infrastructure/crypto/node-secrets';
import { resolveSessionSecret } from '../../lib/runtime-secrets';
import {
  isTemplateClientSupported,
  TEMPLATE_CLIENTS,
  type OutputProfile,
  type TemplateClientId,
} from '../../shared/clients';
import { AppError } from '../../shared/errors';
import type { PublicationAccess } from '../../shared/schemas/publication';
import type { SimpleTemplatePatchInput, WizardGroupMode } from '../../shared/schemas/quick-create';
import type { TemplateBody, TemplateRecord } from '../../shared/schemas/template';
import type { Env } from '../../types';
import { loadCardLookup } from '../cards';
import { bindingAad, snapshotAad } from '../publications/nodes';
import { now } from '../rulesets';

export type SimpleTemplateNodeRegionStat = {
  code: string;
  name: string;
  emoji: string;
  count: number;
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
  hasExtraSlots: boolean;
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

  let boundPublicationCount = 0;
  let needsRebind = false;
  let maskedUrl: string | undefined;
  let bestSnapshotFetchedAt: string | undefined;
  let snapshotSummary: { nodeCount: number; regions: SimpleTemplateNodeRegionStat[] } | null = null;
  let fallbackNodeCount: number | null = null;
  let lastFetchedAt: string | undefined;
  let lastStatus: string | undefined;

  const outputs: SimpleTemplateOutputItem[] = [];

  for (const pub of templatePubs) {
    const bindings = await repos.nodeBindings.listByPublication(pub.id);
    const hasBindings = bindings.length > 0;

    const mainBinding = bindings.find((b) => b.slotId === 'slot-main');
    if (mainBinding && secret) {
      boundPublicationCount += 1;
      if (!maskedUrl) {
        try {
          const plaintext = await decryptNodeSecret(
            mainBinding.subscriptionUrlEnc,
            secret,
            bindingAad(mainBinding.publicationId, mainBinding.slotId),
          );
          maskedUrl = maskSubscriptionUrl(plaintext);
        } catch {
          needsRebind = true;
        }
      }
      if (mainBinding.lastFetchedAt && (!lastFetchedAt || mainBinding.lastFetchedAt > lastFetchedAt)) {
        lastFetchedAt = mainBinding.lastFetchedAt;
        lastStatus = mainBinding.lastStatus ?? undefined;
      } else if (!lastStatus && mainBinding.lastStatus) {
        lastStatus = mainBinding.lastStatus;
      }
      if (fallbackNodeCount === null && mainBinding.lastNodeCount !== null && mainBinding.lastNodeCount !== undefined) {
        fallbackNodeCount = mainBinding.lastNodeCount;
      }

      // Read existing encrypted snapshot only — NEVER trigger an outbound fetch.
      const snapRow = await repos.nodeBindings.findNodeSnapshot(pub.id, 'slot-main');
      if (snapRow && (!bestSnapshotFetchedAt || snapRow.fetchedAt > bestSnapshotFetchedAt)) {
        try {
          const decryptedSnap = await decryptNodeSecret(snapRow.nodesEnc, secret, snapshotAad(pub.id, 'slot-main'));
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

  const bound = boundPublicationCount > 0;
  let nodeCount: number | null = snapshotSummary?.nodeCount ?? fallbackNodeCount;
  let regions: SimpleTemplateNodeRegionStat[] = snapshotSummary?.regions ?? [];

  if (bound && !needsRebind && nodeCount === null && resolvedBody.wizardMeta?.previewSummary) {
    const summary = resolvedBody.wizardMeta.previewSummary;
    nodeCount = summary.nodeCount;
    regions = buildRegionStatsFromCounts(summary.regions);
    if (!lastFetchedAt && summary.checkedAt) {
      lastFetchedAt = summary.checkedAt;
    }
    if (!lastStatus && summary.status) {
      lastStatus = summary.status;
    }
  }

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

  return {
    template: {
      id: template.id,
      slug: template.slug,
      name: template.name,
      description: template.description,
      currentVersion: template.currentVersion,
      baseKind: template.baseKind,
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
      nodeCount,
      regions,
      ...(lastFetchedAt ? { lastFetchedAt } : {}),
      ...(lastStatus ? { lastStatus } : {}),
      groupMode: routing.groupMode,
      hasExtraSlots,
    },
    outputs,
    ruleTokenConfigured: Boolean(env.RULE_TOKEN),
  };
}

/**
 * B3: Reads a template as a plain-language 3-section view (`routing`, `nodes`, `outputs`).
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
 * B3: Applies simple-view edits (scenario toggles/routes, My Rules list/order/routes,
 * node selection mode, optional rename) as a new template version while preserving all
 * custom cards, custom scenario overrides, DNS, modules, and client patches verbatim.
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

  // Determine whether any publication under this template already binds slot-main
  const templatePubs = allPublications.filter((pub) => pub.templateId === existing.id);
  let hasSubscription = false;
  const detectedRegionsSet = new Set<string>(
    currentResolved.wizardMeta?.previewSummary ? Object.keys(currentResolved.wizardMeta.previewSummary.regions) : [],
  );
  const secret = templatePubs.length > 0 ? await resolveSessionSecret(env) : null;
  for (const pub of templatePubs) {
    const bindings = await repos.nodeBindings.listByPublication(pub.id);
    if (bindings.some((b) => b.slotId === 'slot-main')) {
      hasSubscription = true;
      if (secret) {
        const snapRow = await repos.nodeBindings.findNodeSnapshot(pub.id, 'slot-main');
        if (snapRow) {
          try {
            const decryptedSnap = await decryptNodeSecret(snapRow.nodesEnc, secret, snapshotAad(pub.id, 'slot-main'));
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
      scenarios: input.scenarios,
      rulesets: resolvedRulesets,
      groupMode: input.groupMode,
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

  const updated = await repos.templates.findById(existing.id);
  if (!updated) throw new AppError('TEMPLATE_NOT_FOUND', '模板不存在。');

  const view = await assembleSimpleTemplateView(env, updated, patched.body, options);
  return { view, version: nextVersion };
}
