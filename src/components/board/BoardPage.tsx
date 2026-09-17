import type { ViewKind } from '../../router';
import { KanbanView } from '../kanban/KanbanView';
import { TableView } from '../table/TableView';
import { BoardHeader } from './BoardHeader';
import { BoardToolbar } from './BoardToolbar';
import { BulkActionBar } from './BulkActionBar';
import './board.css';

export function BoardPage({ view }: { view: ViewKind }) {
  return (
    <div className="board">
      <BoardHeader view={view} />
      <BoardToolbar view={view} />
      <div className="board__content">{view === 'kanban' ? <KanbanView /> : <TableView />}</div>
      <BulkActionBar />
    </div>
  );
}
