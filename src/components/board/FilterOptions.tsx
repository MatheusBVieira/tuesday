// Opções de filtro de uma coluna — as mesmas no "Filtrar" da barra e no clique do título da coluna.
import { useMemo } from 'react';
import type { Column, Item } from '../../../shared/types';
import { cx } from '../../lib/format';
import { filterOptions } from '../../lib/view';
import { actions, useStore } from '../../store';
import { Avatar } from '../ui/Avatar';

// Seletores do store precisam devolver sempre a mesma referência quando nada mudou.
const NO_IDS: number[] = [];
const NO_ITEMS: Item[] = [];

/** Opções marcadas no filtro da coluna. */
export const useColumnFilter = (columnId: number) => useStore((s) => s.filters.labels[String(columnId)] ?? NO_IDS);

export function toggleColumnFilter(columnId: number, id: number) {
  const labels = useStore.getState().filters.labels;
  const current = labels[String(columnId)] ?? [];
  const next = current.includes(id) ? current.filter((v) => v !== id) : [...current, id];
  actions.setFilters({ labels: { ...labels, [String(columnId)]: next } });
}

export function clearColumnFilter(columnId: number) {
  const { [String(columnId)]: _cleared, ...labels } = useStore.getState().filters.labels;
  actions.setFilters({ labels });
}

export function FilterOptionList({ column }: { column: Column }) {
  const items = useStore((s) => s.board?.items ?? NO_ITEMS);
  const people = useStore((s) => s.people);
  const selected = useColumnFilter(column.id);
  const options = useMemo(() => filterOptions(column, items, people, selected), [column, items, people, selected]);
  return (
    <div className="filter-col__options">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={cx('filter-chip', selected.includes(option.id) && 'is-selected')}
          aria-pressed={selected.includes(option.id)}
          onClick={() => toggleColumnFilter(column.id, option.id)}
        >
          {option.person ? (
            <Avatar person={option.person} size={18} />
          ) : (
            <span className="filter-chip__dot" style={{ background: option.color }} />
          )}
          <span className="ellipsis">{option.name}</span>
          <span className="filter-chip__count">{option.count}</span>
        </button>
      ))}
      {options.length === 0 && <span className="filter-col__empty">Sem valores</span>}
    </div>
  );
}
