import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import { iconPackCache } from '../schema';

export type IconPackCacheRow = typeof iconPackCache.$inferSelect;

export class IconPacksRepository {
  constructor(private readonly db: AppDatabase) {}

  async findByUrl(url: string): Promise<IconPackCacheRow | null> {
    const rows = await this.db.select().from(iconPackCache).where(eq(iconPackCache.url, url)).limit(1);
    return rows[0] ?? null;
  }

  async upsertSuccess(url: string, payload: string, iconCount: number, updatedAt: string): Promise<void> {
    await this.db
      .insert(iconPackCache)
      .values({
        url,
        payload,
        iconCount,
        lastStatus: 'success',
        lastError: null,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: iconPackCache.url,
        set: {
          payload,
          iconCount,
          lastStatus: 'success',
          lastError: null,
          updatedAt,
        },
      });
  }

  async upsertError(url: string, error: string, updatedAt: string): Promise<void> {
    await this.db
      .insert(iconPackCache)
      .values({
        url,
        payload: null,
        iconCount: 0,
        lastStatus: 'error',
        lastError: error,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: iconPackCache.url,
        set: {
          lastStatus: 'error',
          lastError: error,
          updatedAt,
        },
      });
  }
}
