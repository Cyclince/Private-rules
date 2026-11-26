import type { DatabasePort } from '../application/ports/database';
import {
  BASELINE_MIGRATION_NAME,
  LEGACY_BASELINE_COLUMNS,
  LEGACY_CATCHUP_ALTER_COLUMNS,
  LEGACY_CATCHUP_TABLES,
  LEGACY_CORE_TABLES,
  MIGRATIONS,
  type MigrationEntry,
} from './migrations/index';

export type MigrationResult = {
  upgradedFromLegacy: boolean;
  applied: string[];
  backupPath?: string;
};

export type MigrateDatabaseOptions = {
  /**
   * Invoked once after a 1.0.x database passes baseline schema validation and
   * before any tracking tables or 1.1.0 schema changes are written (used by
   * Node/SQLite to create a `.bak-1.0.x` snapshot).
   */
  onBeforeLegacyUpgrade?: () => Promise<string | undefined> | string | undefined;
  /** Lock TTL in milliseconds for cross-isolate D1 coordination. */
  lockTtlMs?: number;
  /** Maximum time to wait when another isolate holds the migration lock. */
  lockWaitMs?: number;
};

const LOCK_ID = 'schema-migration';
const DEFAULT_LOCK_TTL_MS = 60_000;
const DEFAULT_LOCK_WAIT_MS = 15_000;

const migratedDatabases = new WeakMap<object, Promise<MigrationResult>>();

function splitSqlStatements(sql: string): string[] {
  const withoutLineComments = sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutLineComments
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function listTableNames(database: DatabasePort): Promise<Set<string>> {
  const rows = await database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
  return new Set((rows.results ?? []).map((row) => row.name));
}

async function listTableColumns(database: DatabasePort, tableName: string): Promise<Set<string>> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
  const rows = await database.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>();
  return new Set((rows.results ?? []).map((row) => row.name));
}

async function ensureTrackingTables(database: DatabasePort): Promise<void> {
  await database.batch([
    database.prepare(`CREATE TABLE IF NOT EXISTS _schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS _schema_migration_lock (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`),
  ]);
}

async function readKnownAppliedReadOnly(database: DatabasePort, tables: Set<string>): Promise<Set<string>> {
  const applied = new Set<string>();
  const knownNames = new Set(MIGRATIONS.map((entry) => entry.name));
  if (tables.has('_schema_migrations')) {
    const tracked = await database.prepare('SELECT name FROM _schema_migrations').all<{ name: string }>();
    for (const row of tracked.results ?? []) applied.add(row.name);
  }
  if (tables.has('d1_migrations')) {
    const d1Rows = await database.prepare('SELECT name FROM d1_migrations').all<{ name: string }>();
    for (const row of d1Rows.results ?? []) {
      if (knownNames.has(row.name)) applied.add(row.name);
    }
  }
  return applied;
}

async function syncAppliedFromD1Migrations(database: DatabasePort, tables: Set<string>): Promise<Set<string>> {
  const applied = new Set<string>();
  const tracked = await database.prepare('SELECT name FROM _schema_migrations').all<{ name: string }>();
  for (const row of tracked.results ?? []) applied.add(row.name);

  if (tables.has('d1_migrations')) {
    const d1Rows = await database.prepare('SELECT name FROM d1_migrations').all<{ name: string }>();
    const knownNames = new Set(MIGRATIONS.map((entry) => entry.name));
    const newlyDiscovered: string[] = [];
    for (const row of d1Rows.results ?? []) {
      if (knownNames.has(row.name) && !applied.has(row.name)) {
        applied.add(row.name);
        newlyDiscovered.push(row.name);
      }
    }
    if (newlyDiscovered.length > 0) {
      const now = new Date().toISOString();
      await database.batch(
        newlyDiscovered.map((name) =>
          database.prepare('INSERT OR IGNORE INTO _schema_migrations (name, applied_at) VALUES (?, ?)').bind(name, now),
        ),
      );
    }
  }
  return applied;
}

const CATCHUP_ALTER_SET = new Set(LEGACY_CATCHUP_ALTER_COLUMNS.map((entry) => `${entry.table}.${entry.column}`));

/**
 * Read-only check executed before writing `.bak-1.0.x` or any DDL: rejects
 * missing tables/columns that are outside the 1.0.x catch-up scope (e.g.
 * missing 1.0.0 core tables or corrupted base columns on existing tables).
 */
async function validateLegacyPreCatchUp(database: DatabasePort, existingTables: Set<string>): Promise<void> {
  const problems: string[] = [];
  for (const coreTable of LEGACY_CORE_TABLES) {
    if (!existingTables.has(coreTable)) {
      problems.push(`missing table ${coreTable}`);
    }
  }
  for (const [tableName, expectedColumns] of Object.entries(LEGACY_BASELINE_COLUMNS)) {
    if (!existingTables.has(tableName)) {
      if (!(tableName in LEGACY_CATCHUP_TABLES) && !LEGACY_CORE_TABLES.includes(tableName)) {
        problems.push(`missing table ${tableName}`);
      }
      continue;
    }
    const actualColumns = await listTableColumns(database, tableName);
    for (const column of expectedColumns) {
      if (!actualColumns.has(column) && !CATCHUP_ALTER_SET.has(`${tableName}.${column}`)) {
        problems.push(`missing column ${tableName}.${column}`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`1.0.x database baseline validation failed: ${problems.slice(0, 10).join(', ')}`);
  }
}

/**
 * Brings an older 1.0.x database (such as pre-1.0.4 before Telegram tables or
 * databases missing 1.0.7 runtime ALTER columns) up to the 1.0.7 baseline.
 * Strictly limited to the tables and ALTER ADD COLUMN definitions that 1.0.7
 * `ensureDatabase` itself created; must run AFTER `.bak-1.0.x` backup.
 */
async function catchUpLegacySchema(database: DatabasePort): Promise<void> {
  for (const createSql of Object.values(LEGACY_CATCHUP_TABLES)) {
    await database.prepare(createSql).run();
  }

  const columnsByTable = new Map<string, Set<string>>();
  for (const alter of LEGACY_CATCHUP_ALTER_COLUMNS) {
    let columns = columnsByTable.get(alter.table);
    if (!columns) {
      columns = await listTableColumns(database, alter.table);
      columnsByTable.set(alter.table, columns);
    }
    if (columns.has(alter.column)) continue;
    try {
      await database.prepare(alter.sql).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!/duplicate column name/i.test(message)) throw error;
    }
    columns.add(alter.column);
  }
}

/**
 * Validates that an existing 1.0.x database contains every expected table and
 * column, tolerating column-order differences produced by 1.0.x runtime ALTERs.
 */
async function validateLegacyBaseline(database: DatabasePort, existingTables: Set<string>): Promise<void> {
  const problems: string[] = [];
  for (const [tableName, expectedColumns] of Object.entries(LEGACY_BASELINE_COLUMNS)) {
    if (!existingTables.has(tableName)) {
      problems.push(`missing table ${tableName}`);
      continue;
    }
    const actualColumns = await listTableColumns(database, tableName);
    for (const column of expectedColumns) {
      if (!actualColumns.has(column)) {
        problems.push(`missing column ${tableName}.${column}`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`1.0.x database baseline validation failed: ${problems.slice(0, 10).join(', ')}`);
  }
}

async function shouldSkipReentrantStatement(database: DatabasePort, statement: string): Promise<boolean> {
  const alterAddColumn = statement.match(/^ALTER\s+TABLE\s+([a-z_][a-z0-9_]*)\s+ADD\s+COLUMN\s+([a-z_][a-z0-9_]*)\b/i);
  if (alterAddColumn) {
    const [, tableName, columnName] = alterAddColumn;
    const columns = await listTableColumns(database, tableName);
    return columns.has(columnName);
  }

  if (/\bFROM\s+telegram_rate_limits\b/i.test(statement)) {
    const tables = await listTableNames(database);
    return !tables.has('telegram_rate_limits');
  }

  return false;
}

async function executeMigration(
  database: DatabasePort,
  migration: MigrationEntry,
  hasD1MigrationsTable: boolean,
): Promise<void> {
  for (const statement of splitSqlStatements(migration.sql)) {
    if (await shouldSkipReentrantStatement(database, statement)) continue;
    try {
      await database.prepare(statement).run();
    } catch (error) {
      // Handle race where a concurrent isolate added the column between the
      // PRAGMA check and ALTER execution, or dropped telegram_rate_limits.
      const message = error instanceof Error ? error.message : '';
      if (/duplicate column name/i.test(message) || /no such table:\s*telegram_rate_limits/i.test(message)) {
        continue;
      }
      throw error;
    }
  }
  const appliedAt = new Date().toISOString();
  const recordStatements = [
    database
      .prepare('INSERT OR IGNORE INTO _schema_migrations (name, applied_at) VALUES (?, ?)')
      .bind(migration.name, appliedAt),
  ];
  if (hasD1MigrationsTable) {
    recordStatements.push(
      database.prepare('INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)').bind(migration.name),
    );
  }
  await database.batch(recordStatements);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireMigrationLock(
  database: DatabasePort,
  ownerId: string,
  lockTtlMs: number,
  lockWaitMs: number,
): Promise<void> {
  const deadline = Date.now() + lockWaitMs;
  let delayMs = 25;
  while (true) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + lockTtlMs).toISOString();
    await database
      .prepare('DELETE FROM _schema_migration_lock WHERE id = ? AND expires_at <= ?')
      .bind(LOCK_ID, now.toISOString())
      .run();
    const claimed = await database
      .prepare(
        'INSERT OR IGNORE INTO _schema_migration_lock (id, owner_id, acquired_at, expires_at) VALUES (?, ?, ?, ?)',
      )
      .bind(LOCK_ID, ownerId, now.toISOString(), expiresAt)
      .run();
    if ((claimed.changes ?? 0) > 0) return;

    const tables = await listTableNames(database);
    const applied = await syncAppliedFromD1Migrations(database, tables);
    if (MIGRATIONS.every((entry) => applied.has(entry.name))) return;

    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for schema migration lock.');
    }
    await sleep(delayMs);
    delayMs = Math.min(delayMs * 2, 250);
  }
}

async function releaseMigrationLock(database: DatabasePort, ownerId: string): Promise<void> {
  await database
    .prepare('DELETE FROM _schema_migration_lock WHERE id = ? AND owner_id = ?')
    .bind(LOCK_ID, ownerId)
    .run()
    .catch(() => undefined);
}

/**
 * Runs idempotent, concurrency-safe 1.1.0 schema migrations on either D1 or
 * SQLite. Detects existing 1.0.x databases (with or without `d1_migrations`),
 * validates their baseline schema (tolerant of column order), runs the optional
 * pre-upgrade backup hook before writing any DDL, marks the baseline, and
 * applies pending deltas.
 */
export async function migrateDatabase(
  database: DatabasePort,
  options: MigrateDatabaseOptions = {},
): Promise<MigrationResult> {
  const preTables = await listTableNames(database);
  const preApplied = await readKnownAppliedReadOnly(database, preTables);

  if (MIGRATIONS.every((entry) => preApplied.has(entry.name))) {
    if (!preTables.has('_schema_migrations')) {
      await ensureTrackingTables(database);
      await syncAppliedFromD1Migrations(database, preTables);
    }
    return { upgradedFromLegacy: false, applied: [] };
  }

  // Check non-catchup 1.0.x invariants and back up BEFORE creating tracking
  // tables or running catch-up DDL so corrupted DBs are untouched and
  // `.bak-1.0.x` always preserves the original pre-upgrade state.
  const preDetectedLegacy = !preApplied.has(BASELINE_MIGRATION_NAME) && preTables.has('categories');
  let backupPath: string | undefined;
  if (preDetectedLegacy) {
    await validateLegacyPreCatchUp(database, preTables);
    if (options.onBeforeLegacyUpgrade) {
      backupPath = await options.onBeforeLegacyUpgrade();
    }
  }

  await ensureTrackingTables(database);

  const ownerId = crypto.randomUUID();
  const lockTtlMs = options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  const lockWaitMs = options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS;
  await acquireMigrationLock(database, ownerId, lockTtlMs, lockWaitMs);

  try {
    const tables = await listTableNames(database);
    const applied = await syncAppliedFromD1Migrations(database, tables);
    const pending = MIGRATIONS.filter((entry) => !applied.has(entry.name));
    if (pending.length === 0) {
      return { upgradedFromLegacy: false, applied: [] };
    }

    const isLegacyDatabase = !applied.has(BASELINE_MIGRATION_NAME) && tables.has('categories');
    if (isLegacyDatabase) {
      if (!preDetectedLegacy) {
        await validateLegacyPreCatchUp(database, tables);
      }
      await catchUpLegacySchema(database);
      const caughtUpTables = await listTableNames(database);
      await validateLegacyBaseline(database, caughtUpTables);
    }

    const hasD1MigrationsTable = tables.has('d1_migrations');
    const appliedNow: string[] = [];
    for (const migration of pending) {
      await executeMigration(database, migration, hasD1MigrationsTable);
      appliedNow.push(migration.name);
    }

    return {
      upgradedFromLegacy: isLegacyDatabase,
      applied: appliedNow,
      ...(backupPath ? { backupPath } : {}),
    };
  } finally {
    await releaseMigrationLock(database, ownerId);
  }
}

/**
 * Deduplicates migration execution per database instance within a single
 * Worker isolate or Node process. Failed attempts are evicted so subsequent
 * requests can retry cleanly.
 */
export function ensureDatabaseMigrated(
  database: DatabasePort,
  options: MigrateDatabaseOptions = {},
): Promise<MigrationResult> {
  let pending = migratedDatabases.get(database as object);
  if (!pending) {
    pending = migrateDatabase(database, options).catch((error) => {
      migratedDatabases.delete(database as object);
      throw error;
    });
    migratedDatabases.set(database as object, pending);
  }
  return pending;
}
