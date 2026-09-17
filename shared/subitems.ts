// Subitens (checklist) de um item: progresso e leitura de listas coladas.
import type { Subitem } from './types';

export const MAX_SUBITEMS = 200;
export const MAX_SUBITEM_NAME = 500;

export interface SubitemProgress {
  done: number;
  total: number;
  /** todos os subitens feitos (e há pelo menos um) */
  complete: boolean;
}

export function subitemProgress(subitems: Pick<Subitem, 'done'>[]): SubitemProgress {
  const done = subitems.filter((s) => s.done).length;
  return { done, total: subitems.length, complete: subitems.length > 0 && done === subitems.length };
}

// "- [x] passo", "* passo", "1. passo", "2) passo", "☐ passo", "✔ passo"
const BULLET = /^\s*(?:[-*•·+]\s+|\d{1,3}[.)]\s+)?(?:([☐☑✓✔])\s*)?(?:\[([ xX]?)\]\s*)?/;

/** Quebra um texto (ex.: uma lista colada) em passos — um por linha, sem marcadores; "[x]" e "✔" vêm marcados. */
export function splitSteps(text: string): { name: string; done: boolean }[] {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const match = BULLET.exec(line)!;
      const done = (!!match[1] && match[1] !== '☐') || match[2]?.toLowerCase() === 'x';
      return { name: line.slice(match[0].length).trim().slice(0, MAX_SUBITEM_NAME), done };
    })
    .filter((step) => step.name);
}
