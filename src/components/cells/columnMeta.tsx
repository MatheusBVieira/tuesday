import {
  Calendar,
  FingerprintPattern,
  Hash,
  Link,
  ListChecks,
  SquareCheck,
  TextAlignStart,
  Type,
  User,
  type LucideIcon,
} from 'lucide-react';
import type { ColumnType } from '../../../shared/types';
import { COLUMN_TYPES, COLUMN_TYPE_LABELS } from '../../../shared/values';

export const COLUMN_TYPE_META: Record<ColumnType, { icon: LucideIcon; color: string; hint: string }> = {
  status: { icon: ListChecks, color: '#00c875', hint: 'Etapas com etiquetas coloridas' },
  text: { icon: Type, color: '#fdab3d', hint: 'Texto curto' },
  people: { icon: User, color: '#579bfc', hint: 'Responsáveis' },
  date: { icon: Calendar, color: '#9d50dd', hint: 'Prazos e datas' },
  number: { icon: Hash, color: '#ffcb00', hint: 'Valores, horas, custos' },
  checkbox: { icon: SquareCheck, color: '#ff7575', hint: 'Marcar como feito' },
  link: { icon: Link, color: '#66ccff', hint: 'Endereços web' },
  long_text: { icon: TextAlignStart, color: '#ff5ac4', hint: 'Notas e descrições' },
  auto_number: { icon: FingerprintPattern, color: '#784bd1', hint: 'Referência automática (TUE-001)' },
};

export function ColumnTypeIcon({ type, size = 16 }: { type: ColumnType; size?: number }) {
  const Icon = COLUMN_TYPE_META[type].icon;
  return <Icon size={size} className="coltype-icon" aria-hidden />;
}

export function ColumnTypePicker({ onPick }: { onPick: (type: ColumnType) => void }) {
  return (
    <div className="coltype-picker">
      <div className="menu__title">Colunas essenciais</div>
      <div className="coltype-picker__grid">
        {COLUMN_TYPES.map((type) => {
          const meta = COLUMN_TYPE_META[type];
          return (
            <button key={type} type="button" className="coltype" onClick={() => onPick(type)} title={meta.hint}>
              <span className="coltype__icon" style={{ background: meta.color }}>
                <meta.icon size={16} color="#fff" strokeWidth={2.2} />
              </span>
              <span className="ellipsis">{COLUMN_TYPE_LABELS[type]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
