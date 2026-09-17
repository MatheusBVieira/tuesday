import { getDb, tx } from '../db/connection';
import { inIds as sqlInIds } from '../db/driver';
import { notifyChange } from '../events';
import type { ActivitySource } from '../../shared/types';

export { tx };

export const db = () => getDb();

/** INSERT portável: devolve o id da linha criada (RETURNING funciona no SQLite e no PostgreSQL). */
export function insertId(sql: string, ...params: unknown[]): number {
  return (
    db()
      .prepare(`${sql} RETURNING id`)
      .get(...params) as { id: number }
  ).id;
}

/** "coluna IN (ids)" com um parâmetro só — passe JSON.stringify(ids). */
export const inIds = (column: string) => sqlInIds(db().dialect, column);

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (message: string) => new HttpError(404, message);

/** Quem está fazendo a alteração — vai para o registro de atividades e para o autor das atualizações. */
export interface Actor {
  source: ActivitySource;
  personId: number | null;
  /** id da aba do navegador que originou a mudança (para ela ignorar o próprio eco no SSE) */
  clientId?: string | null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function emitBoardChange(actor: Actor, boardId: number): void {
  notifyChange({ scope: 'board', boardId, clientId: actor.clientId ?? null });
}

export function emitGlobalChange(actor: Actor): void {
  notifyChange({ scope: 'global', boardId: null, clientId: actor.clientId ?? null });
}
