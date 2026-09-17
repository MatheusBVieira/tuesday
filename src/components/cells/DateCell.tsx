import { Calendar, CircleAlert, CircleCheck } from 'lucide-react';
import type { Column, Item } from '../../../shared/types';
import { isItemDone } from '../../../shared/values';
import { cx, daysFromToday, formatDateLong, formatDateShort } from '../../lib/format';
import { actions, useStore } from '../../store';
import { DatePicker } from '../ui/DatePicker';
import { PopoverPanel, usePopover } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';
import type { CellProps } from './Cell';

export function dueState(columns: Column[], item: Item, iso: string): 'done' | 'overdue' | 'today' | null {
  if (isItemDone(columns, item)) return 'done';
  const days = daysFromToday(iso);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  return null;
}

// Seletores do store precisam devolver sempre a mesma referência quando nada mudou.
const NO_COLUMNS: Column[] = [];

export function DateCell({ item, column, variant = 'table', columns: boardColumns }: CellProps) {
  const storeColumns = useStore((s) => s.board?.columns ?? NO_COLUMNS);
  const columns = boardColumns ?? storeColumns;
  const value = (item.values[String(column.id)] as string | undefined) ?? null;
  const popover = usePopover({ placement: 'bottom' });
  const state = value ? dueState(columns, item, value) : null;
  const hint = state === 'overdue' ? 'Prazo vencido' : state === 'done' ? 'Concluído' : state === 'today' ? 'Vence hoje' : null;

  return (
    <>
      <div
        ref={popover.refs.setReference}
        {...popover.getReferenceProps({ onClick: () => popover.setOpen(!popover.open) })}
        role="button"
        tabIndex={0}
        aria-label={`${column.title}: ${value ? formatDateLong(value) : 'sem data'}`}
        className={cx('cell-btn date-cell', variant === 'panel' && 'date-cell--panel', popover.open && 'is-open')}
      >
        {value ? (
          <Tooltip content={hint ? `${hint} · ${formatDateLong(value)}` : formatDateLong(value)}>
            <span className={cx('date-cell__value', state && `is-${state}`)}>
              {state === 'overdue' && <CircleAlert size={15} />}
              {state === 'done' && <CircleCheck size={15} />}
              <span>{formatDateShort(value)}</span>
            </span>
          </Tooltip>
        ) : (
          <Calendar size={16} className="cell-hint" />
        )}
      </div>
      <PopoverPanel popover={popover}>
        <DatePicker
          value={value}
          onChange={(iso) => {
            popover.setOpen(false);
            if (iso !== value) void actions.setValue(item.id, column.id, iso);
          }}
          onClear={() => {
            popover.setOpen(false);
            void actions.setValue(item.id, column.id, null);
          }}
        />
      </PopoverPanel>
    </>
  );
}
