import type { Update } from '../../shared/types';
import { badRequest, db, emitBoardChange, insertId, notFound, nowIso, tx, type Actor } from './common';
import { logActivity } from './activity';
import { requireItemRow } from './items';

interface UpdateRow {
  id: number;
  item_id: number;
  author_id: number | null;
  body: string;
  created_at: string;
  updated_at: string;
}

const toUpdate = (r: UpdateRow): Update => ({
  id: r.id,
  itemId: r.item_id,
  authorId: r.author_id,
  body: r.body,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const excerpt = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 137)}…` : flat;
};

export function listUpdates(itemId: number): Update[] {
  return (db().prepare('SELECT * FROM updates WHERE item_id = ? ORDER BY created_at DESC, id DESC').all(itemId) as UpdateRow[]).map(
    toUpdate,
  );
}

function requireUpdate(id: number): UpdateRow {
  const row = db().prepare('SELECT * FROM updates WHERE id = ?').get(id) as UpdateRow | undefined;
  if (!row) throw notFound('Atualização não encontrada.');
  return row;
}

function validBody(body: string): string {
  const text = body.trim();
  if (!text) throw badRequest('A atualização está vazia.');
  if (text.length > 20_000) throw badRequest('Atualização muito longa (máximo de 20.000 caracteres).');
  return text;
}

export function createUpdate(itemId: number, body: string, actor: Actor): Update {
  const text = validBody(body);
  const { id, boardId } = tx(() => {
    const item = requireItemRow(itemId);
    const id = insertId('INSERT INTO updates (item_id, author_id, body) VALUES (?, ?, ?)', itemId, actor.personId, text);
    db().prepare('UPDATE items SET updated_at = ? WHERE id = ?').run(nowIso(), itemId);
    logActivity({ boardId: item.board_id, itemId, itemName: item.name, action: 'update_posted', data: { text: excerpt(text) } }, actor);
    return { id, boardId: item.board_id };
  });
  emitBoardChange(actor, boardId);
  return toUpdate(requireUpdate(id));
}

export function editUpdate(id: number, body: string, actor: Actor): Update {
  const text = validBody(body);
  const row = requireUpdate(id);
  const item = requireItemRow(row.item_id, true);
  db().prepare('UPDATE updates SET body = ?, updated_at = ? WHERE id = ?').run(text, nowIso(), id);
  emitBoardChange(actor, item.board_id);
  return toUpdate(requireUpdate(id));
}

export function deleteUpdate(id: number, actor: Actor): void {
  const row = requireUpdate(id);
  const item = requireItemRow(row.item_id, true);
  db().prepare('DELETE FROM updates WHERE id = ?').run(id);
  emitBoardChange(actor, item.board_id);
}
