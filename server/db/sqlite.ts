// SQLite local (better-sqlite3): um arquivo, modo WAL. O servidor web, o MCP via stdio e os hooks abrem o mesmo
// arquivo; o busy_timeout e as transações IMMEDIATE deixam os processos escreverem sem conflito.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { Driver, Statement } from './driver';

export class SqliteDriver implements Driver {
  readonly dialect = 'sqlite' as const;
  readonly raw: Database.Database;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new Database(file);
    this.raw.pragma('journal_mode = WAL');
    this.raw.pragma('busy_timeout = 5000');
    this.raw.pragma('foreign_keys = ON');
    this.raw.pragma('synchronous = NORMAL');
  }

  prepare(sql: string): Statement {
    return this.raw.prepare(sql) as unknown as Statement;
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    const run = this.raw.transaction(fn);
    return this.raw.inTransaction ? run() : run.immediate();
  }

  get inTransaction(): boolean {
    return this.raw.inTransaction;
  }

  /** Muda quando outro processo grava no arquivo (ex.: o MCP via stdio). */
  dataVersion(): number {
    return this.raw.pragma('data_version', { simple: true }) as number;
  }

  close(): void {
    this.raw.close();
  }
}
