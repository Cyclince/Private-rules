import { and, desc, eq } from 'drizzle-orm';
import type { DatabasePort } from '../../application/ports/database';
import {
  templateBodySchema,
  templateOverlaySchema,
  type TemplateBaseKind,
  type TemplateBody,
  type TemplateOverlay,
  type TemplateRecord,
} from '../../shared/schemas/template';
import type { AppDatabase } from '../db';
import { templates, templateVersions } from '../schema';

export const TEMPLATE_VERSION_RETENTION = 50;

export type TemplateRow = typeof templates.$inferSelect;
export type NewTemplateRow = typeof templates.$inferInsert;
export type TemplateVersionRow = typeof templateVersions.$inferSelect;

export type TemplateVersionSummary = {
  templateId: string;
  version: number;
  note: string;
  createdAt: string;
};

export type TemplateVersionRecord = TemplateVersionSummary & {
  resolvedBody: TemplateBody;
};

const EMPTY_FALLBACK_BODY: TemplateBody = {
  slots: [],
  regionGroups: [],
  cards: [],
  groupMode: 'select',
  final: { kind: 'builtin', id: 'DIRECT' },
  output: 'full',
  dns: { mode: 'fake-ip' },
  modules: [],
};

function parseTemplateBody(raw: string): TemplateBody {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const validated = templateBodySchema.safeParse(parsed);
    if (validated.success) return validated.data;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...EMPTY_FALLBACK_BODY, ...(parsed as Partial<TemplateBody>) };
    }
    return structuredClone(EMPTY_FALLBACK_BODY);
  } catch {
    return structuredClone(EMPTY_FALLBACK_BODY);
  }
}

function parseTemplateOverlay(raw: string): TemplateOverlay {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const validated = templateOverlaySchema.safeParse(parsed);
    return validated.success ? validated.data : [];
  } catch {
    return [];
  }
}

export function mapTemplateRow(row: TemplateRow): TemplateRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    baseKind: row.baseKind as TemplateBaseKind,
    baseSourceUrl: row.baseSourceUrl ?? undefined,
    baseBody: parseTemplateBody(row.baseBody),
    overlay: parseTemplateOverlay(row.overlay),
    currentVersion: row.currentVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapTemplateVersionRow(row: TemplateVersionRow): TemplateVersionRecord {
  return {
    templateId: row.templateId,
    version: row.version,
    resolvedBody: parseTemplateBody(row.resolvedBody),
    note: row.note,
    createdAt: row.createdAt,
  };
}

export class TemplatesRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly rawDb: DatabasePort,
  ) {}

  async listAll(): Promise<TemplateRecord[]> {
    const rows = await this.db.select().from(templates).orderBy(desc(templates.updatedAt), desc(templates.createdAt));
    return rows.map(mapTemplateRow);
  }

  async findById(id: string): Promise<TemplateRecord | null> {
    const rows = await this.db.select().from(templates).where(eq(templates.id, id)).limit(1);
    return rows[0] ? mapTemplateRow(rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<TemplateRecord | null> {
    const rows = await this.db.select().from(templates).where(eq(templates.slug, slug)).limit(1);
    return rows[0] ? mapTemplateRow(rows[0]) : null;
  }

  /**
   * Atomically creates a template and its initial version snapshot (`v1`) in a
   * single D1/SQLite batch.
   */
  async createWithVersion(input: {
    template: NewTemplateRow;
    resolvedBody: TemplateBody;
    note?: string;
  }): Promise<void> {
    const version = input.template.currentVersion ?? 1;
    await this.rawDb.batch([
      this.rawDb
        .prepare(
          `INSERT INTO templates
            (id, slug, name, description, base_kind, base_source_url, base_body, overlay, current_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.template.id,
          input.template.slug,
          input.template.name,
          input.template.description ?? '',
          input.template.baseKind,
          input.template.baseSourceUrl ?? null,
          input.template.baseBody,
          input.template.overlay ?? '[]',
          version,
          input.template.createdAt,
          input.template.updatedAt,
        ),
      this.rawDb
        .prepare(
          `INSERT INTO template_versions (template_id, version, resolved_body, note, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          input.template.id,
          version,
          JSON.stringify(input.resolvedBody),
          input.note ?? '',
          input.template.createdAt,
        ),
    ]);
  }

  /**
   * Atomically updates a template, appends a new `template_versions` snapshot,
   * and prunes older versions beyond `maxVersions` (default 50, design §8.3).
   */
  async saveWithNewVersion(input: {
    id: string;
    slug: string;
    name: string;
    description: string;
    baseKind: TemplateBaseKind;
    baseSourceUrl: string | null;
    baseBody: string;
    overlay: string;
    version: number;
    resolvedBody: TemplateBody;
    note: string;
    updatedAt: string;
    maxVersions?: number;
  }): Promise<void> {
    const retention = Math.max(1, input.maxVersions ?? TEMPLATE_VERSION_RETENTION);
    await this.rawDb.batch([
      this.rawDb
        .prepare(
          `UPDATE templates
           SET slug = ?, name = ?, description = ?, base_kind = ?, base_source_url = ?, base_body = ?, overlay = ?, current_version = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          input.slug,
          input.name,
          input.description,
          input.baseKind,
          input.baseSourceUrl,
          input.baseBody,
          input.overlay,
          input.version,
          input.updatedAt,
          input.id,
        ),
      this.rawDb
        .prepare(
          `INSERT INTO template_versions (template_id, version, resolved_body, note, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(input.id, input.version, JSON.stringify(input.resolvedBody), input.note, input.updatedAt),
      this.rawDb
        .prepare(
          `DELETE FROM template_versions
           WHERE template_id = ?
             AND version NOT IN (
               SELECT version FROM template_versions
               WHERE template_id = ?
               ORDER BY version DESC
               LIMIT ?
             )`,
        )
        .bind(input.id, input.id, retention),
    ]);
  }

  async listVersions(templateId: string, limit = TEMPLATE_VERSION_RETENTION): Promise<TemplateVersionSummary[]> {
    return this.db
      .select({
        templateId: templateVersions.templateId,
        version: templateVersions.version,
        note: templateVersions.note,
        createdAt: templateVersions.createdAt,
      })
      .from(templateVersions)
      .where(eq(templateVersions.templateId, templateId))
      .orderBy(desc(templateVersions.version))
      .limit(limit);
  }

  async findVersion(templateId: string, version: number): Promise<TemplateVersionRecord | null> {
    const rows = await this.db
      .select()
      .from(templateVersions)
      .where(and(eq(templateVersions.templateId, templateId), eq(templateVersions.version, version)))
      .limit(1);
    return rows[0] ? mapTemplateVersionRow(rows[0]) : null;
  }

  async countVersions(templateId: string): Promise<number> {
    const rows = await this.db
      .select({ version: templateVersions.version })
      .from(templateVersions)
      .where(eq(templateVersions.templateId, templateId));
    return rows.length;
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(templates).where(eq(templates.id, id));
  }
}
