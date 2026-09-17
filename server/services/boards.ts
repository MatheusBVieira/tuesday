import type { Board, BoardSettings, BoardSummary, BoardTemplate, IdFormat } from '../../shared/types';
import { idPrefixFor } from '../../shared/templates';
import { MAX_ITEM_NUMBER, fold } from '../../shared/values';
import { badRequest, db, emitBoardChange, emitGlobalChange, insertId, notFound, nowIso, parseJson, tx, type Actor } from './common';
import { listColumns } from './columns';
import { listGroups } from './groups';
import { listItems, maxItemNumber, refFormatter } from './items';
import { ensureDefaultProject, listProjects, requireProject } from './projects';
import { applyTemplate } from './templates';

export interface BoardRow {
  id: number;
  project_id: number | null;
  name: string;
  description: string;
  position: number;
  next_item_number: number;
  settings: string;
  created_at: string;
  updated_at: string;
}

const toSummary = (r: BoardRow, itemCount: number): BoardSummary => ({
  id: r.id,
  projectId: r.project_id ?? 0,
  name: r.name,
  description: r.description,
  position: r.position,
  itemCount,
  updatedAt: r.updated_at,
});

export function getBoardRow(id: number): BoardRow | undefined {
  return db().prepare('SELECT * FROM boards WHERE id = ?').get(id) as BoardRow | undefined;
}

export function requireBoard(id: number): BoardRow {
  const row = getBoardRow(id);
  if (!row) throw notFound('Quadro não encontrado.');
  return row;
}

export function touchBoard(id: number): void {
  db().prepare('UPDATE boards SET updated_at = ? WHERE id = ?').run(nowIso(), id);
}

export function getBoardSettings(id: number): BoardSettings {
  return parseJson<BoardSettings>(requireBoard(id).settings, {});
}

export function saveBoardSettings(id: number, settings: BoardSettings): void {
  db().prepare('UPDATE boards SET settings = ? WHERE id = ?').run(JSON.stringify(settings), id);
}

export function listBoards(): BoardSummary[] {
  const rows = db()
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM items i WHERE i.board_id = b.id AND i.deleted_at IS NULL) AS item_count
       FROM boards b ORDER BY b.position, b.id`,
    )
    .all() as (BoardRow & { item_count: number })[];
  return rows.map((r) => toSummary(r, r.item_count));
}

export function getBoard(id: number): Board {
  const row = requireBoard(id);
  const items = listItems(id);
  return {
    ...toSummary(row, items.length),
    nextItemNumber: row.next_item_number,
    settings: parseJson<BoardSettings>(row.settings, {}),
    groups: listGroups(id),
    columns: listColumns(id),
    items,
  };
}

const nextPositionIn = (projectId: number) =>
  ((db().prepare('SELECT MAX(position) AS p FROM boards WHERE project_id = ?').get(projectId) as { p: number | null }).p ?? 0) + 1000;

function checkStart(start: number | null | undefined): number | null {
  if (start == null) return null;
  if (!Number.isInteger(start) || start < 1 || start > MAX_ITEM_NUMBER)
    throw badRequest(`O primeiro número precisa ser um inteiro entre 1 e ${MAX_ITEM_NUMBER}.`);
  return start;
}

export function createBoard(
  input: { name: string; description?: string; template?: BoardTemplate; projectId?: number | null } & IdFormat,
  actor: Actor,
): Board {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw badRequest('Dê um nome ao quadro.');
  const start = checkStart(input.idStart);
  const id = tx(() => {
    const projectId = input.projectId ?? ensureDefaultProject(actor).id;
    requireProject(projectId);
    const boardId = insertId(
      'INSERT INTO boards (name, description, position, project_id, next_item_number) VALUES (?, ?, ?, ?, ?)',
      name,
      input.description?.trim() ?? '',
      nextPositionIn(projectId),
      projectId,
      start ?? 1,
    );
    applyTemplate(boardId, input.template ?? 'default', { idPrefix: input.idPrefix || idPrefixFor(name), idPad: input.idPad ?? 3 }, actor);
    return boardId;
  });
  emitGlobalChange(actor);
  return getBoard(id);
}

export function updateBoard(
  id: number,
  patch: {
    name?: string;
    description?: string;
    position?: number;
    settings?: BoardSettings;
    projectId?: number;
    /** próximo número de item — precisa ser maior que todos os já usados */
    nextItemNumber?: number;
  },
  actor: Actor,
): BoardSummary {
  const row = requireBoard(id);
  const name = patch.name !== undefined ? patch.name.trim().slice(0, 120) || row.name : row.name;
  const description = patch.description !== undefined ? patch.description.slice(0, 2000) : row.description;
  const settings = { ...parseJson<BoardSettings>(row.settings, {}), ...(patch.settings ?? {}) };
  let projectId = row.project_id;
  let position = patch.position ?? row.position;
  if (patch.projectId !== undefined && patch.projectId !== row.project_id) {
    requireProject(patch.projectId);
    projectId = patch.projectId;
    position = nextPositionIn(patch.projectId);
  }
  let nextItemNumber = row.next_item_number;
  if (patch.nextItemNumber !== undefined && patch.nextItemNumber !== row.next_item_number) {
    nextItemNumber = checkStart(patch.nextItemNumber)!;
    const max = maxItemNumber(id);
    if (nextItemNumber <= max) {
      const ref = refFormatter(id);
      throw badRequest(`Já existe o item ${ref(max)} neste quadro — o próximo número precisa ser ${ref(max + 1)} ou maior.`);
    }
  }
  db()
    .prepare(
      'UPDATE boards SET name = ?, description = ?, position = ?, settings = ?, project_id = ?, next_item_number = ?, updated_at = ? WHERE id = ?',
    )
    .run(name, description, position, JSON.stringify(settings), projectId, nextItemNumber, nowIso(), id);
  emitBoardChange(actor, id);
  if (name !== row.name || description !== row.description || position !== row.position || projectId !== row.project_id)
    emitGlobalChange(actor);
  const count = (db().prepare('SELECT COUNT(*) AS n FROM items WHERE board_id = ? AND deleted_at IS NULL').get(id) as { n: number }).n;
  return toSummary(requireBoard(id), count);
}

export function deleteBoard(id: number, actor: Actor): void {
  requireBoard(id);
  db().prepare('DELETE FROM boards WHERE id = ?').run(id);
  emitGlobalChange(actor);
}

/**
 * Aceita id ou nome do quadro (sem diferenciar acentos/caixa).
 * Com `projectId`, procura primeiro nos quadros desse projeto — nomes como "Tarefas" se repetem entre projetos.
 */
export function resolveBoard(ref: number | string, opts: { projectId?: number | null } = {}): BoardRow {
  const raw = String(ref).trim();
  if (typeof ref === 'number' || /^\d+$/.test(raw)) {
    const byId = getBoardRow(Number(raw));
    if (byId) return byId;
  }
  const boards = db().prepare('SELECT * FROM boards ORDER BY position, id').all() as BoardRow[];
  const projects = new Map(listProjects().map((p) => [p.id, p.name]));
  const label = (b: BoardRow) => `${projects.get(b.project_id ?? 0) ?? '?'} / ${b.name} (id ${b.id})`;
  const key = fold(raw);
  const pools = opts.projectId != null ? [boards.filter((b) => b.project_id === opts.projectId), boards] : [boards];
  for (const pool of pools) {
    const exact = pool.filter((b) => fold(b.name) === key);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) throw badRequest(`Mais de um quadro chamado "${raw}": ${exact.map(label).join(', ')}. Use o id.`);
    const partial = pool.filter((b) => fold(b.name).includes(key));
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) throw badRequest(`Mais de um quadro corresponde a "${raw}": ${partial.map(label).join(', ')}. Use o id.`);
  }
  throw notFound(`Quadro "${raw}" não encontrado. Quadros: ${boards.map(label).join(', ') || '(nenhum)'}.`);
}
