import { asc, eq } from 'drizzle-orm';
import type { DatabasePort } from '../../application/ports/database';
import type { CatalogCategory, CatalogDefaultRoute, CatalogEntry } from '../../shared/schemas/card';
import type { AppDatabase } from '../db';
import { catalogEntries } from '../schema';

export type CatalogEntryRow = typeof catalogEntries.$inferSelect;
export type NewCatalogEntryRow = typeof catalogEntries.$inferInsert;

const UPSERT_BATCH_SIZE = 60;

function parseAliases(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function mapCatalogEntryRow(row: CatalogEntryRow): CatalogEntry {
  return {
    id: row.id,
    provider: row.provider,
    parentId: row.parentId ?? undefined,
    name: row.name,
    aliases: parseAliases(row.aliases),
    category: row.category as CatalogCategory,
    defaultRoute: row.defaultRoute as CatalogDefaultRoute,
    sourceUrl: row.sourceUrl,
    ruleCount: row.ruleCount ?? null,
  };
}

export class CatalogRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly rawDb: DatabasePort,
  ) {}

  async listAll(): Promise<CatalogEntry[]> {
    const rows = await this.db
      .select()
      .from(catalogEntries)
      .orderBy(asc(catalogEntries.category), asc(catalogEntries.name), asc(catalogEntries.id));
    return rows.map(mapCatalogEntryRow);
  }

  async findById(id: string): Promise<CatalogEntry | null> {
    const rows = await this.db.select().from(catalogEntries).where(eq(catalogEntries.id, id)).limit(1);
    return rows[0] ? mapCatalogEntryRow(rows[0]) : null;
  }

  async count(): Promise<number> {
    const rows = await this.db.select({ id: catalogEntries.id }).from(catalogEntries);
    return rows.length;
  }

  async upsertMany(entries: readonly CatalogEntry[]): Promise<void> {
    for (let offset = 0; offset < entries.length; offset += UPSERT_BATCH_SIZE) {
      const chunk = entries.slice(offset, offset + UPSERT_BATCH_SIZE);
      const statements = chunk.map((entry) =>
        this.rawDb
          .prepare(
            `INSERT INTO catalog_entries (id, provider, parent_id, name, aliases, category, default_route, source_url, rule_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               provider = excluded.provider,
               parent_id = excluded.parent_id,
               name = excluded.name,
               aliases = excluded.aliases,
               category = excluded.category,
               default_route = excluded.default_route,
               source_url = excluded.source_url,
               rule_count = excluded.rule_count`,
          )
          .bind(
            entry.id,
            entry.provider,
            entry.parentId ?? null,
            entry.name,
            JSON.stringify(entry.aliases ?? []),
            entry.category,
            entry.defaultRoute,
            entry.sourceUrl,
            entry.ruleCount ?? null,
          ),
      );
      if (statements.length > 0) {
        await this.rawDb.batch(statements);
      }
    }
  }
}
