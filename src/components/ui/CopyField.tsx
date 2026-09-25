// Campo de um valor que se copia (link de convite, token do MCP): o valor à vista e um botão que confirma a cópia.
import { Check, Copy } from 'lucide-react';
import { useRef, useState } from 'react';
import { cx } from '../../lib/format';
import { toast } from '../../store';

export function CopyField({ value, label, mono = true }: { value: string; label: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const copy = async () => {
    input.current?.select();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Sem permissão para a área de transferência (http em outra máquina, por exemplo): o texto fica selecionado.
      toast('Copie com Ctrl+C — o texto já está selecionado.', 'info');
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="copy-field">
      <input
        ref={input}
        className={cx('input input--sm copy-field__value', mono && 'is-mono')}
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.target.select()}
      />
      <button
        type="button"
        className={cx('btn btn--sm copy-field__btn', copied ? 'btn--secondary' : 'btn--primary')}
        onClick={() => void copy()}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}
