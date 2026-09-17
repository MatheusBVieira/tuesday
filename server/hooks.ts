// Hooks do Claude Code (bin/tuesday-hook.mjs):
//   session-start → o Claude recebe o resumo do projeto da pasta (em andamento, bloqueados, atrasados, branch atual).
//   stop          → se houve commits citando itens, trabalho na branch de um item ou subitens marcados, e o Claude ainda não registrou nada,
//                   pede que ele poste a atualização e ajuste o status antes de encerrar.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Project } from '../shared/types';
import { GIT_LOG_FORMAT, parseCommitRefs, parseGitLog, type RawCommit } from '../shared/git';
import { DATA_DIR, getDb } from './db/connection';
import { subitemProgress } from '../shared/subitems';
import { buildBriefing, checklistText, cliCommand, noteCommand, projectItems, type BranchFocus, type BriefItem } from './services/briefing';
import { db, nowIso } from './services/common';
import { findRepos, git, projectPrefixes, syncProjectGit } from './services/git';
import { getClaudeId } from './services/people';
import { findProjectByFolder } from './services/projects';

export interface HookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  /** SessionStart: startup | resume | clear | compact */
  source?: string;
  /** Stop: o Claude já está continuando por causa de um hook — não pedir de novo */
  stop_hook_active?: boolean;
}

export type HookOutput =
  { hookSpecificOutput: { hookEventName: 'SessionStart'; additionalContext: string } } | { decision: 'block'; reason: string };

interface SessionState {
  projectId: number;
  startedAt: string;
  /** assinatura das alterações não commitadas de cada repositório no início da sessão */
  baseline: Record<string, string>;
  /** commits desta sessão já avaliados */
  seenCommits: string[];
  /** itens cuja branch já gerou lembrete nesta sessão */
  remindedItems: number[];
}

const SESSION_TTL_MS = 7 * 86_400_000;

const sessionsDir = () => path.join(DATA_DIR, 'claude-sessions');
const sessionFile = (id: string) => path.join(sessionsDir(), `${id.replace(/[^\w.-]/g, '_')}.json`);

function readSession(id: string | undefined): SessionState | null {
  if (!id) return null;
  try {
    return JSON.parse(fs.readFileSync(sessionFile(id), 'utf8')) as SessionState;
  } catch {
    return null;
  }
}

function writeSession(id: string | undefined, state: SessionState): void {
  if (!id) return;
  fs.mkdirSync(sessionsDir(), { recursive: true });
  fs.writeFileSync(sessionFile(id), JSON.stringify(state));
}

function pruneSessions(): void {
  try {
    for (const name of fs.readdirSync(sessionsDir())) {
      const file = path.join(sessionsDir(), name);
      if (Date.now() - fs.statSync(file).mtimeMs > SESSION_TTL_MS) fs.rmSync(file, { force: true });
    }
  } catch {
    /* pasta ainda não existe */
  }
}

interface RepoSnapshot {
  repo: string;
  branch: string;
  /** assinatura do `git status --porcelain` */
  changes: string;
  clean: boolean;
}

/** Repositório da pasta atual, ou todos os da pasta do projeto (quando o Claude roda na pasta que os contém). */
async function reposFor(cwd: string, project: Project): Promise<string[]> {
  const top = await git(cwd, ['rev-parse', '--show-toplevel'])
    .then((out) => path.resolve(out.trim()))
    .catch(() => null);
  return top ? [top] : findRepos(project.folder!);
}

async function snapshot(repo: string): Promise<RepoSnapshot> {
  const branch = await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
    .then((out) => out.trim())
    .catch(() => '');
  const status = await git(repo, ['status', '--porcelain']).catch(() => '');
  return { repo, branch, changes: createHash('sha1').update(status).digest('hex'), clean: !status.trim() };
}

function itemsCited(text: string, prefixes: Map<string, number[]>, byKey: Map<string, BriefItem>): BriefItem[] {
  const found: BriefItem[] = [];
  for (const ref of parseCommitRefs(text, prefixes).mentions) {
    const item = byKey.get(ref.key);
    if (item && !found.includes(item)) found.push(item);
  }
  return found;
}

const keyed = (items: BriefItem[]) => new Map(items.filter((i) => i.key).map((i) => [i.key!, i]));

async function sessionStart(input: HookInput, project: Project): Promise<HookOutput> {
  await syncProjectGit(project.id).catch(() => undefined);
  const cwd = input.cwd ?? process.cwd();
  const items = projectItems(project.id);
  const prefixes = projectPrefixes(project.id);
  const byKey = keyed(items);
  const snapshots = await Promise.all((await reposFor(cwd, project)).map(snapshot));
  const focus: BranchFocus[] = snapshots
    .filter((s) => s.branch && s.branch !== 'HEAD')
    .map((s) => ({ repo: path.basename(s.repo), branch: s.branch, items: itemsCited(s.branch, prefixes, byKey) }));

  if (!readSession(input.session_id)) {
    writeSession(input.session_id, {
      projectId: project.id,
      startedAt: nowIso(),
      baseline: Object.fromEntries(snapshots.map((s) => [s.repo, s.changes])),
      seenCommits: [],
      remindedItems: [],
    });
  }
  pruneSessions();
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: buildBriefing(project, items, focus) } };
}

interface Pending {
  item: BriefItem;
  commits: RawCommit[];
  branch: string | null;
  /** subitens que o Claude marcou nesta sessão */
  checked: string[];
}

async function stop(input: HookInput, project: Project): Promise<HookOutput | null> {
  if (input.stop_hook_active) return null;
  const cwd = input.cwd ?? process.cwd();
  const snapshots = await Promise.all((await reposFor(cwd, project)).map(snapshot));
  const state = readSession(input.session_id);
  if (!state || state.projectId !== project.id) {
    // Sessão aberta antes de instalar os hooks: começa a acompanhar a partir de agora.
    writeSession(input.session_id, {
      projectId: project.id,
      startedAt: nowIso(),
      baseline: Object.fromEntries(snapshots.map((s) => [s.repo, s.changes])),
      seenCommits: [],
      remindedItems: [],
    });
    return null;
  }

  const items = projectItems(project.id);
  const prefixes = projectPrefixes(project.id);
  const byKey = keyed(items);
  const claudeId = getClaudeId();
  const lastClaudeUpdate = db().prepare('SELECT MAX(created_at) AS at FROM updates WHERE item_id = ? AND author_id = ?');
  const updatedSince = (item: BriefItem, since: string) => {
    const row = lastClaudeUpdate.get(item.id, claudeId) as { at: string | null };
    return !!row.at && row.at >= since;
  };
  const pending = new Map<number, Pending>();
  const entry = (item: BriefItem) => {
    if (!pending.has(item.id)) pending.set(item.id, { item, commits: [], branch: null, checked: [] });
    return pending.get(item.id)!;
  };

  for (const snap of snapshots) {
    // Commits feitos nesta sessão que citam itens e ainda não têm atualização do Claude depois deles.
    const log = await git(snap.repo, ['log', '--max-count=50', `--format=${GIT_LOG_FORMAT}`, 'HEAD']).catch(() => '');
    // Data do commit com precisão de segundos: tolera o mesmo segundo do início da sessão.
    const since = new Date(Date.parse(state.startedAt) - 1000).toISOString();
    for (const commit of parseGitLog(log)) {
      if (commit.committedAt < since || state.seenCommits.includes(commit.hash)) continue;
      state.seenCommits.push(commit.hash);
      for (const item of itemsCited(`${commit.subject}\n${commit.body}`, prefixes, byKey)) {
        if (!updatedSince(item, commit.committedAt)) entry(item).commits.push(commit);
      }
    }
    // Alterações ainda não commitadas na branch de um item: um lembrete por item na sessão.
    if (!snap.clean && snap.changes !== state.baseline[snap.repo]) {
      for (const item of itemsCited(snap.branch, prefixes, byKey)) {
        if (state.remindedItems.includes(item.id) || updatedSince(item, state.startedAt)) continue;
        entry(item).branch = `${snap.branch} (${path.basename(snap.repo)})`;
      }
    }
  }

  // Subitens marcados pelo Claude nesta sessão, sem atualização postada no item desde o começo dela.
  const byId = new Map(items.map((i) => [i.id, i]));
  const checks = db()
    .prepare(
      `SELECT item_id, data FROM activity
       WHERE source = 'claude' AND action = 'subitem_checked' AND created_at >= ? AND item_id IS NOT NULL ORDER BY id`,
    )
    .all(state.startedAt) as { item_id: number; data: string }[];
  for (const check of checks) {
    const item = byId.get(check.item_id);
    if (!item || state.remindedItems.includes(item.id) || updatedSince(item, state.startedAt)) continue;
    const name = (JSON.parse(check.data) as { text?: string }).text;
    if (name && !entry(item).checked.includes(name)) entry(item).checked.push(name);
  }

  for (const { item } of pending.values()) if (!state.remindedItems.includes(item.id)) state.remindedItems.push(item.id);
  writeSession(input.session_id, state);
  if (!pending.size) return null;

  const lines = [`[tuesday] Antes de encerrar, registre este trabalho no projeto "${project.name}":`];
  for (const { item, commits, branch, checked } of pending.values()) {
    lines.push(`- ${item.ref ?? `#${item.id}`} "${item.name}" — status atual: ${item.status ?? 'vazio'}`);
    if (commits.length) lines.push(`  commits desta sessão: ${commits.map((c) => `${c.hash.slice(0, 7)} "${c.subject}"`).join('; ')}`);
    if (branch) lines.push(`  alterações ainda não commitadas na branch ${branch}`);
    if (checked.length) lines.push(`  subitens marcados nesta sessão: ${checked.join('; ')}`);
    if (item.subitems.length) {
      const progress = subitemProgress(item.subitems);
      lines.push(`  subitens (${progress.done}/${progress.total} feitos): ${checklistText(item)}`);
      if (progress.complete && item.state !== 'done') lines.push('  todos os subitens estão feitos — se o item terminou, mude o status.');
    }
    if (item.statusOptions.length) lines.push(`  etiquetas de status: ${item.statusOptions.join(', ')}`);
  }
  const example = [...pending.values()][0].item.ref ?? 'ABC-1';
  lines.push(
    '',
    'Para cada item: marque os subitens que foram concluídos (update_subitems), poste uma atualização curta com add_update (o que mudou, decisões, o que falta) e, se o estado mudou, ajuste o status com update_items usando a etiqueta que reflete a situação real.',
    `Sem as ferramentas do tuesday (MCP), use: ${noteCommand()} ${example} --claude --status "<etiqueta>" "texto da atualização" (e ${cliCommand('check')} ${example} --claude "<passo>" para marcar um subitem).`,
    'Se não houver nada relevante para registrar, apenas encerre.',
  );
  return { decision: 'block', reason: lines.join('\n') };
}

export async function runHook(event: string, input: HookInput): Promise<HookOutput | null> {
  const cwd = input.cwd ?? process.cwd();
  getDb();
  const project = findProjectByFolder(cwd);
  if (!project?.folder) return null;
  if (event === 'session-start') return sessionStart(input, project);
  if (event === 'stop') return stop(input, project);
  return null;
}
