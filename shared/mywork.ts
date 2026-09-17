// "Meu trabalho": em que faixa de prazo cada item cai — regras puras, usadas pela tela e pelo MCP.

export type WorkBucket = 'overdue' | 'today' | 'this_week' | 'next_week' | 'later' | 'no_date' | 'done';

export interface WorkBucketInfo {
  key: WorkBucket;
  title: string;
  color: string;
  /** texto da faixa vazia — as faixas com texto aparecem mesmo sem itens */
  empty?: string;
}

export const WORK_BUCKETS: WorkBucketInfo[] = [
  { key: 'overdue', title: 'Atrasado', color: '#df2f4a', empty: 'Nenhum item atrasado.' },
  { key: 'today', title: 'Hoje', color: '#00c875', empty: 'Nada vence hoje.' },
  { key: 'this_week', title: 'Esta semana', color: '#579bfc', empty: 'Nada mais para esta semana.' },
  { key: 'next_week', title: 'Próxima semana', color: '#9d50dd' },
  { key: 'later', title: 'Mais tarde', color: '#0086c0' },
  { key: 'no_date', title: 'Sem data', color: '#757575' },
  { key: 'done', title: 'Concluído', color: '#037f4c' },
];

const DAY_MS = 86_400_000;

const utc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

export function addDaysIso(iso: string, days: number): string {
  return new Date(utc(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Domingo da semana de `today` — as semanas vão de segunda a domingo. */
export function endOfWeekIso(today: string): string {
  const weekday = (new Date(utc(today)).getUTCDay() + 6) % 7; // 0 = segunda
  return addDaysIso(today, 6 - weekday);
}

/** Faixa de um item pelo prazo (`date`, AAAA-MM-DD) em relação a `today`. */
export function workBucket(date: string | null | undefined, today: string, done = false): WorkBucket {
  if (done) return 'done';
  if (!date) return 'no_date';
  if (date < today) return 'overdue';
  if (date === today) return 'today';
  const weekEnd = endOfWeekIso(today);
  if (date <= weekEnd) return 'this_week';
  return date <= addDaysIso(weekEnd, 7) ? 'next_week' : 'later';
}
