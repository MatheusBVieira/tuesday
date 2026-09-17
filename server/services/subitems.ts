// Subitens (checklist) dos itens: o Claude quebra a tarefa em passos e vai marcando.
import type { Subitem } from '../../shared/types';
import { MAX_SUBITEMS, MAX_SUBITEM_NAME } from '../../shared/subitems';
import { fold, positionBetween } from '../../shared/values';
import { badRequest, db, emitBoardChange, inIds, notFound, nowIso, tx, type Actor } from './common';
import { logActivity } from './activity';
import { touchBoard } from './boards';
import { requireItemRow } from './items';

interface SubitemRow {
  id: number;
  item_id: number;
  name: string;
  done: number;
  position: number;
  done_at: string | null;
  done_by: number | null;
  created_at: string;
  updated_at: string;
}

const toSubitem = (r: SubitemRow): Subitem => ({
  id: r.id,
  itemId: r.item_id,
  name: r.name,
  done: r.done === 1,
  position: r.position,
  doneAt: r.done_at,
  doneBy: r.done_by,
  createdAt: r.created_at,
});

function groupByItem(rows: SubitemRow[]): Map<number, Subitem[]> {
  const map = new Map<number, Subitem[]>();
  for (const row of rows) {
    let list = map.get(row.item_id);
    if (!list) map.set(row.item_id, (list = []));
    list.push(toSubitem(row));
  }
  return map;
}

/** Subitens dos itens (não excluídos) de um quadro, por item. */
export function boardSubitems(boardId: number): Map<number, Subitem[]> {
  return groupByItem(
    db()
      .prepare(
        `SELECT s.* FROM subitems s JOIN items i ON i.id = s.item_id
         WHERE i.board_id = ? AND i.deleted_at IS NULL ORDER BY s.position, s.id`,
      )
      .all(boardId) as SubitemRow[],
  );
}

/** Subitens de alguns itens, por item. */
export function subitemsOf(itemIds: number[]): Map<number, Subitem[]> {
  if (!itemIds.length) return new Map();
  return groupByItem(
    db()
      .prepare(`SELECT * FROM subitems WHERE ${inIds('item_id')} ORDER BY position, id`)
      .all(JSON.stringify(itemIds)) as SubitemRow[],
  );
}

export const listSubitems = (itemId: number): Subitem[] => subitemsOf([itemId]).get(itemId) ?? [];

function requireSubitem(id: number): SubitemRow {
  const row = db().prepare('SELECT * FROM subitems WHERE id = ?').get(id) as SubitemRow | undefined;
  if (!row) throw notFound('Subitem não encontrado.');
  return row;
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_SUBITEM_NAME);
}

const excerpt = (names: string[]) => {
  const text = names.join(' · ');
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
};

function touchItem(itemId: number, boardId: number): void {
  db().prepare('UPDATE items SET updated_at = ? WHERE id = ?').run(nowIso(), itemId);
  touchBoard(boardId);
}

export interface NewSubitem {
  name: string;
  done?: boolean;
}

/** Adiciona passos a um item (no fim, no começo ou numa posição exata — usada para desfazer uma exclusão). */
export function addSubitems(
  itemId: number,
  specs: NewSubitem[],
  opts: { position?: 'top' | 'bottom' | number } = {},
  actor: Actor,
): Subitem[] {
  const steps = specs.map((s) => ({ name: cleanName(s.name), done: !!s.done })).filter((s) => s.name);
  if (!steps.length) throw badRequest('Dê um nome ao subitem.');
  const { ids, boardId } = tx(() => {
    const item = requireItemRow(itemId);
    const existing = db()
      .prepare('SELECT COUNT(*) AS n, MIN(position) AS lo, MAX(position) AS hi FROM subitems WHERE item_id = ?')
      .get(itemId) as { n: number; lo: number | null; hi: number | null };
    if (existing.n + steps.length > MAX_SUBITEMS)
      throw badRequest(`Um item pode ter no máximo ${MAX_SUBITEMS} subitens (este já tem ${existing.n}).`);

    const where = opts.position ?? 'bottom';
    let prev: number | null;
    let next: number | null;
    if (where === 'top') [prev, next] = [null, existing.lo];
    else if (where === 'bottom') [prev, next] = [existing.hi, null];
    else {
      prev = null;
      next = (
        db().prepare('SELECT MIN(position) AS p FROM subitems WHERE item_id = ? AND position > ?').get(itemId, where) as {
          p: number | null;
        }
      ).p;
    }

    const insert = db().prepare(
      'INSERT INTO subitems (item_id, name, done, position, done_at, done_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    );
    const now = nowIso();
    const created: number[] = [];
    steps.forEach((step, index) => {
      const position = typeof where === 'number' && index === 0 ? where : positionBetween(prev, next);
      prev = position;
      const row = insert.get(itemId, step.name, step.done ? 1 : 0, position, step.done ? now : null, step.done ? actor.personId : null);
      created.push((row as { id: number }).id);
    });
    logActivity(
      {
        boardId: item.board_id,
        itemId,
        itemName: item.name,
        action: 'subitems_added',
        data: { text: excerpt(steps.map((s) => s.name)), count: steps.length },
      },
      actor,
    );
    touchItem(itemId, item.board_id);
    return { ids: created, boardId: item.board_id };
  });
  emitBoardChange(actor, boardId);
  const byId = new Map(listSubitems(itemId).map((s) => [s.id, s]));
  return ids.map((id) => byId.get(id)!).filter(Boolean);
}

export function updateSubitem(id: number, patch: { name?: string; done?: boolean; position?: number }, actor: Actor): Subitem {
  const boardId = tx(() => {
    const row = requireSubitem(id);
    const item = requireItemRow(row.item_id);
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    let changed = false;

    if (patch.name !== undefined) {
      const name = cleanName(patch.name);
      if (!name) throw badRequest('O subitem não pode ficar sem nome.');
      if (name !== row.name) {
        sets.push('name = ?');
        params.push(name);
        changed = true;
        logActivity(
          {
            boardId: item.board_id,
            itemId: item.id,
            itemName: item.name,
            action: 'subitem_renamed',
            data: { from: { text: row.name }, to: { text: name } },
          },
          actor,
        );
      }
    }
    if (patch.done !== undefined && patch.done !== (row.done === 1)) {
      sets.push('done = ?', 'done_at = ?', 'done_by = ?');
      params.push(patch.done ? 1 : 0, patch.done ? nowIso() : null, patch.done ? actor.personId : null);
      changed = true;
      logActivity(
        {
          boardId: item.board_id,
          itemId: item.id,
          itemName: item.name,
          action: patch.done ? 'subitem_checked' : 'subitem_unchecked',
          data: { text: cleanName(patch.name ?? row.name) },
        },
        actor,
      );
    }
    if (patch.position !== undefined && patch.position !== row.position) {
      if (!Number.isFinite(patch.position)) throw badRequest('Posição inválida.');
      sets.push('position = ?');
      params.push(patch.position);
    }
    if (!sets.length) return null;
    sets.push('updated_at = ?');
    params.push(nowIso());
    db()
      .prepare(`UPDATE subitems SET ${sets.join(', ')} WHERE id = ?`)
      .run(...params, id);
    if (changed) touchItem(item.id, item.board_id);
    else touchBoard(item.board_id);
    return item.board_id;
  });
  if (boardId != null) emitBoardChange(actor, boardId);
  return toSubitem(requireSubitem(id));
}

/** Remove um subitem e devolve como ele era (para desfazer). */
export function deleteSubitem(id: number, actor: Actor): Subitem {
  const { subitem, boardId } = tx(() => {
    const row = requireSubitem(id);
    const item = requireItemRow(row.item_id);
    db().prepare('DELETE FROM subitems WHERE id = ?').run(id);
    logActivity(
      { boardId: item.board_id, itemId: item.id, itemName: item.name, action: 'subitem_deleted', data: { text: row.name } },
      actor,
    );
    touchItem(item.id, item.board_id);
    return { subitem: toSubitem(row), boardId: item.board_id };
  });
  emitBoardChange(actor, boardId);
  return subitem;
}

/** Copia os passos de um item para outro (desmarcados) — usado ao duplicar itens. */
export function copySubitems(fromItemId: number, toItemId: number): void {
  db()
    .prepare(
      'INSERT INTO subitems (item_id, name, position) SELECT CAST(? AS INTEGER), name, position FROM subitems WHERE item_id = ? ORDER BY position, id',
    )
    .run(toItemId, fromItemId);
}

/**
 * Encontra um subitem do item pelo id (número), pela posição na lista ("#2") ou pelo texto
 * (igual, começo ou trecho — desde que só um combine).
 */
export function resolveSubitem(subitems: Subitem[], ref: number | string): Subitem {
  const list = subitems.map((s, i) => `${i + 1}) ${s.name}${s.done ? ' ✔' : ''}`).join('; ');
  const missing = (what: string) =>
    notFound(`Subitem ${what} não encontrado.${subitems.length ? ` Subitens: ${list}.` : ' O item não tem subitens.'}`);
  if (typeof ref === 'number') {
    const byId = subitems.find((s) => s.id === ref);
    if (byId) return byId;
    throw missing(`com id ${ref}`);
  }
  const raw = ref.trim();
  const position = /^#(\d+)$/.exec(raw);
  if (position) {
    const byPosition = subitems[Number(position[1]) - 1];
    if (byPosition) return byPosition;
    throw missing(raw);
  }
  const key = fold(raw);
  const exact = subitems.filter((s) => fold(s.name) === key);
  if (exact.length === 1) return exact[0];
  const prefixed = subitems.filter((s) => fold(s.name).startsWith(key));
  if (exact.length === 0 && prefixed.length === 1) return prefixed[0];
  const partial = subitems.filter((s) => fold(s.name).includes(key));
  if (exact.length === 0 && prefixed.length === 0 && partial.length === 1) return partial[0];
  if (exact.length > 1 || prefixed.length > 1 || partial.length > 1)
    throw badRequest(`"${raw}" combina com mais de um subitem — use o id ou "#posição". Subitens: ${list}.`);
  throw missing(`"${raw}"`);
}
