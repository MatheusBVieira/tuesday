import fs from 'node:fs';
import path from 'node:path';
import type { BoardTemplate, IdFormat, Project } from '../../shared/types';
import { GROUP_COLORS, resolveColor } from '../../shared/colors';
import { webUrlFromRemote } from '../../shared/git';
import { idPrefixFor } from '../../shared/templates';
import { fold } from '../../shared/values';
import { badRequest, db, emitGlobalChange, insertId, notFound, nowIso, parseJson, tx, type Actor } from './common';
import { createBoard } from './boards';
import type { GitState } from './git';

interface ProjectRow {
  id: number;
  name: string;
  color: string;
  folder: string | null;
  position: number;
  git_state: string;
  board_count?: number;
  linked_commits?: number;
}

const toProject = (r: ProjectRow): Project => {
  const git = parseJson<GitState>(r.git_state, {});
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    folder: r.folder,
    position: r.position,
    boardCount: r.board_count ?? 0,
    git: r.folder
      ? {
          repos: Object.entries(git.repos ?? {}).map(([folder, repo]) => ({
            name: path.basename(folder),
            path: folder,
            remote: repo.remote ?? null,
            webUrl: webUrlFromRemote(repo.remote),
          })),
          lastSyncAt: git.lastSyncAt ?? null,
          error: git.error ?? null,
          linkedCommits: r.linked_commits ?? 0,
        }
      : null,
  };
};

const SELECT = `SELECT p.*,
  (SELECT COUNT(*) FROM boards b WHERE b.project_id = p.id) AS board_count,
  (SELECT COUNT(DISTINCT ic.hash) FROM item_commits ic WHERE ic.project_id = p.id) AS linked_commits
  FROM projects p`;

/** Estado inicial do Git ao vincular uma pasta: commits a partir de agora podem concluir itens. */
const freshGitState = (folder: string | null) => (folder ? JSON.stringify({ initializedAt: nowIso() }) : '{}');

// Windows e macOS não diferenciam maiúsculas nos caminhos.
const caseless = process.platform === 'win32' || process.platform === 'darwin';
const comparable = (p: string) => (caseless ? p.toLowerCase() : p);

export function normalizeFolder(input: string): string {
  return path.resolve(input.trim().replace(/^["']+|["']+$/g, ''));
}

export function sameFolder(a: string, b: string): boolean {
  return comparable(normalizeFolder(a)) === comparable(normalizeFolder(b));
}

/** `dir` é a própria pasta ou está dentro dela? */
export function isInsideFolder(dir: string, folder: string): boolean {
  const d = comparable(normalizeFolder(dir));
  const f = comparable(normalizeFolder(folder));
  return d === f || d.startsWith(f.endsWith(path.sep) ? f : f + path.sep);
}

export function listProjects(): Project[] {
  return (db().prepare(`${SELECT} ORDER BY p.position, p.id`).all() as ProjectRow[]).map(toProject);
}

export function getProject(id: number): Project | null {
  const row = db().prepare(`${SELECT} WHERE p.id = ?`).get(id) as ProjectRow | undefined;
  return row ? toProject(row) : null;
}

export function requireProject(id: number): Project {
  const project = getProject(id);
  if (!project) throw notFound('Projeto não encontrado.');
  return project;
}

function validateFolder(input: string, exceptId: number | null): string {
  const folder = normalizeFolder(input);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(folder);
  } catch {
    throw badRequest(`A pasta "${folder}" não existe.`);
  }
  if (!stat.isDirectory()) throw badRequest(`"${folder}" não é uma pasta.`);
  const taken = listProjects().find((p) => p.id !== exceptId && p.folder && sameFolder(p.folder, folder));
  if (taken) throw badRequest(`Essa pasta já está vinculada ao projeto "${taken.name}".`);
  return folder;
}

export function createProject(
  input: { name: string; color?: string | null; folder?: string | null; template?: BoardTemplate | null; boardName?: string } & IdFormat,
  actor: Actor,
): { project: Project; boardId: number | null } {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw badRequest('Dê um nome ao projeto.');
  const folder = input.folder?.trim() ? validateFolder(input.folder, null) : null;
  const used = new Set(listProjects().map((p) => p.color));
  const color = resolveColor(input.color) ?? GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[used.size % GROUP_COLORS.length];

  const created = tx(() => {
    const max = (db().prepare('SELECT MAX(position) AS p FROM projects').get() as { p: number | null }).p ?? 0;
    const id = insertId(
      'INSERT INTO projects (name, color, folder, position, git_state) VALUES (?, ?, ?, ?, ?)',
      name,
      color,
      folder,
      max + 1000,
      freshGitState(folder),
    );
    const boardId = input.template
      ? createBoard(
          {
            name: input.boardName ?? 'Tarefas',
            template: input.template,
            projectId: id,
            idPrefix: input.idPrefix || idPrefixFor(name),
            idPad: input.idPad,
            idStart: input.idStart,
          },
          actor,
        ).id
      : null;
    return { id, boardId };
  });
  emitGlobalChange(actor);
  return { project: requireProject(created.id), boardId: created.boardId };
}

/** Garante que existe ao menos um projeto (para quadros criados sem projeto). */
export function ensureDefaultProject(actor: Actor): Project {
  return listProjects()[0] ?? createProject({ name: 'Geral', color: '#0073ea' }, actor).project;
}

export function updateProject(
  id: number,
  patch: { name?: string; color?: string | null; folder?: string | null; position?: number },
  actor: Actor,
): Project {
  const project = requireProject(id);
  const name = patch.name !== undefined ? patch.name.trim().slice(0, 80) || project.name : project.name;
  const color = patch.color !== undefined ? (resolveColor(patch.color) ?? project.color) : project.color;
  const folder = patch.folder === undefined ? project.folder : patch.folder?.trim() ? validateFolder(patch.folder, id) : null;
  const position = patch.position ?? project.position;
  db().prepare('UPDATE projects SET name = ?, color = ?, folder = ?, position = ? WHERE id = ?').run(name, color, folder, position, id);
  if (folder !== project.folder) db().prepare('UPDATE projects SET git_state = ? WHERE id = ?').run(freshGitState(folder), id);
  emitGlobalChange(actor);
  return requireProject(id);
}

/** Remove o projeto com todos os quadros dele. */
export function deleteProject(id: number, actor: Actor): void {
  requireProject(id);
  if (listProjects().length <= 1) throw badRequest('Mantenha pelo menos um projeto.');
  db().prepare('DELETE FROM projects WHERE id = ?').run(id);
  emitGlobalChange(actor);
}

/** Aceita id ou nome do projeto (sem diferenciar acentos/caixa). */
export function resolveProject(ref: number | string): Project {
  const raw = String(ref).trim();
  const projects = listProjects();
  if (typeof ref === 'number' || /^\d+$/.test(raw)) {
    const byId = projects.find((p) => p.id === Number(raw));
    if (byId) return byId;
  }
  const key = fold(raw);
  const exact = projects.filter((p) => fold(p.name) === key);
  if (exact.length === 1) return exact[0];
  const partial = projects.filter((p) => fold(p.name).includes(key));
  if (exact.length === 0 && partial.length === 1) return partial[0];
  const known = projects.map((p) => `${p.name} (id ${p.id})`).join(', ') || '(nenhum)';
  if (exact.length > 1 || partial.length > 1) throw badRequest(`Mais de um projeto corresponde a "${raw}". Projetos: ${known}.`);
  throw notFound(`Projeto "${raw}" não encontrado. Projetos: ${known}.`);
}

/** Projeto cuja pasta contém `dir` (a mais específica, se houver pastas aninhadas). */
export function findProjectByFolder(dir: string): Project | null {
  let best: Project | null = null;
  for (const project of listProjects()) {
    if (!project.folder || !isInsideFolder(dir, project.folder)) continue;
    if (!best || project.folder.length > (best.folder?.length ?? 0)) best = project;
  }
  return best;
}
