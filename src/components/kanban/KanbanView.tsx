import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, ChevronsLeft, CircleAlert, CircleCheck, GitCommitHorizontal, MessageCircle, Plus, SquareKanban } from 'lucide-react';
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Column, Item, Person } from '../../../shared/types';
import { EMPTY_STATUS_COLOR, textColorOn, tint } from '../../../shared/colors';
import { formatItemRef, positionBetween, statusLabelOf, valueToText } from '../../../shared/values';
import { domOnly } from '../../lib/dnd';
import { cx, formatDateShort } from '../../lib/format';
import { cardColumnIdsOf, laneColumnOf } from '../../lib/kanban';
import { filterItems, sortItems } from '../../lib/view';
import { navigate } from '../../router';
import { actions, useStore } from '../../store';
import { activateOnKey } from '../cells/Cell';
import { SubitemsChip } from '../item/SubitemsChip';
import { ColumnTypeIcon } from '../cells/columnMeta';
import { dueState } from '../cells/DateCell';
import { AvatarStack } from '../ui/Avatar';
import { Tooltip } from '../ui/Tooltip';
import './kanban.css';

interface Lane {
  key: string;
  labelId: number | null;
  name: string;
  color: string;
}

type Containers = Record<string, number[]>;

const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length) {
    const item = hits.find((h) => typeof h.id === 'number');
    return item ? [item] : hits;
  }
  return closestCorners(args);
};

function findLane(id: UniqueIdentifier, containers: Containers): string | null {
  if (typeof id === 'string' && id.startsWith('lane-')) return id.slice(5);
  for (const [key, ids] of Object.entries(containers)) if (ids.includes(Number(id))) return key;
  return null;
}

function CardField({ column, item, columns, people }: { column: Column; item: Item; columns: Column[]; people: Person[] }) {
  const value = item.values[String(column.id)];
  let content: ReactNode = null;
  switch (column.type) {
    case 'status': {
      const label = statusLabelOf(column, value);
      if (label)
        content = (
          <span className="kchip" style={{ background: label.color, color: textColorOn(label.color) }}>
            {label.name || ' '}
          </span>
        );
      break;
    }
    case 'people': {
      const assigned = ((value as number[] | undefined) ?? []).map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p);
      if (assigned.length) content = <AvatarStack people={assigned} size={22} max={4} />;
      break;
    }
    case 'date': {
      if (typeof value === 'string') {
        const state = dueState(columns, item, value);
        content = (
          <span className={cx('kdate', state && `is-${state}`)}>
            {state === 'overdue' && <CircleAlert size={13} />}
            {state === 'done' && <CircleCheck size={13} />}
            {formatDateShort(value)}
          </span>
        );
      }
      break;
    }
    case 'checkbox':
      if (value === true) content = <Check size={16} strokeWidth={3} className="kcheck" />;
      break;
    case 'auto_number':
      content = formatItemRef(column.settings, item.number);
      break;
    default: {
      const text = valueToText(column, value, { people });
      if (text)
        content = (
          <span className="ellipsis" title={text}>
            {text}
          </span>
        );
    }
  }
  return (
    <div className="kcard__field">
      <span className="kcard__field-label">
        <ColumnTypeIcon type={column.type} size={13} />
        <span className="ellipsis">{column.title}</span>
      </span>
      <span className="kcard__field-value">{content ?? <span className="kcard__empty">—</span>}</span>
    </div>
  );
}

export function KanbanCard({ item, cardColumns, overlay }: { item: Item; cardColumns: Column[]; overlay?: boolean }) {
  const board = useStore((s) => s.board)!;
  const people = useStore((s) => s.people);
  const group = board.groups.find((g) => g.id === item.groupId);
  const refColumn = board.columns.find((c) => c.type === 'auto_number');
  const open = () => navigate({ itemId: item.id });
  return (
    <div className={cx('kcard', overlay && 'kcard--overlay')} role="button" tabIndex={0} onClick={open} onKeyDown={activateOnKey(open)}>
      <div className="kcard__meta">
        {group && (
          <span className="kcard__group">
            <span className="kcard__group-dot" style={{ background: group.color }} />
            <span className="ellipsis">{group.name}</span>
          </span>
        )}
        {refColumn && <span className="kcard__ref">{formatItemRef(refColumn.settings, item.number)}</span>}
      </div>
      <div className="kcard__name">{item.name}</div>
      {cardColumns.length > 0 && (
        <div className="kcard__fields">
          {cardColumns.map((column) => (
            <CardField key={column.id} column={column} item={item} columns={board.columns} people={people} />
          ))}
        </div>
      )}
      {(item.updatesCount > 0 || item.commitsCount > 0 || item.subitems.length > 0) && (
        <div className="kcard__footer">
          <SubitemsChip item={item} />
          {item.commitsCount > 0 && (
            <span className="kcard__commits" title="Commits ligados">
              <GitCommitHorizontal size={14} /> {item.commitsCount}
            </span>
          )}
          {item.updatesCount > 0 && (
            <span className="kcard__updates" title="Atualizações">
              <MessageCircle size={14} /> {item.updatesCount}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SortableCard({ item, cardColumns }: { item: Item; cardColumns: Column[] }) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      className={cx('kcard-wrap', isDragging && 'is-dragging')}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...domOnly(listeners)}
    >
      <KanbanCard item={item} cardColumns={cardColumns} />
    </div>
  );
}

function LaneAddItem({ lane, laneColumn }: { lane: Lane; laneColumn: Column }) {
  const groupId = useStore((s) => s.board?.groups[0]?.id);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const submit = async () => {
    const value = name.trim();
    if (!value || groupId == null) return;
    setName('');
    await actions.createItem(groupId, value, {
      position: 'bottom',
      kanbanPosition: 'bottom',
      values: lane.labelId != null ? { [String(laneColumn.id)]: lane.labelId } : undefined,
    });
  };

  if (!adding) {
    return (
      <button type="button" className="lane__add" onClick={() => setAdding(true)}>
        <Plus size={16} /> Adicionar item
      </button>
    );
  }
  return (
    <div className="lane__add-form">
      <input
        autoFocus
        className="input input--sm"
        placeholder="Nome do item"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
          if (e.key === 'Escape') {
            setName('');
            setAdding(false);
          }
        }}
        onBlur={() => {
          if (name.trim()) void submit();
          setAdding(false);
        }}
      />
    </div>
  );
}

function toggleLane(key: string) {
  const current = useStore.getState().board?.settings.kanban?.collapsedLanes ?? [];
  void actions.updateKanbanSettings({
    collapsedLanes: current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
  });
}

function KanbanLane({
  lane,
  items,
  collapsed,
  cardColumns,
  laneColumn,
}: {
  lane: Lane;
  items: Item[];
  collapsed: boolean;
  cardColumns: Column[];
  laneColumn: Column;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `lane-${lane.key}` });
  const style = {
    '--lane-color': lane.color,
    '--lane-tint': tint(lane.color, 0.9),
    '--lane-text': textColorOn(lane.color),
  } as CSSProperties;
  const name = lane.name || 'Sem nome';

  if (collapsed) {
    return (
      <div ref={setNodeRef} className={cx('lane lane--collapsed', isOver && 'is-over')} style={style}>
        <button type="button" className="lane__collapsed" onClick={() => toggleLane(lane.key)} title={`Expandir ${name}`}>
          <span className="lane__collapsed-count">{items.length}</span>
          <span className="lane__collapsed-name">{name}</span>
        </button>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} className={cx('lane', isOver && 'is-over')} style={style}>
      <div className="lane__head">
        <span className="lane__name ellipsis">{name}</span>
        <span className="lane__count">{items.length}</span>
        <Tooltip content="Recolher raia">
          <button type="button" className="lane__collapse" onClick={() => toggleLane(lane.key)} aria-label="Recolher raia">
            <ChevronsLeft size={16} />
          </button>
        </Tooltip>
      </div>
      <div className="lane__body">
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <SortableCard key={item.id} item={item} cardColumns={cardColumns} />
          ))}
        </SortableContext>
        {items.length === 0 && <div className="lane__empty">Solte itens aqui</div>}
      </div>
      <div className="lane__foot">
        <LaneAddItem lane={lane} laneColumn={laneColumn} />
      </div>
    </div>
  );
}

export function KanbanView() {
  const board = useStore((s) => s.board)!;
  const people = useStore((s) => s.people);
  const filters = useStore((s) => s.filters);
  const laneColumn = laneColumnOf(board);
  const collapsed = board.settings.kanban?.collapsedLanes ?? [];

  const cardColumns = useMemo(
    () =>
      cardColumnIdsOf(board, laneColumn)
        .map((id) => board.columns.find((c) => c.id === id))
        .filter((c): c is Column => !!c),
    [board, laneColumn],
  );

  const lanes = useMemo<Lane[]>(
    () =>
      laneColumn
        ? [
            ...(laneColumn.settings.labels ?? []).map((l) => ({ key: String(l.id), labelId: l.id, name: l.name, color: l.color })),
            { key: 'none', labelId: null, name: 'Sem status', color: EMPTY_STATUS_COLOR },
          ]
        : [],
    [laneColumn],
  );

  const visible = useMemo(() => {
    const filtered = filterItems(board, filters, people);
    return filters.sort
      ? sortItems(filtered, board, filters.sort, people)
      : [...filtered].sort((a, b) => a.kanbanPosition - b.kanbanPosition || a.id - b.id);
  }, [board, filters, people]);

  const byLane = useMemo(() => {
    const map: Containers = Object.fromEntries(lanes.map((l) => [l.key, [] as number[]]));
    if (laneColumn) {
      for (const item of visible) {
        const label = statusLabelOf(laneColumn, item.values[String(laneColumn.id)]);
        (map[label ? String(label.id) : 'none'] ??= []).push(item.id);
      }
    }
    return map;
  }, [visible, lanes, laneColumn]);

  const itemsById = useMemo(() => new Map(board.items.map((i) => [i.id, i])), [board.items]);
  const [containers, setContainers] = useState<Containers | null>(null);
  const containersRef = useRef<Containers | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  if (!laneColumn) {
    return (
      <div className="empty-state kanban-empty">
        <SquareKanban size={44} strokeWidth={1.3} />
        <h3>O Kanban precisa de uma coluna de status</h3>
        <p>As raias do Kanban são as etiquetas de uma coluna de status. Crie uma para começar.</p>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => void actions.createColumn('status')}>
          Criar coluna de status
        </button>
      </div>
    );
  }

  const setDragState = (next: Containers | null) => {
    containersRef.current = next;
    setContainers(next);
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    actions.beginInteraction();
    setActiveId(Number(active.id));
    setDragState({ ...byLane });
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    const current = containersRef.current;
    if (!over || !current) return;
    const from = findLane(active.id, current);
    const to = findLane(over.id, current);
    if (from == null || to == null || from === to) return;
    const id = Number(active.id);
    const target = (current[to] ?? []).filter((x) => x !== id);
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
    const key = findLane(active.id, current);
    const lane = lanes.find((l) => l.key === key);
    if (key == null || !lane || !itemsById.has(id)) return;
    let ids = current[key];
    if (typeof over.id === 'number' && ids.includes(over.id)) ids = arrayMove(ids, ids.indexOf(id), ids.indexOf(over.id));
    if (findLane(id, byLane) === key && byLane[key].join(',') === ids.join(',')) return;
    const index = ids.indexOf(id);
    const prev = itemsById.get(ids[index - 1]);
    const next = itemsById.get(ids[index + 1]);
    void actions.moveItemInKanban(id, laneColumn.id, lane.labelId, positionBetween(prev?.kanbanPosition, next?.kanbanPosition));
  };

  const source = containers ?? byLane;
  const activeItem = activeId != null ? itemsById.get(activeId) : undefined;

  return (
    <div className="kanban-scroll">
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={finish}
      >
        <div className="kanban">
          {lanes.map((lane) => {
            const ids = source[lane.key] ?? [];
            if (lane.key === 'none' && ids.length === 0 && activeId == null) return null;
            return (
              <KanbanLane
                key={lane.key}
                lane={lane}
                items={ids.map((id) => itemsById.get(id)).filter((i): i is Item => !!i)}
                collapsed={collapsed.includes(lane.key)}
                cardColumns={cardColumns}
                laneColumn={laneColumn}
              />
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeItem ? <KanbanCard item={activeItem} cardColumns={cardColumns} overlay /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
