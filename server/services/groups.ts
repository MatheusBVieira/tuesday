import type { Group } from '../../shared/types';
import { GROUP_COLORS, resolveColor } from '../../shared/colors';
import { fold, positionBetween } from '../../shared/values';
import { badRequest, db, emitBoardChange, insertId, notFound, tx, type Actor } from './common';
import { requireBoard, touchBoard } from './boards';

interface GroupRow {
  id: number;
  board_id: number;
  name: string;
  color: string;
  position: number;
  collapsed: number;
}

const toGroup = (r: GroupRow): Group => ({
  id: r.id,
  boardId: r.board_id,
  name: r.name,
  color: r.color,
  position: r.position,
  collapsed: r.collapsed === 1,
});

export function listGroups(boardId: number): Group[] {
  return (db().prepare('SELECT * FROM board_groups WHERE board_id = ? ORDER BY position, id').all(boardId) as GroupRow[]).map(toGroup);
}

export function requireGroup(id: number): Group {
  const row = db().prepare('SELECT * FROM board_groups WHERE id = ?').get(id) as GroupRow | undefined;
  if (!row) throw notFound('Grupo não encontrado.');
  return toGroup(row);
}

function groupPosition(boardId: number, position: 'top' | 'bottom' | number, exceptId?: number): number {
  if (typeof position === 'number') return position;
  const groups = listGroups(boardId).filter((g) => g.id !== exceptId);
  return position === 'top' ? positionBetween(null, groups[0]?.position) : positionBetween(groups.at(-1)?.position, null);
}

export function createGroup(
  boardId: number,
  input: { name?: string; color?: string | null; position?: 'top' | 'bottom' | number },
  actor: Actor,
): Group {
  requireBoard(boardId);
  const used = new Set(listGroups(boardId).map((g) => g.color));
  const color = resolveColor(input.color) ?? GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[used.size % GROUP_COLORS.length];
  const name = input.name?.trim().slice(0, 120) || 'Novo grupo';
  const id = insertId(
    'INSERT INTO board_groups (board_id, name, color, position) VALUES (?, ?, ?, ?)',
    boardId,
    name,
    color,
    groupPosition(boardId, input.position ?? 'bottom'),
  );
  touchBoard(boardId);
  emitBoardChange(actor, boardId);
  return requireGroup(id);
}

export function updateGroup(
  id: number,
  patch: { name?: string; color?: string | null; collapsed?: boolean; position?: 'top' | 'bottom' | number },
  actor: Actor,
): Group {
  const group = requireGroup(id);
  const name = patch.name !== undefined ? patch.name.trim().slice(0, 120) || group.name : group.name;
  const color = patch.color !== undefined ? (resolveColor(patch.color) ?? group.color) : group.color;
  const collapsed = patch.collapsed ?? group.collapsed;
  const position = patch.position !== undefined ? groupPosition(group.boardId, patch.position, id) : group.position;
  db()
    .prepare('UPDATE board_groups SET name = ?, color = ?, collapsed = ?, position = ? WHERE id = ?')
    .run(name, color, collapsed ? 1 : 0, position, id);
  touchBoard(group.boardId);
  emitBoardChange(actor, group.boardId);
  return requireGroup(id);
}

/** Remove o grupo e todos os seus itens. */
export function deleteGroup(id: number, actor: Actor): void {
  const group = requireGroup(id);
  if (listGroups(group.boardId).length <= 1) throw badRequest('O quadro precisa ter pelo menos um grupo.');
  tx(() => {
    db().prepare('DELETE FROM board_groups WHERE id = ?').run(id);
    touchBoard(group.boardId);
  });
  emitBoardChange(actor, group.boardId);
}

export function resolveGroup(boardId: number, ref: number | string, groups: Group[] = listGroups(boardId)): Group {
  const raw = String(ref).trim();
  if (typeof ref === 'number' || /^\d+$/.test(raw)) {
    const byId = groups.find((g) => g.id === Number(raw));
    if (byId) return byId;
  }
  const key = fold(raw);
  const exact = groups.filter((g) => fold(g.name) === key);
  if (exact.length === 1) return exact[0];
  const partial = groups.filter((g) => fold(g.name).includes(key));
  if (exact.length === 0 && partial.length === 1) return partial[0];
  const known = groups.map((g) => g.name).join(', ');
  if (exact.length > 1 || partial.length > 1) throw badRequest(`Mais de um grupo corresponde a "${raw}". Use o id.`);
  throw badRequest(`Grupo "${raw}" não encontrado. Grupos deste quadro: ${known}.`);
}
