import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import type { DatabasePort, DatabaseStatement } from '../application/ports/database';
import { schema } from './schema';

export type AppDatabase = SqliteRemoteDatabase<typeof schema>;

function bindParams(statement: DatabaseStatement, params: unknown[]): DatabaseStatement {
  return params.length > 0 ? statement.bind(...params) : statement;
}

/**
 * Creates a Drizzle ORM instance backed by any `DatabasePort` (Cloudflare D1 or
 * Node better-sqlite3) using `sqlite-proxy`, supporting both single queries and
 * atomic `db.batch([...])` without importing native drivers into shared code.
 */
export function createDrizzle(database: DatabasePort): AppDatabase {
  return drizzle(
    async (sql, params, method) => {
      const stmt = bindParams(database.prepare(sql), params);
      if (method === 'run') {
        await stmt.run();
        return { rows: [] };
      }
      if (stmt.raw) {
        const rows = await stmt.raw();
        return { rows: method === 'get' ? (rows[0] ?? []) : rows };
      }
      const result = await stmt.all<Record<string, unknown>>();
      const rows = (result.results ?? []).map((row) => Object.values(row));
      return { rows: method === 'get' ? (rows[0] ?? []) : rows };
    },
    async (batchQueries) => {
      const statements = batchQueries.map((item) => bindParams(database.prepare(item.sql), item.params));
      const results = await database.batch<Record<string, unknown>>(statements);
      return results.map((result, index) => {
        const method = batchQueries[index].method;
        if (method === 'run') return { rows: [] };
        const rows = (result.results ?? []).map((row) => Object.values(row));
        return { rows: method === 'get' ? (rows[0] ?? []) : rows };
      });
    },
    { schema },
  );
}
