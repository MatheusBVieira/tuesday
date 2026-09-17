// O que os serviços usam do banco — o mesmo para SQLite (instalação local) e PostgreSQL (servidor).
//
// A API é síncrona de propósito: é a do better-sqlite3, e todo o código do tuesday foi escrito sobre ela.
// O driver do PostgreSQL mantém essa API rodando as consultas num worker (veja postgres.ts).
//
// SQL portável: escreva para os dois bancos. Parâmetros com "?", "INSERT ... RETURNING id" em vez de
// lastInsertRowid, "ON CONFLICT ... DO NOTHING/UPDATE" em vez de "INSERT OR ...", e inIds() para listas de ids.

export type Dialect = 'sqlite' | 'postgres';

export interface RunResult {
  changes: number;
}

export interface Statement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): RunResult;
}

export interface Driver {
  readonly dialect: Dialect;
  prepare(sql: string): Statement;
  /** SQL sem parâmetros; aceita vários comandos */
  exec(sql: string): void;
  /** Executa `fn` numa transação de escrita. Chamadas aninhadas viram savepoints. `fn` precisa ser síncrona. */
  transaction<T>(fn: () => T): T;
  readonly inTransaction: boolean;
  close(): void;
}

/** "coluna IN (lista de ids)" com um único parâmetro: JSON.stringify(ids). */
export function inIds(dialect: Dialect, column: string): string {
  return dialect === 'postgres'
    ? `${column} IN (SELECT value::bigint FROM jsonb_array_elements_text(CAST(? AS jsonb)) AS value)`
    : `${column} IN (SELECT value FROM json_each(?))`;
}
