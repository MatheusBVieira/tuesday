import type { ReactNode } from 'react';
import { MAX_ITEM_NUMBER, formatItemRef, sanitizeIdPrefix } from '../../../shared/values';

/** Rascunho do formato das referências (ex.: TM-07): o número fica como texto enquanto é digitado. */
export interface IdFormatDraft {
  prefix: string;
  pad: number;
  start: string;
}

/** Número digitado → inteiro válido, ou null. */
export function parseItemNumber(raw: string): number | null {
  const digits = raw.trim();
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return n >= 1 && n <= MAX_ITEM_NUMBER ? n : null;
}

const PADS = [1, 2, 3, 4, 5, 6, 7, 8];

/** Prefixo, dígitos e número inicial/próximo das referências dos itens, com a prévia do resultado. */
export function IdFormatFields({
  value,
  onChange,
  autoPrefix = '',
  startLabel = 'Começar em',
  previewLabel = 'Primeiro item',
  footer,
}: {
  value: IdFormatDraft;
  onChange: (value: IdFormatDraft) => void;
  /** prefixo usado se o campo ficar vazio */
  autoPrefix?: string;
  startLabel?: string;
  previewLabel?: string;
  footer?: ReactNode;
}) {
  const settings = { prefix: value.prefix || autoPrefix, pad: value.pad };
  const start = parseItemNumber(value.start);
  return (
    <div className="id-format">
      <div className="id-format__fields">
        <label className="id-format__field">
          <span className="id-format__label">Prefixo</span>
          <input
            className="input input--sm"
            value={value.prefix}
            placeholder={autoPrefix || 'Ex.: TM'}
            maxLength={10}
            spellCheck={false}
            onChange={(e) => onChange({ ...value, prefix: sanitizeIdPrefix(e.target.value) })}
          />
        </label>
        <label className="id-format__field">
          <span className="id-format__label">Dígitos</span>
          <select className="input input--sm" value={value.pad} onChange={(e) => onChange({ ...value, pad: Number(e.target.value) })}>
            {PADS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="id-format__field">
          <span className="id-format__label">{startLabel}</span>
          <input
            className="input input--sm"
            inputMode="numeric"
            value={value.start}
            maxLength={7}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => onChange({ ...value, start: e.target.value.replace(/\D/g, '') })}
          />
        </label>
      </div>
      <div className="id-format__preview">
        {previewLabel}: <strong>{start ? formatItemRef(settings, start) : '—'}</strong>
        {footer}
      </div>
    </div>
  );
}
