import { asc, eq } from 'drizzle-orm';
import {
  appCardBodySchema,
  normalizeCatalogCategory,
  type AppCard,
  type AppCardBody,
  type CardOrigin,
  type CatalogCategory,
} from '../../shared/schemas/card';
import type { AppDatabase } from '../db';
import { appCards } from '../schema';

export type AppCardRow = typeof appCards.$inferSelect;
export type NewAppCardRow = typeof appCards.$inferInsert;

function parseCardBody(raw: string): AppCardBody {
  const parsed = JSON.parse(raw) as unknown;
  const validated = appCardBodySchema.safeParse(parsed);
  if (validated.success) return validated.data;
  // Graceful fallback for sparse legacy/draft records imported from backups
  const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  return {
    stage: (typeof record.stage === 'string' ? record.stage : 'app') as AppCardBody['stage'],
    group:
      record.group && typeof record.group === 'object'
        ? (record.group as AppCardBody['group'])
        : { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
    matchers: Array.isArray(record.matchers) ? (record.matchers as AppCardBody['matchers']) : [],
    ...(typeof record.hidden === 'boolean' ? { hidden: record.hidden } : {}),
  };
}

export function mapAppCardRow(row: AppCardRow): AppCard {
  const body = parseCardBody(row.body);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    icon: row.icon ?? undefined,
    // Legacy ids (`advertising`, `infrastructure`) map to current categories on read; rows stay untouched.
    category: (normalizeCatalogCategory(row.category) ?? 'other') as CatalogCategory,
    stage: body.stage,
    group: body.group,
    matchers: body.matchers,
    ...(body.hidden !== undefined ? { hidden: body.hidden } : {}),
    origin: row.origin as CardOrigin,
    forkedFrom: row.forkedFrom ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeCardBody(card: Pick<AppCard, 'stage' | 'group' | 'matchers' | 'hidden'>): string {
  const body: AppCardBody = {
    stage: card.stage,
    group: card.group,
    matchers: card.matchers,
    ...(card.hidden !== undefined ? { hidden: card.hidden } : {}),
  };
  return JSON.stringify(body);
}

export class CardsRepository {
  constructor(private readonly db: AppDatabase) {}

  async listAll(): Promise<AppCard[]> {
    const rows = await this.db
      .select()
      .from(appCards)
      .orderBy(asc(appCards.category), asc(appCards.createdAt), asc(appCards.id));
    return rows.map(mapAppCardRow);
  }

  async listUpdatedTimestamps(): Promise<Array<{ id: string; updatedAt: string }>> {
    return this.db.select({ id: appCards.id, updatedAt: appCards.updatedAt }).from(appCards).orderBy(asc(appCards.id));
  }

  async findById(id: string): Promise<AppCard | null> {
    const rows = await this.db.select().from(appCards).where(eq(appCards.id, id)).limit(1);
    return rows[0] ? mapAppCardRow(rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<AppCard | null> {
    const rows = await this.db.select().from(appCards).where(eq(appCards.slug, slug)).limit(1);
    return rows[0] ? mapAppCardRow(rows[0]) : null;
  }

  async create(row: NewAppCardRow): Promise<void> {
    await this.db.insert(appCards).values(row);
  }

  async update(
    id: string,
    patch: Partial<Pick<AppCardRow, 'slug' | 'name' | 'icon' | 'category' | 'body' | 'updatedAt'>>,
  ): Promise<void> {
    await this.db.update(appCards).set(patch).where(eq(appCards.id, id));
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(appCards).where(eq(appCards.id, id));
  }
}
