import { and, eq, gt, lte } from 'drizzle-orm';
import type { DatabasePort } from '../../application/ports/database';
import type { AppDatabase } from '../db';
import { sessions } from '../schema';

export type SessionRow = typeof sessions.$inferSelect;

export class SessionsRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly rawDb: DatabasePort,
  ) {}

  async create(row: SessionRow): Promise<void> {
    await this.db.insert(sessions).values(row);
  }

  async findValid(id: string, nowIso: string): Promise<SessionRow | null> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, nowIso)))
      .limit(1);
    return rows[0] ?? null;
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }

  /** Removes all sessions whose `expires_at <= nowIso` and returns the deleted count. */
  async cleanupExpired(nowIso = new Date().toISOString()): Promise<number> {
    const result = await this.rawDb.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(nowIso).run();
    return result.changes ?? 0;
  }

  async countExpired(nowIso = new Date().toISOString()): Promise<number> {
    const rows = await this.db.select({ id: sessions.id }).from(sessions).where(lte(sessions.expiresAt, nowIso));
    return rows.length;
  }
}
