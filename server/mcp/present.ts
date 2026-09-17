// Tradução entre o formato interno e o formato "amigável" usado pelo Claude via MCP.
import type { ActivityEntry, Board, CellValue, Column, Item, LinkValue, Person, Subitem } from '../../shared/types';
import { ValidationError, fold, formatItemRef, isEmptyValue, isIsoDate, statusLabelOf, todayIso, valueToText } from '../../shared/values';
import { subitemProgress } from '../../shared/subitems';
import { resolveColumn } from '../services/columns';
import { resolvePerson } from '../services/people';

export interface BoardContext {
  board: Board;
  people: Person[];
  projectName: string | null;
  refColumn: Column | null;
  groupNames: Map<number, string>;
  groupOrder: Map<number, number>;
}

export function boardContext(board: Board, people: Person[], projectName: string | null = null): BoardContext {
  return {
    board,
    people,
    projectName,
    refColumn: board.columns.find((c) => c.type === 'auto_number') ?? null,
    groupNames: new Map(board.groups.map((g) => [g.id, g.name])),
    groupOrder: new Map(board.groups.map((g, i) => [g.id, i])),
  };
}

export function itemRef(item: Item, ctx: BoardContext): string | null {
  return ctx.refColumn ? formatItemRef(ctx.refColumn.settings, item.number) : null;
}

/** Itens na ordem da tabela: grupo a grupo, depois posição. */
export function orderedItems(ctx: BoardContext): Item[] {
  return [...ctx.board.items].sort(
    (a, b) => (ctx.groupOrder.get(a.groupId) ?? 0) - (ctx.groupOrder.get(b.groupId) ?? 0) || a.position - b.position,
  );
}

function friendlyValue(column: Column, value: CellValue, ctx: BoardContext): unknown {
  switch (column.type) {
    case 'status':
      return statusLabelOf(column, value)?.name ?? null;
    case 'people':
      return (value as number[]).map((id) => ctx.people.find((p) => p.id === id)?.name ?? `#${id}`);
    case 'link': {
      const link = value as LinkValue;
      return link.text ? { url: link.url, text: link.text } : link.url;
    }
    default:
      return value;
  }
}

export function presentItem(item: Item, ctx: BoardContext, opts: { includeBoard?: boolean; omitGroup?: boolean } = {}) {
  const values: Record<string, unknown> = {};
  for (const column of ctx.board.columns) {
    if (column.type === 'auto_number') continue;
    const value = item.values[String(column.id)];
    if (isEmptyValue(value ?? null)) continue;
    values[column.title] = friendlyValue(column, value, ctx);
  }
  const ref = itemRef(item, ctx);
  const progress = subitemProgress(item.subitems);
  return {
    id: item.id,
    ...(ref ? { ref } : {}),
    name: item.name,
    ...(opts.includeBoard
      ? { board: ctx.board.name, board_id: ctx.board.id, ...(ctx.projectName ? { project: ctx.projectName } : {}) }
      : {}),
    ...(opts.omitGroup ? {} : { group: ctx.groupNames.get(item.groupId) }),
    values,
    ...(progress.total ? { subitems: `${progress.done}/${progress.total} feitos` } : {}),
    ...(item.updatesCount ? { updates: item.updatesCount } : {}),
  };
}

/** Subitens como o Claude recebe: id, texto, feito e quem marcou. */
export function presentSubitems(subitems: Subitem[], personName: (id: number | null) => string) {
  return subitems.map((s) => ({
    id: s.id,
    name: s.name,
    done: s.done,
    ...(s.done && s.doneBy != null ? { done_by: personName(s.doneBy) } : {}),
  }));
}

export function presentColumn(column: Column) {
  return {
    id: column.id,
    title: column.title,
    type: column.type,
    ...(column.type === 'status' ? { labels: (column.settings.labels ?? []).map((l) => ({ name: l.name, color: l.color })) } : {}),
    ...(column.type === 'auto_number' ? { prefix: column.settings.prefix || null, digits: column.settings.pad ?? 3 } : {}),
    ...(column.type === 'number' && column.settings.unit ? { unit: column.settings.unit } : {}),
  };
}

export function searchableText(item: Item, ctx: BoardContext): string {
  const parts = [item.name, itemRef(item, ctx) ?? '', ...item.subitems.map((s) => s.name)];
  for (const column of ctx.board.columns) {
    parts.push(valueToText(column, item.values[String(column.id)], { people: ctx.people, itemNumber: item.number }));
  }
  return fold(parts.join('  '));
}

const RELATIVE_DAYS: Record<string, number> = {
  today: 0,
  hoje: 0,
  tomorrow: 1,
  amanha: 1,
  yesterday: -1,
  ontem: -1,
};

export function parseFriendlyDate(input: unknown): string {
  const raw = String(input).trim();
  const key = fold(raw);
  if (key in RELATIVE_DAYS) return todayIso(RELATIVE_DAYS[key]);
  const relative = /^([+-])\s*(\d+)\s*(d|dias?|days?)?$/.exec(key);
  if (relative) return todayIso((relative[1] === '-' ? -1 : 1) * Number(relative[2]));
  if (isIsoDate(raw.slice(0, 10))) return raw.slice(0, 10);
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (br) {
    const iso = `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
    if (isIsoDate(iso)) return iso;
  }
  throw new ValidationError(`Data inválida: "${raw}". Use AAAA-MM-DD (ou "hoje", "amanhã", "+3d").`);
}

/** Converte um valor amigável (nome da etiqueta, nome da pessoa, "amanhã"...) para o formato interno. */
export function parseFriendlyValue(column: Column, input: unknown, people: Person[]): CellValue {
  if (input === null || input === undefined || input === '') return null;
  switch (column.type) {
    case 'status': {
      if (typeof input === 'number') return input;
      const key = fold(String(input));
      const labels = column.settings.labels ?? [];
      const prefixed = labels.filter((l) => fold(l.name).startsWith(key));
      const label = labels.find((l) => fold(l.name) === key) ?? (prefixed.length === 1 ? prefixed[0] : undefined);
      if (!label) {
        const options = labels.map((l) => l.name).join(', ');
        throw new ValidationError(
          `A etiqueta "${String(input)}" não existe na coluna "${column.title}". Opções: ${options}. Para criar etiquetas use update_column.`,
        );
      }
      return label.id;
    }
    case 'people': {
      const refs = Array.isArray(input) ? input : String(input).split(/\s*[,;]\s*/);
      const ids = refs.filter((r) => r !== '' && r != null).map((r) => resolvePerson(r as string | number, people).id);
      return ids.length ? ids : null;
    }
    case 'date':
      return parseFriendlyDate(input);
    case 'checkbox': {
      if (typeof input === 'boolean') return input || null;
      const key = fold(String(input));
      if (['true', 'sim', 'yes', '1', 'x', 'marcado', 'feito'].includes(key)) return true;
      if (['false', 'nao', 'no', '0', 'desmarcado'].includes(key)) return null;
      throw new ValidationError(`Use true/false para a coluna "${column.title}".`);
    }
    case 'link':
      return typeof input === 'string' ? { url: input } : (input as LinkValue);
    case 'number':
      return typeof input === 'number' ? input : (String(input) as CellValue);
    default:
      return (typeof input === 'string' ? input : JSON.stringify(input)) as CellValue;
  }
}

/** Converte `{ "Título da coluna": valor amigável }` em `{ "<id da coluna>": valor interno }`. */
export function parseFriendlyValues(
  boardId: number,
  columns: Column[],
  values: Record<string, unknown>,
  people: Person[],
): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const [key, raw] of Object.entries(values)) {
    const column = resolveColumn(boardId, key, columns);
    out[String(column.id)] = parseFriendlyValue(column, raw, people);
  }
  return out;
}

type Range = { before?: unknown; after?: unknown; on?: unknown; gt?: unknown; gte?: unknown; lt?: unknown; lte?: unknown };

/** Avalia uma condição de filtro do find_items contra o valor de uma coluna. */
export function matchesCondition(column: Column, value: CellValue | undefined, cond: unknown, ctx: BoardContext, item: Item): boolean {
  if (cond && typeof cond === 'object' && !Array.isArray(cond) && 'not' in cond) {
    return !matchesCondition(column, value, (cond as { not: unknown }).not, ctx, item);
  }
  const empty = column.type !== 'auto_number' && isEmptyValue(value ?? null);
  if (cond === null) return empty;
  const list = (Array.isArray(cond) ? cond : [cond]).map((c) => fold(String(c)));

  switch (column.type) {
    case 'status': {
      const label = statusLabelOf(column, value);
      return !!label && list.includes(fold(label.name));
    }
    case 'people': {
      const ids = (value as number[] | null) ?? [];
      return ids.some((id) => {
        const person = ctx.people.find((p) => p.id === id);
        if (!person) return false;
        const name = fold(person.name);
        return list.some((n) => n === name || n === String(id) || name.split(/\s+/).includes(n));
      });
    }
    case 'date': {
      if (empty) return false;
      const date = value as string;
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        const c = cond as Range;
        if (c.before != null && !(date < parseFriendlyDate(c.before))) return false;
        if (c.after != null && !(date > parseFriendlyDate(c.after))) return false;
        if (c.on != null && date !== parseFriendlyDate(c.on)) return false;
        return true;
      }
      return (Array.isArray(cond) ? cond : [cond]).some((c) => parseFriendlyDate(c) === date);
    }
    case 'number': {
      if (empty) return false;
      const n = value as number;
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        const c = cond as Range;
        if (c.gt != null && !(n > Number(c.gt))) return false;
        if (c.gte != null && !(n >= Number(c.gte))) return false;
        if (c.lt != null && !(n < Number(c.lt))) return false;
        if (c.lte != null && !(n <= Number(c.lte))) return false;
        return true;
      }
      return (Array.isArray(cond) ? cond : [cond]).some((c) => Number(c) === n);
    }
    case 'checkbox':
      return (cond === true || list[0] === 'true' || list[0] === 'sim') === (value === true);
    case 'auto_number': {
      const ref = fold(itemRef(item, ctx) ?? '');
      return list.some((c) => c === ref || Number(c) === item.number);
    }
    default: {
      const text = fold(valueToText(column, value, { people: ctx.people }));
      return list.some((c) => text.includes(c));
    }
  }
}

const localTime = (iso: string) => new Date(iso).toLocaleString('sv-SE').slice(0, 16);

/** Linha legível de uma entrada do registro de atividades. */
export function describeActivity(entry: ActivityEntry, people: Person[]): string {
  const who =
    people.find((p) => p.id === entry.actorId)?.name ?? (entry.source === 'claude' ? 'Claude' : entry.source === 'git' ? 'Git' : 'Alguém');
  const d = entry.data;
  const snap = (s: { text: string } | null | undefined) => (s ? `"${s.text}"` : '(vazio)');
  const item = entry.itemName ? `"${entry.itemName}"` : 'item';
  let what: string;
  switch (entry.action) {
    case 'item_created':
      what = `criou ${item}${d.text ? ` em ${d.text}` : ''}`;
      break;
    case 'item_renamed':
      what = `renomeou ${snap(d.from)} → ${snap(d.to)}`;
      break;
    case 'value_changed':
      what = `${item} · ${d.columnTitle}: ${snap(d.from)} → ${snap(d.to)}`;
      break;
    case 'item_moved':
      what = `moveu ${item} de ${snap(d.from)} para ${snap(d.to)}`;
      break;
    case 'item_deleted':
      what = `excluiu ${item}`;
      break;
    case 'item_restored':
      what = `restaurou ${item}`;
      break;
    case 'item_duplicated':
      what = `duplicou ${item}`;
      break;
    case 'update_posted':
      what = `postou em ${item}: ${d.text ?? ''}`;
      break;
    case 'commit_linked':
      what = `commit ${d.hash ?? ''} citou ${item}: ${d.text ?? ''}`;
      break;
    case 'subitems_added':
      what = `adicionou ${d.count ?? ''} subitens em ${item}: ${d.text ?? ''}`;
      break;
    case 'subitem_checked':
      what = `marcou como feito em ${item}: ${d.text ?? ''}`;
      break;
    case 'subitem_unchecked':
      what = `reabriu em ${item}: ${d.text ?? ''}`;
      break;
    case 'subitem_renamed':
      what = `renomeou subitem de ${item}: ${snap(d.from)} → ${snap(d.to)}`;
      break;
    case 'subitem_deleted':
      what = `removeu subitem de ${item}: ${d.text ?? ''}`;
      break;
    default:
      what = entry.action;
  }
  return `${localTime(entry.createdAt)} · ${who} · ${what}`;
}
