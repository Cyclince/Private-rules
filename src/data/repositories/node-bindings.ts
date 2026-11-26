import { and, asc, eq } from 'drizzle-orm';
import type { DatabasePort } from '../../application/ports/database';
import type { AppDatabase } from '../db';
import { nodeBindings, nodeSnapshots } from '../schema';

export type NodeBindingRow = typeof nodeBindings.$inferSelect;
export type NewNodeBindingRow = typeof nodeBindings.$inferInsert;
export type NodeSnapshotRow = typeof nodeSnapshots.$inferSelect;

export class NodeBindingsRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly rawDb: DatabasePort,
  ) {}

  async listByPublication(publicationId: string): Promise<NodeBindingRow[]> {
    return this.db
      .select()
      .from(nodeBindings)
      .where(eq(nodeBindings.publicationId, publicationId))
      .orderBy(asc(nodeBindings.slotId));
  }

  async findBySlot(publicationId: string, slotId: string): Promise<NodeBindingRow | null> {
    const rows = await this.db
      .select()
      .from(nodeBindings)
      .where(and(eq(nodeBindings.publicationId, publicationId), eq(nodeBindings.slotId, slotId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Atomically upserts an encrypted slot binding, drops any stale snapshot for
   * that slot, and touches `publications.updated_at` so publication caches
   * rotate immediately.
   */
  async upsert(
    row: {
      publicationId: string;
      slotId: string;
      subscriptionUrlEnc: string;
      userAgent: string | null;
    },
    publicationUpdatedAt: string,
  ): Promise<void> {
    await this.rawDb.batch([
      this.rawDb
        .prepare(
          `INSERT INTO node_bindings
            (publication_id, slot_id, subscription_url_enc, user_agent, last_fetched_at, last_status, last_node_count)
           VALUES (?, ?, ?, ?, NULL, NULL, NULL)
           ON CONFLICT(publication_id, slot_id) DO UPDATE SET
             subscription_url_enc = excluded.subscription_url_enc,
             user_agent = excluded.user_agent,
             last_fetched_at = NULL,
             last_status = NULL,
             last_node_count = NULL`,
        )
        .bind(row.publicationId, row.slotId, row.subscriptionUrlEnc, row.userAgent),
      this.rawDb
        .prepare('DELETE FROM node_snapshots WHERE publication_id = ? AND slot_id = ?')
        .bind(row.publicationId, row.slotId),
      this.rawDb
        .prepare('UPDATE publications SET updated_at = ? WHERE id = ?')
        .bind(publicationUpdatedAt, row.publicationId),
    ]);
  }

  async deleteBySlot(publicationId: string, slotId: string, publicationUpdatedAt: string): Promise<void> {
    await this.rawDb.batch([
      this.rawDb
        .prepare('DELETE FROM node_bindings WHERE publication_id = ? AND slot_id = ?')
        .bind(publicationId, slotId),
      this.rawDb
        .prepare('DELETE FROM node_snapshots WHERE publication_id = ? AND slot_id = ?')
        .bind(publicationId, slotId),
      this.rawDb
        .prepare('UPDATE publications SET updated_at = ? WHERE id = ?')
        .bind(publicationUpdatedAt, publicationId),
    ]);
  }

  async recordFetchMetadata(
    publicationId: string,
    slotId: string,
    metadata: { lastFetchedAt: string; lastStatus: string; lastNodeCount: number | null },
  ): Promise<void> {
    await this.db
      .update(nodeBindings)
      .set({
        lastFetchedAt: metadata.lastFetchedAt,
        lastStatus: metadata.lastStatus,
        lastNodeCount: metadata.lastNodeCount,
      })
      .where(and(eq(nodeBindings.publicationId, publicationId), eq(nodeBindings.slotId, slotId)));
  }

  async upsertNodeSnapshot(input: {
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

  async findNodeSnapshot(publicationId: string, slotId: string): Promise<NodeSnapshotRow | null> {
    const rows = await this.db
      .select()
      .from(nodeSnapshots)
      .where(and(eq(nodeSnapshots.publicationId, publicationId), eq(nodeSnapshots.slotId, slotId)))
      .limit(1);
    return rows[0] ?? null;
  }
}
