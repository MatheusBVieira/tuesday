import { ChevronLeft, ChevronRight, Trash } from 'lucide-react';
import { useState } from 'react';
import { WEEKDAYS_SHORT, cx, monthLabel, parseIsoDate, toIsoDate } from '../../lib/format';
import './DatePicker.css';

const addDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
};

export function DatePicker({ value, onChange, onClear }: { value: string | null; onChange: (iso: string) => void; onClear?: () => void }) {
  const today = new Date();
  const initial = value ? parseIsoDate(value) : null;
  const [view, setView] = useState({ y: initial?.y ?? today.getFullYear(), m: (initial?.m ?? today.getMonth() + 1) - 1 });

  const first = new Date(view.y, view.m, 1);
  const start = new Date(view.y, view.m, 1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const todayIso = toIsoDate(today);

  const shiftMonth = (delta: number) =>
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  return (
    <div className="datepicker">
      <div className="datepicker__quick">
        <button type="button" className="btn btn--secondary btn--xs" onClick={() => onChange(todayIso)}>
          Hoje
        </button>
        <button type="button" className="btn btn--secondary btn--xs" onClick={() => onChange(addDays(1))}>
          Amanhã
        </button>
        <button type="button" className="btn btn--secondary btn--xs" onClick={() => onChange(addDays(7))}>
          Em 1 semana
        </button>
      </div>
      <div className="datepicker__header">
        <button type="button" className="icon-btn icon-btn--sm" onClick={() => shiftMonth(-1)} aria-label="Mês anterior">
          <ChevronLeft size={16} />
        </button>
        <span className="datepicker__month">{monthLabel(view.y, view.m)}</span>
        <button type="button" className="icon-btn icon-btn--sm" onClick={() => shiftMonth(1)} aria-label="Próximo mês">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="datepicker__grid">
        {WEEKDAYS_SHORT.map((w, i) => (
          <span key={i} className="datepicker__weekday">
            {w}
          </span>
        ))}
        {days.map((d) => {
          const iso = toIsoDate(d);
          return (
            <button
              key={iso}
              type="button"
              className={cx(
                'datepicker__day',
                d.getMonth() !== view.m && 'is-outside',
                iso === todayIso && 'is-today',
                iso === value && 'is-selected',
              )}
              onClick={() => onChange(iso)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      {value && onClear && (
        <div className="datepicker__footer">
          <button type="button" className="btn btn--tertiary btn--sm" onClick={onClear}>
            <Trash size={14} /> Limpar data
          </button>
        </div>
      )}
    </div>
  );
}
