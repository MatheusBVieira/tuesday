// Modelos de quadro (dados puros — usados pelo servidor, pelo quadro de exemplo e pela interface).
import type { BoardTemplate, StatusLabel } from './types';

const toLabels = (list: [string, string][]): StatusLabel[] => list.map(([name, color], i) => ({ id: i + 1, name, color }));

/** Status de desenvolvimento — "Feito" (id 5) é a etiqueta de conclusão. */
export const DEV_STATUS = toLabels([
  ['Pronto pra começar', '#579bfc'],
  ['Em andamento', '#fdab3d'],
  ['Em revisão', '#9d50dd'],
  ['Bloqueado', '#df2f4a'],
  ['Feito', '#00c875'],
]);

export const DEV_PRIORITY = toLabels([
  ['Crítica', '#333333'],
  ['Alta', '#401694'],
  ['Normal', '#579bfc'],
  ['Baixa', '#9aadbd'],
]);

export const DEV_TYPE = toLabels([
  ['Funcionalidade', '#00c875'],
  ['Melhoria', '#579bfc'],
  ['Bug', '#df2f4a'],
  ['Infraestrutura', '#784bd1'],
  ['Débito técnico', '#7e3b8a'],
  ['Outro', '#0086c0'],
]);

export const TASK_PRIORITY = toLabels([
  ['Crítica', '#333333'],
  ['Alta', '#401694'],
  ['Média', '#5559df'],
  ['Baixa', '#579bfc'],
]);

export const TEMPLATES: Record<BoardTemplate, { title: string; description: string; colors: string[] }> = {
  software: {
    title: 'Desenvolvimento de software',
    description: 'Sprint atual, Backlog e Concluído com Status, Prioridade, Tipo, Prazo e ID (ex.: APP-001).',
    colors: ['#579bfc', '#fdab3d', '#9d50dd', '#df2f4a', '#00c875'],
  },
  default: {
    title: 'Gestão de tarefas',
    description: 'Grupos "A fazer" e "Concluído" com Responsável, Status, Prazo e Prioridade.',
    colors: ['#fdab3d', '#00c875', '#df2f4a', '#579bfc'],
  },
  empty: {
    title: 'Em branco',
    description: 'Um grupo e uma coluna de status — monte do seu jeito.',
    colors: ['#c4c4c4'],
  },
};

/** Prefixo das referências dos itens a partir de um nome ("Meu App" → "MEU"). */
export function idPrefixFor(name: string): string {
  const clean = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return clean.slice(0, 3) || 'ID';
}
