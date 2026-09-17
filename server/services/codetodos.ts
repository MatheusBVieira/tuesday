// TODO/FIXME do código como itens: varre a pasta do projeto, importa as marcações escolhidas (com link que abre o
// arquivo na linha, no editor) e mantém a linha certa quando o código muda.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CodeTodo, CodeTodoImportResult, CodeTodoItem, CodeTodoScan, Column, LinkValue, RemovedCodeTodo } from '../../shared/types';
import {
  EDITOR_SCHEMES,
  codeLanguage,
  editorUrl,
  isEditorUrl,
  isScannableFile,
  parseTodos,
  todoItemName,
  todoKey,
  type ParsedTodo,
  type TodoTag,
} from '../../shared/codetodos';
import { parseCommitRefs } from '../../shared/git';
import { doneLabelId, fold, formatItemRef, isItemDone, primaryStatusColumn } from '../../shared/values';
import { badRequest, db, emitBoardChange, nowIso, parseJson, tx, type Actor } from './common';
import { getBoardSettings, listBoards } from './boards';
import { createColumn, listColumns } from './columns';
import { findRepos, projectPrefixes } from './git';
import { listGroups } from './groups';
import { createItem, getItem, setItemValues } from './items';
import { requireProject } from './projects';
import { createUpdate } from './updates';

const MAX_FILES = 20_000;
const MAX_TODOS = 2_000;
const MAX_FILE_BYTES = 1_000_000;
const WALK_SKIP = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  'coverage',
  'bin',
  'obj',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__',
  '.gradle',
  '.idea',
  '.vscode',
]);
const MARKERS = '(TODO|FIXME|HACK|XXX)';

/** Movimentos automáticos (linha atualizada, marcação que sumiu) não entram no registro de atividades. */
const CODE_ACTOR: Actor = { source: 'git', personId: null, clientId: null };

/** Editor dos links: TUESDAY_EDITOR=cursor (ou vscode-insiders, windsurf); padrão VS Code. */
function editorScheme(): string {
  const wanted = process.env.TUESDAY_EDITOR?.trim().toLowerCase();
  return (EDITOR_SCHEMES as readonly string[]).includes(wanted ?? '') ? wanted! : 'vscode';
}

interface FoundTodo extends ParsedTodo {
  fingerprint: string;
  absPath: string;
  /** relativo à pasta do projeto, com "/" */
  relPath: string;
  repo: string | null;
}

interface TrackedRow {
  fingerprint: string;
  item_id: number;
  path: string;
  line: number;
  col: number;
  tag: string;
  text: string;
  removed_at: string | null;
}

const fingerprintOf = (key: string) => createHash('sha1').update(key).digest('hex').slice(0, 16);
const relative = (folder: string, file: string) => path.relative(folder, file).replace(/\\/g, '/');
const linkText = (relPath: string, line: number) => `${relPath.split('/').pop()}:${line}`;

/** Marcações de um arquivo com a identidade de cada uma (repetições idênticas no mesmo arquivo são numeradas). */
function identify(relPath: string, parsed: ParsedTodo[]): { todo: ParsedTodo; fingerprint: string }[] {
  const seen = new Map<string, number>();
  return parsed.map((todo) => {
    const base = todoKey(relPath, todo, 0);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return { todo, fingerprint: fingerprintOf(todoKey(relPath, todo, occurrence)) };
  });
}

function readText(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    const buffer = fs.readFileSync(file);
    if (buffer.subarray(0, 8000).includes(0)) return null; // binário
    return buffer.toString('utf8');
  } catch {
    return null;
  }
}

/** Arquivos do repositório que citam alguma marcação (respeita o .gitignore; inclui arquivos ainda não commitados). */
function gitCandidates(repo: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      // -z: nomes de arquivo sem escapes (acentos chegariam como "\303\247")
      ['grep', '-l', '-z', '-I', '--untracked', '-E', '-e', MARKERS],
      { cwd: repo, windowsHide: true, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', timeout: 30_000 },
      (error, stdout, stderr) => {
        // git grep sai com 1 quando não encontra nada
        if (error && !(error.code === 1 && !stderr.trim()))
          reject(new Error(`${path.basename(repo)}: ${(stderr || error.message).split('\n')[0]}`));
        else
          resolve(
            stdout
              .split('\0')
              .filter(Boolean)
              .map((file) => path.join(repo, file)),
          );
      },
    );
  });
}

/** Pasta sem Git: percorre ignorando dependências e saídas de build. */
function walkCandidates(folder: string): { files: string[]; truncated: boolean } {
  const files: string[] = [];
  const stack = [folder];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!WALK_SKIP.has(entry.name) && !entry.name.startsWith('.')) stack.push(full);
      } else if (entry.isFile() && isScannableFile(entry.name)) {
        if (files.length >= MAX_FILES) return { files, truncated: true };
        files.push(full);
      }
    }
  }
  return { files, truncated: false };
}

async function scanFolder(folder: string): Promise<{ todos: FoundTodo[]; files: number; truncated: boolean; errors: string[] }> {
  if (!fs.existsSync(folder)) return { todos: [], files: 0, truncated: false, errors: [`A pasta ${folder} não existe mais.`] };
  const repos = findRepos(folder);
  const errors: string[] = [];
  let truncated = false;
  const sources: { root: string; repo: string | null; files: string[] }[] = [];
  if (repos.length) {
    for (const repo of repos) {
      try {
        sources.push({ root: repo, repo: repo === folder ? null : path.basename(repo), files: await gitCandidates(repo) });
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
  } else {
    const walked = walkCandidates(folder);
    truncated = walked.truncated;
    sources.push({ root: folder, repo: null, files: walked.files });
  }

  const todos: FoundTodo[] = [];
  let files = 0;
  for (const source of sources) {
    for (const file of source.files.sort()) {
      if (!isScannableFile(file)) continue;
      const content = readText(file);
      if (content == null) continue;
      files++;
      const relPath = relative(folder, file);
      for (const { todo, fingerprint } of identify(relPath, parseTodos(content))) {
        if (todos.length >= MAX_TODOS) return { todos, files, truncated: true, errors };
        todos.push({ ...todo, fingerprint, absPath: file, relPath, repo: source.repo });
      }
    }
  }
  return { todos, files, truncated, errors };
}

// ── Itens ligados ──

function itemSummary(itemId: number, columnsCache: Map<number, Column[]>): CodeTodoItem | null {
  const row = db().prepare('SELECT id, board_id, number, name, deleted_at FROM items WHERE id = ?').get(itemId) as
    { id: number; board_id: number; number: number; name: string; deleted_at: string | null } | undefined;
  if (!row) return null;
  let columns = columnsCache.get(row.board_id);
  if (!columns) columnsCache.set(row.board_id, (columns = listColumns(row.board_id)));
  const values = Object.fromEntries(
    (db().prepare('SELECT column_id, value FROM item_values WHERE item_id = ?').all(itemId) as { column_id: number; value: string }[]).map(
      (v) => [String(v.column_id), JSON.parse(v.value)],
    ),
  );
  const refColumn = columns.find((c) => c.type === 'auto_number');
  return {
    id: row.id,
    boardId: row.board_id,
    ref: refColumn ? formatItemRef(refColumn.settings, row.number) : null,
    name: row.name,
    done: isItemDone(columns, { values }),
    deleted: row.deleted_at != null,
  };
}

const trackedRows = (projectId: number) => db().prepare('SELECT * FROM code_todos WHERE project_id = ?').all(projectId) as TrackedRow[];

/** Atualiza o link "arquivo:linha" do item sem registrar atividade (é só o código que andou). */
function moveLink(itemId: number, url: string, text: string): number | null {
  const item = db().prepare('SELECT board_id FROM items WHERE id = ?').get(itemId) as { board_id: number } | undefined;
  if (!item) return null;
  const column = listColumns(item.board_id).find((c) => {
    if (c.type !== 'link') return false;
    const current = db().prepare('SELECT value FROM item_values WHERE item_id = ? AND column_id = ?').get(itemId, c.id) as
      { value: string } | undefined;
    return !!current && isEditorUrl(parseJson<LinkValue>(current.value, { url: '' }).url);
  });
  if (!column) return null;
  db()
    .prepare('UPDATE item_values SET value = ?, updated_at = ? WHERE item_id = ? AND column_id = ?')
    .run(JSON.stringify({ url, text } satisfies LinkValue), nowIso(), itemId, column.id);
  return item.board_id;
}

/** Confere as marcações já importadas contra o que foi encontrado: linha nova, sumiu ou voltou. */
function reconcile(projectId: number, found: Map<string, FoundTodo>, complete: boolean, onlyPaths?: Set<string>): Set<number> {
  const touched = new Set<number>();
  const scheme = editorScheme();
  tx(() => {
    for (const row of trackedRows(projectId)) {
      if (onlyPaths && !onlyPaths.has(row.path)) continue;
      const todo = found.get(row.fingerprint);
      if (todo) {
        if (todo.line !== row.line || todo.column !== row.col || row.removed_at) {
          db()
            .prepare('UPDATE code_todos SET line = ?, col = ?, removed_at = NULL WHERE project_id = ? AND fingerprint = ?')
            .run(todo.line, todo.column, projectId, row.fingerprint);
          const board = moveLink(row.item_id, editorUrl(todo.absPath, todo.line, todo.column, scheme), linkText(todo.relPath, todo.line));
          if (board != null) touched.add(board);
        }
      } else if (complete && !row.removed_at) {
        db()
          .prepare('UPDATE code_todos SET removed_at = ? WHERE project_id = ? AND fingerprint = ?')
          .run(nowIso(), projectId, row.fingerprint);
        const item = db().prepare('SELECT board_id FROM items WHERE id = ?').get(row.item_id) as { board_id: number } | undefined;
        if (item) touched.add(item.board_id);
      }
    }
  });
  return touched;
}

export async function scanCodeTodos(projectId: number): Promise<CodeTodoScan> {
  const project = requireProject(projectId);
  if (!project.folder) throw badRequest(`O projeto "${project.name}" não tem pasta vinculada — vincule a pasta do código primeiro.`);
  const scan = await scanFolder(project.folder);
  const found = new Map(scan.todos.map((t) => [t.fingerprint, t]));
  const touched = reconcile(projectId, found, !scan.truncated && !scan.errors.length);
  for (const boardId of touched) emitBoardChange(CODE_ACTOR, boardId);

  const columns = new Map<number, Column[]>();
  const tracked = new Map(trackedRows(projectId).map((r) => [r.fingerprint, r]));
  // "TODO TM-40: …" já pertence ao TM-40.
  const prefixes = projectPrefixes(projectId);
  const boards = listBoards().filter((b) => b.projectId === projectId);
  const cited = (text: string): CodeTodoItem | null => {
    for (const ref of parseCommitRefs(text, prefixes).mentions) {
      for (const boardId of prefixes.get(ref.prefix) ?? []) {
        const row = db()
          .prepare('SELECT id FROM items WHERE board_id = ? AND number = ? AND deleted_at IS NULL')
          .get(boardId, ref.number) as { id: number } | undefined;
        if (row) return itemSummary(row.id, columns);
      }
    }
    return null;
  };
  const scheme = editorScheme();
  const todos: CodeTodo[] = scan.todos.map((t) => {
    const row = tracked.get(t.fingerprint);
    const item = row ? itemSummary(row.item_id, columns) : boards.length ? cited(t.text) : null;
    return {
      id: t.fingerprint,
      tag: t.tag,
      path: t.relPath,
      repo: t.repo,
      line: t.line,
      column: t.column,
      author: t.author,
      text: t.text,
      name: todoItemName(t, t.relPath),
      url: editorUrl(t.absPath, t.line, t.column, scheme),
      status: row && item ? 'imported' : item ? 'cited' : 'new',
      item,
    };
  });
  const removed: RemovedCodeTodo[] = [];
  for (const row of tracked.values()) {
    if (!row.removed_at) continue;
    const item = itemSummary(row.item_id, columns);
    if (item && !item.done && !item.deleted)
      removed.push({ tag: row.tag as TodoTag, path: row.path, line: row.line, text: row.text, item });
  }
  return {
    projectId,
    folder: project.folder,
    scannedAt: nowIso(),
    files: scan.files,
    todos,
    removed,
    truncated: scan.truncated,
    errors: scan.errors,
  };
}

// ── Importação ──

/** Coluna de link "Código" do quadro (criada na primeira importação). */
function codeColumn(boardId: number, actor: Actor): Column {
  const existing = listColumns(boardId).find((c) => c.type === 'link' && ['codigo', 'code', 'arquivo'].includes(fold(c.title)));
  return existing ?? createColumn(boardId, { title: 'Código', type: 'link', width: 190 }, actor);
}

/** FIXME/XXX → Bug · HACK → Débito técnico, se o quadro tiver uma coluna "Tipo" com essas etiquetas. */
function typeValue(columns: Column[], tag: TodoTag): Record<string, number> {
  const column = columns.find((c) => c.type === 'status' && /^(tipo|type)/.test(fold(c.title)));
  const wanted = tag === 'FIXME' || tag === 'XXX' ? /^bug/ : tag === 'HACK' ? /debito|divida|debt/ : null;
  const label = wanted && column?.settings.labels?.find((l) => wanted.test(fold(l.name)));
  return column && label ? { [String(column.id)]: label.id } : {};
}

function snippet(file: string, todo: CodeTodo): string {
  const lines = readText(file)?.split(/\r?\n/);
  if (!lines) return '';
  const from = Math.max(1, todo.line - 2);
  const to = Math.min(lines.length, todo.line + 4);
  const width = String(to).length;
  const body = lines
    .slice(from - 1, to)
    .map((text, i) => `${from + i === todo.line ? '>' : ' '} ${String(from + i).padStart(width)} | ${text.slice(0, 160)}`)
    .join('\n');
  return `\n\n\`\`\`${codeLanguage(todo.path)}\n${body.replace(/```/g, "'''")}\n\`\`\``;
}

export interface ImportCodeTodosInput {
  /** marcações a importar (padrão: todas as novas) */
  ids?: string[];
  tags?: TodoTag[];
  boardId?: number;
  groupId?: number;
  /** itens cuja marcação saiu do código e devem ir para concluído */
  completeItemIds?: number[];
  /** conclui todos os itens cuja marcação saiu do código */
  completeAllRemoved?: boolean;
}

export async function importCodeTodos(
  projectId: number,
  input: ImportCodeTodosInput,
  actor: Actor,
): Promise<CodeTodoImportResult & { scan: CodeTodoScan }> {
  const scan = await scanCodeTodos(projectId);
  const boards = listBoards().filter((b) => b.projectId === projectId);
  const board = input.boardId != null ? boards.find((b) => b.id === input.boardId) : boards[0];
  if (!board)
    throw badRequest(input.boardId != null ? 'O quadro informado não pertence a este projeto.' : 'O projeto ainda não tem quadros.');
  const groups = listGroups(board.id);
  const group =
    input.groupId != null ? groups.find((g) => g.id === input.groupId) : (groups.find((g) => /backlog/.test(fold(g.name))) ?? groups[0]);
  if (!group) throw badRequest(input.groupId != null ? 'O grupo informado não pertence a este quadro.' : 'O quadro não tem grupos.');

  const wanted = input.ids ? new Set(input.ids) : null;
  const chosen = scan.todos.filter(
    (t) => t.status === 'new' && (!wanted || wanted.has(t.id)) && (!input.tags || input.tags.includes(t.tag)),
  );
  const removable = new Map(scan.removed.map((r) => [r.item.id, r]));
  const toComplete = input.completeAllRemoved ? [...removable.keys()] : (input.completeItemIds ?? []).filter((id) => removable.has(id));
  if (!chosen.length && !toComplete.length) {
    return { boardId: board.id, groupName: group.name, created: [], completed: 0, scan };
  }

  const createdIds = tx(() => {
    const ids: number[] = [];
    if (chosen.length) {
      const link = codeColumn(board.id, actor);
      const columns = listColumns(board.id);
      const insert = db().prepare(
        'INSERT INTO code_todos (project_id, fingerprint, item_id, path, line, col, tag, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const todo of chosen) {
        const item = createItem(
          board.id,
          {
            name: todo.name,
            groupId: group.id,
            values: { [String(link.id)]: { url: todo.url, text: linkText(todo.path, todo.line) }, ...typeValue(columns, todo.tag) },
          },
          actor,
        );
        insert.run(projectId, todo.id, item.id, todo.path, todo.line, todo.column, todo.tag, todo.text);
        const author = todo.author ? ` (${todo.author})` : '';
        createUpdate(
          item.id,
          `**${todo.tag}**${author} importado de \`${todo.path}:${todo.line}\` — abra pela coluna **${link.title}**.${todo.text && todo.text !== todo.name ? `\n\n> ${todo.text}` : ''}${snippet(path.join(scan.folder, todo.path), todo)}`,
          actor,
        );
        ids.push(item.id);
      }
    }
    for (const itemId of toComplete) {
      const item = getItem(itemId);
      const status = primaryStatusColumn(listColumns(item.boardId), getBoardSettings(item.boardId).kanban?.laneColumnId);
      const done = status ? doneLabelId(status) : null;
      if (status && done != null) setItemValues(itemId, { [String(status.id)]: done }, actor);
    }
    return ids;
  });
  return { boardId: board.id, groupName: group.name, created: createdIds.map(getItem), completed: toComplete.length, scan };
}

// ── Linha certa ──

/** mtime de cada arquivo já conferido (por processo). */
const checkedMtimes = new Map<string, number>();

/**
 * Relê só os arquivos com marcações importadas que mudaram desde a última conferência e corrige a linha do link.
 * Barato o bastante para rodar junto da sincronização do Git (a cada 10 s com o app aberto).
 */
export function refreshCodeTodos(projectId: number): void {
  // Inclui as que sumiram: voltando para uma branch onde a marcação existe, ela volta a valer.
  const rows = db().prepare('SELECT DISTINCT path FROM code_todos WHERE project_id = ?').all(projectId) as { path: string }[];
  if (!rows.length) return;
  const folder = (db().prepare('SELECT folder FROM projects WHERE id = ?').get(projectId) as { folder: string | null } | undefined)?.folder;
  if (!folder || !fs.existsSync(folder)) return;
  const changed = new Set<string>();
  const found = new Map<string, FoundTodo>();
  for (const { path: relPath } of rows) {
    const absPath = path.join(folder, relPath);
    let mtime: number;
    try {
      mtime = fs.statSync(absPath).mtimeMs;
    } catch {
      mtime = -1; // arquivo apagado ou renomeado
    }
    if (checkedMtimes.get(absPath) === mtime) continue;
    checkedMtimes.set(absPath, mtime);
    changed.add(relPath);
    const content = mtime >= 0 ? readText(absPath) : null;
    for (const { todo, fingerprint } of identify(relPath, content ? parseTodos(content) : [])) {
      found.set(fingerprint, { ...todo, fingerprint, absPath, relPath, repo: null });
    }
  }
  if (!changed.size) return;
  for (const boardId of reconcile(projectId, found, true, changed)) emitBoardChange(CODE_ACTOR, boardId);
}
