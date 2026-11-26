import { and, asc, eq, gt, lte, ne } from 'drizzle-orm';
import type { DatabasePort } from '../../application/ports/database';
import { sourceNameFromSubscriptionUrl } from '../../lib/github-mirror';
import type { DomainRule, RuleOptimizationMode, RuleSource } from '../../types/domain-rules';
import type { AppDatabase } from '../db';
import { categories, categorySources, rules, sourceRuleStaging, syncLeases } from '../schema';

export type SourceRow = typeof categorySources.$inferSelect;
export type NewSourceRow = typeof categorySources.$inferInsert;

const STAGING_BATCH_SIZE = 80;

export function mapSourceRow(row: SourceRow): RuleSource {
  const sourceType = (row.sourceType ?? 'url') as 'url' | 'geosite' | 'geoip';
  const name = sourceType === 'url' ? sourceNameFromSubscriptionUrl(row.url, row.name) : row.name;
  const rawOpt = row.ruleOptimization as RuleOptimizationMode | 'balanced' | null;
  return {
    id: row.id,
    categoryId: row.categoryId,
    name,
    url: row.url,
    enabled: row.enabled !== 0,
    lastSyncedAt: row.lastSyncedAt ?? undefined,
    lastStatus: (row.lastStatus ?? 'pending') as RuleSource['lastStatus'],
    lastCount: row.lastCount ?? 0,
    lastOriginalCount: row.lastOriginalCount ?? row.lastCount ?? 0,
    lastError: row.lastError ?? undefined,
    syncIntervalMinutes: row.syncIntervalMinutes ?? 60,
    userAgent: row.userAgent ?? 'clash-verge/v2.5.1',
    sourceType,
    geositeName: row.geositeName ?? undefined,
    geoipName: row.geoipName ?? undefined,
    ruleOptimization: rawOpt === 'balanced' ? 'aggressive' : (rawOpt ?? 'none'),
    coverageDedup: row.coverageDedup !== 0,
  };
}

export class SourcesRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly rawDb: DatabasePort,
  ) {}

  async listAll(): Promise<RuleSource[]> {
    const rows = await this.db.select().from(categorySources).orderBy(asc(categorySources.createdAt));
    return rows.map(mapSourceRow);
  }

  async listByCategory(categoryId: string): Promise<RuleSource[]> {
    const rows = await this.db
      .select()
      .from(categorySources)
      .where(eq(categorySources.categoryId, categoryId))
      .orderBy(asc(categorySources.createdAt));
    return rows.map(mapSourceRow);
  }

  async listEnabledRows(categoryId?: string): Promise<SourceRow[]> {
    const condition = categoryId
      ? and(eq(categorySources.enabled, 1), eq(categorySources.categoryId, categoryId))
      : eq(categorySources.enabled, 1);
    return this.db.select().from(categorySources).where(condition).orderBy(asc(categorySources.createdAt));
  }

  async listFailedRows(): Promise<SourceRow[]> {
    return this.db
      .select()
      .from(categorySources)
      .where(and(eq(categorySources.enabled, 1), eq(categorySources.lastStatus, 'error')))
      .orderBy(asc(categorySources.createdAt));
  }

  async findById(sourceId: string, categoryId?: string): Promise<RuleSource | null> {
    const condition = categoryId
      ? and(eq(categorySources.id, sourceId), eq(categorySources.categoryId, categoryId))
      : eq(categorySources.id, sourceId);
    const rows = await this.db.select().from(categorySources).where(condition).limit(1);
    return rows[0] ? mapSourceRow(rows[0]) : null;
  }

  async findEnabledRowById(sourceId: string): Promise<SourceRow | null> {
    const rows = await this.db
      .select()
      .from(categorySources)
      .where(and(eq(categorySources.id, sourceId), eq(categorySources.enabled, 1)))
      .limit(1);
    return rows[0] ?? null;
  }

  async existsEnabled(sourceId: string, categoryId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: categorySources.id })
      .from(categorySources)
      .where(
        and(
          eq(categorySources.id, sourceId),
          eq(categorySources.categoryId, categoryId),
          eq(categorySources.enabled, 1),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async hasDuplicateUrl(categoryId: string, url: string, excludeSourceId?: string): Promise<boolean> {
    const condition = excludeSourceId
      ? and(
          eq(categorySources.categoryId, categoryId),
          eq(categorySources.url, url),
          ne(categorySources.id, excludeSourceId),
        )
      : and(eq(categorySources.categoryId, categoryId), eq(categorySources.url, url));
    const rows = await this.db.select({ id: categorySources.id }).from(categorySources).where(condition).limit(1);
    return rows.length > 0;
  }

  async create(row: NewSourceRow): Promise<void> {
    await this.db.insert(categorySources).values(row);
  }

  async update(sourceId: string, patch: Partial<Omit<SourceRow, 'id' | 'categoryId' | 'createdAt'>>): Promise<void> {
    await this.db.update(categorySources).set(patch).where(eq(categorySources.id, sourceId));
  }

  async toggle(sourceId: string, enabled: boolean, updatedAt: string): Promise<boolean> {
    const existing = await this.findById(sourceId);
    if (!existing) return false;
    await this.db
      .update(categorySources)
      .set({ enabled: enabled ? 1 : 0, updatedAt })
      .where(eq(categorySources.id, sourceId));
    return true;
  }

  async deleteWithRules(sourceId: string, categoryId: string, updatedAt: string): Promise<void> {
    await this.db.batch([
      this.db.delete(rules).where(eq(rules.sourceId, sourceId)),
      this.db.delete(categorySources).where(eq(categorySources.id, sourceId)),
      this.db.update(categories).set({ updatedAt }).where(eq(categories.id, categoryId)),
    ]);
  }

  async hasActiveLease(sourceId: string, nowIso: string): Promise<boolean> {
    const rows = await this.db
      .select({ ownerId: syncLeases.ownerId })
      .from(syncLeases)
      .where(
        and(
          eq(syncLeases.resourceType, 'source'),
          eq(syncLeases.resourceId, sourceId),
          gt(syncLeases.expiresAt, nowIso),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async claimLease(sourceId: string, ownerId: string, acquiredAt: string, expiresAt: string): Promise<boolean> {
    await this.db
      .delete(syncLeases)
      .where(
        and(
          eq(syncLeases.resourceType, 'source'),
          eq(syncLeases.resourceId, sourceId),
          lte(syncLeases.expiresAt, acquiredAt),
        ),
      );
    const result = await this.rawDb
      .prepare(
        `INSERT OR IGNORE INTO sync_leases (resource_type, resource_id, owner_id, acquired_at, expires_at)
         VALUES ('source', ?, ?, ?, ?)`,
      )
      .bind(sourceId, ownerId, acquiredAt, expiresAt)
      .run();
    return (result.changes ?? 0) > 0;
  }

  async releaseLease(sourceId: string, ownerId: string): Promise<void> {
    await this.db
      .delete(syncLeases)
      .where(
        and(
          eq(syncLeases.resourceType, 'source'),
          eq(syncLeases.resourceId, sourceId),
          eq(syncLeases.ownerId, ownerId),
        ),
      );
  }

  async stageRules(
    stageId: string,
    sourceId: string,
    categoryId: string,
    stagedRules: readonly (DomainRule & { stagedId: string })[],
    baseSortOrder = Date.now(),
  ): Promise<void> {
    for (let offset = 0; offset < stagedRules.length; offset += STAGING_BATCH_SIZE) {
      const chunk = stagedRules.slice(offset, offset + STAGING_BATCH_SIZE);
      const queries = chunk.map((rule, index) =>
        this.db.insert(sourceRuleStaging).values({
          syncId: stageId,
          id: rule.stagedId,
          sourceId,
          categoryId,
          value: rule.value,
          type: rule.type,
          displayType: rule.displayType ?? '',
          note: rule.note ?? '',
          sortOrder: baseSortOrder + offset + index,
          createdAt: rule.createdAt,
          updatedAt: rule.updatedAt,
        }),
      );
      if (queries.length > 0) {
        await this.db.batch(queries as [(typeof queries)[0], ...(typeof queries)[0][]]);
      }
    }
  }

  async commitStagedRules(input: {
    stageId: string;
    sourceId: string;
    categoryId: string;
    syncedAt: string;
    count: number;
    originalCount: number;
  }): Promise<void> {
    await this.rawDb.batch([
      this.rawDb.prepare('DELETE FROM rules WHERE source_id = ?').bind(input.sourceId),
      this.rawDb
        .prepare(
          `INSERT OR IGNORE INTO rules
            (id, category_id, value, type, display_type, note, enabled, sort_order, source_id, created_at, updated_at)
          SELECT id, category_id, value, type, display_type, note, 1, sort_order, source_id, created_at, updated_at
          FROM source_rule_staging WHERE sync_id = ?`,
        )
        .bind(input.stageId),
      this.rawDb.prepare('DELETE FROM source_rule_staging WHERE sync_id = ?').bind(input.stageId),
      this.rawDb
        .prepare(
          `UPDATE category_sources
           SET last_synced_at = ?, last_status = 'success', last_count = ?, last_original_count = ?, last_error = NULL, updated_at = ?
           WHERE id = ? AND category_id = ?`,
        )
        .bind(input.syncedAt, input.count, input.originalCount, input.syncedAt, input.sourceId, input.categoryId),
      this.rawDb.prepare('UPDATE categories SET updated_at = ? WHERE id = ?').bind(input.syncedAt, input.categoryId),
    ]);
  }

  async clearStaging(stageId: string): Promise<void> {
    await this.db.delete(sourceRuleStaging).where(eq(sourceRuleStaging.syncId, stageId));
  }

  async recordSyncError(sourceId: string, syncedAt: string, errorMessage: string): Promise<void> {
    await this.db
      .update(categorySources)
      .set({
        lastSyncedAt: syncedAt,
        lastStatus: 'error',
        lastError: errorMessage.slice(0, 500),
        updatedAt: syncedAt,
      })
      .where(eq(categorySources.id, sourceId));
  }
}
