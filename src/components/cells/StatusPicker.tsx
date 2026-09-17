import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Pencil, Plus, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { Column, StatusLabel } from '../../../shared/types';
import { EMPTY_STATUS_COLOR, LABEL_COLORS, textColorOn } from '../../../shared/colors';
import { fold } from '../../../shared/values';
import { cx, plural } from '../../lib/format';
import { actions, useStore } from '../../store';
import { ColorPalette } from '../ui/ColorPalette';
import { Tooltip } from '../ui/Tooltip';

export function StatusPicker({
  column,
  value,
  onPick,
}: {
  column: Column;
  value: number | null;
  onPick: (labelId: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  // Editar etiquetas usa o quadro aberto (contagem de uso); fora dele (ex.: "Meu trabalho") só dá para escolher.
  const canEdit = useStore((s) => s.board?.id === column.boardId);
  const labels = column.settings.labels ?? [];
  if (editing) return <LabelEditor column={column} onDone={() => setEditing(false)} />;
  return (
    <div className="status-picker">
      <div className={cx('status-picker__grid', labels.length > 7 && 'is-two-cols')}>
        {labels.map((label) => (
          <button
            key={label.id}
            type="button"
            className={cx('status-picker__label', label.id === value && 'is-selected')}
            style={{ background: label.color, color: textColorOn(label.color) }}
            onClick={() => onPick(label.id)}
          >
            <span className="ellipsis">{label.name || ' '}</span>
          </button>
        ))}
        {value != null && (
          <button
            type="button"
            className="status-picker__label status-picker__label--clear"
            style={{ background: EMPTY_STATUS_COLOR }}
            onClick={() => onPick(null)}
            aria-label="Limpar"
            title="Limpar"
          />
        )}
      </div>
      {canEdit && (
        <div className="status-picker__footer">
          <button type="button" className="btn btn--tertiary btn--sm" onClick={() => setEditing(true)}>
            <Pencil size={14} /> Editar etiquetas
          </button>
        </div>
      )}
    </div>
  );
}

function LabelRow({
  label,
  usage,
  paletteOpen,
  onChange,
  onRemove,
  onTogglePalette,
}: {
  label: StatusLabel;
  usage: number;
  paletteOpen: boolean;
  onChange: (patch: Partial<StatusLabel>) => void;
  onRemove: () => void;
  onTogglePalette: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: label.id });
  return (
    <div
      ref={setNodeRef}
      className={cx('label-row', isDragging && 'is-dragging')}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <div className="label-row__main">
        <button type="button" className="label-row__grip" aria-label="Arrastar para reordenar" {...attributes} {...listeners}>
          <GripVertical size={14} />
        </button>
        <button
          type="button"
          className="label-row__swatch"
          style={{ background: label.color }}
          onClick={onTogglePalette}
          aria-label="Escolher cor"
        />
        <input
          className="label-row__input"
          value={label.name}
          placeholder="Nome da etiqueta"
          maxLength={60}
          autoFocus={label.id < 0}
          onChange={(e) => onChange({ name: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <Tooltip content={usage > 0 ? `Em uso por ${plural(usage, 'item', 'itens')}` : 'Remover etiqueta'}>
          <span>
            <button type="button" className="icon-btn icon-btn--sm" disabled={usage > 0} onClick={onRemove} aria-label="Remover">
              <X size={14} />
            </button>
          </span>
        </Tooltip>
      </div>
      {paletteOpen && (
        <ColorPalette
          value={label.color}
          onSelect={(color) => {
            onChange({ color });
            onTogglePalette();
          }}
        />
      )}
    </div>
  );
}

export function LabelEditor({ column, onDone }: { column: Column; onDone: () => void }) {
  const items = useStore((s) => s.board?.items);
  const usage = useMemo(() => {
    const counts = new Map<number, number>();
    for (const item of items ?? []) {
      const value = item.values[String(column.id)];
      if (typeof value === 'number') counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  }, [items, column.id]);
  const [labels, setLabels] = useState<StatusLabel[]>(() => (column.settings.labels ?? []).map((l) => ({ ...l })));
  const [palette, setPalette] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const tempId = useRef(-1);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 3 } }));

  const duplicate = useMemo(() => {
    const seen = new Set<string>();
    for (const label of labels) {
      const key = fold(label.name);
      if (!key) continue;
      if (seen.has(key)) return label.name.trim();
      seen.add(key);
    }
    return null;
  }, [labels]);

  const change = (id: number, patch: Partial<StatusLabel>) => setLabels((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const add = () => {
    const used = new Set(labels.map((l) => l.color));
    const color = LABEL_COLORS.find((c) => !used.has(c)) ?? LABEL_COLORS[labels.length % LABEL_COLORS.length];
    setLabels((ls) => [...ls, { id: tempId.current--, name: '', color }]);
  };

  const save = async () => {
    setSaving(true);
    const result = await actions.updateColumn(column.id, {
      settings: { labels: labels.map((l) => ({ ...l, name: l.name.trim(), id: l.id > 0 ? l.id : 0 })) },
    });
    setSaving(false);
    if (result) onDone();
  };

  return (
    <div className="label-editor">
      <div className="label-editor__title">Editar etiquetas</div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (!over || active.id === over.id) return;
          setLabels((ls) =>
            arrayMove(
              ls,
              ls.findIndex((l) => l.id === active.id),
              ls.findIndex((l) => l.id === over.id),
            ),
          );
        }}
      >
        <SortableContext items={labels.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          <div className="label-editor__list">
            {labels.map((label) => (
              <LabelRow
                key={label.id}
                label={label}
                usage={usage.get(label.id) ?? 0}
                paletteOpen={palette === label.id}
                onChange={(patch) => change(label.id, patch)}
                onRemove={() => setLabels((ls) => ls.filter((l) => l.id !== label.id))}
                onTogglePalette={() => setPalette((p) => (p === label.id ? null : label.id))}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button type="button" className="btn btn--tertiary btn--sm label-editor__add" onClick={add}>
        <Plus size={14} /> Nova etiqueta
      </button>
      {duplicate && <div className="form-error">A etiqueta "{duplicate}" está repetida.</div>}
      <div className="label-editor__footer">
        <button type="button" className="btn btn--tertiary btn--sm" onClick={onDone}>
          Cancelar
        </button>
        <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={saving || !!duplicate}>
          Aplicar
        </button>
      </div>
    </div>
  );
}
