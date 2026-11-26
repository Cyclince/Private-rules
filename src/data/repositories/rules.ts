import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { DatabasePort } from '../../application/ports/database';
import type { ConflictIndexedRule } from '../../domain/rules/conflicts';
import type { RuleOptions } from '../../shared/schemas/rule';
import { UPSTREAM_RULE_PREVIEW_LIMIT, type DomainRule, type DomainRuleType } from '../../types/domain-rules';
import type { AppDatabase } from '../db';
import { categories, rules } from '../schema';

export type RuleRow = typeof rules.$inferSelect;
export type NewRuleRow = typeof rules.$inferInsert;

export type RuleCountSummary = {
  categoryId: string;
  ruleCount: number;
  enabledRuleCount: number;
  manualRuleCount: number;
  urlRuleCount: number;
  geoRuleCount: number;
};

export type RuleSourceFilter = 'manual' | 'upstream' | 'url' | 'geo';

export const RULE_BATCH_SIZE = 80;

export function parseRuleOptions(raw: string | null | undefined): RuleOptions | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return undefined;
    const record = parsed as Record<string, unknown>;
    const options: RuleOptions = {};
    if (typeof record.noResolve === 'boolean') options.noResolve = record.noResolve;
    return Object.keys(options).length > 0 ? options : undefined;
  } catch {
    return undefined;
  }
}

export function serializeRuleOptions(options: RuleOptions | undefined): string | null {
  if (!options || Object.keys(options).length === 0) return null;
  return JSON.stringify(options);
}

type RawJoinedRuleRow = {
  id: string;
  category_id: string;
  value: string;
  type: DomainRuleType;
  display_type: string | null;
  options: string | null;
  note: string | null;
  enabled: number | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
  source_id: string | null;
  source_name?: string | null;
  source_type?: 'url' | 'geosite' | 'geoip' | null;
  source_enabled?: number | null;
  category_name?: string | null;
};

export function mapRuleRow(row: RuleRow): DomainRule {
  const options = parseRuleOptions(row.options);
  return {
    id: row.id,
    categoryId: row.categoryId,
    value: row.value,
    type: row.type as DomainRuleType,
    displayType: row.displayType ?? undefined,
    ...(options ? { options } : {}),
    note: row.note ?? undefined,
    sortOrder: row.sortOrder ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sourceId: row.sourceId ?? undefined,
    enabled: row.enabled !== 0,
  };
}

function mapRawJoinedRule(row: RawJoinedRuleRow): DomainRule {
  const options = parseRuleOptions(row.options);
  return {
    id: row.id,
    categoryId: row.category_id,
    value: row.value,
    type: row.type,
    displayType: row.display_type ?? undefined,
    ...(options ? { options } : {}),
    note: row.note ?? undefined,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceId: row.source_id ?? undefined,
    sourceName: row.source_name ?? undefined,
    sourceType: row.source_type ?? undefined,
    sourceEnabled: row.source_id ? row.source_enabled !== 0 : undefined,
    enabled: row.enabled !== 0 && (!row.source_id || row.source_enabled !== 0),
  };
}

const DEDUPLICATED_RULE_CTE = `WITH ranked_rules AS (
  SELECT r.*, s.name AS source_name, COALESCE(s.source_type, 'url') AS source_type, COALESCE(s.enabled, 1) AS source_enabled,
    c.name AS category_name, c.description AS category_description,
    ROW_NUMBER() OVER (
      PARTITION BY r.category_id, LOWER(r.type), LOWER(r.value)
      ORDER BY CASE WHEN r.source_id IS NULL THEN 0 ELSE 1 END, r.sort_order ASC, r.created_at ASC
    ) AS duplicate_rank
  FROM rules r
  LEFT JOIN category_sources s ON s.id = r.source_id
  LEFT JOIN categories c ON c.id = r.category_id
)`;

export class RulesRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly rawDb: DatabasePort,
  ) {}

  async listAll(): Promise<DomainRule[]> {
    const rows = await this.db.select().from(rules).orderBy(asc(rules.sortOrder), asc(rules.createdAt));
    return rows.map(mapRuleRow);
  }

  async listByCategory(categoryId: string): Promise<DomainRule[]> {
    const rows = await this.db
      .select()
      .from(rules)
      .where(eq(rules.categoryId, categoryId))
      .orderBy(asc(rules.sortOrder), asc(rules.createdAt));
    return rows.map(mapRuleRow);
  }

  async listManual(): Promise<DomainRule[]> {
    const rows = await this.db
      .select()
      .from(rules)
      .where(isNull(rules.sourceId))
      .orderBy(asc(rules.sortOrder), asc(rules.createdAt));
    return rows.map(mapRuleRow);
  }

  async listUpstreamPreview(limit = UPSTREAM_RULE_PREVIEW_LIMIT): Promise<DomainRule[]> {
    if (limit <= 0) return [];
    const rows = await this.rawDb
      .prepare(
        `SELECT id, category_id, value, type, display_type, options, note, enabled, sort_order, created_at, updated_at, source_id
        FROM (
          SELECT r.*, ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY sort_order ASC, created_at ASC) AS preview_row
          FROM rules r WHERE source_id IS NOT NULL
        ) WHERE preview_row <= ? ORDER BY category_id, sort_order ASC, created_at ASC`,
      )
      .bind(limit)
      .all<RawJoinedRuleRow>();
    return (rows.results ?? []).map(mapRawJoinedRule);
  }

  async getCountsByCategory(): Promise<Map<string, RuleCountSummary>> {
    const rows = await this.rawDb
      .prepare(
        `${DEDUPLICATED_RULE_CTE}
        SELECT category_id,
          COUNT(*) AS rule_count,
          SUM(CASE WHEN enabled <> 0 AND (source_id IS NULL OR source_enabled <> 0) THEN 1 ELSE 0 END) AS enabled_rule_count,
          SUM(CASE WHEN source_id IS NULL THEN 1 ELSE 0 END) AS manual_rule_count,
          SUM(CASE WHEN source_id IS NOT NULL AND source_type = 'url' THEN 1 ELSE 0 END) AS url_rule_count,
          SUM(CASE WHEN source_id IS NOT NULL AND source_type <> 'url' THEN 1 ELSE 0 END) AS geo_rule_count
        FROM ranked_rules WHERE duplicate_rank = 1 GROUP BY category_id`,
      )
      .all<{
        category_id: string;
        rule_count: number;
        enabled_rule_count: number;
        manual_rule_count: number;
        url_rule_count: number;
        geo_rule_count: number;
      }>();

    const counts = new Map<string, RuleCountSummary>();
    for (const row of rows.results ?? []) {
      counts.set(row.category_id, {
        categoryId: row.category_id,
        ruleCount: row.rule_count,
        enabledRuleCount: row.enabled_rule_count,
        manualRuleCount: row.manual_rule_count,
        urlRuleCount: row.url_rule_count,
        geoRuleCount: row.geo_rule_count,
      });
    }
    return counts;
  }

  async listFiltered(
    options: {
      categoryId?: string;
      query?: string;
      source?: RuleSourceFilter;
      limit?: number;
    } = {},
  ): Promise<DomainRule[]> {
    const conditions = ['duplicate_rank = 1'];
    const bindings: unknown[] = [];
    if (options.categoryId) {
      conditions.push('category_id = ?');
      bindings.push(options.categoryId);
    }
    if (options.source === 'manual') conditions.push('source_id IS NULL');
    if (options.source === 'upstream') conditions.push('source_id IS NOT NULL');
    if (options.source === 'url') conditions.push("source_id IS NOT NULL AND source_type = 'url'");
    if (options.source === 'geo') conditions.push("source_id IS NOT NULL AND source_type <> 'url'");
    const query = options.query?.trim();
    if (query) {
      conditions.push(
        `(LOWER(value) LIKE LOWER(?) ESCAPE '\\' OR LOWER(COALESCE(note, '')) LIKE LOWER(?) ESCAPE '\\'
          OR LOWER(type) LIKE LOWER(?) ESCAPE '\\' OR LOWER(COALESCE(display_type, '')) LIKE LOWER(?) ESCAPE '\\'
          OR LOWER(COALESCE(source_name, '')) LIKE LOWER(?) ESCAPE '\\' OR LOWER(COALESCE(category_name, '')) LIKE LOWER(?) ESCAPE '\\'
          OR LOWER(COALESCE(category_description, '')) LIKE LOWER(?) ESCAPE '\\')`,
      );
      const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
      bindings.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
    }
    const limit =
      options.limit === undefined ? UPSTREAM_RULE_PREVIEW_LIMIT : Math.max(0, Math.min(options.limit, 100_000));
    const statement = this.rawDb.prepare(
      `${DEDUPLICATED_RULE_CTE}
      SELECT id, category_id, value, type, display_type, options, note, enabled, sort_order, created_at, updated_at,
        source_id, source_name, source_type, source_enabled
      FROM ranked_rules WHERE ${conditions.join(' AND ')}
      ORDER BY category_id, sort_order ASC, created_at ASC${limit ? ' LIMIT ?' : ''}`,
    );
    if (limit) bindings.push(limit);
    const rows = await statement.bind(...bindings).all<RawJoinedRuleRow>();
    return (rows.results ?? []).map(mapRawJoinedRule);
  }

  async findById(ruleId: string, categoryId: string): Promise<RuleRow | null> {
    const rows = await this.db
      .select()
      .from(rules)
      .where(and(eq(rules.id, ruleId), eq(rules.categoryId, categoryId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listManualForConflictIndex(): Promise<ConflictIndexedRule[]> {
    const rows = await this.db
      .select({
        id: rules.id,
        categoryId: rules.categoryId,
        categoryName: categories.name,
        type: rules.type,
        value: rules.value,
      })
      .from(rules)
      .innerJoin(categories, eq(categories.id, rules.categoryId))
      .where(isNull(rules.sourceId));

    return rows.map((row) => ({
      id: row.id,
      categoryId: row.categoryId,
      categoryName: row.categoryName ?? '未知分类',
      type: row.type as DomainRuleType,
      value: row.value,
    }));
  }

  async listManualDomainRulesForOptimization(): Promise<Array<{ rule: DomainRule; categoryName: string }>> {
    const rows = await this.rawDb
      .prepare(
        `SELECT r.*, c.name AS category_name
        FROM rules r JOIN categories c ON c.id = r.category_id
        WHERE r.source_id IS NULL AND r.type IN ('DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD')
        ORDER BY r.category_id, r.enabled DESC, r.sort_order ASC, r.created_at ASC`,
      )
      .all<RawJoinedRuleRow>();

    return (rows.results ?? []).map((row) => ({
      rule: mapRawJoinedRule(row),
      categoryName: row.category_name ?? '未知分类',
    }));
  }

  async insertOne(categoryId: string, rule: DomainRule, sortOrder = 0, sourceId?: string): Promise<void> {
    await this.db
      .insert(rules)
      .values({
        id: rule.id,
        categoryId,
        value: rule.value,
        type: rule.type,
        displayType: rule.displayType ?? '',
        options: serializeRuleOptions(rule.options),
        note: rule.note ?? '',
        enabled: rule.enabled ? 1 : 0,
        sortOrder: rule.sortOrder ?? sortOrder,
        sourceId: sourceId ?? rule.sourceId ?? null,
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
      })
      .onConflictDoNothing();
  }

  /**
   * Inserts rules in atomic batches of `batchSize` (default 80, design §9.3)
   * using Drizzle `db.batch` for compatibility with both D1 and SQLite.
   */
  async insertManyInBatches(
    categoryId: string,
    items: readonly DomainRule[],
    baseSortOrder = Date.now(),
    batchSize = RULE_BATCH_SIZE,
  ): Promise<void> {
    for (let offset = 0; offset < items.length; offset += batchSize) {
      const chunk = items.slice(offset, offset + batchSize);
      const queries = chunk.map((rule, index) =>
        this.db
          .insert(rules)
          .values({
            id: rule.id,
            categoryId,
            value: rule.value,
            type: rule.type,
            displayType: rule.displayType ?? '',
            options: serializeRuleOptions(rule.options),
            note: rule.note ?? '',
            enabled: rule.enabled ? 1 : 0,
            sortOrder: rule.sortOrder ?? baseSortOrder + offset + index,
            sourceId: rule.sourceId ?? null,
            createdAt: rule.createdAt,
            updatedAt: rule.updatedAt,
          })
          .onConflictDoNothing(),
      );
      if (queries.length > 0) {
        await this.db.batch(queries as [(typeof queries)[0], ...(typeof queries)[0][]]);
      }
    }
  }

  async updateOne(
    categoryId: string,
    ruleId: string,
    patch: Partial<
      Pick<RuleRow, 'value' | 'type' | 'displayType' | 'options' | 'note' | 'enabled' | 'sortOrder' | 'updatedAt'>
    >,
  ): Promise<void> {
    await this.db
      .update(rules)
      .set(patch)
      .where(and(eq(rules.id, ruleId), eq(rules.categoryId, categoryId)));
  }

  async deleteOne(categoryId: string, ruleId: string): Promise<void> {
    await this.db.delete(rules).where(and(eq(rules.id, ruleId), eq(rules.categoryId, categoryId)));
  }

  async deleteManualByIds(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    for (let offset = 0; offset < ids.length; offset += RULE_BATCH_SIZE) {
      const chunk = ids.slice(offset, offset + RULE_BATCH_SIZE);
      await this.db.delete(rules).where(and(isNull(rules.sourceId), inArray(rules.id, chunk)));
    }
  }

  async deleteManualInCategoryByIds(categoryId: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    for (let offset = 0; offset < ids.length; offset += 500) {
      const chunk = ids.slice(offset, offset + 500);
      await this.db
        .delete(rules)
        .where(and(eq(rules.categoryId, categoryId), isNull(rules.sourceId), inArray(rules.id, chunk)));
    }
  }

  async batchUpdateManual(
    categoryId: string,
    ids: readonly string[],
    action: 'enable' | 'disable' | 'delete',
    updatedAt: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    if (action === 'delete') {
      await this.deleteManualInCategoryByIds(categoryId, ids);
      return;
    }
    await this.db
      .update(rules)
      .set({ enabled: action === 'enable' ? 1 : 0, updatedAt })
      .where(and(eq(rules.categoryId, categoryId), isNull(rules.sourceId), inArray(rules.id, [...ids])));
  }
}
