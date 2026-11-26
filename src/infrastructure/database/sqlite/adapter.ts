import Database from 'better-sqlite3';
import type { DatabasePort, DatabaseResult, DatabaseStatement } from '../../../application/ports/database';

class SqliteStatementAdapter implements DatabaseStatement {
  constructor(private readonly database: Database.Database, private readonly sql: string, private readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new SqliteStatementAdapter(this.database, this.sql, values); }
  async all<T>() { return { success: true, results: this.database.prepare(this.sql).all(...this.values) as T[] }; }
  async first<T>() { return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
  async run<T>() {
    const info = this.database.prepare(this.sql).run(...this.values);
    return { success: true, changes: info.changes } as DatabaseResult<T>;
  }
  execute() { return this.database.prepare(this.sql).run(...this.values); }
}

export class SqliteDatabaseAdapter implements DatabasePort {
  readonly native: Database.Database;
  readonly filePath: string;
  constructor(path: string) {
    this.filePath = path;
    this.native = new Database(path);
    this.native.pragma('foreign_keys = ON');
    this.native.pragma('journal_mode = WAL');
  }
  prepare(sql: string) { return new SqliteStatementAdapter(this.native, sql); }
  async batch<T>(statements: DatabaseStatement[]) {
    return this.native.transaction(() => statements.map((statement) => {
      const info = (statement as SqliteStatementAdapter).execute();
      return { success: true, changes: info.changes } as DatabaseResult<T>;
    }))();
  }
  async ping() { return (this.native.prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1; }
  async backup(destinationPath: string) {
    await this.native.backup(destinationPath);
  }
  close() { this.native.close(); }
}
