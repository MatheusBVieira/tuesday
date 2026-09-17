import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { Plus, SearchX } from 'lucide-react';
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Item } from '../../../shared/types';
import { positionBetween } from '../../../shared/values';
import { filterItems, groupItems, hasActiveFilters, sortItems } from '../../lib/view';
import { actions, useStore } from '../../store';
import { GroupSection } from './GroupSection';
import './table.css';

type Containers = Record<number, number[]>;

/** Prefere o item sob o ponteiro; se não houver, o grupo mais próximo. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length) {
    const item = hits.find((h) => typeof h.id === 'number');
    return item ? [item] : hits;
  }
  return closestCorners(args);
};

function findContainer(id: UniqueIdentifier, containers: Containers): number | null {
  if (typeof id === 'string' && id.startsWith('group-')) return Number(id.slice(6));
  for (const [groupId, ids] of Object.entries(containers)) if (ids.includes(Number(id))) return Number(groupId);
  return null;
}

export function TableView() {
  const board = useStore((s) => s.board)!;
  const people = useStore((s) => s.people);
  const filters = useStore((s) => s.filters);
  const hidden = board.settings.table?.hiddenColumnIds;
  const columns = useMemo(() => board.columns.filter((c) => !hidden?.includes(c.id)), [board.columns, hidden]);
  const grouped = useMemo(
    () => groupItems(board, sortItems(filterItems(board, filters, people), board, filters.sort, people)),
    [board, filters, people],
  );
  const itemsById = useMemo(() => new Map(board.items.map((i) => [i.id, i])), [board.items]);
  const filtering = hasActiveFilters(filters);
  const visibleCount = [...grouped.values()].reduce((n, items) => n + items.length, 0);

  const style = useMemo(() => {
    const vars: Record<string, string> = { '--name-w': `${board.settings.table?.nameWidth ?? 420}px` };
    for (const c of board.columns) vars[`--col-${c.id}`] = `${c.width}px`;
    vars['--cols-w'] = `${columns.reduce((sum, c) => sum + c.width, 0)}px`;
    return vars as CSSProperties;
  }, [board.columns, board.settings.table?.nameWidth, columns]);

  const [containers, setContainers] = useState<Containers | null>(null);
  const containersRef = useRef<Containers | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const setDragState = (next: Containers | null) => {
    containersRef.current = next;
    setContainers(next);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragStart = ({ active }: DragStartEvent) => {
    actions.beginInteraction();
    setActiveId(Number(active.id));
    setDragState(Object.fromEntries(board.groups.map((g) => [g.id, (grouped.get(g.id) ?? []).map((i) => i.id)])));
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    const current = containersRef.current;
    if (!over || !current) return;
    const from = findContainer(active.id, current);
    const to = findContainer(over.id, current);
    if (from == null || to == null || from === to) return;
    const id = Number(active.id);
    const target = current[to].filter((x) => x !== id);
    const overIndex = typeof over.id === 'number' ? target.indexOf(over.id) : -1;
    const dragged = active.rect.current.translated;
    const below = dragged && over.rect ? dragged.top > over.rect.top + over.rect.height / 2 : false;
    target.splice(overIndex < 0 ? target.length : overIndex + (below ? 1 : 0), 0, id);
    setDragState({ ...current, [from]: current[from].filter((x) => x !== id), [to]: target });
  };

  const finish = () => {
    setActiveId(null);
    setDragState(null);
    actions.endInteraction();
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const current = containersRef.current;
    finish();
    if (!over || !current) return;
    const id = Number(active.id);
    const groupId = findContainer(active.id, current);
    const item = itemsById.get(id);
    if (groupId == null || !item) return;
    let ids = current[groupId];
    if (typeof over.id === 'number' && ids.includes(over.id)) ids = arrayMove(ids, ids.indexOf(id), ids.indexOf(over.id));
    const original = (grouped.get(groupId) ?? []).map((i) => i.id);
    if (item.groupId === groupId && original.join(',') === ids.join(',')) return;
    const index = ids.indexOf(id);
    const prev = itemsById.get(ids[index - 1]);
    const next = itemsById.get(ids[index + 1]);
    void actions.moveItem(id, groupId, positionBetween(prev?.position, next?.position));
  };

  const activeItem = activeId != null ? itemsById.get(activeId) : undefined;
  const activeGroup = activeItem ? board.groups.find((g) => g.id === activeItem.groupId) : undefined;

  return (
    <div className="table-scroll" style={style}>
      <div className="table">
        <DndContext
          sensors={sensors}
          collisionDetection={collision}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={finish}
        >
          {board.groups.map((group, index) => {
            const items = containers
              ? (containers[group.id] ?? []).map((id) => itemsById.get(id)).filter((i): i is Item => !!i)
              : (grouped.get(group.id) ?? []);
            if (filtering && items.length === 0) return null;
            return (
              <GroupSection
                key={group.id}
                group={group}
                items={items}
                columns={columns}
                sortable={!filters.sort}
                isFirst={index === 0}
                isLast={index === board.groups.length - 1}
                groupCount={board.groups.length}
              />
            );
          })}
          <DragOverlay dropAnimation={null}>
            {activeItem ? (
              <div className="row-preview" style={{ '--group-color': activeGroup?.color } as CSSProperties}>
                <span className="row-preview__bar" />
                <span className="ellipsis">{activeItem.name}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {filtering && visibleCount === 0 && (
          <div className="empty-state table-empty">
            <SearchX size={40} strokeWidth={1.4} />
            <h3>Nenhum item encontrado</h3>
            <p>Nenhum item corresponde à busca e aos filtros atuais.</p>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => actions.clearFilters()}>
              Limpar filtros
            </button>
          </div>
        )}

        {!filtering && (
          <button type="button" className="add-group-btn" onClick={() => void actions.createGroup('bottom')}>
            <Plus size={16} /> Adicionar novo grupo
          </button>
        )}
      </div>
    </div>
  );
}
