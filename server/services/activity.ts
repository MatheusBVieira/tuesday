import type { ActivityAction, ActivityData, ActivityEntry, ActivitySource } from '../../shared/types';
import { db, inIds, parseJson, type Actor } from './common';

interface ActivityRow {
  id: number;
  board_id: number;
  item_id: number | null;
  item_name: string | null;
  actor_id: number | null;
  source: string;
  action: string;
  data: string;
  created_at: string;
}

const toEntry = (r: ActivityRow): ActivityEntry => ({
  id: r.id,
  boardId: r.board_id,
  itemId: r.item_id,
  itemName: r.item_name,
  actorId: r.actor_id,
  source: r.source as ActivitySource,
  action: r.action as ActivityAction,
  data: parseJson<ActivityData>(r.data, {}),
  createdAt: r.created_at,
});

export function logActivity(
  entry: { boardId: number; itemId?: number | null; itemName?: string | null; action: ActivityAction; data?: ActivityData },
  actor: Actor,
): void {
  db()
    .prepare('INSERT INTO activity (board_id, item_id, item_name, actor_id, source, action, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(
      entry.boardId,
      entry.itemId ?? null,
      entry.itemName ?? null,
      actor.personId,
      actor.source,
      entry.action,
      JSON.stringify(entry.data ?? {}),
    );
}

export function listActivity(filter: {
  boardId?: number;
  boardIds?: number[];
  itemId?: number;
  limit?: number;
  beforeId?: number;
}): ActivityEntry[] {
  const where: string[] = [];
  const params: (number | string)[] = [];
  if (filter.boardId != null) {
    where.push('board_id = ?');
    params.push(filter.boardId);
  }
  if (filter.boardIds) {
    where.push(inIds('board_id'));
    params.push(JSON.stringify(filter.boardIds));
  }
  if (filter.itemId != null) {
    where.push('item_id = ?');
    params.push(filter.itemId);
  }
  if (filter.beforeId != null) {
    where.push('id < ?');
    params.push(filter.beforeId);
  }
  const limit = Math.min(Math.max(Math.round(filter.limit ?? 50), 1), 500);
  const sql = `SELECT * FROM activity ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${limit}`;
  return (
    db()
      .prepare(sql)
      .all(...params) as ActivityRow[]
  ).map(toEntry);
}
