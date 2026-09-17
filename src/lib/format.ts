const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_LONG = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
export const WEEKDAYS_SHORT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function parseIsoDate(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** "12 set" (ou "12 set 2025" se for outro ano). */
export function formatDateShort(iso: string): string {
  const { y, m, d } = parseIsoDate(iso);
  const sameYear = y === new Date().getFullYear();
  return `${d} ${MONTHS_SHORT[m - 1]}${sameYear ? '' : ` ${y}`}`;
}

export function formatDateLong(iso: string): string {
  const { y, m, d } = parseIsoDate(iso);
  return `${d} de ${MONTHS_LONG[m - 1]} de ${y}`;
}

export function monthLabel(year: number, month: number): string {
  const name = MONTHS_LONG[month];
  return `${name[0].toUpperCase()}${name.slice(1)} ${year}`;
}

/** Dias entre hoje e a data (negativo = passou). */
export function daysFromToday(iso: string): number {
  const { y, m, d } = parseIsoDate(iso);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return 'agora';
  if (diff < 3600) return `${Math.round(diff / 60)} min`;
  if (diff < 86_400) return `${Math.round(diff / 3600)} h`;
  const days = Math.round(diff / 86_400);
  if (days === 1) return 'ontem';
  if (days < 7) return `${days} d`;
  const date = new Date(iso);
  return formatDateShort(toIsoDate(date));
}

/** "há 5 min", "há 2 h", "agora", "ontem"… */
export function ago(iso: string): string {
  const text = relativeTime(iso);
  return /^\d+ (min|h|d)$/.test(text) ? `há ${text}` : text;
}

/** "F:\a\b\c\meu-app" → "…\c\meu-app" */
export function shortPath(folder: string): string {
  const parts = folder.split(/[\\/]+/).filter(Boolean);
  const sep = folder.includes('\\') ? '\\' : '/';
  return parts.length > 2 ? `…${sep}${parts.slice(-2).join(sep)}` : folder;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return `${formatDateLong(toIsoDate(date))}, ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
