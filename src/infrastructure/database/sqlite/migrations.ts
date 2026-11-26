import { access } from 'node:fs/promises';
import { migrateDatabase, type MigrationResult } from '../../../data/migrate';
import type { SqliteDatabaseAdapter } from './adapter';

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Migrates a Node/SQLite database to the current 1.1.0 schema. When upgrading
 * a 1.0.x database on disk, writes a consistent WAL-safe `.bak-1.0.x` backup
 * before applying any DDL (design §17.2).
 */
export async function migrateSqliteDatabase(database: SqliteDatabaseAdapter): Promise<MigrationResult> {
  return migrateDatabase(database, {
    onBeforeLegacyUpgrade: async () => {
      if (database.native.memory || !database.filePath || database.filePath === ':memory:') {
        return undefined;
      }
      const backupPath = `${database.filePath}.bak-1.0.x`;
      if (!(await fileExists(backupPath))) {
        await database.backup(backupPath);
      }
      return backupPath;
    },
  });
}
