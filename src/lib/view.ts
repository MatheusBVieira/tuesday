// Filtros, busca e ordenação aplicados às duas visualizações.
import { EMPTY_STATUS_COLOR } from '../../shared/colors';
import type { Board, CellValue, Column, ColumnType, Item, Person } from '../../shared/types';
import { fold, sortKey, statusLabelOf, todayIso, valueToText } from '../../shared/values';
import type { SortSpec, ViewFilters } from '../store';

// ── Filtro por coluna: status, pessoas, data e checkbox (id 0 = vazio) ──

const FILTERABLE_TYPES: ReadonlySet<ColumnType> = new Set(['status', 'people', 'date', 'checkbox']);
export const isFilterable = (column: Column) => FILTERABLE_TYPES.has(column.type);

const DATE_OPTIONS = [
  { id: 1, name: 'Antes de hoje', color: '#e2445c' },
  { id: 2, name: 'Hoje', color: '#fdab3d' },
  { id: 3, name: 'Próximos 7 dias', color: '#00c875' },
  { id: 4, name: 'Depois', color: '#579bfc' },
];

interface FilterDays {
  today: string;
  week: string;
}

const filterDays = (): FilterDays => ({ today: todayIso(), week: todayIso(7) });

/** Ids das opções de filtro que o valor atende. */
function filterIdsOf(column: Column, value: CellValue | undefined, days: FilterDays): number[] {
  switch (column.type) {
    case 'status': {
      const label = statusLabelOf(column, value);
      return [label ? label.id : 0];
    }
    case 'people': {
      const ids = (value as number[] | undefined) ?? [];
      return ids.length ? ids : [0];
    }
    case 'date': {
      if (typeof value !== 'string' || !value) return [0];
      const day = value.slice(0, 10);
      return [day < days.today ? 1 : day === days.today ? 2 : day <= days.week ? 3 : 4];
    }
    case 'checkbox':
      return [value === true ? 1 : 0];
    default:
      return [];
  }
}

export interface FilterOption {
  id: number;
  name: string;
  color?: string;
  person?: Person;
  count: number;
}

/** As opções de filtro de uma coluna, com quantos itens cada uma tem. Somem as vazias que não estão marcadas. */
export function filterOptions(column: Column, items: Item[], people: Person[], selected: number[]): FilterOption[] {
  const days = filterDays();
  const counts = new Map<number, number>();
  for (const item of items)
    for (const id of new Set(filterIdsOf(column, item.values[String(column.id)], days))) counts.set(id, (counts.get(id) ?? 0) + 1);
  const count = (id: number) => counts.get(id) ?? 0;
  const empty = (name: string): FilterOption => ({ id: 0, name, color: EMPTY_STATUS_COLOR, count: count(0) });
  const options: FilterOption[] =
    column.type === 'status'
      ? [
          ...(column.settings.labels ?? []).map((l) => ({ id: l.id, name: l.name || 'Sem nome', color: l.color, count: count(l.id) })),
          empty('Vazio'),
        ]
      : column.type === 'people'
        ? [...people.map((p) => ({ id: p.id, name: p.name, person: p, count: count(p.id) })), empty('Ninguém')]
        : column.type === 'date'
          ? [...DATE_OPTIONS.map((o) => ({ ...o, count: count(o.id) })), empty('Sem data')]
          : column.type === 'checkbox'
            ? [{ id: 1, name: 'Marcado', color: '#00c875', count: count(1) }, empty('Desmarcado')]
            : [];
  return options.filter((o) => o.count > 0 || selected.includes(o.id));
}

export function hasActiveFilters(filters: ViewFilters): boolean {
  return filters.search.trim() !== '' || filters.people.length > 0 || Object.values(filters.labels).some((ids) => ids.length > 0);
}

export function activeFilterCount(filters: ViewFilters): number {
  return Object.values(filters.labels).reduce((n, ids) => n + ids.length, 0);
}

export function itemSearchText(item: Item, board: Board, people: Person[]): string {
  const parts: string[] = [item.name, ...item.subitems.map((s) => s.name)];
  for (const column of board.columns) {
    parts.push(valueToText(column, item.values[String(column.id)], { people, itemNumber: item.number }));
  }
  return fold(parts.join('  '));
}

export function filterItems(board: Board, filters: ViewFilters, people: Person[]): Item[] {
  const query = fold(filters.search);
  const labelFilters = Object.entries(filters.labels)
    .filter(([, ids]) => ids.length > 0)
    .map(([columnId, ids]) => [board.columns.find((c) => c.id === Number(columnId)), ids] as const)
    .filter((entry): entry is readonly [Column, number[]] => entry[0] !== undefined && isFilterable(entry[0]));
  const peopleColumns = board.columns.filter((c) => c.type === 'people');
  const days = filterDays();

  return board.items.filter((item) => {
    if (query && !itemSearchText(item, board, people).includes(query)) return false;
    if (filters.people.length) {
      const assigned = peopleColumns.flatMap((c) => (item.values[String(c.id)] as number[] | undefined) ?? []);
      if (!filters.people.some((id) => assigned.includes(id))) return false;
    }
    for (const [column, ids] of labelFilters) {
      const matches = filterIdsOf(column, item.values[String(column.id)], days);
      if (!ids.some((id) => matches.includes(id))) return false;
    }
    return true;
  });
}

function compare(a: string | number | null, b: string | number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'pt-BR', { numeric: true });
}

export function sortItems(items: Item[], board: Board, sort: SortSpec | null, people: Person[]): Item[] {
  if (!sort) return [...items].sort((a, b) => a.position - b.position || a.id - b.id);
  const column = sort.columnId === 'name' ? null : board.columns.find((c) => c.id === sort.columnId);
  const key = (item: Item): string | number | null =>
    column ? sortKey(column, item.values[String(column.id)] as CellValue, { people, itemNumber: item.number }) : fold(item.name);
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null || kb === null) return compare(ka, kb); // vazios sempre no fim
    return compare(ka, kb) * dir || a.position - b.position;
  });
}

export function groupItems(board: Board, items: Item[]): Map<number, Item[]> {
  const map = new Map<number, Item[]>(board.groups.map((g) => [g.id, []]));
  for (const item of items) map.get(item.groupId)?.push(item);
  return map;
}
