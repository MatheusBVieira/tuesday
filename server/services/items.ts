import type { CellValue, Column, ColumnSettings, Item, ItemDetails, Person, Subitem } from '../../shared/types';
import { MAX_ITEM_NUMBER, formatItemRef, normalizeValue, positionBetween, sameValue, snapshotValue } from '../../shared/values';
import { badRequest, db, emitBoardChange, inIds, insertId, notFound, nowIso, parseJson, tx, type Actor } from './common';
import { requireBoard, touchBoard } from './boards';
import { listColumns } from './columns';
import { listGroups, requireGroup } from './groups';
import { listPeople } from './people';
import { listActivity, logActivity } from './activity';
import { listUpdates } from './updates';
import { listItemCommits } from './git';
import { boardSubitems, copySubitems, subitemsOf } from './subitems';

export interface ItemRow {
  id: number;
  board_id: number;
  group_id: number;
  number: number;
  name: string;
  position: number;
  kanban_position: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  updates_count: number;
  commits_count: number;
}

/** A lista de pessoas (JSON) de uma coluna contém a pessoa do parâmetro. */
const personInList = (column: string) =>
  db().dialect === 'postgres'
    ? `CAST(${column} AS jsonb) @> to_jsonb(CAST(? AS INTEGER))`
    : `EXISTS (SELECT 1 FROM json_each(${column}) WHERE json_each.value = ?)`;

const ITEM_SELECT = `SELECT i.*,
  (SELECT COUNT(*) FROM updates u WHERE u.item_id = i.id) AS updates_count,
  (SELECT COUNT(*) FROM item_commits ic WHERE ic.item_id = i.id) AS commits_count
  FROM items i`;

const toItem = (r: ItemRow, values: Record<string, CellValue> = {}, subitems: Subitem[] = []): Item => ({
  id: r.id,
  boardId: r.board_id,
  groupId: r.group_id,
  number: r.number,
  name: r.name,
  position: r.position,
  kanbanPosition: r.kanban_position,
  values,
  subitems,
  updatesCount: r.updates_count ?? 0,
  commitsCount: r.commits_count ?? 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

type ValueRow = { item_id: number; column_id: number; value: string };

function groupValues(rows: ValueRow[]): Map<number, Record<string, CellValue>> {
  const map = new Map<number, Record<string, CellValue>>();
  for (const row of rows) {
    let record = map.get(row.item_id);
    if (!record) map.set(row.item_id, (record = {}));
    record[String(row.column_id)] = JSON.parse(row.value) as CellValue;
  }
  return map;
}

export function listItems(boardId: number): Item[] {
  const rows = db()
    .prepare(`${ITEM_SELECT} WHERE i.board_id = ? AND i.deleted_at IS NULL ORDER BY i.position, i.id`)
    .all(boardId) as ItemRow[];
  const values = groupValues(
    db()
      .prepare(
        `SELECT v.item_id, v.column_id, v.value FROM item_values v
         JOIN items i ON i.id = v.item_id WHERE i.board_id = ? AND i.deleted_at IS NULL`,
      )
      .all(boardId) as ValueRow[],
  );
  const subitems = boardSubitems(boardId);
  return rows.map((r) => toItem(r, values.get(r.id), subitems.get(r.id)));
}

/** Itens (não excluídos) de todos os quadros em que a pessoa está em alguma coluna de pessoas. */
export function listAssignedItems(personId: number): Item[] {
  const rows = db()
    .prepare(
      `${ITEM_SELECT} WHERE i.deleted_at IS NULL AND EXISTS (
         SELECT 1 FROM item_values v JOIN board_columns c ON c.id = v.column_id AND c.type = 'people'
         WHERE v.item_id = i.id AND ${personInList('v.value')}
       ) ORDER BY i.board_id, i.position, i.id`,
    )
    .all(personId) as ItemRow[];
  if (!rows.length) return [];
  const values = groupValues(
    db()
      .prepare(`SELECT item_id, column_id, value FROM item_values WHERE ${inIds('item_id')}`)
      .all(JSON.stringify(rows.map((r) => r.id))) as ValueRow[],
  );
  const subitems = subitemsOf(rows.map((r) => r.id));
  return rows.map((r) => toItem(r, values.get(r.id), subitems.get(r.id)));
}

function getItemRow(id: number, includeDeleted = false): ItemRow | undefined {
  return db()
    .prepare(`${ITEM_SELECT} WHERE i.id = ?${includeDeleted ? '' : ' AND i.deleted_at IS NULL'}`)
    .get(id) as ItemRow | undefined;
}

export function requireItemRow(id: number, includeDeleted = false): ItemRow {
  const row = getItemRow(id, includeDeleted);
  if (!row) throw notFound('Item não encontrado.');
  return row;
}

export function getItem(id: number): Item {
  const row = requireItemRow(id);
  const values = groupValues(db().prepare('SELECT item_id, column_id, value FROM item_values WHERE item_id = ?').all(id) as ValueRow[]);
  return toItem(row, values.get(id), subitemsOf([id]).get(id));
}

interface WriteContext {
  columns: Map<number, Column>;
  people: Person[];
}

const writeContext = (boardId: number): WriteContext => ({
  columns: new Map(listColumns(boardId).map((c) => [c.id, c])),
  people: listPeople(),
});

/** Grava valores (formato interno) e registra cada mudança no registro de atividades. */
function writeValues(row: ItemRow, values: Record<string, unknown>, actor: Actor, ctx: WriteContext, log = true): boolean {
  let changed = false;
  for (const [key, raw] of Object.entries(values)) {
    const column = ctx.columns.get(Number(key));
    if (!column) throw badRequest(`A coluna ${key} não pertence a este quadro.`);
    const next = normalizeValue(column, raw);
    if (column.type === 'people' && Array.isArray(next)) {
      const missing = next.filter((id) => !ctx.people.some((p) => p.id === id));
      if (missing.length) throw badRequest(`Pessoa(s) inexistente(s): ${missing.join(', ')}.`);
    }
    const prevRow = db().prepare('SELECT value FROM item_values WHERE item_id = ? AND column_id = ?').get(row.id, column.id) as
      { value: string } | undefined;
    const prev = prevRow ? (JSON.parse(prevRow.value) as CellValue) : null;
    if (sameValue(prev, next)) continue;
    if (next === null) {
      db().prepare('DELETE FROM item_values WHERE item_id = ? AND column_id = ?').run(row.id, column.id);
    } else {
      db()
        .prepare(
          `INSERT INTO item_values (item_id, column_id, value, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(item_id, column_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .run(row.id, column.id, JSON.stringify(next), nowIso());
    }
    changed = true;
    if (log) {
      logActivity(
        {
          boardId: row.board_id,
          itemId: row.id,
          itemName: row.name,
          action: 'value_changed',
          data: {
            columnId: column.id,
            columnTitle: column.title,
            columnType: column.type,
            from: snapshotValue(column, prev, { people: ctx.people }),
            to: snapshotValue(column, next, { people: ctx.people }),
          },
        },
        actor,
      );
    }
  }
  return changed;
}

function itemPosition(groupId: number, position: 'top' | 'bottom' | number, exceptId?: number): number {
  if (typeof position === 'number') return position;
  const r = db()
    .prepare('SELECT MIN(position) AS lo, MAX(position) AS hi FROM items WHERE group_id = ? AND deleted_at IS NULL AND id != ?')
    .get(groupId, exceptId ?? -1) as { lo: number | null; hi: number | null };
  return position === 'top' ? positionBetween(null, r.lo) : positionBetween(r.hi, null);
}

function kanbanPosition(boardId: number, position: 'top' | 'bottom' | number): number {
  if (typeof position === 'number') return position;
  const r = db()
    .prepare('SELECT MIN(kanban_position) AS lo, MAX(kanban_position) AS hi FROM items WHERE board_id = ? AND deleted_at IS NULL')
    .get(boardId) as { lo: number | null; hi: number | null };
  return position === 'top' ? positionBetween(null, r.lo) : positionBetween(r.hi, null);
}

// ── Números dos itens (a referência da coluna "ID do item", ex.: TM-07) ──

/** Formata números como referências do quadro ("TM-07") — ou "#7" se o quadro não tem coluna de ID. */
export function refFormatter(boardId: number): (n: number) => string {
  const column = listColumns(boardId).find((c) => c.type === 'auto_number');
  return (n) => (column ? formatItemRef(column.settings, n) : `#${n}`);
}

/** Maior número já usado no quadro (itens excluídos incluídos — eles podem ser restaurados). */
export function maxItemNumber(boardId: number): number {
  return (db().prepare('SELECT MAX(number) AS n FROM items WHERE board_id = ?').get(boardId) as { n: number | null }).n ?? 0;
}

/** Reserva o próximo número livre do quadro. */
function allocateNumber(boardId: number): number {
  const { next_item_number } = requireBoard(boardId);
  const number = Math.max(next_item_number, maxItemNumber(boardId) + 1);
  db()
    .prepare('UPDATE boards SET next_item_number = ? WHERE id = ?')
    .run(number + 1, boardId);
  return number;
}

/** Valida um número escolhido à mão (ex.: ao importar TM-07) e avança o contador se preciso. */
function claimNumber(boardId: number, number: number, exceptItemId: number | null = null): number {
  if (!Number.isInteger(number) || number < 1 || number > MAX_ITEM_NUMBER)
    throw badRequest(`O número do item precisa ser um inteiro entre 1 e ${MAX_ITEM_NUMBER}.`);
  const taken = db()
    .prepare('SELECT name, deleted_at FROM items WHERE board_id = ? AND number = ? AND id != ?')
    .get(boardId, number, exceptItemId ?? -1) as { name: string; deleted_at: string | null } | undefined;
  if (taken) {
    const ref = refFormatter(boardId)(number);
    throw badRequest(
      taken.deleted_at
        ? `${ref} pertence a um item excluído ("${taken.name}"). Restaure-o ou escolha outro número.`
        : `${ref} já é usado por "${taken.name}".`,
    );
  }
  db()
    .prepare('UPDATE boards SET next_item_number = CASE WHEN next_item_number > ? THEN next_item_number ELSE ? END WHERE id = ?')
    .run(number + 1, number + 1, boardId);
  return number;
}

export interface CreateItemInput {
  name: string;
  groupId?: number | null;
  values?: Record<string, unknown>;
  position?: 'top' | 'bottom' | number;
  kanbanPosition?: 'top' | 'bottom' | number;
  /** número fixo (senão, o próximo do quadro) — para importar mantendo a referência antiga */
  number?: number | null;
}

export function createItem(boardId: number, input: CreateItemInput, actor: Actor): Item {
  const id = tx(() => {
    requireBoard(boardId);
    const name = input.name.trim().slice(0, 500);
    if (!name) throw badRequest('Dê um nome ao item.');
    const groups = listGroups(boardId);
    if (!groups.length) throw badRequest('O quadro não tem grupos.');
    const group = input.groupId != null ? groups.find((g) => g.id === input.groupId) : groups[0];
    if (!group) throw badRequest('O grupo informado não pertence a este quadro.');
    const number = input.number != null ? claimNumber(boardId, input.number) : allocateNumber(boardId);
    const itemId = insertId(
      'INSERT INTO items (board_id, group_id, number, name, position, kanban_position) VALUES (?, ?, ?, ?, ?, ?)',
      boardId,
      group.id,
      number,
      name,
      itemPosition(group.id, input.position ?? 'bottom'),
      kanbanPosition(boardId, input.kanbanPosition ?? 'bottom'),
    );
    logActivity({ boardId, itemId, itemName: name, action: 'item_created', data: { text: group.name } }, actor);
    if (input.values && Object.keys(input.values).length)
      writeValues(requireItemRow(itemId), input.values, actor, writeContext(boardId), false);
    touchBoard(boardId);
    return itemId;
  });
  emitBoardChange(actor, boardId);
  return getItem(id);
}

export function updateItem(
  id: number,
  patch: { name?: string; groupId?: number; position?: 'top' | 'bottom' | number; kanbanPosition?: number; number?: number },
  actor: Actor,
): Item {
  const boardId = tx(() => {
    const row = requireItemRow(id);
    const sets: string[] = [];
    const params: (string | number)[] = [];

    if (patch.number !== undefined && patch.number !== row.number) {
      const number = claimNumber(row.board_id, patch.number, id);
      const refColumn = listColumns(row.board_id).find((c) => c.type === 'auto_number');
      const ref = refFormatter(row.board_id);
      sets.push('number = ?');
      params.push(number);
      logActivity(
        {
          boardId: row.board_id,
          itemId: id,
          itemName: row.name,
          action: 'value_changed',
          data: {
            columnId: refColumn?.id,
            columnTitle: refColumn?.title ?? 'ID',
            columnType: 'auto_number',
            from: { text: ref(row.number) },
            to: { text: ref(number) },
          },
        },
        actor,
      );
    }

    if (patch.name !== undefined) {
      const name = patch.name.trim().slice(0, 500);
      if (!name) throw badRequest('O nome do item não pode ficar vazio.');
      if (name !== row.name) {
        sets.push('name = ?');
        params.push(name);
        logActivity(
          {
            boardId: row.board_id,
            itemId: id,
            itemName: name,
            action: 'item_renamed',
            data: { columnType: 'name', columnTitle: 'Nome', from: { text: row.name }, to: { text: name } },
          },
          actor,
        );
      }
    }

    let groupId = row.group_id;
    if (patch.groupId !== undefined && patch.groupId !== row.group_id) {
      const target = requireGroup(patch.groupId);
      if (target.boardId !== row.board_id) throw badRequest('O grupo de destino pertence a outro quadro.');
      const source = requireGroup(row.group_id);
      groupId = target.id;
      sets.push('group_id = ?');
      params.push(target.id);
      logActivity(
        {
          boardId: row.board_id,
          itemId: id,
          itemName: row.name,
          action: 'item_moved',
          data: {
            columnType: 'group',
            columnTitle: 'Grupo',
            from: { text: source.name, color: source.color },
            to: { text: target.name, color: target.color },
          },
        },
        actor,
      );
      if (patch.position === undefined) {
        sets.push('position = ?');
        params.push(itemPosition(target.id, 'top', id));
      }
    }
    if (patch.position !== undefined) {
      sets.push('position = ?');
      params.push(itemPosition(groupId, patch.position, id));
    }
    if (patch.kanbanPosition !== undefined) {
      sets.push('kanban_position = ?');
      params.push(patch.kanbanPosition);
    }
    if (sets.length) {
      sets.push('updated_at = ?');
      params.push(nowIso());
      db()
        .prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`)
        .run(...params, id);
      touchBoard(row.board_id);
    }
    return row.board_id;
  });
  emitBoardChange(actor, boardId);
  return getItem(id);
}

export function setItemValues(id: number, values: Record<string, unknown>, actor: Actor): Item {
  const boardId = tx(() => {
    const row = requireItemRow(id);
    if (writeValues(row, values, actor, writeContext(row.board_id))) {
      db().prepare('UPDATE items SET updated_at = ? WHERE id = ?').run(nowIso(), id);
      touchBoard(row.board_id);
    }
    return row.board_id;
  });
  emitBoardChange(actor, boardId);
  return getItem(id);
}

/** Exclusão reversível: o item fica 30 dias recuperável (restoreItems). */
export function deleteItems(ids: number[], actor: Actor): number[] {
  const boards = new Set<number>();
  const deleted = tx(() => {
    const done: number[] = [];
    for (const id of new Set(ids)) {
      const row = getItemRow(id);
      if (!row) continue;
      db().prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(nowIso(), id);
      logActivity({ boardId: row.board_id, itemId: id, itemName: row.name, action: 'item_deleted' }, actor);
      boards.add(row.board_id);
      done.push(id);
    }
    for (const b of boards) touchBoard(b);
    return done;
  });
  for (const b of boards) emitBoardChange(actor, b);
  return deleted;
}

export function restoreItems(ids: number[], actor: Actor): number[] {
  const boards = new Set<number>();
  const restored = tx(() => {
    const done: number[] = [];
    for (const id of new Set(ids)) {
      const row = getItemRow(id, true);
      if (!row || !row.deleted_at) continue;
      db().prepare('UPDATE items SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(nowIso(), id);
      logActivity({ boardId: row.board_id, itemId: id, itemName: row.name, action: 'item_restored' }, actor);
      boards.add(row.board_id);
      done.push(id);
    }
    for (const b of boards) touchBoard(b);
    return done;
  });
  for (const b of boards) emitBoardChange(actor, b);
  return restored;
}

export function duplicateItems(ids: number[], actor: Actor): Item[] {
  const boards = new Set<number>();
  const created = tx(() => {
    const out: number[] = [];
    for (const id of ids) {
      const row = requireItemRow(id);
      const nextPos = (
        db()
          .prepare('SELECT MIN(position) AS p FROM items WHERE group_id = ? AND position > ? AND deleted_at IS NULL')
          .get(row.group_id, row.position) as { p: number | null }
      ).p;
      const nextKanban = (
        db()
          .prepare('SELECT MIN(kanban_position) AS p FROM items WHERE board_id = ? AND kanban_position > ? AND deleted_at IS NULL')
          .get(row.board_id, row.kanban_position) as { p: number | null }
      ).p;
      const newId = insertId(
        'INSERT INTO items (board_id, group_id, number, name, position, kanban_position) VALUES (?, ?, ?, ?, ?, ?)',
        row.board_id,
        row.group_id,
        allocateNumber(row.board_id),
        row.name,
        positionBetween(row.position, nextPos),
        positionBetween(row.kanban_position, nextKanban),
      );
      db()
        .prepare(
          'INSERT INTO item_values (item_id, column_id, value) SELECT CAST(? AS INTEGER), column_id, value FROM item_values WHERE item_id = ?',
        )
        .run(newId, id);
      copySubitems(id, newId);
      logActivity({ boardId: row.board_id, itemId: newId, itemName: row.name, action: 'item_duplicated', data: { text: row.name } }, actor);
      boards.add(row.board_id);
      out.push(newId);
    }
    for (const b of boards) touchBoard(b);
    return out;
  });
  for (const b of boards) emitBoardChange(actor, b);
  return created.map(getItem);
}

export function moveItems(ids: number[], groupId: number, actor: Actor): Item[] {
  return tx(() => ids.map((id) => updateItem(id, { groupId }, actor)));
}

export function getItemDetails(id: number): ItemDetails {
  return {
    item: getItem(id),
    updates: listUpdates(id),
    activity: listActivity({ itemId: id, limit: 100 }),
    commits: listItemCommits(id),
  };
}

/**
 * Aceita id numérico ("42", "#42") ou referência da coluna "ID do item" ("TUE-012").
 * Com `projectId`, prefere quadros desse projeto quando o mesmo prefixo existe em mais de um.
 */
export function resolveItem(ref: number | string, opts: { projectId?: number | null } = {}): ItemRow {
  const raw = String(ref).trim();
  const byId = /^#?(\d+)$/.exec(raw);
  if (typeof ref === 'number' || byId) {
    const row = getItemRow(Number(byId ? byId[1] : ref));
    if (row) return row;
    throw notFound(`Item ${raw} não encontrado.`);
  }
  const byRef = /^([A-Za-z0-9_]+)-(\d+)$/.exec(raw);
  if (byRef) {
    const prefix = byRef[1].toUpperCase();
    const number = Number(byRef[2]);
    const columns = db().prepare(`SELECT board_id, settings FROM board_columns WHERE type = 'auto_number'`).all() as {
      board_id: number;
      settings: string;
    }[];
    const inProject = new Set(
      opts.projectId != null
        ? (db().prepare('SELECT id FROM boards WHERE project_id = ?').all(opts.projectId) as { id: number }[]).map((b) => b.id)
        : [],
    );
    const boardIds = [
      ...new Set(
        columns.filter((c) => (parseJson<ColumnSettings>(c.settings, {}).prefix ?? '').toUpperCase() === prefix).map((c) => c.board_id),
      ),
    ].sort((a, b) => Number(inProject.has(b)) - Number(inProject.has(a)));
    for (const boardId of boardIds) {
      const row = db().prepare(`${ITEM_SELECT} WHERE i.board_id = ? AND i.number = ? AND i.deleted_at IS NULL`).get(boardId, number) as
        ItemRow | undefined;
      if (row) return row;
    }
    throw notFound(`Item ${raw} não encontrado.`);
  }
  throw badRequest(`Referência de item inválida: "${raw}". Use o id numérico ou a referência (ex.: TUE-012).`);
}

export function purgeDeletedItems(days = 30): number {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  return db().prepare('DELETE FROM items WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(cutoff).changes;
}
