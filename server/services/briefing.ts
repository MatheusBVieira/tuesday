// Resumo do projeto para o Claude: o que está em andamento, bloqueado e atrasado (hook de início de sessão e "tuesday brief").
import path from 'node:path';
import type { Project } from '../../shared/types';
import { fold, formatItemRef, isItemDone, primaryDateColumn, primaryStatusColumn, statusLabelOf, todayIso } from '../../shared/values';
import { subitemProgress } from '../../shared/subitems';
import { ROOT_DIR } from '../db/connection';
import { RUNTIME } from '../runtime';
import { getBoard, listBoards } from './boards';

/** done: concluído · blocked: bloqueado · active: em andamento · todo: ainda não começou */
export type WorkState = 'done' | 'blocked' | 'active' | 'todo';

const BLOCKED = /bloque|parad|imped|travad|stuck|blocked/;
const NOT_STARTED = /pronto pra|pronto para|a fazer|to do|todo|backlog|nao inici|cancel/;
// Itens em grupos como "Concluído" contam como feitos, mesmo que o status seja "Aguardando deploy".
const DONE_GROUP = /conclu|feito|done|finaliz|arquiv|entregue/;

export interface BriefItem {
  id: number;
  boardId: number;
  /** referência formatada (ex.: TM-07) */
  ref: string | null;
  /** chave para casar com citações em commits e branches (ex.: TM-7) */
  key: string | null;
  name: string;
  status: string | null;
  /** etiquetas da coluna de status principal do quadro */
  statusOptions: string[];
  priority: string | null;
  /** posição da prioridade na coluna (0 = a mais alta) */
  priorityRank: number;
  due: string | null;
  state: WorkState;
  overdue: boolean;
  /** subitens (checklist), na ordem */
  subitems: { name: string; done: boolean }[];
}

export function projectItems(projectId: number): BriefItem[] {
  const today = todayIso();
  const out: BriefItem[] = [];
  for (const summary of listBoards().filter((b) => b.projectId === projectId)) {
    const board = getBoard(summary.id);
    const status = primaryStatusColumn(board.columns, board.settings.kanban?.laneColumnId);
    const priority = board.columns.find((c) => c.type === 'status' && /priori/.test(fold(c.title)));
    const dueColumn = primaryDateColumn(board.columns);
    const refColumn = board.columns.find((c) => c.type === 'auto_number');
    const prefix = refColumn?.settings.prefix?.trim().toUpperCase();
    const doneGroups = new Set(board.groups.filter((g) => DONE_GROUP.test(fold(g.name))).map((g) => g.id));
    const statusOptions = (status?.settings.labels ?? []).map((l) => l.name).filter(Boolean);

    for (const item of board.items) {
      const label = status ? statusLabelOf(status, item.values[String(status.id)]) : null;
      const priorityLabel = priority ? statusLabelOf(priority, item.values[String(priority.id)]) : null;
      const due = dueColumn ? ((item.values[String(dueColumn.id)] as string | undefined) ?? null) : null;
      const name = fold(label?.name ?? '');
      const state: WorkState =
        isItemDone(board.columns, item) || doneGroups.has(item.groupId)
          ? 'done'
          : BLOCKED.test(name)
            ? 'blocked'
            : !name || NOT_STARTED.test(name)
              ? 'todo'
              : 'active';
      out.push({
        id: item.id,
        boardId: board.id,
        ref: refColumn ? formatItemRef(refColumn.settings, item.number) : null,
        key: prefix ? `${prefix}-${item.number}` : null,
        name: item.name,
        status: label?.name ?? null,
        statusOptions,
        priority: priorityLabel?.name ?? null,
        priorityRank: priorityLabel ? (priority?.settings.labels ?? []).findIndex((l) => l.id === priorityLabel.id) : 99,
        due,
        state,
        overdue: state !== 'done' && !!due && due < today,
        subitems: item.subitems.map((s) => ({ name: s.name, done: s.done })),
      });
    }
  }
  return out;
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** "subitens 2/5" — ou null se o item não tem subitens. */
export function progressText(item: BriefItem): string | null {
  const { done, total } = subitemProgress(item.subitems);
  return total ? `subitens ${done}/${total}` : null;
}

/** "[x] Criar a migração; [ ] Endpoint da API; …" */
export function checklistText(item: BriefItem, max = 12): string {
  const shown = item.subitems.slice(0, max).map((s) => `[${s.done ? 'x' : ' '}] ${cut(s.name, 80)}`);
  const more = item.subitems.length > max ? `; … e mais ${item.subitems.length - max}` : '';
  return `${shown.join('; ')}${more}`;
}

function describe(item: BriefItem, opts: { status?: boolean } = {}): string {
  const details = [
    opts.status !== false ? item.status : null,
    item.priority,
    item.due ? `prazo ${item.due}` : null,
    progressText(item),
  ].filter(Boolean);
  return `${item.ref ? `${item.ref} ` : ''}${cut(item.name, 90)}${details.length ? ` — ${details.join(' · ')}` : ''}`;
}

const byPriority = (a: BriefItem, b: BriefItem) => a.priorityRank - b.priorityRank || (a.due ?? '9').localeCompare(b.due ?? '9');

function section(title: string, items: BriefItem[], limit: number, opts: { status?: boolean } = {}): string {
  if (!items.length) return `${title} (0): nenhum.`;
  const shown = [...items].sort(byPriority).slice(0, limit);
  const more = items.length > shown.length ? `\n- … e mais ${items.length - shown.length}` : '';
  return `${title} (${items.length}):\n${shown.map((i) => `- ${describe(i, opts)}`).join('\n')}${more}`;
}

/** Comando da CLI do tuesday, para registrar trabalho sem o MCP (caminho com barras normais, entre aspas). */
export const cliCommand = (command: string) =>
  RUNTIME === 'desktop'
    ? `"${path.join(path.dirname(process.execPath), 'bin', 'tuesday.cmd').replace(/\\/g, '/')}" ${command}`
    : `node "${path.join(ROOT_DIR, 'bin', 'tuesday.mjs').replace(/\\/g, '/')}" ${command}`;
export const noteCommand = () => cliCommand('note');

export interface BranchFocus {
  repo: string;
  branch: string;
  items: BriefItem[];
}

export function buildBriefing(project: Project, items: BriefItem[] = projectItems(project.id), focus: BranchFocus[] = []): string {
  const open = items.filter((i) => i.state !== 'done');
  const example = focus.flatMap((f) => f.items)[0]?.ref ?? items.find((i) => i.ref)?.ref ?? 'ABC-1';
  const lines = [
    `[tuesday] Projeto "${project.name}"${project.folder ? ` (pasta ${project.folder})` : ''} — ${open.length} itens abertos de ${items.length}.`,
  ];
  for (const f of focus) {
    lines.push(
      f.items.length
        ? `Branch atual em ${f.repo}: ${f.branch} → ${f.items.map((i) => describe(i)).join('; ')}`
        : `Branch atual em ${f.repo}: ${f.branch}`,
    );
    for (const item of f.items) if (item.subitems.length) lines.push(`  Subitens de ${item.ref ?? item.name}: ${checklistText(item)}`);
  }
  lines.push(
    '',
    section(
      'Bloqueados',
      open.filter((i) => i.state === 'blocked'),
      10,
    ),
    section(
      'Em andamento',
      open.filter((i) => i.state === 'active'),
      15,
    ),
    section(
      'Atrasados',
      open.filter((i) => i.overdue),
      10,
    ),
    section(
      'Próximos na fila',
      open.filter((i) => i.state === 'todo'),
      8,
    ),
    '',
    `Como registrar o trabalho: cite a referência nas mensagens de commit ("${example}: …"; "fixes ${example}" conclui o item). ` +
      'Para um trabalho com várias etapas, quebre o item em subitens (add_subitems) e marque cada passo ao concluí-lo (update_subitems). ' +
      'Ao terminar algo, poste uma atualização no item e ajuste o status pelas ferramentas do tuesday (add_update, update_items). ' +
      `Sem o MCP do tuesday, use: ${noteCommand()} ${example} --claude --status "<etiqueta>" "o que foi feito" ` +
      `e ${cliCommand('check')} ${example} --claude "<passo>" para marcar um subitem.`,
  );
  return lines.join('\n');
}
