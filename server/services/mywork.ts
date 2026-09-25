// "Meu trabalho": tudo o que está atribuído a uma pessoa, em todos os projetos.
import type { MyWork, MyWorkBoard } from '../../shared/types';
import { primaryDateColumn, primaryStatusColumn } from '../../shared/values';
import { notFound } from './common';
import { getBoardSettings, listBoards } from './boards';
import { listColumns } from './columns';
import { listGroups } from './groups';
import { listAssignedItems } from './items';
import { getMeId, listPeople } from './people';

export function getMyWork(personId: number | null = getMeId(), visibleProjects: Set<number> | null = null): MyWork {
  if (personId == null) return { personId: 0, boards: [], items: [] };
  if (!listPeople().some((p) => p.id === personId)) throw notFound('Pessoa não encontrada.');
  const summaries = new Map(listBoards().map((b) => [b.id, b]));
  const withinReach = (boardId: number) => {
    const summary = summaries.get(boardId);
    return !!summary && (!visibleProjects || visibleProjects.has(summary.projectId));
  };
  const items = listAssignedItems(personId).filter((item) => withinReach(item.boardId));
  const boards: MyWorkBoard[] = [];
  for (const id of new Set(items.map((i) => i.boardId))) {
    const summary = summaries.get(id);
    if (!summary) continue;
    const columns = listColumns(id);
    boards.push({
      id,
      name: summary.name,
      projectId: summary.projectId,
      columns,
      groups: listGroups(id),
      statusColumnId: primaryStatusColumn(columns, getBoardSettings(id).kanban?.laneColumnId)?.id ?? null,
      dateColumnId: primaryDateColumn(columns)?.id ?? null,
    });
  }
  return { personId, boards, items };
}
