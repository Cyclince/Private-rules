import { desc, eq } from 'drizzle-orm';
import type { OutputProfile, TemplateClientId } from '../../shared/clients';
import type { Publication, PublicationAccess } from '../../shared/schemas/publication';
import type { AppDatabase } from '../db';
import { publications } from '../schema';

export type PublicationRow = typeof publications.$inferSelect;
export type NewPublicationRow = typeof publications.$inferInsert;

function parseClients(raw: string): TemplateClientId[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TemplateClientId[]) : [];
  } catch {
    return [];
  }
}

export function mapPublicationRow(row: PublicationRow): Publication {
  return {
    id: row.id,
    slug: row.slug,
    templateId: row.templateId,
    pinnedVersion: row.pinnedVersion ?? undefined,
    clients: parseClients(row.clients),
    access: row.access as PublicationAccess,
    output: row.output === 'full' || row.output === 'minimal' ? (row.output as OutputProfile) : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PublicationsRepository {
  constructor(private readonly db: AppDatabase) {}

  async listAll(): Promise<Publication[]> {
    const rows = await this.db
      .select()
      .from(publications)
      .orderBy(desc(publications.updatedAt), desc(publications.createdAt));
    return rows.map(mapPublicationRow);
  }

  async listByTemplateId(templateId: string): Promise<Publication[]> {
    const rows = await this.db
      .select()
      .from(publications)
      .where(eq(publications.templateId, templateId))
      .orderBy(desc(publications.updatedAt));
    return rows.map(mapPublicationRow);
  }

  async findById(id: string): Promise<Publication | null> {
    const rows = await this.db.select().from(publications).where(eq(publications.id, id)).limit(1);
    return rows[0] ? mapPublicationRow(rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<Publication | null> {
    const rows = await this.db.select().from(publications).where(eq(publications.slug, slug)).limit(1);
    return rows[0] ? mapPublicationRow(rows[0]) : null;
  }

  async create(row: NewPublicationRow): Promise<void> {
    await this.db.insert(publications).values(row);
  }

  async update(
    id: string,
    patch: Partial<
      Pick<PublicationRow, 'slug' | 'templateId' | 'pinnedVersion' | 'clients' | 'access' | 'output' | 'updatedAt'>
    >,
  ): Promise<void> {
    await this.db.update(publications).set(patch).where(eq(publications.id, id));
  }

  async touch(id: string, updatedAt: string): Promise<void> {
    await this.db.update(publications).set({ updatedAt }).where(eq(publications.id, id));
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(publications).where(eq(publications.id, id));
  }
}
