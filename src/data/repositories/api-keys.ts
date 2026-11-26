import { desc, eq } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import { apiKeys } from '../schema';

export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type NewApiKeyRow = typeof apiKeys.$inferInsert;

export type ApiKeySummary = {
  id: string;
  note: string;
  keyPrefix: string;
  scopes: string;
  createdAt: string;
  lastUsedAt?: string;
};

export class ApiKeysRepository {
  constructor(private readonly db: AppDatabase) {}

  async hasAny(): Promise<boolean> {
    const rows = await this.db.select({ id: apiKeys.id }).from(apiKeys).limit(1);
    return rows.length > 0;
  }

  async list(): Promise<ApiKeySummary[]> {
    const rows = await this.db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
    return rows.map((row) => ({
      id: row.id,
      note: row.note,
      keyPrefix: row.keyPrefix,
      scopes: row.scopes,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt ?? undefined,
    }));
  }

  async create(row: NewApiKeyRow): Promise<void> {
    await this.db.insert(apiKeys).values(row);
  }

  async findByHash(keyHash: string): Promise<ApiKeyRow | null> {
    const rows = await this.db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
    return rows[0] ?? null;
  }

  async touchLastUsed(id: string, lastUsedAt: string): Promise<void> {
    await this.db.update(apiKeys).set({ lastUsedAt }).where(eq(apiKeys.id, id));
  }

  async updateNote(id: string, note: string): Promise<void> {
    await this.db.update(apiKeys).set({ note }).where(eq(apiKeys.id, id));
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(apiKeys).where(eq(apiKeys.id, id));
  }
}
