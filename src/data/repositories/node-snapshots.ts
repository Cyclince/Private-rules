import { and, asc, eq, lt } from 'drizzle-orm';
import type { DatabasePort } from '../../application/ports/database';
import type { AppDatabase } from '../db';
import { nodeSnapshots } from '../schema';

export type NodeSnapshotRow = typeof nodeSnapshots.$inferSelect;
export type NewNodeSnapshotRow = typeof nodeSnapshots.$inferInsert;

export class NodeSnapshotsRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly rawDb: DatabasePort,
  ) {}

  async findBySlot(publicationId: string, slotId: string): Promise<NodeSnapshotRow | null> {
    const rows = await this.db
      .select()
      .from(nodeSnapshots)
      .where(and(eq(nodeSnapshots.publicationId, publicationId), eq(nodeSnapshots.slotId, slotId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByPublication(publicationId: string): Promise<NodeSnapshotRow[]> {
    return this.db
      .select()
      .from(nodeSnapshots)
      .where(eq(nodeSnapshots.publicationId, publicationId))
      .orderBy(asc(nodeSnapshots.slotId));
  }

  async upsert(input: {
    publicationId: string;
    slotId: string;
    nodesEnc: string;
    fetchedAt: string;
    expiresAt: string;
  }): Promise<void> {
    await this.rawDb
      .prepare(
        `INSERT INTO node_snapshots (publication_id, slot_id, nodes_enc, fetched_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(publication_id, slot_id) DO UPDATE SET
           nodes_enc = excluded.nodes_enc,
           fetched_at = excluded.fetched_at,
           expires_at = excluded.expires_at`,
      )
      .bind(input.publicationId, input.slotId, input.nodesEnc, input.fetchedAt, input.expiresAt)
      .run();
  }

  async deleteBySlot(publicationId: string, slotId: string): Promise<void> {
    await this.db
      .delete(nodeSnapshots)
      .where(and(eq(nodeSnapshots.publicationId, publicationId), eq(nodeSnapshots.slotId, slotId)));
  }

  async deleteByPublication(publicationId: string): Promise<void> {
    await this.db.delete(nodeSnapshots).where(eq(nodeSnapshots.publicationId, publicationId));
  }

  async deleteExpiredBefore(isoTimestamp: string): Promise<void> {
    await this.db.delete(nodeSnapshots).where(lt(nodeSnapshots.expiresAt, isoTimestamp));
  }
}
