import type { DatabasePort, DatabaseResult, DatabaseStatement } from '../../../application/ports/database';

class D1StatementAdapter implements DatabaseStatement {
  constructor(private readonly statement: D1PreparedStatement) {}
  bind(...values: unknown[]) { return new D1StatementAdapter(this.statement.bind(...values)); }
  async all<T>() { return this.statement.all<T>() as Promise<DatabaseResult<T>>; }
  async first<T>() { return this.statement.first<T>(); }
  async run<T>() {
    const result = await this.statement.run<T>();
    return { ...result, changes: result.meta?.changes ?? 0 } as DatabaseResult<T>;
  }
  unwrap() { return this.statement; }
}

export class D1DatabaseAdapter implements DatabasePort {
  constructor(private readonly database: D1Database) {}
  prepare(sql: string) { return new D1StatementAdapter(this.database.prepare(sql)); }
  async batch<T>(statements: DatabaseStatement[]) {
    const results = await this.database.batch(statements.map((statement) => (statement as D1StatementAdapter).unwrap()));
    return results.map((result) => ({ ...result, changes: result.meta?.changes ?? 0 })) as DatabaseResult<T>[];
  }
  async ping() {
    const result = await this.database.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    return result?.ok === 1;
  }
}
