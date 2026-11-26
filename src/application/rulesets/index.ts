import {
  createRepositories,
  RULE_BATCH_SIZE,
  serializeRuleOptions,
  type PaginatedRulesResult,
  type RuleCountSummary,
  type RuleSetRow,
  type RuleSourceFilter,
} from '../../data/repositories';
import {
  formatCategoryFile,
  subscriptionFileCandidates,
  type FormattedSubscriptionFile,
} from '../../domain/formatters';
import { RuleConflictIndex } from '../../domain/rules/conflicts';
import { parseBulkImport, parseRuleInput } from '../../domain/rules/parser';
import { id, slugify, validateCategoryName } from '../../domain/rules/slug';
import { sourceNameFromSubscriptionUrl } from '../../lib/github-mirror';
import { AppError } from '../../shared/errors';
import type { RuleOptions } from '../../shared/schemas/rule';
import type { Env } from '../../types';
import {
  UPSTREAM_RULE_PREVIEW_LIMIT,
  type DomainRule,
  type ImportPreview,
  type ManualRuleOptimizationPreview,
  type RuleCategory,
  type RuleConflict,
  type RuleOptimizationMode,
  type RuleSource,
  type RulesData,
} from '../../types/domain-rules';

export type { RuleSourceFilter };

const DEFAULT_USER_AGENT = 'clash-verge/v2.5.1';
const MANUAL_DOMAIN_RULE_TYPES = new Set<DomainRule['type']>(['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD']);

export function now(): string {
  return new Date().toISOString();
}

export function sourceNameFromUrl(value: string, fallback = ''): string {
  return sourceNameFromSubscriptionUrl(value, fallback);
}

export function normalizeUserAgent(value?: string | null): string {
  const normalized = value?.trim() || DEFAULT_USER_AGENT;
  if (normalized.length > 256 || /[\r\n\0]/.test(normalized)) {
    throw new AppError('VALIDATION_FAILED', 'User-Agent 格式不正确');
  }
  return normalized;
}

function buildCategory(
  row: RuleSetRow,
  categoryRules: DomainRule[],
  sources: RuleSource[],
  counts?: RuleCountSummary,
): RuleCategory {
  const uniqueRules = new Map<string, DomainRule>();
  for (const rule of categoryRules) {
    const key = `${rule.type}:${rule.value}`.toLowerCase();
    const existing = uniqueRules.get(key);
    if (!existing || (!rule.sourceId && existing.sourceId)) uniqueRules.set(key, rule);
  }
  const deduped = [...uniqueRules.values()];
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: row.icon ?? undefined,
    description: row.description ?? undefined,
    note: row.note ?? undefined,
    enabled: row.enabled !== 0,
    sortOrder: row.sortOrder ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    rules: deduped,
    publicLinksEnabled: row.publicLinksEnabled !== 0,
    tokenLinksEnabled: row.tokenLinksEnabled !== 0,
    sources,
    lastSyncedAt: sources.reduce<string | undefined>(
      (latest, source) => (!latest || (source.lastSyncedAt ?? '') > latest ? source.lastSyncedAt : latest),
      undefined,
    ),
    syncIntervalMinutes: sources[0]?.syncIntervalMinutes ?? 60,
    ruleCount: counts?.ruleCount ?? deduped.length,
    enabledRuleCount: counts?.enabledRuleCount ?? deduped.filter((rule) => rule.enabled).length,
    manualRuleCount: counts?.manualRuleCount ?? deduped.filter((rule) => !rule.sourceId).length,
    urlRuleCount: counts?.urlRuleCount ?? deduped.filter((rule) => rule.sourceType === 'url').length,
    geoRuleCount: counts?.geoRuleCount ?? deduped.filter((rule) => rule.sourceId && rule.sourceType !== 'url').length,
  };
}

function attachSourcesToRules(ruleList: DomainRule[], sourceById: Map<string, RuleSource>): Map<string, DomainRule[]> {
  const byCategory = new Map<string, DomainRule[]>();
  for (const rule of ruleList) {
    if (rule.sourceId) {
      const source = sourceById.get(rule.sourceId);
      if (source) {
        rule.sourceName = source.name;
        rule.sourceType = source.sourceType ?? 'url';
        rule.sourceEnabled = source.enabled;
        if (!source.enabled) rule.enabled = false;
      }
    }
    const categoryId = rule.categoryId ?? '';
    const list = byCategory.get(categoryId) ?? [];
    list.push(rule);
    byCategory.set(categoryId, list);
  }
  return byCategory;
}

export async function findRulesetSlug(env: Env, categoryId: string): Promise<string | null> {
  const row = await createRepositories(env.DB).rulesets.findById(categoryId);
  return row ? row.slug : null;
}

export async function listRulesetSlugs(env: Env): Promise<string[]> {
  const rows = await createRepositories(env.DB).rulesets.listAll();
  return rows.map((row) => row.slug);
}

export async function getRulesetById(env: Env, categoryId: string): Promise<RuleCategory> {
  const repos = createRepositories(env.DB);
  const row = await repos.rulesets.findById(categoryId);
  if (!row) throw new AppError('RULESET_NOT_FOUND', '分类不存在。');
  const [categoryRules, categorySources] = await Promise.all([
    repos.rules.listByCategory(row.id),
    repos.sources.listByCategory(row.id),
  ]);
  const sourceById = new Map(categorySources.map((source) => [source.id, source]));
  const rulesByCategory = attachSourcesToRules(categoryRules, sourceById);
  return buildCategory(row, rulesByCategory.get(row.id) ?? [], categorySources);
}

/**
 * Resolves and formats a single subscription file by querying only the matched
 * category's rules and sources (avoiding a full-table scan across all rulesets).
 */
export async function getSubscriptionFile(
  env: Env,
  fileName: string,
  access: 'public' | 'token',
): Promise<FormattedSubscriptionFile | null> {
  const candidates = subscriptionFileCandidates(fileName);
  if (candidates.length === 0) return null;

  const repos = createRepositories(env.DB);
  let matchedRow: RuleSetRow | null = null;
  let matchedFormatter = candidates[0].formatter;

  for (const candidate of candidates) {
    const row = await repos.rulesets.findBySlug(candidate.slug);
    if (row) {
      matchedRow = row;
      matchedFormatter = candidate.formatter;
      break;
    }
  }
  if (!matchedRow || matchedRow.enabled === 0) return null;

  const publicLinksEnabled = matchedRow.publicLinksEnabled !== 0;
  const tokenLinksEnabled = matchedRow.tokenLinksEnabled !== 0;
  if (access === 'public' && (tokenLinksEnabled || !publicLinksEnabled)) return null;
  if (access === 'token' && !tokenLinksEnabled) return null;

  const [categoryRules, categorySources, settings] = await Promise.all([
    repos.rules.listByCategory(matchedRow.id),
    repos.sources.listByCategory(matchedRow.id),
    repos.settings.getAll(),
  ]);

  const sourceById = new Map(categorySources.map((source) => [source.id, source]));
  const rulesByCategory = attachSourcesToRules(categoryRules, sourceById);
  const category = buildCategory(matchedRow, rulesByCategory.get(matchedRow.id) ?? [], categorySources);
  const data: RulesData = {
    version: 1,
    updatedAt: category.updatedAt,
    settings,
    categories: [category],
  };

  return formatCategoryFile(category, matchedFormatter, data);
}

export async function getRulesData(env: Env): Promise<RulesData> {
  const repos = createRepositories(env.DB);
  const [categoryRows, allRules, allSources, settings, hasApiKey] = await Promise.all([
    repos.rulesets.listAll(),
    repos.rules.listAll(),
    repos.sources.listAll(),
    repos.settings.getAll(),
    repos.apiKeys.hasAny(),
  ]);

  const sourceById = new Map(allSources.map((source) => [source.id, source]));
  const rulesByCategory = attachSourcesToRules(allRules, sourceById);
  const categories = categoryRows.map((row) =>
    buildCategory(
      row,
      rulesByCategory.get(row.id) ?? [],
      allSources.filter((source) => source.categoryId === row.id),
    ),
  );
  const updatedAt = categories.reduce(
    (latest, category) => (category.updatedAt > latest ? category.updatedAt : latest),
    '',
  );

  return {
    version: 1,
    settings,
    meta: {
      d1Ready: true,
      adminPasswordConfigured: Boolean(env.ADMIN_PASSWORD),
      ruleTokenConfigured: Boolean(env.RULE_TOKEN),
      sessionSecretConfigured: Boolean(env.SESSION_SECRET),
      apiKeyConfigured: hasApiKey,
    },
    categories,
    updatedAt: updatedAt || now(),
    lastSyncedAt: allSources.reduce<string | undefined>(
      (latest, source) => (!latest || (source.lastSyncedAt ?? '') > latest ? source.lastSyncedAt : latest),
      undefined,
    ),
  };
}

/**
 * Lightweight payload for the admin UI. Custom rules stay editable, while
 * mirrored upstream rules are capped per rule set until expanded or searched.
 */
export async function getRulesOverview(
  env: Env,
  upstreamPreviewLimit = UPSTREAM_RULE_PREVIEW_LIMIT,
): Promise<RulesData> {
  const repos = createRepositories(env.DB);
  const [categoryRows, manualRules, upstreamRules, allSources, settings, hasApiKey, countsByCategory] =
    await Promise.all([
      repos.rulesets.listAll(),
      repos.rules.listManual(),
      repos.rules.listUpstreamPreview(upstreamPreviewLimit),
      repos.sources.listAll(),
      repos.settings.getAll(),
      repos.apiKeys.hasAny(),
      repos.rules.getCountsByCategory(),
    ]);

  const sourceById = new Map(allSources.map((source) => [source.id, source]));
  const rulesByCategory = attachSourcesToRules([...manualRules, ...upstreamRules], sourceById);
  const categories = categoryRows.map((row) =>
    buildCategory(
      row,
      rulesByCategory.get(row.id) ?? [],
      allSources.filter((source) => source.categoryId === row.id),
      countsByCategory.get(row.id),
    ),
  );
  const updatedAt = categories.reduce(
    (latest, category) => (category.updatedAt > latest ? category.updatedAt : latest),
    '',
  );

  return {
    version: 1,
    settings,
    meta: {
      d1Ready: true,
      adminPasswordConfigured: Boolean(env.ADMIN_PASSWORD),
      ruleTokenConfigured: Boolean(env.RULE_TOKEN),
      sessionSecretConfigured: Boolean(env.SESSION_SECRET),
      apiKeyConfigured: hasApiKey,
    },
    categories,
    updatedAt: updatedAt || now(),
    lastSyncedAt: allSources.reduce<string | undefined>(
      (latest, source) => (!latest || (source.lastSyncedAt ?? '') > latest ? source.lastSyncedAt : latest),
      undefined,
    ),
  };
}

export async function listRules(
  env: Env,
  options: { categoryId?: string; query?: string; source?: RuleSourceFilter; limit?: number } = {},
): Promise<DomainRule[]> {
  return createRepositories(env.DB).rules.listFiltered(options);
}

/**
 * Ultra-lightweight summary payload for the 1.1.0 UI (`?summary=1`): omits
 * rule rows while returning complete ruleset metadata, sources, and counts,
 * keeping 10k+ rule categories sub-10ms on route transitions.
 */
export async function getRulesetsSummary(env: Env): Promise<RulesData> {
  const repos = createRepositories(env.DB);
  const [categoryRows, allSources, settings, hasApiKey, countsByCategory] = await Promise.all([
    repos.rulesets.listAll(),
    repos.sources.listAll(),
    repos.settings.getAll(),
    repos.apiKeys.hasAny(),
    repos.rules.getCountsByCategory(),
  ]);

  const categories = categoryRows.map((row) =>
    buildCategory(
      row,
      [],
      allSources.filter((source) => source.categoryId === row.id),
      countsByCategory.get(row.id) ?? {
        categoryId: row.id,
        ruleCount: 0,
        enabledRuleCount: 0,
        manualRuleCount: 0,
        urlRuleCount: 0,
        geoRuleCount: 0,
      },
    ),
  );
  const updatedAt = categories.reduce(
    (latest, category) => (category.updatedAt > latest ? category.updatedAt : latest),
    '',
  );

  return {
    version: 1,
    settings,
    meta: {
      d1Ready: true,
      adminPasswordConfigured: Boolean(env.ADMIN_PASSWORD),
      ruleTokenConfigured: Boolean(env.RULE_TOKEN),
      sessionSecretConfigured: Boolean(env.SESSION_SECRET),
      apiKeyConfigured: hasApiKey,
    },
    categories,
    updatedAt: updatedAt || now(),
    lastSyncedAt: allSources.reduce<string | undefined>(
      (latest, source) => (!latest || (source.lastSyncedAt ?? '') > latest ? source.lastSyncedAt : latest),
      undefined,
    ),
  };
}

export async function listRulesPaginated(
  env: Env,
  options: {
    categoryId: string;
    query?: string;
    source?: RuleSourceFilter;
    cursor?: string;
    limit?: number;
  },
): Promise<PaginatedRulesResult> {
  return createRepositories(env.DB).rules.listPaginated(options);
}

export type CategoryInput = Partial<RuleCategory> & {
  sourceUrls?: string[];
  geositeNames?: string[];
  geoipNames?: string[];
  syncIntervalMinutes?: number;
  userAgent?: string;
  ruleOptimization?: RuleOptimizationMode;
};

export async function replaceCategorySources(
  env: Env,
  categoryId: string,
  sourceUrls: string[],
  syncIntervalMinutes = 60,
  geositeNames: string[] = [],
  geoipNames: string[] = [],
  userAgent?: string | null,
  ruleOptimization: RuleOptimizationMode = 'none',
): Promise<void> {
  const normalizedUserAgent = normalizeUserAgent(userAgent);
  const normalizedRuleOptimization: RuleOptimizationMode =
    ruleOptimization === 'conservative' || ruleOptimization === 'aggressive' ? ruleOptimization : 'none';
  const urls = [...new Set(sourceUrls.map((url) => url.trim()).filter((url) => /^https?:\/\//i.test(url)))];
  const geosites = [
    ...new Set(geositeNames.map((name) => name.trim().toLowerCase()).filter((name) => /^[a-z0-9_!@.-]+$/i.test(name))),
  ];
  const geositeUrls = geosites.map(
    (name) => `https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/${encodeURIComponent(name)}`,
  );
  const geoips = [
    ...new Set(geoipNames.map((name) => name.trim().toLowerCase()).filter((name) => /^[a-z0-9_!-]+$/i.test(name))),
  ];
  const geoipUrls = geoips.map(
    (name) => `https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(name)}.txt`,
  );
  const desiredUrls = [...urls, ...geositeUrls, ...geoipUrls];

  const existing = await createRepositories(env.DB).sources.listByCategory(categoryId);
  const existingByUrl = new Map(existing.map((source) => [source.url, source]));
  const removedSourceIds = existing.filter((source) => !desiredUrls.includes(source.url)).map((source) => source.id);
  const timestamp = now();

  const statements = [
    ...removedSourceIds.map((sourceId) => env.DB.prepare('DELETE FROM rules WHERE source_id = ?').bind(sourceId)),
    ...urls
      .filter((url) => !existingByUrl.has(url))
      .map((url, index) =>
        env.DB.prepare(
          "INSERT INTO category_sources (id, category_id, name, url, enabled, last_status, sync_interval_minutes, user_agent, source_type, rule_optimization, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'url', ?, ?, ?)",
        ).bind(
          id('src'),
          categoryId,
          sourceNameFromUrl(url, `来源 ${index + 1}`),
          url,
          'pending',
          syncIntervalMinutes,
          normalizedUserAgent,
          normalizedRuleOptimization,
          timestamp,
          timestamp,
        ),
      ),
    ...geosites
      .filter(
        (name) =>
          !existingByUrl.has(
            `https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/${encodeURIComponent(name)}`,
          ),
      )
      .map((name) =>
        env.DB.prepare(
          "INSERT INTO category_sources (id, category_id, name, url, enabled, last_status, sync_interval_minutes, source_type, geosite_name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, 'geosite', ?, ?, ?)",
        ).bind(
          id('src'),
          categoryId,
          `GeoSite · ${name}`,
          `https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/${encodeURIComponent(name)}`,
          'pending',
          syncIntervalMinutes,
          name,
          timestamp,
          timestamp,
        ),
      ),
    ...geoips
      .filter(
        (name) =>
          !existingByUrl.has(
            `https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(name)}.txt`,
          ),
      )
      .map((name) =>
        env.DB.prepare(
          "INSERT INTO category_sources (id, category_id, name, url, enabled, last_status, sync_interval_minutes, source_type, geoip_name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, 'geoip', ?, ?, ?)",
        ).bind(
          id('src'),
          categoryId,
          `GeoIP · ${name}`,
          `https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(name)}.txt`,
          'pending',
          syncIntervalMinutes,
          name,
          timestamp,
          timestamp,
        ),
      ),
    ...desiredUrls
      .filter((url) => existingByUrl.has(url))
      .map((url) =>
        env.DB.prepare(
          "UPDATE category_sources SET sync_interval_minutes = ?, user_agent = CASE WHEN source_type = 'url' THEN ? ELSE user_agent END, rule_optimization = CASE WHEN source_type = 'url' THEN ? ELSE 'none' END, updated_at = ? WHERE category_id = ? AND url = ?",
        ).bind(syncIntervalMinutes, normalizedUserAgent, normalizedRuleOptimization, timestamp, categoryId, url),
      ),
    env.DB.prepare(
      desiredUrls.length
        ? `DELETE FROM category_sources WHERE category_id = ? AND url NOT IN (${desiredUrls.map(() => '?').join(',')})`
        : 'DELETE FROM category_sources WHERE category_id = ?',
    ).bind(categoryId, ...desiredUrls),
  ];
  await env.DB.batch(statements);
}

export async function createCategory(env: Env, input: CategoryInput): Promise<RulesData> {
  const timestamp = now();
  const name = input.name?.trim() ?? '';
  const nameError = validateCategoryName(name);
  if (nameError) throw new AppError('VALIDATION_FAILED', nameError);
  const categoryId = id('cat');
  const slug = slugify(input.slug?.trim() || name);
  const sortOrder = input.sortOrder ?? Date.now();
  const hasUpstream = Boolean(input.sourceUrls?.length || input.geositeNames?.length || input.geoipNames?.length);
  const tokenAccess = input.tokenLinksEnabled ?? !hasUpstream;
  const publicAccess = !tokenAccess && (input.publicLinksEnabled ?? hasUpstream);

  await createRepositories(env.DB).rulesets.create({
    id: categoryId,
    name,
    slug,
    icon: input.icon?.trim() || name.slice(0, 2).toUpperCase(),
    description: input.description?.trim() || '',
    note: input.note?.trim() || '',
    sortOrder,
    enabled: input.enabled === false ? 0 : 1,
    publicLinksEnabled: publicAccess ? 1 : 0,
    tokenLinksEnabled: tokenAccess ? 1 : 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  if (hasUpstream) {
    await replaceCategorySources(
      env,
      categoryId,
      input.sourceUrls ?? [],
      input.syncIntervalMinutes ?? 60,
      input.geositeNames ?? [],
      input.geoipNames ?? [],
      input.userAgent,
      input.ruleOptimization,
    );
  }
  return getRulesOverview(env);
}

export async function updateCategory(env: Env, categoryId: string, input: CategoryInput): Promise<RulesData> {
  if (input.sourceUrls || input.geositeNames || input.geoipNames) {
    throw new AppError('VALIDATION_FAILED', '来源必须通过来源级 Use Case 修改，不能整体替换分类来源。');
  }
  const { rulesets } = createRepositories(env.DB);
  const current = await rulesets.findById(categoryId);
  if (!current) throw new AppError('RULESET_NOT_FOUND', '分类不存在。');
  const name = input.name?.trim() || current.name;
  const nameError = validateCategoryName(name);
  if (nameError) throw new AppError('VALIDATION_FAILED', nameError);
  const timestamp = now();
  const tokenAccess = input.tokenLinksEnabled === undefined ? current.tokenLinksEnabled !== 0 : input.tokenLinksEnabled;
  let publicAccess =
    input.publicLinksEnabled === undefined ? current.publicLinksEnabled !== 0 : input.publicLinksEnabled;
  if (tokenAccess) publicAccess = false;

  await rulesets.update(categoryId, {
    name,
    slug: input.slug?.trim() || name !== current.name ? slugify(input.slug?.trim() || name) : current.slug,
    icon: input.icon ?? current.icon,
    description: input.description ?? current.description,
    note: input.note ?? current.note,
    sortOrder: input.sortOrder ?? current.sortOrder ?? 0,
    enabled: input.enabled === undefined ? (current.enabled ?? 1) : input.enabled ? 1 : 0,
    publicLinksEnabled: publicAccess ? 1 : 0,
    tokenLinksEnabled: tokenAccess ? 1 : 0,
    updatedAt: timestamp,
  });
  return getRulesOverview(env);
}

export async function deleteCategory(env: Env, categoryId: string): Promise<RulesData> {
  await createRepositories(env.DB).rulesets.deleteById(categoryId);
  return getRulesOverview(env);
}

export async function createManualRuleConflictIndex(env: Env): Promise<RuleConflictIndex> {
  const rows = await createRepositories(env.DB).rules.listManualForConflictIndex();
  return new RuleConflictIndex(rows);
}

export async function findRuleConflicts(
  env: Env,
  candidate: Pick<DomainRule, 'type' | 'value'>,
  excludeRuleId?: string,
): Promise<RuleConflict[]> {
  const index = await createManualRuleConflictIndex(env);
  return index.findConflicts(candidate, excludeRuleId);
}

export async function insertRule(
  env: Env,
  categoryId: string,
  rule: DomainRule,
  sortOrder = 0,
  sourceId?: string,
): Promise<void> {
  await createRepositories(env.DB).rules.insertOne(categoryId, rule, sortOrder, sourceId);
}

export async function addRule(
  env: Env,
  categoryId: string,
  input: {
    value: string;
    type?: DomainRule['type'];
    note?: string;
    enabled?: boolean;
    options?: RuleOptions;
    replaceConflicts?: boolean;
  },
) {
  const repos = createRepositories(env.DB);
  const category = await repos.rulesets.findById(categoryId);
  if (!category) throw new AppError('RULESET_NOT_FOUND', '分类不存在。');
  const rule = parseRuleInput(input.value, input.type, input.note, input.options);
  if (input.enabled === false) rule.enabled = false;
  const conflicts = await findRuleConflicts(env, rule);
  if (conflicts.length && !input.replaceConflicts) return { conflicts };
  if (conflicts.length) {
    await repos.rules.deleteManualByIds(conflicts.map((conflict) => conflict.id));
  }
  await repos.rules.insertOne(categoryId, rule, Date.now());
  await repos.rulesets.touch(categoryId, now());
  return { ...(await getRulesOverview(env)), replaced: conflicts.length };
}

export async function updateRule(
  env: Env,
  categoryId: string,
  ruleId: string,
  input: Partial<DomainRule>,
): Promise<RulesData> {
  const repos = createRepositories(env.DB);
  const current = await repos.rules.findById(ruleId, categoryId);
  if (!current) throw new AppError('RULE_NOT_FOUND', '规则不存在。');
  if (current.sourceId) throw new AppError('FORBIDDEN', '上游规则为只读，请修改来源或等待下次同步。');
  const timestamp = now();
  await repos.rules.updateOne(categoryId, ruleId, {
    value: input.value ?? current.value,
    type: input.type ?? current.type,
    displayType: input.displayType ?? current.displayType,
    options: input.options === undefined ? current.options : serializeRuleOptions(input.options),
    note: input.note ?? current.note,
    enabled: input.enabled === undefined ? (current.enabled ?? 1) : input.enabled ? 1 : 0,
    sortOrder: input.sortOrder ?? current.sortOrder ?? 0,
    updatedAt: timestamp,
  });
  await repos.rulesets.touch(categoryId, timestamp);
  return getRulesOverview(env);
}

export async function deleteRule(env: Env, categoryId: string, ruleId: string): Promise<RulesData> {
  const repos = createRepositories(env.DB);
  const current = await repos.rules.findById(ruleId, categoryId);
  if (!current) throw new AppError('RULE_NOT_FOUND', '规则不存在。');
  if (current.sourceId) throw new AppError('FORBIDDEN', '上游规则为只读，不能单独删除。');
  await repos.rules.deleteOne(categoryId, ruleId);
  await repos.rulesets.touch(categoryId, now());
  return getRulesOverview(env);
}

export async function batchUpdateRules(
  env: Env,
  categoryId: string,
  ruleIds: string[],
  action: 'enable' | 'disable' | 'delete',
): Promise<RulesData> {
  const ids = [...new Set(ruleIds)].filter(Boolean).slice(0, 1000);
  if (!ids.length) throw new AppError('VALIDATION_FAILED', '请选择至少一条规则。');
  const repos = createRepositories(env.DB);
  const timestamp = now();
  await repos.rules.batchUpdateManual(categoryId, ids, action, timestamp);
  await repos.rulesets.touch(categoryId, timestamp);
  return getRulesOverview(env);
}

export type BulkImportResult =
  | { status: 'preview'; preview: ImportPreview }
  | { status: 'conflict'; preview: ImportPreview }
  | { status: 'imported'; preview: ImportPreview; replaced: number; data: RulesData };

/**
 * Bulk import use case (design §9.3): single-read in-memory conflict index
 * followed by chunked 80-row atomic batch inserts.
 */
export async function bulkImportRules(
  env: Env,
  categoryId: string,
  input: { text?: string; confirm?: boolean; replaceConflicts?: boolean },
): Promise<BulkImportResult> {
  const repos = createRepositories(env.DB);
  const category = await repos.rulesets.findById(categoryId);
  if (!category) throw new AppError('RULESET_NOT_FOUND', '分类不存在。');

  const preview = parseBulkImport(input.text ?? '', []);
  const conflictIndex = await createManualRuleConflictIndex(env);
  preview.conflicts = preview.rules
    .map((rule) => ({ rule, matches: conflictIndex.findConflicts(rule) }))
    .filter((item) => item.matches.length > 0);

  if (!input.confirm) return { status: 'preview', preview };
  if (preview.conflicts.length > 0 && !input.replaceConflicts) {
    return { status: 'conflict', preview };
  }

  const conflictIds = [...new Set(preview.conflicts.flatMap((item) => item.matches.map((match) => match.id)))];
  if (conflictIds.length > 0) {
    await repos.rules.deleteManualByIds(conflictIds);
  }
  if (preview.rules.length > 0) {
    await repos.rules.insertManyInBatches(categoryId, preview.rules, Date.now(), RULE_BATCH_SIZE);
  }
  await repos.rulesets.touch(categoryId, now());
  return {
    status: 'imported',
    preview,
    replaced: conflictIds.length,
    data: await getRulesOverview(env),
  };
}

function normalizedDomainValue(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

function manualDomainRuleCovers(
  covering: Pick<DomainRule, 'type' | 'value'>,
  candidate: Pick<DomainRule, 'type' | 'value'>,
): boolean {
  if (!MANUAL_DOMAIN_RULE_TYPES.has(covering.type) || !MANUAL_DOMAIN_RULE_TYPES.has(candidate.type)) return false;
  const coveringValue = normalizedDomainValue(covering.value);
  const candidateValue = normalizedDomainValue(candidate.value);
  if (!coveringValue || !candidateValue) return false;
  if (covering.type === 'DOMAIN-KEYWORD') return candidateValue.includes(coveringValue);
  if (covering.type === 'DOMAIN-SUFFIX' && candidate.type !== 'DOMAIN-KEYWORD') {
    return candidateValue === coveringValue || candidateValue.endsWith(`.${coveringValue}`);
  }
  return covering.type === 'DOMAIN' && candidate.type === 'DOMAIN' && candidateValue === coveringValue;
}

function manualDomainRulePriority(rule: DomainRule) {
  const value = normalizedDomainValue(rule.value);
  const typePriority = rule.type === 'DOMAIN-KEYWORD' ? 0 : rule.type === 'DOMAIN-SUFFIX' ? 1 : 2;
  const scopeSize = rule.type === 'DOMAIN-SUFFIX' ? value.split('.').length : value.length;
  return [typePriority, scopeSize, rule.sortOrder ?? 0, rule.createdAt, rule.id] as const;
}

function compareManualDomainRulePriority(left: DomainRule, right: DomainRule): number {
  const a = manualDomainRulePriority(left);
  const b = manualDomainRulePriority(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) continue;
    return a[index]! < b[index]! ? -1 : 1;
  }
  return 0;
}

export async function previewManualRuleOptimization(env: Env): Promise<ManualRuleOptimizationPreview> {
  const rows = await createRepositories(env.DB).rules.listManualDomainRulesForOptimization();
  const categoryNames = new Map<string, string>();
  const grouped = new Map<string, DomainRule[]>();
  for (const { rule, categoryName } of rows) {
    const categoryId = rule.categoryId ?? '';
    categoryNames.set(categoryId, categoryName);
    const key = `${categoryId}:${rule.enabled ? 'enabled' : 'disabled'}`;
    grouped.set(key, [...(grouped.get(key) ?? []), rule]);
  }
  const removals: ManualRuleOptimizationPreview['removals'] = [];
  for (const categoryRules of grouped.values()) {
    const kept: DomainRule[] = [];
    for (const rule of [...categoryRules].sort(compareManualDomainRulePriority)) {
      const covering = kept.find((candidate) => manualDomainRuleCovers(candidate, rule));
      if (!covering) {
        kept.push(rule);
        continue;
      }
      const duplicate =
        covering.type === rule.type && normalizedDomainValue(covering.value) === normalizedDomainValue(rule.value);
      removals.push({
        rule,
        keptRule: covering,
        categoryName: categoryNames.get(rule.categoryId ?? '') ?? '未知分类',
        reason: duplicate ? '与保留规则完全重复' : '已被范围更广的规则覆盖',
      });
    }
  }
  return {
    scanned: rows.length,
    remaining: rows.length - removals.length,
    affectedCategories: new Set(removals.map((item) => item.rule.categoryId)).size,
    removals,
  };
}

export async function optimizeManualRules(env: Env) {
  const preview = await previewManualRuleOptimization(env);
  if (!preview.removals.length) return { preview, data: await getRulesOverview(env) };
  const repos = createRepositories(env.DB);
  const removalsByCategory = new Map<string, string[]>();
  for (const { rule } of preview.removals) {
    const categoryId = rule.categoryId!;
    removalsByCategory.set(categoryId, [...(removalsByCategory.get(categoryId) ?? []), rule.id]);
  }
  const timestamp = now();
  for (const [categoryId, ruleIds] of removalsByCategory) {
    await repos.rules.deleteManualInCategoryByIds(categoryId, ruleIds);
    await repos.rulesets.touch(categoryId, timestamp);
  }
  return { preview, data: await getRulesOverview(env) };
}
