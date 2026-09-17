import type { ReactNode } from 'react';
import { cx } from '../../lib/format';

export function Menu({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('menu', className)} role="menu">
      {children}
    </div>
  );
}

export function MenuItem({
  icon,
  label,
  onClick,
  danger,
  disabled,
  selected,
  end,
}: {
  icon?: ReactNode;
  label: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  selected?: boolean;
  end?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cx('menu__item', danger && 'menu__item--danger', selected && 'is-selected')}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      <span className="ellipsis">{label}</span>
      {end != null && <span className="menu__item-end">{end}</span>}
    </button>
  );
}

export function MenuDivider() {
  return <div className="menu__divider" role="separator" />;
}

export function MenuTitle({ children }: { children: ReactNode }) {
  return <div className="menu__title">{children}</div>;
}
