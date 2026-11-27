import { BUILTIN_TEMPLATES, buildStarterTemplate, type StarterTemplateTier } from '../../builtin';
import {
  createRepositories,
  TEMPLATE_VERSION_RETENTION,
  type TemplateVersionRecord,
  type TemplateVersionSummary,
} from '../../data/repositories';
import { summarizeRulesetBehaviors } from '../../domain/formatters';
import { id, slugify } from '../../domain/rules/slug';
import {
  applyOverlay,
  compileTemplate,
  importMihomoYaml,
  importSubconverterIni,
  lintTemplate,
  probeTemplate,
  rebaseOverlay,
  resolveOverlayConflicts,
  resolveTemplateCards,
  validateModuleCombination,
  type CompiledConfigResult,
  type ConflictResolution,
  type IconPackEntry,
  type ImportedTemplateResult,
  type ImportSourceFormat,
  type LintReport,
  type LintTemplateInput,
  type OverlayConflict,
  type ProbeRequestMeta,
  type ProbeResult,
  type ProbeRuleEntry,
  type RebaseDiff,
} from '../../domain/templates';
import { safeFetchText } from '../../infrastructure/http/fetch';
import {
  SUPPORTED_TEMPLATE_CLIENTS,
  TEMPLATE_CLIENTS,
  type OutputProfile,
  type TemplateClientId,
} from '../../shared/clients';
import { AppError } from '../../shared/errors';
import type { AppCard, RemoteRuleBehavior } from '../../shared/schemas/card';
import type {
  TemplateBaseKind,
  TemplateBody,
  TemplateGroupMode,
  TemplateOverlay,
  TemplateRecord,
} from '../../shared/schemas/template';
import type { Env } from '../../types';
import { loadCardLookup } from '../cards';
import { loadCatalogIndexMap } from '../catalog';
import { now } from '../rulesets';
import { PRESET_ICON_PACK_URLS } from '../settings';

export const SUPPORTED_COMPILER_CLIENTS = new Set<TemplateClientId>(SUPPORTED_TEMPLATE_CLIENTS);

export type ListTemplatesOptions = {
  query?: string;
  cursor?: string;
  limit?: number;
};

export type ListTemplatesResult = {
  templates: TemplateRecord[];
  starters: readonly TemplateRecord[];
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
};

export type CreateTemplateInput = {
  name?: string;
  slug?: string;
  description?: string;
  starterTier?: StarterTemplateTier;
  groupMode?: TemplateGroupMode;
  output?: OutputProfile;
  baseKind?: TemplateBaseKind;
  baseSourceUrl?: string;
  baseBody?: TemplateBody;
  overlay?: TemplateOverlay;
  note?: string;
};

export type UpdateTemplateInput = {
  name?: string;
  slug?: string;
  description?: string;
  baseKind?: TemplateBaseKind;
  baseSourceUrl?: string | null;
  baseBody?: TemplateBody;
  overlay?: TemplateOverlay;
  note?: string;
};

export type ImportTemplateInput = {
  format: ImportSourceFormat;
  content?: string;
  sourceUrl?: string;
  name?: string;
  slug?: string;
  description?: string;
  save?: boolean;
  note?: string;
};

export type RebaseTemplateInput = {
  baseBody?: TemplateBody;
  format?: ImportSourceFormat;
  content?: string;
  sourceUrl?: string;
  resolutions?: ConflictResolution[];
  apply?: boolean;
  note?: string;
};

export type TemplateRulesetRuntimeContext = {
  rulesetRules: Map<string, ProbeRuleEntry[]>;
  rulesetBehaviors: Map<string, Partial<Record<RemoteRuleBehavior, number>>>;
  rulesetUpdatedAt: Map<string, string>;
};

const DEFAULT_BLANK_BODY: TemplateBody = {
  slots: [{ id: 'slot-main', name: '主力订阅', excludeInfo: true, udp: true }],
  regionGroups: [],
  cards: [],
  groupMode: 'select',
  final: { kind: 'builtin', id: 'DIRECT' },
  output: 'full',
  dns: { mode: 'fake-ip' },
  modules: [{ id: 'ip-no-resolve', enabled: true }],
};

function decodeOffsetCursor(raw?: string): number {
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AppError('VALIDATION_FAILED', '分页游标无效。');
  }
  return parsed;
}

async function resolveUniqueTemplateSlug(
  env: Env,
  preferred: string,
  explicit: boolean,
  excludeTemplateId?: string,
): Promise<string> {
  const base = slugify(preferred).toLowerCase();
  const existing = await createRepositories(env.DB).templates.findBySlug(base);
  if (!existing || existing.id === excludeTemplateId) return base;
  if (explicit) {
    throw new AppError('CONFLICT', `模板标识 ${base} 已存在。`);
  }
  const all = await createRepositories(env.DB).templates.listAll();
  const taken = new Set(all.filter((item) => item.id !== excludeTemplateId).map((item) => item.slug.toLowerCase()));
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function assertValidModuleCombination(body: TemplateBody): void {
  const validation = validateModuleCombination(body.modules);
  if (!validation.ok) {
    const summary = validation.errors.map((err) => err.message).join('；');
    throw new AppError('VALIDATION_FAILED', summary || '增强模块配置存在冲突。', {
      moduleErrors: validation.errors,
    });
  }
}

/**
 * Collects every `ruleset` ID referenced by the enabled cards of `body`.
 */
export function collectReferencedRulesetIds(body: TemplateBody, cards: Map<string, AppCard>): string[] {
  const resolved = resolveTemplateCards(body, cards);
  const ids = new Set<string>();
  for (const card of resolved.cards) {
    if (!card.enabled) continue;
    for (const matcher of card.effective.matchers) {
      if (matcher.kind === 'ruleset') {
        ids.add(matcher.ruleSetId);
      }
    }
  }
  return [...ids].sort();
}

/**
 * Loads rules, behavior breakdowns, and updatedAt timestamps ONLY for rulesets
 * actually referenced by `body` (no full-table scan).
 */
export async function loadTemplateRulesetContext(
  env: Env,
  body: TemplateBody,
  cards: Map<string, AppCard>,
): Promise<TemplateRulesetRuntimeContext> {
  const repos = createRepositories(env.DB);
  const referencedIds = collectReferencedRulesetIds(body, cards);
  const rulesetRules = new Map<string, ProbeRuleEntry[]>();
  const rulesetBehaviors = new Map<string, Partial<Record<RemoteRuleBehavior, number>>>();
  const rulesetUpdatedAt = new Map<string, string>();

  if (referencedIds.length === 0) {
    return { rulesetRules, rulesetBehaviors, rulesetUpdatedAt };
  }

  for (const ruleSetId of referencedIds) {
    const row = (await repos.rulesets.findById(ruleSetId)) ?? (await repos.rulesets.findBySlug(ruleSetId));
    if (!row) continue;
    rulesetUpdatedAt.set(ruleSetId, row.updatedAt);

    const [categoryRules, sources] = await Promise.all([
      repos.rules.listByCategory(row.id),
      repos.sources.listByCategory(row.id),
    ]);
    const disabledSourceIds = new Set(sources.filter((s) => !s.enabled).map((s) => s.id));
    const activeRules = categoryRules.filter(
      (rule) => rule.enabled && (!rule.sourceId || !disabledSourceIds.has(rule.sourceId)),
    );
    rulesetRules.set(
      ruleSetId,
      activeRules.map((rule) => ({
        type: rule.type,
        value: rule.value,
        ...(rule.options ? { options: rule.options } : {}),
      })),
    );
    rulesetBehaviors.set(ruleSetId, summarizeRulesetBehaviors(activeRules));
  }

  return { rulesetRules, rulesetBehaviors, rulesetUpdatedAt };
}

/**
 * Reads cached external icon packs (if already cached in DB, without triggering
 * outbound HTTP fetches during compilation).
 */
export async function loadCachedIconPackEntries(env: Env): Promise<IconPackEntry[]> {
  const repos = createRepositories(env.DB);
  const settings = await repos.settings.getAll();
  const urls = [...new Set([...PRESET_ICON_PACK_URLS, ...settings.customIconPackUrls])];
  const entries: IconPackEntry[] = [];
  for (const url of urls) {
    const cached = await repos.iconPacks.findByUrl(url);
    if (!cached?.payload) continue;
    try {
      const parsed = JSON.parse(cached.payload) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (
            item &&
            typeof item === 'object' &&
            typeof (item as Record<string, unknown>).name === 'string' &&
            typeof (item as Record<string, unknown>).url === 'string'
          ) {
            entries.push({
              name: (item as { name: string }).name,
              url: (item as { url: string }).url,
            });
          }
        }
      }
    } catch {
      // Ignore malformed cache rows
    }
  }
  return entries;
}

export async function listTemplates(env: Env, options: ListTemplatesOptions = {}): Promise<ListTemplatesResult> {
  let list = await createRepositories(env.DB).templates.listAll();
  const query = options.query?.trim().toLowerCase();
  if (query) {
    list = list.filter(
      (item) =>
        item.id.toLowerCase().includes(query) ||
        item.slug.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query),
    );
  }
  const total = list.length;
  const offset = decodeOffsetCursor(options.cursor);
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 200));
  const slice = list.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  const hasMore = nextOffset < total;

  return {
    templates: slice,
    starters: BUILTIN_TEMPLATES,
    total,
    nextCursor: hasMore ? String(nextOffset) : null,
    hasMore,
  };
}

export async function getTemplateById(
  env: Env,
  templateId: string,
): Promise<{
  template: TemplateRecord;
  resolvedBody: TemplateBody;
  overlayConflicts: OverlayConflict[];
}> {
  const template = await createRepositories(env.DB).templates.findById(templateId);
  if (!template) throw new AppError('TEMPLATE_NOT_FOUND', '模板不存在。');
  const applied = applyOverlay(template.baseBody, template.overlay);
  return {
    template,
    resolvedBody: applied.resolved,
    overlayConflicts: applied.conflicts,
  };
}

export async function createTemplate(
  env: Env,
  input: CreateTemplateInput,
): Promise<{
  template: TemplateRecord;
  resolvedBody: TemplateBody;
  version: number;
  overlayConflicts: OverlayConflict[];
  lint: LintReport;
}> {
  const starter = input.starterTier
    ? buildStarterTemplate(input.starterTier, {
        groupMode: input.groupMode,
        output: input.output,
      })
    : undefined;

  const name = input.name?.trim() || starter?.name || '';
  if (!name) throw new AppError('VALIDATION_FAILED', '模板名称不能为空。');

  const description = input.description ?? starter?.description ?? '';
  const baseKind: TemplateBaseKind = input.baseKind ?? (starter ? 'builtin' : 'blank');
  const baseBody: TemplateBody = structuredClone(input.baseBody ?? starter?.baseBody ?? DEFAULT_BLANK_BODY);
  if (input.groupMode) baseBody.groupMode = input.groupMode;
  if (input.output) baseBody.output = input.output;
  const overlay: TemplateOverlay = input.overlay ?? [];

  const applied = applyOverlay(baseBody, overlay);
  assertValidModuleCombination(applied.resolved);

  const templateId = id('tpl');
  const slug = await resolveUniqueTemplateSlug(env, input.slug || starter?.slug || name, Boolean(input.slug));
  const timestamp = now();

  const repos = createRepositories(env.DB);
  await repos.templates.createWithVersion({
    template: {
      id: templateId,
      slug,
      name,
      description,
      baseKind,
      baseSourceUrl: input.baseSourceUrl ?? null,
      baseBody: JSON.stringify(baseBody),
      overlay: JSON.stringify(overlay),
      currentVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    resolvedBody: applied.resolved,
    note: input.note?.trim() || '初始版本',
  });

  const template = await repos.templates.findById(templateId);
  if (!template) throw new AppError('INTERNAL', '创建模板失败。');

  const [cards, catalogIndex] = await Promise.all([loadCardLookup(env), loadCatalogIndexMap(env)]);
  const lint = lintTemplate({ body: applied.resolved, cards, catalogIndex });

  return {
    template,
    resolvedBody: applied.resolved,
    version: 1,
    overlayConflicts: applied.conflicts,
    lint,
  };
}

export async function updateTemplate(
  env: Env,
  templateId: string,
  patch: UpdateTemplateInput,
): Promise<{
  template: TemplateRecord;
  resolvedBody: TemplateBody;
  version: number;
  overlayConflicts: OverlayConflict[];
  lint: LintReport;
}> {
  const repos = createRepositories(env.DB);
  const existing = await repos.templates.findById(templateId);
  if (!existing) throw new AppError('TEMPLATE_NOT_FOUND', '模板不存在。');

  const nextSlug =
    patch.slug !== undefined && patch.slug.trim() !== existing.slug
      ? await resolveUniqueTemplateSlug(env, patch.slug, true, existing.id)
      : existing.slug;
  const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
  const nextDescription = patch.description !== undefined ? patch.description : existing.description;
  const nextBaseKind = patch.baseKind ?? existing.baseKind;
  const nextBaseSourceUrl =
    patch.baseSourceUrl === undefined ? (existing.baseSourceUrl ?? null) : patch.baseSourceUrl?.trim() || null;
  const nextBaseBody = patch.baseBody ?? existing.baseBody;
  const nextOverlay = patch.overlay ?? existing.overlay;

  const applied = applyOverlay(nextBaseBody, nextOverlay);
  assertValidModuleCombination(applied.resolved);

  const nextVersion = existing.currentVersion + 1;
  const timestamp = now();

  await repos.templates.saveWithNewVersion({
    id: existing.id,
    slug: nextSlug,
    name: nextName,
    description: nextDescription,
    baseKind: nextBaseKind,
    baseSourceUrl: nextBaseSourceUrl,
    baseBody: JSON.stringify(nextBaseBody),
    overlay: JSON.stringify(nextOverlay),
    version: nextVersion,
    resolvedBody: applied.resolved,
    note: patch.note?.trim() ?? '',
    updatedAt: timestamp,
    maxVersions: TEMPLATE_VERSION_RETENTION,
  });

  const template = await repos.templates.findById(existing.id);
  if (!template) throw new AppError('TEMPLATE_NOT_FOUND', '模板不存在。');

  const [cards, catalogIndex] = await Promise.all([loadCardLookup(env), loadCatalogIndexMap(env)]);
  const lint = lintTemplate({
    body: applied.resolved,
    cards,
    previousBody: applyOverlay(existing.baseBody, existing.overlay).resolved,
    catalogIndex,
  });

  return {
    template,
    resolvedBody: applied.resolved,
    version: nextVersion,
    overlayConflicts: applied.conflicts,
    lint,
  };
}

export async function deleteTemplate(env: Env, templateId: string): Promise<{ deletedId: string }> {
  const repos = createRepositories(env.DB);
  const existing = await repos.templates.findById(templateId);
  if (!existing) throw new AppError('TEMPLATE_NOT_FOUND', '模板不存在。');

  const refs = await repos.publications.listByTemplateId(existing.id);
  if (refs.length > 0) {
    throw new AppError('CONFLICT', '该模板仍被发布引用，请先删除或修改相关发布。', {
      publicationIds: refs.map((item) => item.id),
    });
  }
  await repos.templates.deleteById(existing.id);
  return { deletedId: existing.id };
}

async function runImporter(
  format: ImportSourceFormat,
  content: string | undefined,
  sourceUrl: string | undefined,
  name?: string,
): Promise<ImportedTemplateResult> {
  let rawText = content;
  if (rawText === undefined || rawText.trim().length === 0) {
    if (!sourceUrl?.trim()) {
      throw new AppError('VALIDATION_FAILED', '请提供导入内容或上游地址。');
    }
    const fetched = await safeFetchText(sourceUrl.trim(), {
      headers: { accept: 'text/plain, text/yaml, application/x-yaml, */*' },
    });
    if (!fetched.ok) {
      throw new AppError('UPSTREAM_FAILED', `拉取上游模板失败（HTTP ${fetched.status}）。`);
    }
    rawText = fetched.text;
  }

  return format === 'acl4ssr-ini' ? importSubconverterIni(rawText, { name }) : importMihomoYaml(rawText, { name });
}

export async function importTemplate(
  env: Env,
  input: ImportTemplateInput,
): Promise<
  | { saved: false; imported: ImportedTemplateResult }
  | {
      saved: true;
      template: TemplateRecord;
      resolvedBody: TemplateBody;
      cards: AppCard[];
      report: ImportedTemplateResult['report'];
    }
> {
  const imported = await runImporter(input.format, input.content, input.sourceUrl, input.name);
  if (input.save === false) {
    return { saved: false, imported };
  }

  const repos = createRepositories(env.DB);
  const existingLookup = await loadCardLookup(env);
  const takenSlugs = new Set([...existingLookup.values()].map((c) => c.slug.toLowerCase()));
  const timestamp = now();
  const savedCards: AppCard[] = [];

  // Persist imported custom cards that do not already exist in the card library.
  for (const card of imported.cards) {
    if (existingLookup.has(card.id)) continue;
    let cardSlug = slugify(card.slug || card.name).toLowerCase();
    if (takenSlugs.has(cardSlug)) {
      let suffix = 2;
      while (takenSlugs.has(`${cardSlug}-${suffix}`)) suffix += 1;
      cardSlug = `${cardSlug}-${suffix}`;
    }
    takenSlugs.add(cardSlug);

    await repos.cards.create({
      id: card.id,
      slug: cardSlug,
      name: card.name,
      icon: card.icon ?? null,
      category: card.category,
      body: JSON.stringify({
        stage: card.stage,
        group: card.group,
        matchers: card.matchers,
        ...(card.hidden !== undefined ? { hidden: card.hidden } : {}),
      }),
      origin: 'user',
      forkedFrom: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const stored = await repos.cards.findById(card.id);
    if (stored) savedCards.push(stored);
  }

  const templateId = id('tpl');
  const templateName = input.name?.trim() || imported.name;
  const slug = await resolveUniqueTemplateSlug(env, input.slug || templateName, Boolean(input.slug));

  await repos.templates.createWithVersion({
    template: {
      id: templateId,
      slug,
      name: templateName,
      description: input.description ?? `导入自 ${input.format}`,
      baseKind: imported.baseKind,
      baseSourceUrl: input.sourceUrl?.trim() || null,
      baseBody: JSON.stringify(imported.body),
      overlay: '[]',
      currentVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    resolvedBody: imported.body,
    note: input.note?.trim() || `导入 ${input.format}`,
  });

  const template = await repos.templates.findById(templateId);
  if (!template) throw new AppError('INTERNAL', '导入模板失败。');

  return {
    saved: true,
    template,
    resolvedBody: imported.body,
    cards: savedCards,
    report: imported.report,
  };
}

export async function rebaseTemplate(
  env: Env,
  templateId: string,
  input: RebaseTemplateInput,
): Promise<
  | {
      applied: false;
      resolvedBody: TemplateBody;
      diff: RebaseDiff;
      conflicts: OverlayConflict[];
      hasConflicts: boolean;
    }
  | {
      applied: true;
      template: TemplateRecord;
      resolvedBody: TemplateBody;
      version: number;
      diff: RebaseDiff;
      conflicts: OverlayConflict[];
    }
> {
  const repos = createRepositories(env.DB);
  const existing = await repos.templates.findById(templateId);
  if (!existing) throw new AppError('TEMPLATE_NOT_FOUND', '模板不存在。');

  let newBaseBody = input.baseBody;
  let newBaseSourceUrl = input.sourceUrl?.trim() || existing.baseSourceUrl || null;
  if (!newBaseBody) {
    const format: ImportSourceFormat | undefined =
      input.format ??
      (existing.baseKind === 'acl4ssr-ini' || existing.baseKind === 'mihomo-yaml' ? existing.baseKind : undefined);
    if (!format) {
      throw new AppError('VALIDATION_FAILED', '请提供新的 baseBody 或指定导入格式（acl4ssr-ini / mihomo-yaml）。');
    }
    const imported = await runImporter(format, input.content, newBaseSourceUrl ?? undefined, existing.name);
    newBaseBody = imported.body;
    if (input.sourceUrl?.trim()) newBaseSourceUrl = input.sourceUrl.trim();
  }

  const rebaseResult = rebaseOverlay(existing.baseBody, newBaseBody, existing.overlay);
  let nextOverlay = existing.overlay;
  let finalResolved = rebaseResult.resolved;
  let finalConflicts = rebaseResult.conflicts;

  if (input.resolutions && input.resolutions.length > 0) {
    nextOverlay = resolveOverlayConflicts(existing.overlay, input.resolutions);
    const appliedAfterResolve = applyOverlay(newBaseBody, nextOverlay);
    finalResolved = appliedAfterResolve.resolved;
    finalConflicts = appliedAfterResolve.conflicts;
  }

  if (input.apply === false || (finalConflicts.length > 0 && (!input.resolutions || input.resolutions.length === 0))) {
    return {
      applied: false,
      resolvedBody: finalResolved,
      diff: rebaseResult.diff,
      conflicts: finalConflicts,
      hasConflicts: finalConflicts.length > 0,
    };
  }

  assertValidModuleCombination(finalResolved);
  const nextVersion = existing.currentVersion + 1;
  const timestamp = now();

  await repos.templates.saveWithNewVersion({
    id: existing.id,
    slug: existing.slug,
    name: existing.name,
    description: existing.description,
    baseKind: existing.baseKind,
    baseSourceUrl: newBaseSourceUrl,
    baseBody: JSON.stringify(newBaseBody),
    overlay: JSON.stringify(nextOverlay),
    version: nextVersion,
    resolvedBody: finalResolved,
    note: input.note?.trim() || '底稿更新（Rebase）',
    updatedAt: timestamp,
    maxVersions: TEMPLATE_VERSION_RETENTION,
  });

  const template = await repos.templates.findById(existing.id);
  if (!template) throw new AppError('TEMPLATE_NOT_FOUND', '模板不存在。');

  return {
    applied: true,
    template,
    resolvedBody: finalResolved,
    version: nextVersion,
    diff: rebaseResult.diff,
    conflicts: finalConflicts,
  };
}

export async function listTemplateVersions(env: Env, templateId: string): Promise<TemplateVersionSummary[]> {
  const repos = createRepositories(env.DB);
  const existing = await repos.templates.findById(templateId);
  if (!existing) throw new AppError('TEMPLATE_NOT_FOUND', '模板不存在。');
  return repos.templates.listVersions(templateId, TEMPLATE_VERSION_RETENTION);
}

export async function getTemplateVersion(
  env: Env,
  templateId: string,
  version: number,
): Promise<TemplateVersionRecord> {
  const repos = createRepositories(env.DB);
  const existing = await repos.templates.findById(templateId);
  if (!existing) throw new AppError('TEMPLATE_NOT_FOUND', '模板不存在。');
  const record = await repos.templates.findVersion(templateId, version);
  if (!record) throw new AppError('NOT_FOUND', `模板版本 v${version} 不存在。`);
  return record;
}

export async function restoreTemplateVersion(
  env: Env,
  templateId: string,
  version: number,
  note?: string,
): Promise<{
  template: TemplateRecord;
  resolvedBody: TemplateBody;
  version: number;
  restoredFrom: number;
}> {
  const repos = createRepositories(env.DB);
  const existing = await repos.templates.findById(templateId);
  if (!existing) throw new AppError('TEMPLATE_NOT_FOUND', '模板不存在。');
  const target = await repos.templates.findVersion(templateId, version);
  if (!target) throw new AppError('NOT_FOUND', `模板版本 v${version} 不存在。`);

  const nextVersion = existing.currentVersion + 1;
  const timestamp = now();
  const restoredBody = structuredClone(target.resolvedBody);

  await repos.templates.saveWithNewVersion({
    id: existing.id,
    slug: existing.slug,
    name: existing.name,
    description: existing.description,
    baseKind: existing.baseKind,
    baseSourceUrl: existing.baseSourceUrl ?? null,
    baseBody: JSON.stringify(restoredBody),
    overlay: '[]',
    version: nextVersion,
    resolvedBody: restoredBody,
    note: note?.trim() || `恢复自版本 v${version}`,
    updatedAt: timestamp,
    maxVersions: TEMPLATE_VERSION_RETENTION,
  });

  const template = await repos.templates.findById(existing.id);
  if (!template) throw new AppError('TEMPLATE_NOT_FOUND', '模板不存在。');

  return {
    template,
    resolvedBody: restoredBody,
    version: nextVersion,
    restoredFrom: version,
  };
}

export async function lintTemplateById(
  env: Env,
  templateId: string,
  input: {
    body?: TemplateBody;
    overlay?: TemplateOverlay;
    previousBody?: TemplateBody;
    previousCards?: LintTemplateInput['previousCards'];
    clients?: TemplateClientId[];
    nodeNamesBySlot?: Record<string, string[]>;
    nodeNames?: string[];
    sampleTargets?: string[];
  } = {},
): Promise<{ report: LintReport }> {
  const { template, resolvedBody } = await getTemplateById(env, templateId);
  const effectiveBody = input.body
    ? input.overlay
      ? applyOverlay(input.body, input.overlay).resolved
      : input.body
    : input.overlay
      ? applyOverlay(template.baseBody, input.overlay).resolved
      : resolvedBody;

  const [cards, catalogIndex] = await Promise.all([loadCardLookup(env), loadCatalogIndexMap(env)]);
  const rulesetCtx = await loadTemplateRulesetContext(env, effectiveBody, cards);

  const report = lintTemplate({
    body: effectiveBody,
    cards,
    previousBody: input.previousBody,
    previousCards: input.previousCards,
    clients: input.clients,
    nodeNamesBySlot: input.nodeNamesBySlot,
    nodeNames: input.nodeNames,
    caches: {
      rulesetRules: rulesetCtx.rulesetRules,
      catalogIndex,
    },
    catalogIndex,
    sampleTargets: input.sampleTargets,
  });

  return { report };
}

export async function probeTemplateById(
  env: Env,
  templateId: string,
  input: {
    target: string;
    meta?: ProbeRequestMeta;
    body?: TemplateBody;
    overlay?: TemplateOverlay;
  },
): Promise<{ result: ProbeResult }> {
  const { template, resolvedBody } = await getTemplateById(env, templateId);
  const effectiveBody = input.body
    ? input.overlay
      ? applyOverlay(input.body, input.overlay).resolved
      : input.body
    : input.overlay
      ? applyOverlay(template.baseBody, input.overlay).resolved
      : resolvedBody;

  const [cards, catalogIndex] = await Promise.all([loadCardLookup(env), loadCatalogIndexMap(env)]);
  const rulesetCtx = await loadTemplateRulesetContext(env, effectiveBody, cards);

  const result = probeTemplate({
    target: input.target,
    body: effectiveBody,
    cards,
    meta: input.meta,
    caches: {
      rulesetRules: rulesetCtx.rulesetRules,
      catalogIndex,
    },
  });

  return { result };
}

export async function previewTemplateById(
  env: Env,
  templateId: string,
  options: {
    client: TemplateClientId;
    output?: OutputProfile;
    body?: TemplateBody;
    overlay?: TemplateOverlay;
    baseUrl?: string;
    experimentalFullConfig?: boolean;
  },
): Promise<CompiledConfigResult> {
  if (!SUPPORTED_COMPILER_CLIENTS.has(options.client)) {
    const supportedLabels = SUPPORTED_TEMPLATE_CLIENTS.map((id) => TEMPLATE_CLIENTS[id].label).join(' / ');
    throw new AppError(
      'NOT_FOUND',
      `客户端 ${TEMPLATE_CLIENTS[options.client].label} 尚未支持编译预览，当前仅支持 ${supportedLabels}。`,
      { client: options.client, supportedClients: [...SUPPORTED_COMPILER_CLIENTS] },
    );
  }

  const { template, resolvedBody } = await getTemplateById(env, templateId);
  const effectiveBody = options.body
    ? options.overlay
      ? applyOverlay(options.body, options.overlay).resolved
      : options.body
    : options.overlay
      ? applyOverlay(template.baseBody, options.overlay).resolved
      : resolvedBody;

  const [cards, catalogIndex, iconPack] = await Promise.all([
    loadCardLookup(env),
    loadCatalogIndexMap(env),
    loadCachedIconPackEntries(env),
  ]);
  const rulesetCtx = await loadTemplateRulesetContext(env, effectiveBody, cards);

  return compileTemplate(options.client, {
    body: effectiveBody,
    cards,
    templateName: template.name,
    generatedAt: template.updatedAt,
    output: options.output ?? effectiveBody.output,
    catalogIndex,
    rulesetBehaviors: rulesetCtx.rulesetBehaviors,
    baseUrl: options.baseUrl,
    iconPack,
    experimentalFullConfig: options.experimentalFullConfig,
  });
}

export {
  previewSubscription,
  quickCreateTemplate,
  type PreviewSubscriptionOptions,
  type PreviewSubscriptionRegionStat,
  type PreviewSubscriptionResult,
  type QuickCreatePublicationLink,
  type QuickCreateTemplateOptions,
  type QuickCreateTemplateResult,
} from './quick-create';
export {
  getSimpleTemplateView,
  patchSimpleTemplateView,
  type SimpleTemplateNodeRegionStat,
  type SimpleTemplateNodesView,
  type SimpleTemplateOutputItem,
  type SimpleTemplateOutputLink,
  type SimpleTemplateView,
  type SimpleTemplateViewOptions,
} from './simple-view';
