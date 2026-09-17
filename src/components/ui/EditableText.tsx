import { useEffect, useRef, useState } from 'react';
import { cx } from '../../lib/format';
import './EditableText.css';

interface Props {
  value: string;
  onSave: (value: string) => void;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  /** controle externo do modo de edição (opcional) */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  allowEmpty?: boolean;
  trigger?: 'click' | 'doubleClick' | 'none';
  maxLength?: number;
}

/** Texto que vira campo ao clicar — Enter salva, Esc cancela, sair do campo salva. */
export function EditableText({
  value,
  onSave,
  className,
  inputClassName,
  placeholder,
  editing: controlled,
  onEditingChange,
  allowEmpty = false,
  trigger = 'click',
  maxLength = 500,
}: Props) {
  const [internal, setInternal] = useState(false);
  const editing = controlled ?? internal;
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const settled = useRef(false);

  const setEditing = (next: boolean) => {
    setInternal(next);
    onEditingChange?.(next);
  };

  useEffect(() => {
    if (!editing) return;
    settled.current = false;
    setDraft(value);
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const finish = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const next = draft.trim();
    setEditing(false);
    if (save && (next || allowEmpty) && next !== value) onSave(next);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={cx('editable__input', inputClassName)}
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            finish(true);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            finish(false);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      />
    );
  }

  const start = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(true);
  };

  return (
    <span
      className={cx('editable', trigger !== 'none' && 'editable--interactive', className)}
      onClick={trigger === 'click' ? start : undefined}
      onDoubleClick={trigger === 'doubleClick' ? start : undefined}
      title={value}
    >
      {value || <span className="editable__placeholder">{placeholder}</span>}
    </span>
  );
}
