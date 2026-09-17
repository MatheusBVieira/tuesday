// Filtros, busca e ordenação aplicados às duas visualizações.
import type { Board, CellValue, Column, Item, Person } from '../../shared/types';
import { fold, sortKey, statusLabelOf, valueToText } from '../../shared/values';
import type { SortSpec, ViewFilters } from '../store';

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
    .filter((entry): entry is readonly [Column, number[]] => entry[0] !== undefined);
  const peopleColumns = board.columns.filter((c) => c.type === 'people');

  return board.items.filter((item) => {
    if (query && !itemSearchText(item, board, people).includes(query)) return false;
    if (filters.people.length) {
      const assigned = peopleColumns.flatMap((c) => (item.values[String(c.id)] as number[] | undefined) ?? []);
      if (!filters.people.some((id) => assigned.includes(id))) return false;
    }
    for (const [column, ids] of labelFilters) {
      const value = item.values[String(column.id)];
      if (column.type === 'status') {
        const label = statusLabelOf(column, value);
        if (!ids.includes(label ? label.id : 0)) return false;
      } else if (column.type === 'people') {
        const assigned = (value as number[] | undefined) ?? [];
        if (!ids.some((id) => (id === 0 ? assigned.length === 0 : assigned.includes(id)))) return false;
      }
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
