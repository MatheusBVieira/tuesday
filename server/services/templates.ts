import type { BoardTemplate } from '../../shared/types';
import { DEV_PRIORITY, DEV_STATUS, DEV_TYPE, TASK_PRIORITY } from '../../shared/templates';
import type { Actor } from './common';
import { saveBoardSettings } from './boards';
import { createColumn } from './columns';
import { createGroup } from './groups';

/** Cria grupos, colunas e a configuração do kanban de um quadro recém-criado. */
export function applyTemplate(boardId: number, template: BoardTemplate, opts: { idPrefix: string; idPad: number }, actor: Actor): void {
  switch (template) {
    case 'empty': {
      createGroup(boardId, { name: 'Grupo 1', color: '#579bfc' }, actor);
      const status = createColumn(boardId, { title: 'Status', type: 'status' }, actor);
      saveBoardSettings(boardId, { kanban: { laneColumnId: status.id, cardColumnIds: [] } });
      return;
    }
    case 'software': {
      createGroup(boardId, { name: 'Sprint atual', color: '#579bfc' }, actor);
      createGroup(boardId, { name: 'Backlog', color: '#9d50dd' }, actor);
      createGroup(boardId, { name: 'Concluído', color: '#00c875' }, actor);
      const owner = createColumn(boardId, { title: 'Responsável', type: 'people', width: 136 }, actor);
      const status = createColumn(boardId, { title: 'Status', type: 'status', settings: { labels: DEV_STATUS, doneLabelId: 5 } }, actor);
      const priority = createColumn(
        boardId,
        { title: 'Prioridade', type: 'status', width: 120, settings: { labels: DEV_PRIORITY } },
        actor,
      );
      const type = createColumn(boardId, { title: 'Tipo', type: 'status', width: 140, settings: { labels: DEV_TYPE } }, actor);
      const due = createColumn(boardId, { title: 'Prazo', type: 'date', width: 120 }, actor);
      createColumn(boardId, { title: 'ID', type: 'auto_number', width: 100, settings: { prefix: opts.idPrefix, pad: opts.idPad } }, actor);
      saveBoardSettings(boardId, {
        kanban: { laneColumnId: status.id, cardColumnIds: [owner.id, priority.id, type.id, due.id] },
      });
      return;
    }
    default: {
      createGroup(boardId, { name: 'A fazer', color: '#579bfc' }, actor);
      createGroup(boardId, { name: 'Concluído', color: '#00c875' }, actor);
      const owner = createColumn(boardId, { title: 'Responsável', type: 'people', width: 136 }, actor);
      const status = createColumn(boardId, { title: 'Status', type: 'status' }, actor);
      const due = createColumn(boardId, { title: 'Prazo', type: 'date' }, actor);
      const priority = createColumn(boardId, { title: 'Prioridade', type: 'status', settings: { labels: TASK_PRIORITY } }, actor);
      saveBoardSettings(boardId, {
        kanban: { laneColumnId: status.id, cardColumnIds: [owner.id, due.id, priority.id] },
      });
    }
  }
}
