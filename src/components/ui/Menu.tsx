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
  hint,
  onClick,
  danger,
  disabled,
  selected,
  end,
}: {
  icon?: ReactNode;
  label: ReactNode;
  /** linha de apoio embaixo do rótulo (ex.: o que um papel permite) */
  hint?: ReactNode;
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
      className={cx('menu__item', hint != null && 'menu__item--tall', danger && 'menu__item--danger', selected && 'is-selected')}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      {hint != null ? (
        <span className="menu__item-text">
          <span className="ellipsis">{label}</span>
          <span className="menu__item-hint">{hint}</span>
        </span>
      ) : (
        <span className="ellipsis">{label}</span>
      )}
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
