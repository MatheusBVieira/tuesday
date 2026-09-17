// Regras de valores das colunas — puras, usadas no servidor e no cliente.
import type { ActivitySnapshot, CellValue, Column, ColumnSettings, ColumnType, LinkValue, Person, StatusLabel } from './types';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export const COLUMN_TYPES: ColumnType[] = ['status', 'text', 'people', 'date', 'number', 'checkbox', 'link', 'long_text', 'auto_number'];

export const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  status: 'Status',
  text: 'Texto',
  long_text: 'Texto longo',
  people: 'Pessoas',
  date: 'Data',
  number: 'Números',
  checkbox: 'Caixa de seleção',
  link: 'Link',
  auto_number: 'ID do item',
};

export const DEFAULT_COLUMN_WIDTH: Record<ColumnType, number> = {
  status: 150,
  text: 180,
  long_text: 220,
  people: 120,
  date: 130,
  number: 110,
  checkbox: 100,
  link: 170,
  auto_number: 110,
};

/** Remove acentos, caixa e espaços extras — para buscas e comparações tolerantes. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function positionBetween(prev: number | null | undefined, next: number | null | undefined): number {
  if (prev == null && next == null) return 1000;
  if (prev == null) return (next as number) - 1000;
  if (next == null) return prev + 1000;
  return (prev + next) / 2;
}

export function statusLabelOf(column: Column, value: CellValue | undefined): StatusLabel | null {
  if (value == null || column.type !== 'status') return null;
  return column.settings.labels?.find((l) => l.id === value) ?? null;
}

export function formatItemRef(settings: ColumnSettings, itemNumber: number): string {
  const prefix = settings.prefix?.trim();
  const n = String(itemNumber).padStart(settings.pad ?? 3, '0');
  return prefix ? `${prefix}-${n}` : n;
}

/** Maior número de item aceito (a referência fica com até 7 dígitos, ex.: TM-9999999). */
export const MAX_ITEM_NUMBER = 9_999_999;

/** Prefixo de referência: letras sem acento, dígitos e "_", em maiúsculas, até 10 caracteres. */
export function sanitizeIdPrefix(input: string | null | undefined): string {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '')
    .slice(0, 10);
}

export const clampIdPad = (pad: unknown): number => Math.min(Math.max(Math.round(Number(pad) || 1), 1), 8);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function todayIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isEmptyValue(value: CellValue | undefined): boolean {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

/** Valida e normaliza um valor no formato interno. `null` significa "limpar". */
export function normalizeValue(column: Column, raw: unknown): CellValue {
  if (raw === undefined || raw === null) return null;
  switch (column.type) {
    case 'status': {
      if (raw === '') return null;
      const id = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isInteger(id)) throw new ValidationError(`Valor inválido para a coluna de status "${column.title}".`);
      if (!column.settings.labels?.some((l) => l.id === id))
        throw new ValidationError(`A etiqueta ${id} não existe na coluna "${column.title}".`);
      return id;
    }
    case 'text':
    case 'long_text': {
      const s = typeof raw === 'string' ? raw : String(raw);
      if (s.trim() === '') return null;
      return column.type === 'text' ? s.replace(/\s*\n\s*/g, ' ') : s;
    }
    case 'number': {
      if (raw === '') return null;
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(',', '.'));
      if (!Number.isFinite(n)) throw new ValidationError(`"${String(raw)}" não é um número válido.`);
      return n;
    }
    case 'date': {
      if (raw === '') return null;
      if (typeof raw !== 'string' || !isIsoDate(raw))
        throw new ValidationError(`Data inválida para "${column.title}". Use o formato AAAA-MM-DD.`);
      return raw;
    }
    case 'people': {
      const list = Array.isArray(raw) ? raw : [raw];
      const ids = [...new Set(list.map((v) => Number(v)))];
      if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new ValidationError(`Pessoas inválidas para "${column.title}".`);
      return ids.length ? ids : null;
    }
    case 'checkbox':
      return raw === true || raw === 'true' || raw === 1 ? true : null;
    case 'link': {
      if (typeof raw === 'string') return raw.trim() ? { url: raw.trim() } : null;
      if (typeof raw === 'object' && 'url' in (raw as object)) {
        const url = String((raw as LinkValue).url ?? '').trim();
        const text = String((raw as LinkValue).text ?? '').trim();
        if (!url) return null;
        return text ? { url, text } : { url };
      }
      throw new ValidationError(`Link inválido para "${column.title}".`);
    }
    case 'auto_number':
      throw new ValidationError(`A coluna "${column.title}" é preenchida automaticamente.`);
  }
}

export function formatNumber(settings: ColumnSettings, n: number): string {
  const decimals = settings.decimals;
  const text = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? 4,
  }).format(n);
  const unit = settings.unit?.trim();
  if (!unit) return text;
  return settings.unitPosition === 'left' ? `${unit} ${text}` : `${text} ${unit}`;
}

export interface TextContext {
  people?: Person[];
  itemNumber?: number;
}

/** Representação textual de um valor (busca, registro de atividades, MCP). */
export function valueToText(column: Column, value: CellValue | undefined, ctx: TextContext = {}): string {
  if (column.type === 'auto_number') return ctx.itemNumber != null ? formatItemRef(column.settings, ctx.itemNumber) : '';
  if (value == null) return '';
  switch (column.type) {
    case 'status':
      return statusLabelOf(column, value)?.name ?? '';
    case 'people':
      return (value as number[]).map((id) => ctx.people?.find((p) => p.id === id)?.name ?? `#${id}`).join(', ');
    case 'checkbox':
      return value ? '✓' : '';
    case 'link': {
      const link = value as LinkValue;
      return link.text || link.url;
    }
    case 'number':
      return formatNumber(column.settings, value as number);
    default:
      return String(value);
  }
}

export function snapshotValue(column: Column, value: CellValue | undefined, ctx: TextContext = {}): ActivitySnapshot | null {
  if (isEmptyValue(value ?? null)) return null;
  if (column.type === 'status') {
    const label = statusLabelOf(column, value);
    return label ? { text: label.name, color: label.color } : null;
  }
  const text = valueToText(column, value, ctx);
  return text ? { text: text.length > 140 ? `${text.slice(0, 137)}…` : text } : null;
}

/** Chave de ordenação de um valor (null = vazio, vai para o fim). */
export function sortKey(column: Column, value: CellValue | undefined, ctx: TextContext = {}): string | number | null {
  if (column.type === 'auto_number') return ctx.itemNumber ?? null;
  if (value == null) return null;
  switch (column.type) {
    case 'status': {
      const idx = column.settings.labels?.findIndex((l) => l.id === value) ?? -1;
      return idx < 0 ? null : idx;
    }
    case 'number':
      return value as number;
    case 'checkbox':
      return value ? 0 : null;
    case 'people':
    case 'link':
    case 'text':
    case 'long_text':
      return fold(valueToText(column, value, ctx)) || null;
    default:
      return String(value);
  }
}

export function sameValue(a: CellValue | undefined, b: CellValue | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function defaultStatusLabels(): StatusLabel[] {
  return [
    { id: 1, name: 'Em andamento', color: '#fdab3d' },
    { id: 2, name: 'Feito', color: '#00c875' },
    { id: 3, name: 'Parado', color: '#df2f4a' },
  ];
}

export function defaultColumnSettings(type: ColumnType): ColumnSettings {
  switch (type) {
    case 'status':
      return { labels: defaultStatusLabels(), doneLabelId: 2 };
    case 'auto_number':
      return { prefix: '', pad: 3 };
    case 'number':
      return { unit: '', unitPosition: 'right', decimals: null };
    default:
      return {};
  }
}

const DONE_NAMES = ['feito', 'concluido', 'concluida', 'done', 'finalizado', 'pronto', 'entregue'];

/** Identifica a etiqueta "concluído" de uma coluna de status. */
export function doneLabelId(column: Column): number | null {
  if (column.type !== 'status') return null;
  if (column.settings.doneLabelId != null) return column.settings.doneLabelId;
  return column.settings.labels?.find((l) => DONE_NAMES.includes(fold(l.name)))?.id ?? null;
}

/** Item está "feito" se alguma coluna de status dele está na etiqueta de conclusão. */
export function isItemDone(columns: Column[], item: { values: Record<string, CellValue> }): boolean {
  return columns.some((c) => {
    const done = doneLabelId(c);
    return done != null && item.values[String(c.id)] === done;
  });
}

/** Coluna de status principal: a do Kanban se tiver etiqueta de concluído; senão a primeira que tiver (ou a primeira de status). */
export function primaryStatusColumn(columns: Column[], laneColumnId?: number | null): Column | null {
  const statuses = columns.filter((c) => c.type === 'status');
  const ordered = [...statuses.filter((c) => c.id === laneColumnId), ...statuses.filter((c) => c.id !== laneColumnId)];
  return ordered.find((c) => doneLabelId(c) != null) ?? ordered[0] ?? null;
}

const DUE_TITLE = /prazo|entrega|vencimento|deadline|due/;

/** Coluna de data principal (o prazo): prefere títulos como "Prazo" ou "Entrega"; senão a primeira de data. */
export function primaryDateColumn(columns: Column[]): Column | null {
  const dates = columns.filter((c) => c.type === 'date');
  return dates.find((c) => DUE_TITLE.test(fold(c.title))) ?? dates[0] ?? null;
}
