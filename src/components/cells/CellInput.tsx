import { useRef, useState } from 'react';
import { cx } from '../../lib/format';

/** Campo que ocupa a célula durante a edição. Enter/sair salva, Esc cancela. */
export function CellInput({
  initial,
  onCommit,
  onCancel,
  numeric,
  placeholder,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  numeric?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(initial);
  const settled = useRef(false);
  const finish = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (save) onCommit(draft.trim());
    else onCancel();
  };
  return (
    <input
      autoFocus
      className={cx('cell-input', numeric && 'cell-input--numeric')}
      value={draft}
      inputMode={numeric ? 'decimal' : undefined}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
