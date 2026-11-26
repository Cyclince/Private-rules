import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { SqliteDatabaseAdapter } from '../src/infrastructure/database/sqlite/adapter';
import { migrateSqliteDatabase } from '../src/infrastructure/database/sqlite/migrations';

const path = process.env.DATABASE_PATH?.trim();
if (!path) throw new Error('DATABASE_PATH 必须指向要迁移的 SQLite 文件。');
const databasePath = resolve(process.cwd(), path);
await mkdir(dirname(databasePath), { recursive: true });
const database = new SqliteDatabaseAdapter(databasePath);
try {
  const result = await migrateSqliteDatabase(database);
  const summary = result.applied.length ? `applied ${result.applied.join(', ')}` : 'already up to date';
  console.info(`[db:migrate:node] ${summary}${result.backupPath ? ` (backup: ${result.backupPath})` : ''}`);
} finally {
  database.close();
}
