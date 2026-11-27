import { asc } from 'drizzle-orm';
import {
  createRepositories,
  resolveSettingsPatch,
  serializeRuleOptions,
  serializeSettingsEntries,
} from '../../data/repositories';
import { appCards, publications, templates } from '../../data/schema';
import { id, slugify } from '../../domain/rules/slug';
import { applyOverlay } from '../../domain/templates/overlay';
import { serializeTemplateBodyForStorage } from '../../domain/templates/pools';
import { AppError } from '../../shared/errors';
import {
  BACKUP_FORMAT_VERSION,
  backupSchema,
  describeIssues,
  type Backup,
  type BackupCard,
  type BackupPublication,
  type BackupTemplate,
} from '../../shared/schemas/backup';
import { templateBodySchema, templateOverlaySchema, type TemplateOverlayOp } from '../../shared/schemas/template';
import type { TemplateClientId } from '../../shared/clients';
import type { Env } from '../../types';
import type { BackupRuleCategory, BackupRuleSource, RulesData } from '../../types/domain-rules';
import { getRulesData, getRulesOverview, normalizeUserAgent, now, sourceNameFromUrl } from '../rulesets';

export class BackupValidationError extends AppError {
  constructor(readonly problems: string[]) {
    super('BACKUP_INVALID', `备份 JSON 格式不正确：${problems.slice(0, 5).join('；')}`, { problems });
  }
}

export type ExportedBackup = {
  version: typeof BACKUP_FORMAT_VERSION;
  settings: RulesData['settings'];
  categories: BackupRuleCategory[];
  cards: BackupCard[];
  templates: BackupTemplate[];
  publications: BackupPublication[];
  updatedAt: string;
};

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseOverlayArray(raw: string): TemplateOverlayOp[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = templateOverlaySchema.safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

function parseClientsArray(raw: string): TemplateClientId[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TemplateClientId[]) : [];
  } catch {
    return [];
  }
}

/**
 * Exports a version-2 backup containing settings, rule sets (manual rules with
 * options + source definitions), app cards, current templates (no version
 * history), and publications (never `node_bindings` or `node_snapshots`).
 */
export async function getBackupData(env: Env): Promise<ExportedBackup> {
  const repos = createRepositories(env.DB);
  const [data, cardRows, templateRows, publicationRows] = await Promise.all([
    getRulesData(env),
    repos.db.select().from(appCards).orderBy(asc(appCards.createdAt)),
    repos.db.select().from(templates).orderBy(asc(templates.createdAt)),
    repos.db.select().from(publications).orderBy(asc(publications.createdAt)),
  ]);

  const categories: BackupRuleCategory[] = data.categories.map((category) => {
    const {
      lastSyncedAt: _categoryLastSyncedAt,
      syncIntervalMinutes: _syncIntervalMinutes,
      sources,
      rules,
      ...categoryBackup
    } = category;
    return {
      ...categoryBackup,
      rules: rules.filter((rule) => !rule.sourceId),
      sources: sources?.map((source): BackupRuleSource => {
        const common = {
          sourceType: source.sourceType ?? 'url',
          enabled: source.enabled,
          syncIntervalMinutes: source.syncIntervalMinutes,
          ...(source.coverageDedup === false ? { coverageDedup: false } : {}),
        };
        if (common.sourceType === 'geosite') return { ...common, geositeName: source.geositeName };
        if (common.sourceType === 'geoip') return { ...common, geoipName: source.geoipName };
        return {
          ...common,
          url: source.url,
          userAgent: source.userAgent,
          ruleOptimization: source.ruleOptimization ?? 'none',
        };
      }),
    };
  });

  const cards: BackupCard[] = cardRows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    icon: row.icon ?? undefined,
    category: row.category as BackupCard['category'],
    body: parseJsonObject(row.body),
    origin: row.origin as BackupCard['origin'],
    forkedFrom: row.forkedFrom ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  const exportedTemplates: BackupTemplate[] = templateRows.map((row) => {
    const baseBody = parseJsonObject(row.baseBody);
    const output = baseBody.output === 'minimal' ? 'minimal' : baseBody.output === 'full' ? 'full' : undefined;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description || undefined,
      baseKind: row.baseKind as BackupTemplate['baseKind'],
      baseSourceUrl: row.baseSourceUrl ?? undefined,
      baseBody,
      overlay: parseOverlayArray(row.overlay),
      output,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  const exportedPublications: BackupPublication[] = publicationRows.map((row) => ({
    id: row.id,
    slug: row.slug,
    templateId: row.templateId,
    pinnedVersion: row.pinnedVersion ?? undefined,
    clients: parseClientsArray(row.clients),
    access: row.access as BackupPublication['access'],
    output: row.output === 'full' || row.output === 'minimal' ? row.output : undefined,
    ...(row.experimentalFullConfig ? { experimentalFullConfig: true } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  return {
    version: BACKUP_FORMAT_VERSION,
    settings: data.settings,
    categories,
    cards,
    templates: exportedTemplates,
    publications: exportedPublications,
    updatedAt: data.updatedAt,
  };
}

export type BackupValidationSummary = {
  valid: true;
  version: 1 | 2;
  categories: number;
  rules: number;
  sources: number;
  cards?: number;
  templates?: number;
  publications?: number;
  preservesExistingTemplatesAndCards: boolean;
};

export function validateBackupPayload(input: unknown): { parsed: Backup; summary: BackupValidationSummary } {
  const parsed = backupSchema.safeParse(input);
  if (!parsed.success) throw new BackupValidationError(describeIssues(parsed.error));
  const data = parsed.data;
  const rulesCount = data.categories.reduce((sum, category) => sum + category.rules.length, 0);
  const sourcesCount = data.categories.reduce((sum, category) => sum + category.sources.length, 0);
  const preservesExistingTemplatesAndCards =
    data.cards === undefined && data.templates === undefined && data.publications === undefined;

  return {
    parsed: data,
    summary: {
      valid: true,
      version: data.version ?? 1,
      categories: data.categories.length,
      rules: rulesCount,
      sources: sourcesCount,
      ...(data.cards !== undefined ? { cards: data.cards.length } : {}),
      ...(data.templates !== undefined ? { templates: data.templates.length } : {}),
      ...(data.publications !== undefined ? { publications: data.publications.length } : {}),
      preservesExistingTemplatesAndCards,
    },
  };
}

/**
 * Restores a backup atomically in a single DB batch (zero pollution on
 * validation or constraint error). Importing a 1.0.x backup (without `cards`,
 * `templates`, or `publications`) only overwrites rule sets and settings while
 * preserving existing app cards, templates, and publications (design §4.1, §17.1).
 */
export async function importRulesData(env: Env, input: unknown): Promise<RulesData> {
  const { parsed: data } = validateBackupPayload(input);
  const timestamp = now();
  const repos = createRepositories(env.DB);
  const settings = resolveSettingsPatch(await repos.settings.getAll(), data.settings);

  const statements = [
    ...serializeSettingsEntries(settings).map((entry) =>
      env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(entry.key, entry.value),
    ),
    env.DB.prepare('DELETE FROM rules'),
    env.DB.prepare('DELETE FROM category_sources'),
    env.DB.prepare('DELETE FROM categories'),
  ];

  for (const [index, category] of data.categories.entries()) {
    const categoryId = category.id || id('cat');
    statements.push(
      env.DB.prepare(
        'INSERT INTO categories (id, name, slug, icon, description, note, sort_order, enabled, public_links_enabled, token_links_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        categoryId,
        category.name,
        category.slug || slugify(category.name),
        category.icon ?? category.name.slice(0, 2).toUpperCase(),
        category.description ?? '',
        category.note ?? '',
        category.sortOrder ?? index,
        category.enabled === false ? 0 : 1,
        category.tokenLinksEnabled === false && category.publicLinksEnabled !== false ? 1 : 0,
        category.tokenLinksEnabled === false ? 0 : 1,
        category.createdAt ?? timestamp,
        category.updatedAt ?? timestamp,
      ),
    );

    for (const [sourceIndex, source] of category.sources.entries()) {
      const sourceType = source.sourceType;
      const sourceUrl =
        source.url ||
        (sourceType === 'geosite' && source.geositeName
          ? `https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/${encodeURIComponent(source.geositeName)}`
          : sourceType === 'geoip' && source.geoipName
            ? `https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(source.geoipName)}.txt`
            : '');
      const sourceName =
        source.name ||
        (sourceType === 'geosite' && source.geositeName
          ? `GeoSite · ${source.geositeName}`
          : sourceType === 'geoip' && source.geoipName
            ? `GeoIP · ${source.geoipName}`
            : sourceNameFromUrl(sourceUrl, `来源 ${sourceIndex + 1}`));
      const isLegacyBackup = (data.version ?? 1) < 2;
      const coverageDedupFlag =
        source.coverageDedup !== undefined ? (source.coverageDedup ? 1 : 0) : isLegacyBackup ? 0 : 1;
      statements.push(
        env.DB.prepare(
          'INSERT INTO category_sources (id, category_id, name, url, enabled, last_synced_at, last_status, last_count, last_original_count, last_error, sync_interval_minutes, user_agent, source_type, geosite_name, geoip_name, rule_optimization, coverage_dedup, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          source.id || id('src'),
          categoryId,
          sourceName,
          sourceUrl,
          source.enabled === false ? 0 : 1,
          source.lastSyncedAt ?? null,
          source.lastStatus ?? 'pending',
          source.lastCount ?? 0,
          source.lastOriginalCount ?? source.lastCount ?? 0,
          source.lastError ?? null,
          source.syncIntervalMinutes ?? category.syncIntervalMinutes ?? 60,
          normalizeUserAgent(source.userAgent),
          sourceType,
          source.geositeName ?? null,
          source.geoipName ?? null,
          sourceType === 'url' ? (source.ruleOptimization ?? 'none') : 'none',
          coverageDedupFlag,
          category.createdAt ?? timestamp,
          category.updatedAt ?? timestamp,
        ),
      );
    }

    for (const [ruleIndex, rule] of category.rules.entries()) {
      statements.push(
        env.DB.prepare(
          'INSERT OR IGNORE INTO rules (id, category_id, value, type, display_type, options, note, enabled, sort_order, source_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          rule.id || id('rule'),
          categoryId,
          rule.value,
          rule.type,
          rule.displayType ?? '',
          serializeRuleOptions(rule.options),
          rule.note ?? '',
          rule.enabled ? 1 : 0,
          rule.sortOrder ?? ruleIndex,
          rule.sourceId ?? null,
          rule.createdAt ?? timestamp,
          rule.updatedAt ?? timestamp,
        ),
      );
    }
  }

  // Restore 1.1.0 cards / templates / publications ONLY when present in backup
  if (data.cards !== undefined) {
    statements.push(env.DB.prepare('DELETE FROM app_cards'));
    for (const card of data.cards) {
      statements.push(
        env.DB.prepare(
          'INSERT INTO app_cards (id, slug, name, icon, category, body, origin, forked_from, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          card.id || id('card'),
          card.slug,
          card.name,
          card.icon ?? null,
          card.category,
          JSON.stringify(card.body),
          card.origin ?? 'user',
          card.forkedFrom ?? null,
          card.createdAt ?? timestamp,
          card.updatedAt ?? timestamp,
        ),
      );
    }
  }

  if (data.templates !== undefined || data.publications !== undefined) {
    // Publications reference templates via FK; clear publications first whenever either section is replaced.
    statements.push(env.DB.prepare('DELETE FROM publications'));

    if (data.templates !== undefined) {
      statements.push(env.DB.prepare('DELETE FROM template_versions'));
      statements.push(env.DB.prepare('DELETE FROM templates'));
      for (const template of data.templates) {
        const templateId = template.id || id('tpl');
        const createdAt = template.createdAt ?? timestamp;
        const updatedAt = template.updatedAt ?? timestamp;
        const baseBody =
          template.output && !('output' in template.baseBody)
            ? { ...template.baseBody, output: template.output }
            : template.baseBody;
        const parsedBody = templateBodySchema.safeParse(baseBody);
        const resolvedBody = parsedBody.success ? applyOverlay(parsedBody.data, template.overlay).resolved : baseBody;
        const storedBaseBodyJson = parsedBody.success
          ? serializeTemplateBodyForStorage(parsedBody.data, { slug: template.slug })
          : JSON.stringify(baseBody);
        const storedResolvedBodyJson = parsedBody.success
          ? serializeTemplateBodyForStorage(resolvedBody as ReturnType<typeof templateBodySchema.parse>, {
              slug: template.slug,
            })
          : JSON.stringify(resolvedBody);
        statements.push(
          env.DB.prepare(
            'INSERT INTO templates (id, slug, name, description, base_kind, base_source_url, base_body, overlay, current_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
          ).bind(
            templateId,
            template.slug,
            template.name,
            template.description ?? '',
            template.baseKind,
            template.baseSourceUrl ?? null,
            storedBaseBodyJson,
            JSON.stringify(template.overlay),
            createdAt,
            updatedAt,
          ),
        );
        statements.push(
          env.DB.prepare(
            'INSERT INTO template_versions (template_id, version, resolved_body, note, created_at) VALUES (?, 1, ?, ?, ?)',
          ).bind(templateId, storedResolvedBodyJson, '备份导入', createdAt),
        );
      }
    }

    if (data.publications !== undefined) {
      for (const publication of data.publications) {
        statements.push(
          env.DB.prepare(
            'INSERT INTO publications (id, slug, template_id, pinned_version, clients, access, output, experimental_full_config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          ).bind(
            publication.id || id('pub'),
            publication.slug,
            publication.templateId,
            publication.pinnedVersion ?? null,
            JSON.stringify(publication.clients),
            publication.access,
            publication.output ?? null,
            publication.experimentalFullConfig ? 1 : 0,
            publication.createdAt ?? timestamp,
            publication.updatedAt ?? timestamp,
          ),
        );
      }
    }
  }

  await env.DB.batch(statements);
  return getRulesOverview(env);
}
