import { Check, Pencil, Plus } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import type { Column, Item } from '../../../shared/types';
import { MAX_ITEM_NUMBER, formatItemRef, formatNumber } from '../../../shared/values';
import { cx } from '../../lib/format';
import { useCanInBoard } from '../../lib/permissions';
import { actions, toast } from '../../store';
import { Tooltip } from '../ui/Tooltip';
import { CellInput } from './CellInput';
import { DateCell } from './DateCell';
import { LinkCell } from './LinkCell';
import { LongTextCell } from './LongTextCell';
import { PeopleCell } from './PeopleCell';
import { StatusCell } from './StatusCell';
import './cells.css';

export interface CellProps {
  item: Item;
  column: Column;
  variant?: 'table' | 'panel';
  /** colunas do quadro do item, quando ele aparece fora do quadro aberto (ex.: "Meu trabalho") */
  columns?: Column[];
}

/** Ativa com Enter/Espaço quando a célula tem foco pelo teclado. */
export const activateOnKey = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

function TextCell({ item, column }: CellProps) {
  const value = (item.values[String(column.id)] as string | undefined) ?? '';
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <CellInput
        initial={value}
        onCancel={() => setEditing(false)}
        onCommit={(next) => {
          setEditing(false);
          if (next !== value) void actions.setValue(item.id, column.id, next || null);
        }}
      />
    );
  }
  return (
    <div
      className="cell-btn text-cell"
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={activateOnKey(() => setEditing(true))}
      title={value}
    >
      {value ? <span className="ellipsis">{value}</span> : <Pencil size={14} className="cell-hint" />}
    </div>
  );
}

function NumberCell({ item, column }: CellProps) {
  const value = item.values[String(column.id)] as number | undefined;
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <CellInput
        numeric
        initial={value != null ? String(value).replace('.', ',') : ''}
        onCancel={() => setEditing(false)}
        onCommit={(raw) => {
          setEditing(false);
          if (!raw) {
            if (value != null) void actions.setValue(item.id, column.id, null);
            return;
          }
          const n = Number(raw.replace(/\./g, '').replace(',', '.'));
          const parsed = Number.isFinite(n) ? n : Number(raw);
          if (!Number.isFinite(parsed)) {
            toast(`"${raw}" não é um número válido.`, 'error');
            return;
          }
          if (parsed !== value) void actions.setValue(item.id, column.id, parsed);
        }}
      />
    );
  }
  return (
    <div
      className="cell-btn number-cell"
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={activateOnKey(() => setEditing(true))}
    >
      {value != null ? <span className="ellipsis">{formatNumber(column.settings, value)}</span> : <Plus size={14} className="cell-hint" />}
    </div>
  );
}

function CheckboxCell({ item, column }: CellProps) {
  const checked = item.values[String(column.id)] === true;
  const toggle = () => void actions.setValue(item.id, column.id, checked ? null : true);
  return (
    <div
      className="cell-btn checkbox-cell"
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={toggle}
      onKeyDown={activateOnKey(toggle)}
    >
      <span className={cx('checkbox-cell__box', checked && 'is-checked')}>{checked && <Check size={16} strokeWidth={3} />}</span>
    </div>
  );
}

/** Edita o número do item (a parte depois do prefixo). Aceita "7", "07" ou "TM-07". */
function ItemNumberInput({ item, column, onDone }: { item: Item; column: Column; onDone: () => void }) {
  const prefix = column.settings.prefix?.trim();
  const [draft, setDraft] = useState(String(item.number).padStart(column.settings.pad ?? 3, '0'));
  const settled = useRef(false);
  const finish = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    onDone();
    const raw = draft.trim().replace(/^[A-Za-z0-9_]*-/, '');
    if (!save || !raw) return;
    const number = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(number) || number < 1 || number > MAX_ITEM_NUMBER) {
      toast(`"${draft.trim()}" não é um número de item válido.`, 'error');
      return;
    }
    if (number !== item.number) void actions.setItemNumber(item.id, number);
  };
  return (
    <div className="auto-number-edit" onClick={(e) => e.stopPropagation()}>
      {prefix && <span className="auto-number-edit__prefix">{prefix}-</span>}
      <input
        autoFocus
        className="auto-number-edit__input"
        value={draft}
        inputMode="numeric"
        aria-label="Número do item"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(true);
          else if (e.key === 'Escape') finish(false);
        }}
      />
    </div>
  );
}

function AutoNumberCell({ item, column, variant = 'table' }: CellProps) {
  const [editing, setEditing] = useState(false);
  const ref = formatItemRef(column.settings, item.number);
  if (editing) return <ItemNumberInput item={item} column={column} onDone={() => setEditing(false)} />;
  const copy = () => {
    void navigator.clipboard?.writeText(ref).then(() => toast(`${ref} copiado.`, 'success', undefined, 2000));
  };
  return (
    <div className={cx('auto-number-cell', variant === 'panel' && 'auto-number-cell--panel')}>
      <button type="button" className="auto-number-cell__copy" onClick={copy} title="Clique para copiar">
        {ref}
      </button>
      <Tooltip content="Alterar o número">
        <button type="button" className="auto-number-cell__edit" onClick={() => setEditing(true)} aria-label={`Alterar o número de ${ref}`}>
          <Pencil size={13} />
        </button>
      </Tooltip>
    </div>
  );
}

export function Cell(props: CellProps) {
  const editable = useCanInBoard('itens', props.item.boardId);
  const cell = renderCell(props);
  // display: contents — o invólucro some do layout e só bloqueia o clique.
  return editable ? (
    cell
  ) : (
    <div className="cell-readonly" title="Você tem acesso de leitura neste projeto">
      {cell}
    </div>
  );
}

function renderCell(props: CellProps) {
  switch (props.column.type) {
    case 'status':
      return <StatusCell {...props} />;
    case 'people':
      return <PeopleCell {...props} />;
    case 'date':
      return <DateCell {...props} />;
    case 'number':
      return <NumberCell {...props} />;
    case 'checkbox':
      return <CheckboxCell {...props} />;
    case 'link':
      return <LinkCell {...props} />;
    case 'long_text':
      return <LongTextCell {...props} />;
    case 'auto_number':
      return <AutoNumberCell {...props} />;
    default:
      return <TextCell {...props} />;
  }
}
