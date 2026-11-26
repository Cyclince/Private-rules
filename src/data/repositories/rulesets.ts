import { asc, eq } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import { categories } from '../schema';

export type RuleSetRow = typeof categories.$inferSelect;
export type NewRuleSetRow = typeof categories.$inferInsert;

export class RuleSetsRepository {
  constructor(private readonly db: AppDatabase) {}

  async listAll(): Promise<RuleSetRow[]> {
    return this.db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.createdAt));
  }

  async findById(id: string): Promise<RuleSetRow | null> {
    const rows = await this.db.select().from(categories).where(eq(categories.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findBySlug(slug: string): Promise<RuleSetRow | null> {
    const rows = await this.db.select().from(categories).where(eq(categories.slug, slug)).limit(1);
    return rows[0] ?? null;
  }

  async create(row: NewRuleSetRow): Promise<void> {
    await this.db.insert(categories).values(row);
  }

  async update(
    id: string,
    patch: Partial<
      Pick<
        RuleSetRow,
        | 'name'
        | 'slug'
        | 'icon'
        | 'description'
        | 'note'
        | 'sortOrder'
        | 'enabled'
        | 'publicLinksEnabled'
        | 'tokenLinksEnabled'
        | 'updatedAt'
      >
    >,
  ): Promise<void> {
    await this.db.update(categories).set(patch).where(eq(categories.id, id));
  }

  async touch(id: string, updatedAt: string): Promise<void> {
    await this.db.update(categories).set({ updatedAt }).where(eq(categories.id, id));
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(categories).where(eq(categories.id, id));
  }
}
