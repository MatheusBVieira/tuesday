import { PALETTE } from '../../../shared/colors';
import { cx } from '../../lib/format';

export function ColorPalette({ value, onSelect }: { value?: string; onSelect: (hex: string) => void }) {
  return (
    <div className="palette" role="listbox" aria-label="Cores">
      {PALETTE.map((color) => (
        <button
          key={color.key}
          type="button"
          role="option"
          aria-selected={color.hex === value}
          aria-label={color.name}
          title={color.name}
          className={cx('palette__swatch', color.hex === value && 'is-selected')}
          style={{ background: color.hex }}
          onClick={() => onSelect(color.hex)}
        />
      ))}
    </div>
  );
}
