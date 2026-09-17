import type { Column, Item, Person } from '../../../shared/types';
import { EMPTY_STATUS_COLOR } from '../../../shared/colors';
import { formatNumber, statusLabelOf } from '../../../shared/values';
import { cx, formatDateShort } from '../../lib/format';
import { useStore } from '../../store';
import { AvatarStack } from '../ui/Avatar';
import { Tooltip } from '../ui/Tooltip';

/** A "bateria" do monday: distribuição das etiquetas de uma coluna de status. */
export function StatusBattery({ column, items }: { column: Column; items: Item[] }) {
  const total = items.length;
  if (!total) return <div className="battery battery--empty" />;
  const counts = new Map<number, number>();
  let empty = 0;
  for (const item of items) {
    const label = statusLabelOf(column, item.values[String(column.id)]);
    if (label) counts.set(label.id, (counts.get(label.id) ?? 0) + 1);
    else empty++;
  }
  const segments = [
    ...(column.settings.labels ?? [])
      .filter((l) => counts.has(l.id))
      .map((l) => ({ key: String(l.id), name: l.name || 'Sem nome', color: l.color, count: counts.get(l.id)! })),
    ...(empty ? [{ key: 'empty', name: 'Vazio', color: EMPTY_STATUS_COLOR, count: empty }] : []),
  ];
  return (
    <div className="battery">
      {segments.map((s) => (
        <Tooltip key={s.key} content={`${s.name} · ${s.count}/${total} (${Math.round((s.count / total) * 100)}%)`} delay={0}>
          <div className="battery__segment" style={{ background: s.color, flexGrow: s.count }} />
        </Tooltip>
      ))}
    </div>
  );
}

export function ColumnSummary({ column, items }: { column: Column; items: Item[] }) {
  const people = useStore((s) => s.people);
  const values = items.map((i) => i.values[String(column.id)]);
  switch (column.type) {
    case 'status':
      return <StatusBattery column={column} items={items} />;
    case 'number': {
      const numbers = values.filter((v): v is number => typeof v === 'number');
      if (!numbers.length) return null;
      return (
        <div className="summary-number">
          <strong>
            {formatNumber(
              column.settings,
              numbers.reduce((a, b) => a + b, 0),
            )}
          </strong>
          <span>soma</span>
        </div>
      );
    }
    case 'date': {
      const dates = values.filter((v): v is string => typeof v === 'string').sort();
      if (!dates.length) return null;
      const first = dates[0];
      const last = dates[dates.length - 1];
      return (
        <div className="summary-date">
          {first === last ? formatDateShort(first) : `${formatDateShort(first)} – ${formatDateShort(last)}`}
        </div>
      );
    }
    case 'checkbox': {
      if (!items.length) return null;
      const done = values.filter((v) => v === true).length;
      return (
        <div className="summary-number">
          <strong>
            {done}/{items.length}
          </strong>
          <span>marcados</span>
        </div>
      );
    }
    case 'people': {
      const ids = [...new Set(values.flatMap((v) => (Array.isArray(v) ? v : [])))];
      const assigned = ids.map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p);
      return assigned.length ? <AvatarStack people={assigned} size={22} max={4} /> : null;
    }
    default:
      return null;
  }
}

export function SummaryRow({ items, columns }: { items: Item[]; columns: Column[] }) {
  if (!columns.length) return null;
  return (
    <div className="summary-row">
      <div className="row-sticky">
        <div className="row-gutter" />
        <div className="summary-row__spacer" />
      </div>
      {columns.map((column, i) => (
        <div
          key={column.id}
          className={cx('summary-cell', i === 0 && 'is-first', i === columns.length - 1 && 'is-last')}
          style={{ width: `var(--col-${column.id})` }}
        >
          <ColumnSummary column={column} items={items} />
        </div>
      ))}
    </div>
  );
}
