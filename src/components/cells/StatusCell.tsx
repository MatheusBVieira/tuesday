import { EMPTY_STATUS_COLOR, textColorOn } from '../../../shared/colors';
import { statusLabelOf } from '../../../shared/values';
import { cx } from '../../lib/format';
import { actions } from '../../store';
import { PopoverPanel, usePopover } from '../ui/Popover';
import type { CellProps } from './Cell';
import { StatusPicker } from './StatusPicker';

export function StatusCell({ item, column, variant = 'table' }: CellProps) {
  const label = statusLabelOf(column, item.values[String(column.id)]);
  const popover = usePopover({ placement: 'bottom' });
  const color = label?.color ?? EMPTY_STATUS_COLOR;
  return (
    <>
      <div
        ref={popover.refs.setReference}
        {...popover.getReferenceProps({
          onClick: () => popover.setOpen(!popover.open),
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              popover.setOpen(true);
            }
          },
        })}
        role="button"
        tabIndex={0}
        aria-label={`${column.title}: ${label?.name || 'vazio'}`}
        className={cx('status-cell', variant === 'panel' && 'status-cell--panel', popover.open && 'is-open')}
        style={{ background: color, color: textColorOn(color) }}
      >
        <span className="status-cell__text">{label?.name ?? ''}</span>
      </div>
      <PopoverPanel popover={popover} className="status-popover">
        <StatusPicker
          column={column}
          value={label?.id ?? null}
          onPick={(id) => {
            popover.setOpen(false);
            if (id !== (label?.id ?? null)) void actions.setValue(item.id, column.id, id);
          }}
        />
      </PopoverPanel>
    </>
  );
}
