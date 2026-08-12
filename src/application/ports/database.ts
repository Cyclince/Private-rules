export type DatabaseResult<T = unknown> = { results?: T[]; success?: boolean; changes?: number };

export interface DatabaseStatement {
  bind(...values: unknown[]): DatabaseStatement;
  all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = unknown>(): Promise<DatabaseResult<T>>;
}

export interface DatabasePort {
  prepare(sql: string): DatabaseStatement;
  batch<T = unknown>(statements: DatabaseStatement[]): Promise<DatabaseResult<T>[]>;
  ping(): Promise<boolean>;
  transaction?<T>(task: () => Promise<T>): Promise<T>;
  close?(): Promise<void> | void;
}
