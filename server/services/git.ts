// Integração com Git: liga commits que citam itens (ex.: TUE-012) e conclui itens com "fixes TUE-012".
// A pasta vinculada ao projeto é lida com `git log` — não é preciso instalar hooks nos repositórios.
// Um projeto pode ter vários repositórios: a própria pasta, ou as subpastas de primeiro nível que são repositórios
// (ex.: uma pasta "loja" com "backend" e "front" dentro).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ColumnSettings, GitSyncResult, ItemCommit } from '../../shared/types';
import { GIT_LOG_FORMAT, commitUrl, parseCommitRefs, parseGitLog, webUrlFromRemote, type RawCommit } from '../../shared/git';
import { doneLabelId, primaryStatusColumn } from '../../shared/values';
import { db, emitBoardChange, emitGlobalChange, inIds, nowIso, parseJson, tx, type Actor } from './common';
import { logActivity } from './activity';
import { getBoardSettings } from './boards';
import { listColumns } from './columns';
import { setItemValues } from './items';
import { refreshCodeTodos } from './codetodos';
import { getProject, listProjects } from './projects';

/** Estado de um repositório entre sincronizações. */
export interface GitRepoState {
  remote: string | null;
  /** refs + HEAD + prefixos + itens: se não mudou, não relê o histórico */
  signature: string;
}

export interface GitState {
  /** commits (committer date) a partir deste momento podem concluir itens */
  initializedAt?: string;
  lastSyncAt?: string;
  /** repositórios da pasta do projeto, pelo caminho absoluto */
  repos?: Record<string, GitRepoState>;
  error?: string | null;
}

export const GIT_ACTOR: Actor = { source: 'git', personId: null, clientId: null };

const MAX_COMMITS = 2000;
const MAX_REPOS = 12;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'coverage']);

export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', timeout: 20_000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`${stderr || error.message}`.trim()));
        else resolve(stdout);
      },
    );
  });
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/not a git repository/i.test(message)) return 'A pasta não é um repositório Git.';
  if (/ENOENT|not recognized|não é reconhecido/i.test(message)) return 'O Git não foi encontrado neste computador.';
  if (/dubious ownership/i.test(message))
    return 'O Git recusou a pasta (dubious ownership) — rode "git config --global --add safe.directory <pasta>".';
  return message.split('\n')[0].slice(0, 200);
}

/** Repositórios do projeto: a própria pasta, ou as subpastas de primeiro nível que são repositórios. */
export function findRepos(folder: string): string[] {
  if (fs.existsSync(path.join(folder, '.git'))) return [folder];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name))
    .map((entry) => path.join(folder, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, '.git')))
    .sort()
    .slice(0, MAX_REPOS);
}

export function readGitState(projectId: number): GitState {
  const row = db().prepare('SELECT git_state FROM projects WHERE id = ?').get(projectId) as { git_state: string } | undefined;
  return parseJson<GitState>(row?.git_state, {});
}

function saveGitState(projectId: number, state: GitState): void {
  db().prepare('UPDATE projects SET git_state = ? WHERE id = ?').run(JSON.stringify(state), projectId);
}

/** Prefixos das colunas "ID do item" dos quadros do projeto → quadros que usam cada um. */
export function projectPrefixes(projectId: number): Map<string, number[]> {
  const rows = db()
    .prepare(
      `SELECT c.board_id, c.settings FROM board_columns c JOIN boards b ON b.id = c.board_id
       WHERE b.project_id = ? AND c.type = 'auto_number'`,
    )
    .all(projectId) as { board_id: number; settings: string }[];
  const map = new Map<string, number[]>();
  for (const row of rows) {
    const prefix = (parseJson<ColumnSettings>(row.settings, {}).prefix ?? '').trim().toUpperCase();
    if (prefix) map.set(prefix, [...(map.get(prefix) ?? []), row.board_id]);
  }
  return map;
}

/** Coloca o item na etiqueta de concluído da coluna de status principal (a do kanban, se tiver). */
function closeItem(itemId: number, boardId: number): boolean {
  const column = primaryStatusColumn(listColumns(boardId), getBoardSettings(boardId).kanban?.laneColumnId);
  const done = column ? doneLabelId(column) : null;
  if (!column || done == null) return false;
  const current = db().prepare('SELECT value FROM item_values WHERE item_id = ? AND column_id = ?').get(itemId, column.id) as
    { value: string } | undefined;
  if (current && JSON.parse(current.value) === done) return false;
  setItemValues(itemId, { [String(column.id)]: done }, GIT_ACTOR);
  return true;
}

/** Liga a um item cada commit que cita a referência dele; "fixes X-1" também conclui, se o commit for posterior ao vínculo. */
function linkCommits(
  projectId: number,
  repo: string,
  commits: RawCommit[],
  prefixes: Map<string, number[]>,
  threshold: number,
  boards: Set<number>,
): { linked: number; closed: number } {
  const findItem = db().prepare(
    `SELECT id, board_id, name FROM items WHERE ${inIds('board_id')} AND number = ? AND deleted_at IS NULL LIMIT 1`,
  );
  const insertCommit = db().prepare(
    `INSERT INTO commits (project_id, hash, repo, subject, body, author_name, author_email, committed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  );
  const insertLink = db().prepare('INSERT INTO item_commits (item_id, project_id, hash) VALUES (?, ?, ?) ON CONFLICT DO NOTHING');
  const markClosed = db().prepare('UPDATE item_commits SET closed = 1 WHERE item_id = ? AND hash = ?');
  // Um rebase recria o commit com outro hash: não conclui de novo um item que o mesmo commit já concluiu.
  const closedBefore = db().prepare(
    `SELECT 1 FROM item_commits ic JOIN commits c ON c.project_id = ic.project_id AND c.hash = ic.hash
     WHERE ic.item_id = ? AND ic.closed = 1 AND c.subject = ? LIMIT 1`,
  );

  let linked = 0;
  let closed = 0;
  tx(() => {
    for (const commit of commits) {
      const { mentions, closes } = parseCommitRefs(`${commit.subject}\n${commit.body}`, prefixes);
      if (!mentions.length) continue;
      insertCommit.run(
        projectId,
        commit.hash,
        repo,
        commit.subject,
        commit.body,
        commit.authorName,
        commit.authorEmail,
        commit.committedAt,
      );
      for (const ref of mentions) {
        const item = findItem.get(JSON.stringify(prefixes.get(ref.prefix)), ref.number) as
          { id: number; board_id: number; name: string } | undefined;
        if (!item || insertLink.run(item.id, projectId, commit.hash).changes === 0) continue;
        linked++;
        boards.add(item.board_id);
        logActivity(
          {
            boardId: item.board_id,
            itemId: item.id,
            itemName: item.name,
            action: 'commit_linked',
            data: { text: commit.subject, hash: commit.hash.slice(0, 7) },
          },
          GIT_ACTOR,
        );
        const closesItem = closes.has(ref.key) && Date.parse(commit.committedAt) >= threshold && !closedBefore.get(item.id, commit.subject);
        if (closesItem && closeItem(item.id, item.board_id)) {
          markClosed.run(item.id, commit.hash);
          closed++;
        }
      }
    }
  });
  return { linked, closed };
}

const inFlight = new Map<number, Promise<GitSyncResult>>();

/** Lê o histórico dos repositórios do projeto e liga os commits novos. Sem `force`, só relê o que mudou. */
export function syncProjectGit(projectId: number, opts: { force?: boolean } = {}): Promise<GitSyncResult> {
  const running = inFlight.get(projectId);
  if (running) return running;
  const promise = runSync(projectId, opts.force ?? false).finally(() => inFlight.delete(projectId));
  inFlight.set(projectId, promise);
  return promise;
}

async function repoState(repo: string, key: string): Promise<GitRepoState> {
  const refs = await git(repo, ['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads', 'refs/remotes']);
  const head = await git(repo, ['rev-parse', '--verify', '-q', 'HEAD']).catch(() => '');
  const remote = await git(repo, ['remote', 'get-url', 'origin'])
    .then((s) => s.trim() || null)
    .catch(() => null);
  return { remote, signature: createHash('sha1').update(`${key}|${refs}|${head}`).digest('hex') };
}

async function runSync(projectId: number, force: boolean): Promise<GitSyncResult> {
  const project = getProject(projectId);
  const empty = { scanned: 0, linked: 0, closed: 0 };
  if (!project?.folder) return { ok: false, message: 'O projeto não tem pasta vinculada.', ...empty };
  const state = readGitState(projectId);

  const fail = (message: string): GitSyncResult => {
    if (state.error !== message || Object.keys(state.repos ?? {}).length > 0) {
      saveGitState(projectId, { ...state, repos: {}, error: message, lastSyncAt: nowIso() });
      emitGlobalChange(GIT_ACTOR);
    }
    return { ok: false, message, ...empty };
  };

  const repos = findRepos(project.folder);
  if (!repos.length) return fail('Nenhum repositório Git na pasta do projeto (nem nas subpastas dela).');

  const prefixes = projectPrefixes(projectId);
  // Itens novos ou renumerados (ex.: TM-07 importado depois) também pedem uma releitura: commits antigos podem citá-los.
  const items = db()
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS last, COALESCE(SUM(number), 0) AS total FROM items
       WHERE deleted_at IS NULL AND board_id IN (SELECT id FROM boards WHERE project_id = ?)`,
    )
    .get(projectId) as { n: number; last: number; total: number };
  const key = `${[...prefixes.keys()].sort().join(',') || '-'}|${items.n}:${items.last}:${items.total}`;
  // Commits de antes do vínculo só são ligados; a partir dele, "fixes X-1" também conclui o item.
  const threshold = state.initializedAt ? Date.parse(state.initializedAt) - 1000 : Number.POSITIVE_INFINITY;

  const nextRepos: Record<string, GitRepoState> = {};
  const failures: string[] = [];
  const boards = new Set<number>();
  let scanned = 0;
  let linked = 0;
  let closed = 0;

  for (const repo of repos) {
    const name = path.basename(repo);
    let current: GitRepoState;
    try {
      current = await repoState(repo, key);
    } catch (error) {
      failures.push(`${name}: ${friendlyError(error)}`);
      continue;
    }
    nextRepos[repo] = current;
    if (!prefixes.size || (!force && state.repos?.[repo]?.signature === current.signature)) continue;

    let commits: RawCommit[] = [];
    try {
      commits = parseGitLog(
        await git(repo, ['log', '--all', `--max-count=${MAX_COMMITS}`, '--encoding=UTF-8', `--format=${GIT_LOG_FORMAT}`]),
      );
    } catch (error) {
      if (!/does not have any commits|unknown revision|bad default revision/i.test(String(error))) {
        failures.push(`${name}: ${friendlyError(error)}`);
        delete nextRepos[repo]; // tenta de novo na próxima sincronização
        continue;
      }
    }
    scanned += commits.length;
    const result = linkCommits(projectId, repo, commits, prefixes, threshold, boards);
    linked += result.linked;
    closed += result.closed;
  }

  if (!Object.keys(nextRepos).length) return fail(failures.join(' · ') || 'Não foi possível ler os repositórios.');

  const error = failures.join(' · ') || null;
  const changed =
    linked > 0 || closed > 0 || (state.error ?? null) !== error || JSON.stringify(state.repos ?? {}) !== JSON.stringify(nextRepos);
  if (changed || force) {
    saveGitState(projectId, {
      ...state,
      initializedAt: state.initializedAt ?? nowIso(),
      repos: nextRepos,
      error,
      lastSyncAt: nowIso(),
    });
  }
  for (const boardId of boards) emitBoardChange(GIT_ACTOR, boardId);
  if (changed) emitGlobalChange(GIT_ACTOR);

  const where = repos.length > 1 ? ` em ${repos.length} repositórios` : '';
  const message = linked
    ? `${linked} ${linked === 1 ? 'commit ligado' : 'commits ligados'}${where}${closed ? `, ${closed} ${closed === 1 ? 'item concluído' : 'itens concluídos'}` : ''}.`
    : prefixes.size
      ? `Nenhum commit novo citando itens${where}.`
      : 'Os quadros deste projeto não têm coluna "ID do item" para citar nos commits.';
  return { ok: true, message: error ? `${message} (${error})` : message, scanned, linked, closed };
}

export function listItemCommits(itemId: number): ItemCommit[] {
  const rows = db()
    .prepare(
      `SELECT c.hash, c.repo, c.subject, c.body, c.author_name, c.author_email, c.committed_at, ic.closed, p.git_state
       FROM item_commits ic
       JOIN commits c ON c.project_id = ic.project_id AND c.hash = ic.hash
       LEFT JOIN projects p ON p.id = ic.project_id
       WHERE ic.item_id = ? ORDER BY c.committed_at DESC`,
    )
    .all(itemId) as {
    hash: string;
    repo: string | null;
    subject: string;
    body: string;
    author_name: string;
    author_email: string;
    committed_at: string;
    closed: number;
    git_state: string | null;
  }[];
  return rows.map((r) => {
    const state = parseJson<GitState>(r.git_state, {});
    const remote = r.repo ? (state.repos?.[r.repo]?.remote ?? null) : null;
    return {
      hash: r.hash,
      shortHash: r.hash.slice(0, 7),
      repo: r.repo ? path.basename(r.repo) : null,
      subject: r.subject,
      body: r.body,
      authorName: r.author_name,
      authorEmail: r.author_email,
      committedAt: r.committed_at,
      closed: r.closed === 1,
      url: commitUrl(webUrlFromRemote(remote), r.hash),
    };
  });
}

/** Verifica periodicamente os repositórios das pastas vinculadas (usado pelo servidor web). */
export function startGitWatcher(intervalMs = 10_000): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const project of listProjects()) {
        if (!project.folder) continue;
        await syncProjectGit(project.id).catch(() => undefined);
        try {
          refreshCodeTodos(project.id);
        } catch {
          /* a pasta pode estar inacessível no momento */
        }
      }
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), intervalMs).unref();
}
