import type { Column, ColumnSettings, ColumnType, StatusLabel } from '../../shared/types';
import { LABEL_COLORS, resolveColor } from '../../shared/colors';
import {
  COLUMN_TYPE_LABELS,
  COLUMN_TYPES,
  DEFAULT_COLUMN_WIDTH,
  clampIdPad,
  defaultColumnSettings,
  fold,
  positionBetween,
  sanitizeIdPrefix,
} from '../../shared/values';
import { badRequest, db, emitBoardChange, insertId, notFound, parseJson, tx, type Actor } from './common';
import { getBoardSettings, requireBoard, saveBoardSettings, touchBoard } from './boards';

interface ColumnRow {
  id: number;
  board_id: number;
  title: string;
  type: string;
  settings: string;
  width: number;
  position: number;
}

const toColumn = (r: ColumnRow): Column => ({
  id: r.id,
  boardId: r.board_id,
  title: r.title,
  type: r.type as ColumnType,
  settings: parseJson<ColumnSettings>(r.settings, {}),
  width: r.width,
  position: r.position,
});

const clampWidth = (w: number) => Math.min(Math.max(Math.round(w), 60), 800);

export function listColumns(boardId: number): Column[] {
  return (db().prepare('SELECT * FROM board_columns WHERE board_id = ? ORDER BY position, id').all(boardId) as ColumnRow[]).map(toColumn);
}

export function requireColumn(id: number): Column {
  const row = db().prepare('SELECT * FROM board_columns WHERE id = ?').get(id) as ColumnRow | undefined;
  if (!row) throw notFound('Coluna não encontrada.');
  return toColumn(row);
}

function sanitizeLabels(input: unknown, previous: StatusLabel[] = []): StatusLabel[] {
  if (!Array.isArray(input)) throw badRequest('Etiquetas inválidas.');
  if (input.length > 60) throw badRequest('Máximo de 60 etiquetas por coluna.');
  const incomingIds = input.map((l) => Number((l as StatusLabel)?.id) || 0);
  let nextId = Math.max(0, ...previous.map((l) => l.id), ...incomingIds) + 1;
  const names = new Set<string>();
  const ids = new Set<number>();
  return input.map((raw, index) => {
    const label = (raw ?? {}) as Partial<StatusLabel>;
    const name = String(label.name ?? '')
      .trim()
      .slice(0, 60);
    const key = fold(name);
    if (key && names.has(key)) throw badRequest(`Etiqueta duplicada: "${name}".`);
    if (key) names.add(key);
    let id = Number(label.id);
    if (!Number.isInteger(id) || id <= 0 || ids.has(id)) id = nextId++;
    ids.add(id);
    const color = resolveColor(label.color) ?? LABEL_COLORS[index % LABEL_COLORS.length];
    return { id, name, color };
  });
}

function sanitizeSettings(type: ColumnType, input: ColumnSettings | undefined, previous: ColumnSettings): ColumnSettings {
  const next: ColumnSettings = { ...previous };
  if (!input) return next;
  switch (type) {
    case 'status':
      if (input.labels !== undefined) next.labels = sanitizeLabels(input.labels, previous.labels);
      if (input.doneLabelId !== undefined) next.doneLabelId = input.doneLabelId;
      if (next.doneLabelId != null && !next.labels?.some((l) => l.id === next.doneLabelId)) next.doneLabelId = null;
      break;
    case 'number':
      if (input.unit !== undefined) next.unit = String(input.unit ?? '').slice(0, 12);
      if (input.unitPosition !== undefined) next.unitPosition = input.unitPosition === 'left' ? 'left' : 'right';
      if (input.decimals !== undefined)
        next.decimals = input.decimals == null ? null : Math.min(Math.max(Math.round(Number(input.decimals)), 0), 6);
      break;
    case 'auto_number':
      if (input.prefix !== undefined) next.prefix = sanitizeIdPrefix(input.prefix);
      if (input.pad !== undefined) next.pad = clampIdPad(input.pad);
      break;
  }
  return next;
}

export function createColumn(
  boardId: number,
  input: {
    title?: string;
    type: ColumnType;
    settings?: ColumnSettings;
    width?: number;
    afterColumnId?: number | null;
    position?: 'start' | 'end';
  },
  actor: Actor,
): Column {
  requireBoard(boardId);
  if (!COLUMN_TYPES.includes(input.type)) throw badRequest(`Tipo de coluna inválido: ${input.type}.`);
  const base = defaultColumnSettings(input.type);
  if (input.type === 'status' && input.settings?.labels) base.doneLabelId = null;
  const settings = sanitizeSettings(input.type, input.settings, base);
  const columns = listColumns(boardId);
  let position: number;
  if (input.afterColumnId != null) {
    const index = columns.findIndex((c) => c.id === input.afterColumnId);
    if (index < 0) throw badRequest('Coluna de referência não encontrada.');
    position = positionBetween(columns[index].position, columns[index + 1]?.position);
  } else if (input.position === 'start') {
    position = positionBetween(null, columns[0]?.position);
  } else {
    position = positionBetween(columns.at(-1)?.position, null);
  }
  const title = input.title?.trim().slice(0, 80) || COLUMN_TYPE_LABELS[input.type];
  const id = insertId(
    'INSERT INTO board_columns (board_id, title, type, settings, width, position) VALUES (?, ?, ?, ?, ?, ?)',
    boardId,
    title,
    input.type,
    JSON.stringify(settings),
    clampWidth(input.width ?? DEFAULT_COLUMN_WIDTH[input.type]),
    position,
  );
  touchBoard(boardId);
  emitBoardChange(actor, boardId);
  return requireColumn(id);
}

export function updateColumn(
  id: number,
  patch: { title?: string; width?: number; position?: number; settings?: ColumnSettings },
  actor: Actor,
): Column {
  const column = requireColumn(id);
  const updated = tx(() => {
    const title = patch.title !== undefined ? patch.title.trim().slice(0, 80) || column.title : column.title;
    const width = patch.width !== undefined ? clampWidth(patch.width) : column.width;
    const position = patch.position ?? column.position;
    const settings = patch.settings !== undefined ? sanitizeSettings(column.type, patch.settings, column.settings) : column.settings;

    if (column.type === 'status' && patch.settings?.labels !== undefined) {
      const kept = new Set(settings.labels?.map((l) => l.id));
      for (const label of (column.settings.labels ?? []).filter((l) => !kept.has(l.id))) {
        const value = JSON.stringify(label.id);
        const inUse = (
          db()
            .prepare(
              `SELECT COUNT(*) AS n FROM item_values v JOIN items i ON i.id = v.item_id
               WHERE v.column_id = ? AND v.value = ? AND i.deleted_at IS NULL`,
            )
            .get(id, value) as { n: number }
        ).n;
        if (inUse > 0)
          throw badRequest(
            `A etiqueta "${label.name || '(sem nome)'}" está em uso por ${inUse} ${inUse === 1 ? 'item' : 'itens'}. Mude o status desses itens antes de removê-la.`,
          );
        db().prepare('DELETE FROM item_values WHERE column_id = ? AND value = ?').run(id, value);
      }
    }

    db()
      .prepare('UPDATE board_columns SET title = ?, width = ?, position = ?, settings = ? WHERE id = ?')
      .run(title, width, position, JSON.stringify(settings), id);
    touchBoard(column.boardId);
    return requireColumn(id);
  });
  emitBoardChange(actor, column.boardId);
  return updated;
}

export function deleteColumn(id: number, actor: Actor): void {
  const column = requireColumn(id);
  tx(() => {
    db().prepare('DELETE FROM board_columns WHERE id = ?').run(id);
    const settings = getBoardSettings(column.boardId);
    if (settings.kanban) {
      if (settings.kanban.laneColumnId === id) settings.kanban.laneColumnId = null;
      settings.kanban.cardColumnIds = settings.kanban.cardColumnIds?.filter((c) => c !== id);
    }
    if (settings.table?.hiddenColumnIds) settings.table.hiddenColumnIds = settings.table.hiddenColumnIds.filter((c) => c !== id);
    saveBoardSettings(column.boardId, settings);
    touchBoard(column.boardId);
  });
  emitBoardChange(actor, column.boardId);
}

/** Aceita id ou título da coluna (sem diferenciar acentos/caixa). */
export function resolveColumn(boardId: number, ref: number | string, columns: Column[] = listColumns(boardId)): Column {
  const raw = String(ref).trim();
  if (typeof ref === 'number' || /^\d+$/.test(raw)) {
    const byId = columns.find((c) => c.id === Number(raw));
    if (byId) return byId;
  }
  const key = fold(raw);
  const matches = columns.filter((c) => fold(c.title) === key);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw badRequest(`Há mais de uma coluna chamada "${raw}". Use o id da coluna.`);
  const known = columns.map((c) => `${c.title} (${c.type})`).join(', ');
  throw badRequest(`Coluna "${raw}" não encontrada. Colunas deste quadro: ${known}.`);
}
