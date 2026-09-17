import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, ChevronRight, Ellipsis, EyeOff, Pencil, Plus, Settings2, Trash, Type } from 'lucide-react';
import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Column, ColumnSettings } from '../../../shared/types';
import { COLUMN_TYPE_LABELS, formatItemRef, formatNumber } from '../../../shared/values';
import { domOnly } from '../../lib/dnd';
import { cx } from '../../lib/format';
import { actions, useStore } from '../../store';
import { ColumnTypePicker } from '../cells/columnMeta';
import { LabelEditor } from '../cells/StatusPicker';
import { IdFormatFields, parseItemNumber, type IdFormatDraft } from '../shell/IdFormatFields';
import { Checkbox } from '../ui/Checkbox';
import { EditableText } from '../ui/EditableText';
import { Menu, MenuDivider, MenuItem, MenuTitle } from '../ui/Menu';
import { PopoverPanel, usePopover } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';

// Seletores do store precisam devolver sempre a mesma referência quando nada mudou.
const NO_IDS: number[] = [];

/** Alça para redimensionar a coluna (atualiza a variável CSS ao vivo e salva ao soltar). */
function ResizeHandle({ target }: { target: number | 'name' }) {
  const onPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const root = (e.currentTarget as HTMLElement).closest('.table-scroll') as HTMLElement | null;
    if (!root) return;
    const variable = target === 'name' ? '--name-w' : `--col-${target}`;
    const start = e.clientX;
    const initial = parseFloat(getComputedStyle(root).getPropertyValue(variable)) || 140;
    const min = target === 'name' ? 220 : 72;
    let width = initial;
    actions.beginInteraction();
    document.body.classList.add('is-resizing');
    const move = (ev: PointerEvent) => {
      width = Math.round(Math.min(900, Math.max(min, initial + ev.clientX - start)));
      root.style.setProperty(variable, `${width}px`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('is-resizing');
      actions.endInteraction();
      if (width === Math.round(initial)) return;
      if (target === 'name') void actions.updateTableSettings({ nameWidth: width });
      else void actions.updateColumn(target, { width });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      className="col-resizer no-drag"
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionar coluna"
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}

function NumberColumnSettings({ column, onDone }: { column: Column; onDone: () => void }) {
  const [unit, setUnit] = useState(column.settings.unit ?? '');
  const [unitPosition, setUnitPosition] = useState<'left' | 'right'>(column.settings.unitPosition ?? 'right');
  const [decimals, setDecimals] = useState(column.settings.decimals != null ? String(column.settings.decimals) : '');
  const settings: ColumnSettings = { unit, unitPosition, decimals: decimals === '' ? null : Number(decimals) };

  return (
    <form
      className="column-settings"
      onSubmit={(e) => {
        e.preventDefault();
        void actions.updateColumn(column.id, { settings }).then(onDone);
      }}
    >
      <div className="column-settings__title">Configurar "{column.title}"</div>
      <label className="field-label" htmlFor="col-unit">
        Unidade
      </label>
      <input
        id="col-unit"
        autoFocus
        className="input input--sm"
        placeholder="Ex.: R$, h, %"
        value={unit}
        onChange={(e) => setUnit(e.target.value.slice(0, 12))}
      />
      <div className="column-settings__row">
        <div className="segmented">
          <button type="button" className={cx(unitPosition === 'left' && 'is-active')} onClick={() => setUnitPosition('left')}>
            Antes
          </button>
          <button type="button" className={cx(unitPosition === 'right' && 'is-active')} onClick={() => setUnitPosition('right')}>
            Depois
          </button>
        </div>
        <select className="input input--sm" value={decimals} onChange={(e) => setDecimals(e.target.value)} aria-label="Casas decimais">
          <option value="">Decimais: auto</option>
          {[0, 1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? 'casa' : 'casas'}
            </option>
          ))}
        </select>
      </div>
      <div className="column-settings__preview">
        Exemplo: <strong>{formatNumber(settings, 1234.5)}</strong>
      </div>
      <div className="column-settings__actions">
        <button type="button" className="btn btn--tertiary btn--sm" onClick={onDone}>
          Cancelar
        </button>
        <button type="submit" className="btn btn--primary btn--sm">
          Salvar
        </button>
      </div>
    </form>
  );
}

/** Coluna "ID do item": prefixo, dígitos e o número do próximo item (para continuar uma numeração, ex.: TM-38). */
function IdColumnSettings({ column, onDone }: { column: Column; onDone: () => void }) {
  const board = useStore((s) => s.board)!;
  const maxUsed = useMemo(() => board.items.reduce((max, i) => Math.max(max, i.number), 0), [board.items]);
  const initialNext = Math.max(board.nextItemNumber, maxUsed + 1);
  const [draft, setDraft] = useState<IdFormatDraft>({
    prefix: column.settings.prefix ?? '',
    pad: column.settings.pad ?? 3,
    start: String(initialNext),
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const settings = { prefix: draft.prefix, pad: draft.pad };

  const save = async () => {
    const next = parseItemNumber(draft.start);
    if (next == null) return setError('Informe um número inteiro a partir de 1.');
    if (next <= maxUsed) return setError(`Já existe ${formatItemRef(settings, maxUsed)} — o próximo precisa ser ${maxUsed + 1} ou mais.`);
    setSaving(true);
    const saved = await actions.updateColumn(column.id, { settings });
    const nextOk = !!saved && (next === initialNext || (await actions.setNextItemNumber(board.id, next)));
    setSaving(false);
    if (nextOk) onDone();
  };

  return (
    <form
      className="column-settings column-settings--id"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="column-settings__title">Referência dos itens</div>
      <p className="column-settings__lead">Vindo de outra ferramenta? Use o mesmo prefixo e continue a numeração de lá.</p>
      <IdFormatFields
        value={draft}
        onChange={(value) => {
          setDraft(value);
          setError(null);
        }}
        startLabel="Próximo número"
        previewLabel="Próximo item"
        footer={maxUsed > 0 && <span className="id-format__used"> · maior em uso: {formatItemRef(settings, maxUsed)}</span>}
      />
      <p className="column-settings__hint">O número de um item específico muda no lápis da própria célula de ID.</p>
      {error && <div className="form-error">{error}</div>}
      <div className="column-settings__actions">
        <button type="button" className="btn btn--tertiary btn--sm" onClick={onDone}>
          Cancelar
        </button>
        <button type="submit" className="btn btn--primary btn--sm" disabled={saving}>
          Salvar
        </button>
      </div>
    </form>
  );
}

function ColumnMenu({ column, onRename, onClose }: { column: Column; onRename: () => void; onClose: () => void }) {
  const [view, setView] = useState<'main' | 'labels' | 'settings' | 'add'>('main');
  const hidden = useStore((s) => s.board?.settings.table?.hiddenColumnIds ?? NO_IDS);
  if (view === 'labels') return <LabelEditor column={column} onDone={onClose} />;
  if (view === 'settings')
    return column.type === 'auto_number' ? (
      <IdColumnSettings column={column} onDone={onClose} />
    ) : (
      <NumberColumnSettings column={column} onDone={onClose} />
    );
  if (view === 'add')
    return (
      <ColumnTypePicker
        onPick={(type) => {
          onClose();
          void actions.createColumn(type, column.id);
        }}
      />
    );
  const run = (fn: () => unknown) => () => {
    onClose();
    void fn();
  };
  return (
    <Menu>
      <MenuTitle>{COLUMN_TYPE_LABELS[column.type]}</MenuTitle>
      {column.type === 'status' && <MenuItem icon={<Pencil size={16} />} label="Editar etiquetas" onClick={() => setView('labels')} />}
      {column.type === 'auto_number' && (
        <MenuItem icon={<Settings2 size={16} />} label="Prefixo e numeração" onClick={() => setView('settings')} />
      )}
      {column.type === 'number' && (
        <MenuItem icon={<Settings2 size={16} />} label="Configurações da coluna" onClick={() => setView('settings')} />
      )}
      <MenuItem icon={<Type size={16} />} label="Renomear" onClick={onRename} />
      <MenuItem
        icon={<ArrowUp size={16} />}
        label="Ordenar crescente"
        onClick={run(() => actions.setFilters({ sort: { columnId: column.id, dir: 'asc' } }))}
      />
      <MenuItem
        icon={<ArrowDown size={16} />}
        label="Ordenar decrescente"
        onClick={run(() => actions.setFilters({ sort: { columnId: column.id, dir: 'desc' } }))}
      />
      <MenuItem
        icon={<EyeOff size={16} />}
        label="Ocultar coluna"
        onClick={run(() => actions.updateTableSettings({ hiddenColumnIds: [...hidden, column.id] }))}
      />
      <MenuItem
        icon={<Plus size={16} />}
        label="Adicionar coluna à direita"
        end={<ChevronRight size={14} />}
        onClick={() => setView('add')}
      />
      <MenuDivider />
      <MenuItem
        icon={<Trash size={16} />}
        label="Excluir coluna"
        danger
        onClick={run(() =>
          actions.confirm({
            title: 'Excluir coluna?',
            message: `A coluna "${column.title}" e todos os valores dela serão excluídos permanentemente.`,
            confirmLabel: 'Excluir coluna',
            danger: true,
            onConfirm: () => actions.deleteColumn(column.id),
          }),
        )}
      />
    </Menu>
  );
}

function ColumnHeaderCell({ sortableId, column }: { sortableId: string; column: Column }) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: sortableId });
  const [editing, setEditing] = useState(false);
  const menu = usePopover({ placement: 'bottom-end' });
  return (
    <>
      <div
        ref={setNodeRef}
        className={cx('hcell', isDragging && 'is-dragging')}
        style={{ width: `var(--col-${column.id})`, transform: CSS.Translate.toString(transform), transition }}
        {...domOnly(listeners)}
      >
        <EditableText
          value={column.title}
          onSave={(title) => void actions.updateColumn(column.id, { title })}
          editing={editing}
          onEditingChange={setEditing}
          trigger="doubleClick"
          className="hcell__title"
          inputClassName="hcell__input"
          maxLength={80}
        />
        <button
          ref={menu.refs.setReference}
          {...menu.getReferenceProps({ onClick: () => menu.setOpen(!menu.open) })}
          type="button"
          className={cx('icon-btn icon-btn--sm hcell__menu', menu.open && 'is-open')}
          aria-label={`Opções da coluna ${column.title}`}
        >
          <Ellipsis size={16} />
        </button>
        <ResizeHandle target={column.id} />
      </div>
      <PopoverPanel popover={menu}>
        <ColumnMenu
          column={column}
          onClose={() => menu.setOpen(false)}
          onRename={() => {
            menu.setOpen(false);
            setEditing(true);
          }}
        />
      </PopoverPanel>
    </>
  );
}

function ColumnHeaders({ columns }: { columns: Column[] }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const ids = columns.map((c) => `col-${c.id}`);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    actions.endInteraction();
    if (!over || active.id === over.id) return;
    const reordered = arrayMove(columns, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    const index = reordered.findIndex((c) => `col-${c.id}` === active.id);
    void actions.moveColumn(reordered[index].id, reordered[index - 1]?.id ?? null, reordered[index + 1]?.id ?? null);
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={() => actions.beginInteraction()}
      onDragCancel={() => actions.endInteraction()}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
        {columns.map((column, i) => (
          <ColumnHeaderCell key={column.id} sortableId={ids[i]} column={column} />
        ))}
      </SortableContext>
    </DndContext>
  );
}

function AddColumnCell({ lastColumnId }: { lastColumnId: number | null }) {
  const popover = usePopover({ placement: 'bottom-end' });
  return (
    <div className="hcell hcell--add">
      <Tooltip content="Adicionar coluna">
        <button
          ref={popover.refs.setReference}
          {...popover.getReferenceProps({ onClick: () => popover.setOpen(!popover.open) })}
          type="button"
          className={cx('icon-btn icon-btn--sm', popover.open && 'is-active')}
          aria-label="Adicionar coluna"
        >
          <Plus size={18} />
        </button>
      </Tooltip>
      <PopoverPanel popover={popover}>
        <ColumnTypePicker
          onPick={(type) => {
            popover.setOpen(false);
            void actions.createColumn(type, lastColumnId);
          }}
        />
      </PopoverPanel>
    </div>
  );
}

export function HeaderRow({ columns, itemIds }: { columns: Column[]; itemIds: number[] }) {
  const selection = useStore((s) => s.selection);
  const itemTitle = useStore((s) => s.board?.settings.table?.itemColumnTitle) || 'Item';
  const selected = itemIds.filter((id) => selection.includes(id)).length;
  return (
    <div className="hrow">
      <div className="row-sticky">
        <div className="row-gutter" />
        <div className="cell cell--bar" />
        <div className="cell cell--check">
          <Checkbox
            checked={itemIds.length > 0 && selected === itemIds.length}
            indeterminate={selected > 0 && selected < itemIds.length}
            disabled={itemIds.length === 0}
            onChange={(checked) => actions.setSelected(itemIds, checked)}
            label="Selecionar todos os itens do grupo"
          />
        </div>
        <div className="hcell hcell--name">
          <EditableText
            value={itemTitle}
            onSave={(title) => void actions.updateTableSettings({ itemColumnTitle: title })}
            trigger="doubleClick"
            className="hcell__title"
            inputClassName="hcell__input"
            maxLength={40}
          />
          <ResizeHandle target="name" />
        </div>
      </div>
      <ColumnHeaders columns={columns} />
      <AddColumnCell lastColumnId={columns.at(-1)?.id ?? null} />
    </div>
  );
}
