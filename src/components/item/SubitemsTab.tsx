import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CircleCheck, GripVertical, ListChecks, Plus, Sparkles, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Item, Subitem } from '../../../shared/types';
import { splitSteps, subitemProgress } from '../../../shared/subitems';
import { positionBetween } from '../../../shared/values';
import { cx, formatDateTime } from '../../lib/format';
import { actions, useStore } from '../../store';
import { Avatar } from '../ui/Avatar';
import { useCanInBoard } from '../../lib/permissions';
import { Checkbox } from '../ui/Checkbox';
import { EditableText } from '../ui/EditableText';
import { Tooltip } from '../ui/Tooltip';

function DoneBy({ subitem }: { subitem: Subitem }) {
  const person = useStore((s) => s.people.find((p) => p.id === subitem.doneBy));
  if (!subitem.done || !person) return null;
  const tip = `Feito por ${person.name}${subitem.doneAt ? ` · ${formatDateTime(subitem.doneAt)}` : ''}`;
  return (
    <Tooltip content={tip}>
      {person.isAgent ? (
        <span className="via-claude subitem__by">
          <Sparkles size={11} /> {person.name}
        </span>
      ) : (
        <span className="subitem__by">
          <Avatar person={person} size={22} />
        </span>
      )}
    </Tooltip>
  );
}

function SubitemRow({ itemId, subitem, canEdit }: { itemId: number; subitem: Subitem; canEdit: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: subitem.id });
  return (
    <li
      ref={setNodeRef}
      className={cx('subitem', subitem.done && 'is-done', isDragging && 'is-dragging')}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {canEdit ? (
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="subitem__handle"
          aria-label="Arrastar para reordenar"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
      ) : (
        <span className="subitem__handle" />
      )}
      <Checkbox
        checked={subitem.done}
        disabled={!canEdit}
        onChange={(done) => void actions.setSubitemDone(itemId, subitem.id, done)}
        label={subitem.done ? `Reabrir "${subitem.name}"` : `Marcar "${subitem.name}" como feito`}
      />
      <EditableText
        value={subitem.name}
        onSave={(name) => void actions.renameSubitem(itemId, subitem.id, name)}
        trigger={canEdit ? 'click' : 'none'}
        className="subitem__name"
        inputClassName="subitem__input"
      />
      <DoneBy subitem={subitem} />
      {canEdit && (
        <Tooltip content="Excluir subitem">
          <button
            type="button"
            className="icon-btn icon-btn--sm subitem__delete"
            aria-label="Excluir subitem"
            onClick={() => void actions.deleteSubitem(itemId, subitem.id)}
          >
            <X size={14} />
          </button>
        </Tooltip>
      )}
    </li>
  );
}

function AddSubitem({ itemId, startOpen, canEdit }: { itemId: number; startOpen: boolean; canEdit: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [draft, setDraft] = useState('');
  // Passos digitados em sequência (ou colados) são enviados em fila, na ordem.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const add = (text: string) => {
    const steps = splitSteps(text);
    if (!steps.length) return;
    setDraft('');
    queue.current = queue.current.then(async () => {
      const created = await actions.addSubitems(itemId, steps);
      if (!created) setDraft((current) => current || text);
    });
  };

  if (!canEdit) return null;
  if (!open) {
    return (
      <button type="button" className="subitem-add" onClick={() => setOpen(true)}>
        <Plus size={16} /> Adicionar subitem
      </button>
    );
  }

  return (
    <div className="subitem-add is-editing">
      <Plus size={16} className="subitem-add__icon" />
      <input
        autoFocus
        className="subitem-add__input"
        value={draft}
        maxLength={500}
        placeholder="Nome do passo — Enter adiciona · cole uma lista para criar vários"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft('');
            setOpen(false);
          }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (!/\r?\n/.test(text.trim())) return;
          e.preventDefault();
          add(`${draft}${text}`);
        }}
        onBlur={() => {
          // Trocar de janela (ex.: para copiar a lista de passos) não fecha o campo.
          if (!draft.trim() && document.hasFocus()) setOpen(false);
        }}
      />
    </div>
  );
}

export function SubitemsTab({ item, reference }: { item: Item; reference: string | null }) {
  const subitems = item.subitems;
  const canEdit = useCanInBoard('itens', item.boardId);
  const { done, total, complete } = subitemProgress(subitems);
  const percent = total ? Math.round((done / total) * 100) : 0;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 3 } }));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = subitems.findIndex((s) => s.id === active.id);
    const to = subitems.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;
    const moved = arrayMove(subitems, from, to);
    void actions.moveSubitem(item.id, Number(active.id), positionBetween(moved[to - 1]?.position, moved[to + 1]?.position));
  };

  return (
    <div className="subitems">
      {total > 0 ? (
        <div className={cx('subitems-progress', complete && 'is-complete')}>
          <div className="subitems-progress__head">
            <span className="subitems-progress__label">
              <strong>
                {done} de {total}
              </strong>{' '}
              {total === 1 ? 'passo feito' : 'passos feitos'}
            </span>
            {complete ? (
              <span className="subitems-progress__done">
                <CircleCheck size={14} /> Tudo pronto
              </span>
            ) : (
              <span className="subitems-progress__percent">{percent}%</span>
            )}
          </div>
          <div className="subitems-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <span style={{ width: `${percent}%` }} />
          </div>
        </div>
      ) : (
        <div className="empty-state subitems-empty">
          <ListChecks size={44} strokeWidth={1.3} />
          <h3>Quebre a tarefa em passos</h3>
          <p>
            Adicione os passos abaixo ou peça ao Claude: <em>"quebre {reference ?? 'este item'} em subitens"</em>. Ele marca cada passo ao
            concluir, e o progresso aparece na tabela e no Kanban.
          </p>
        </div>
      )}

      {total > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={subitems.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <ul className="subitem-list">
              {subitems.map((subitem) => (
                <SubitemRow key={subitem.id} itemId={item.id} subitem={subitem} canEdit={canEdit} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      <AddSubitem key={item.id} itemId={item.id} startOpen={total === 0} canEdit={canEdit} />
    </div>
  );
}
