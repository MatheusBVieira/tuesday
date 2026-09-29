// O "..." que aparece ao passar o mouse numa linha de lista (pessoas, quem participa, contas).
import { Ellipsis } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../../lib/format';
import { Menu } from './Menu';
import { PopoverPanel, usePopover } from './Popover';

export function RowMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const menu = usePopover({ placement: 'bottom-end' });
  return (
    <>
      <button
        ref={menu.refs.setReference}
        {...menu.getReferenceProps({ onClick: () => menu.setOpen(!menu.open) })}
        type="button"
        className={cx('icon-btn icon-btn--sm team-row__menu', menu.open && 'is-open')}
        aria-label={label}
      >
        <Ellipsis size={18} />
      </button>
      <PopoverPanel popover={menu}>
        <Menu>{children(() => menu.setOpen(false))}</Menu>
      </PopoverPanel>
    </>
  );
}
