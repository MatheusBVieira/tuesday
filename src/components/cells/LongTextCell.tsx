import { TextAlignStart } from 'lucide-react';
import { useRef, useState } from 'react';
import { cx } from '../../lib/format';
import { actions } from '../../store';
import { PopoverPanel, usePopover } from '../ui/Popover';
import type { CellProps } from './Cell';

export function LongTextCell({ item, column, variant = 'table' }: CellProps) {
  const value = (item.values[String(column.id)] as string | undefined) ?? '';
  const [draft, setDraft] = useState(value);
  const latest = useRef({ draft: value, value });
  latest.current.value = value;

  const popover = usePopover({
    placement: 'bottom',
    onOpenChange: (open) => {
      if (open) {
        setDraft(latest.current.value);
        latest.current.draft = latest.current.value;
        return;
      }
      const next = latest.current.draft;
      if (next.trim() !== latest.current.value.trim()) void actions.setValue(item.id, column.id, next.trim() ? next : null);
    },
  });

  return (
    <>
      <div
        ref={popover.refs.setReference}
        {...popover.getReferenceProps({ onClick: () => popover.setOpen(!popover.open) })}
        role="button"
        tabIndex={0}
        className={cx('cell-btn long-text-cell', variant === 'panel' && 'long-text-cell--panel', popover.open && 'is-open')}
        title={value}
      >
        {value ? <span className="ellipsis">{value.split('\n')[0]}</span> : <TextAlignStart size={15} className="cell-hint" />}
      </div>
      <PopoverPanel popover={popover} className="long-text-popover">
        <textarea
          autoFocus
          className="textarea"
          value={draft}
          placeholder={`${column.title}…`}
          onChange={(e) => {
            setDraft(e.target.value);
            latest.current.draft = e.target.value;
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) popover.setOpen(false);
          }}
        />
        <div className="long-text-popover__hint">Salva ao fechar · Ctrl + Enter</div>
      </PopoverPanel>
    </>
  );
}
