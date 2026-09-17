import { Check, Minus } from 'lucide-react';
import { cx } from '../../lib/format';

export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      disabled={disabled}
      className={cx('checkbox', checked && 'is-checked', indeterminate && 'is-indeterminate')}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.(!checked);
      }}
    >
      {indeterminate ? <Minus size={12} strokeWidth={3} /> : checked ? <Check size={12} strokeWidth={3} /> : null}
    </button>
  );
}
