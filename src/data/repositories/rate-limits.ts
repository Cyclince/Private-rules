import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import { rateLimits } from '../schema';

export type RateLimitStatus = {
  allowed: boolean;
  remaining: number;
};

export class RateLimitsRepository {
  constructor(private readonly db: AppDatabase) {}

  async consume(
    identity: string,
    operation: string,
    limit: number,
    windowSeconds = 60,
    nowMs = Date.now(),
  ): Promise<RateLimitStatus> {
    const rows = await this.db
      .select()
      .from(rateLimits)
      .where(and(eq(rateLimits.identity, identity), eq(rateLimits.operation, operation)))
      .limit(1);
    const current = rows[0];
    const expired = !current || Date.parse(current.windowStartedAt) + windowSeconds * 1000 <= nowMs;
    const hits = expired ? 1 : current.hits + 1;
    const windowStartedAt = expired ? new Date(nowMs).toISOString() : current.windowStartedAt;

    await this.db
      .insert(rateLimits)
      .values({ identity, operation, windowStartedAt, hits })
      .onConflictDoUpdate({
        target: [rateLimits.identity, rateLimits.operation],
        set: { windowStartedAt, hits },
      });

    return { allowed: hits <= limit, remaining: Math.max(0, limit - hits) };
  }

  async peek(
    identity: string,
    operation: string,
    limit: number,
    windowSeconds = 60,
    nowMs = Date.now(),
  ): Promise<RateLimitStatus> {
    const rows = await this.db
      .select()
      .from(rateLimits)
      .where(and(eq(rateLimits.identity, identity), eq(rateLimits.operation, operation)))
      .limit(1);
    const current = rows[0];
    const expired = !current || Date.parse(current.windowStartedAt) + windowSeconds * 1000 <= nowMs;
    const hits = expired ? 0 : current.hits;
    return { allowed: hits < limit, remaining: Math.max(0, limit - hits) };
  }

  async reset(identity: string, operation: string): Promise<void> {
    await this.db.delete(rateLimits).where(and(eq(rateLimits.identity, identity), eq(rateLimits.operation, operation)));
  }
}
