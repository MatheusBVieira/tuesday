import type { Board, Column } from '../../shared/types';

/** Coluna de status que define as raias do kanban. */
export function laneColumnOf(board: Board): Column | null {
  const status = board.columns.filter((c) => c.type === 'status');
  return status.find((c) => c.id === board.settings.kanban?.laneColumnId) ?? status[0] ?? null;
}

/** Colunas exibidas nos cartões (padrão: as 3 primeiras que não são a raia). */
export function cardColumnIdsOf(board: Board, lane: Column | null): number[] {
  const configured = board.settings.kanban?.cardColumnIds;
  if (configured) return configured.filter((id) => id !== lane?.id && board.columns.some((c) => c.id === id));
  return board.columns
    .filter((c) => c.id !== lane?.id && c.type !== 'auto_number')
    .slice(0, 3)
    .map((c) => c.id);
}
