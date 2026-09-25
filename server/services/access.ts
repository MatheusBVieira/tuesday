// Quem pode o quê em cada projeto: membros, convites, tokens do MCP e a checagem que a API faz antes de gravar.
//
// Sem contas (app instalado), `viewer` é null e tudo é permitido — é o computador de uma pessoa só.
import { createHash, randomBytes } from 'node:crypto';
import { can, isProjectRole, type Permission, type ProjectRole } from '../../shared/roles';
import { HttpError, badRequest, db, inIds, insertId, notFound, nowIso } from './common';

export interface Viewer {
  userId: string;
  name: string;
  email: string;
  /** dono da instalação: administra as contas (a primeira conta criada) */
  master: boolean;
  personId: number;
  via: 'sessao' | 'token';
}

export const forbidden = (message: string) => new HttpError(403, message);

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

// ── Papéis ─────────────────────────────────────────────────

/** O papel de alguém num projeto, ou null se não for membro. */
export function roleInProject(viewer: Viewer | null, projectId: number): ProjectRole | null {
  if (!viewer) return 'dono';
  const row = db().prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, viewer.userId) as
    { role: string } | undefined;
  return isProjectRole(row?.role) ? row.role : null;
}

/** Recusa a ação quando o papel no projeto não alcança a permissão. */
export function assertPermission(viewer: Viewer | null, projectId: number | null, permission: Permission): void {
  if (!viewer) return;
  if (projectId == null) throw forbidden('Este quadro não está em nenhum projeto.');
  const role = roleInProject(viewer, projectId);
  if (!role) throw notFound('Projeto não encontrado.');
  if (!can(role, permission)) throw forbidden(MESSAGES[permission]);
}

const MESSAGES: Record<Permission, string> = {
  ler: 'Você não participa deste projeto.',
  comentar: 'Você não pode escrever neste projeto.',
  itens: 'Seu papel neste projeto não edita itens.',
  estrutura: 'Só quem administra o projeto mexe em quadros, grupos e colunas.',
  membros: 'Só quem administra o projeto convida e remove pessoas.',
  projeto: 'Só o dono do projeto pode fazer isso.',
};

/** Ids dos projetos que a pessoa enxerga — null quando não há contas (vê tudo). */
export function visibleProjectIds(viewer: Viewer | null): Set<number> | null {
  if (!viewer) return null;
  const rows = db().prepare('SELECT project_id FROM project_members WHERE user_id = ?').all(viewer.userId) as { project_id: number }[];
  return new Set(rows.map((r) => r.project_id));
}

// ── De onde veio a alteração: quadro, grupo, coluna, item… → projeto ──

const projectBy = (sql: string, id: number): number | null => {
  const row = db().prepare(sql).get(id) as { project_id: number | null } | undefined;
  if (!row) return null;
  return row.project_id;
};

export const projectOfBoard = (boardId: number) => projectBy('SELECT project_id FROM boards WHERE id = ?', boardId);
export const projectOfGroup = (groupId: number) =>
  projectBy('SELECT b.project_id FROM board_groups g JOIN boards b ON b.id = g.board_id WHERE g.id = ?', groupId);
export const projectOfColumn = (columnId: number) =>
  projectBy('SELECT b.project_id FROM board_columns c JOIN boards b ON b.id = c.board_id WHERE c.id = ?', columnId);
export const projectOfItem = (itemId: number) =>
  projectBy('SELECT b.project_id FROM items i JOIN boards b ON b.id = i.board_id WHERE i.id = ?', itemId);
export const projectOfSubitem = (subitemId: number) =>
  projectBy(
    'SELECT b.project_id FROM subitems s JOIN items i ON i.id = s.item_id JOIN boards b ON b.id = i.board_id WHERE s.id = ?',
    subitemId,
  );
export const projectOfUpdate = (updateId: number) =>
  projectBy(
    'SELECT b.project_id FROM updates u JOIN items i ON i.id = u.item_id JOIN boards b ON b.id = i.board_id WHERE u.id = ?',
    updateId,
  );

/** Projetos dos itens, para checar a permissão de uma vez só em ações em lote. */
export function projectsOfItems(itemIds: number[]): (number | null)[] {
  if (!itemIds.length) return [];
  const rows = db()
    .prepare(`SELECT DISTINCT b.project_id FROM items i JOIN boards b ON b.id = i.board_id WHERE ${inIds('i.id')}`)
    .all(JSON.stringify([...new Set(itemIds)])) as { project_id: number | null }[];
  return rows.map((r) => r.project_id);
}

/** O papel da pessoa em cada projeto — vai para a tela decidir o que mostrar. */
export function rolesOf(viewer: Viewer): Record<number, ProjectRole> {
  const rows = db().prepare('SELECT project_id, role FROM project_members WHERE user_id = ?').all(viewer.userId) as {
    project_id: number;
    role: string;
  }[];
  const roles: Record<number, ProjectRole> = {};
  for (const row of rows) if (isProjectRole(row.role)) roles[row.project_id] = row.role;
  return roles;
}

// ── Membros ────────────────────────────────────────────────

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: ProjectRole;
  personId: number | null;
  since: string;
}

export function listMembers(projectId: number): Member[] {
  const rows = db()
    .prepare(
      `SELECT m.user_id, m.role, m.created_at, u.name, u.email, p.id AS person_id
       FROM project_members m
       JOIN "user" u ON u.id = m.user_id
       LEFT JOIN people p ON p.user_id = m.user_id
       WHERE m.project_id = ?
       ORDER BY m.created_at`,
    )
    .all(projectId) as { user_id: string; role: string; created_at: string; name: string; email: string; person_id: number | null }[];
  return rows
    .filter((r) => isProjectRole(r.role))
    .map((r) => ({
      userId: r.user_id,
      name: r.name,
      email: r.email,
      role: r.role as ProjectRole,
      personId: r.person_id,
      since: r.created_at,
    }));
}

export function setMember(projectId: number, userId: string, role: ProjectRole): void {
  db()
    .prepare(
      `INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role`,
    )
    .run(projectId, userId, role);
}

/** Quem cria um projeto vira o dono dele. */
export function claimProject(projectId: number, viewer: Viewer | null): void {
  if (viewer) setMember(projectId, viewer.userId, 'dono');
}

/**
 * A primeira conta da instalação adota o que já estava no banco: o projeto de exemplo e os projetos de quem usava
 * o servidor antes das contas. Sem isto eles ficariam sem dono e ninguém os veria.
 */
export function adoptOrphanProjects(userId: string): void {
  const rows = db().prepare('SELECT id FROM projects WHERE id NOT IN (SELECT project_id FROM project_members)').all() as { id: number }[];
  for (const row of rows) setMember(row.id, userId, 'dono');
}

const ownerCount = (projectId: number) =>
  (db().prepare("SELECT count(*) AS n FROM project_members WHERE project_id = ? AND role = 'dono'").get(projectId) as { n: number }).n;

export function changeMemberRole(projectId: number, userId: string, role: ProjectRole, viewer: Viewer | null): void {
  const current = db().prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId) as
    { role: string } | undefined;
  if (!current) throw notFound('Esta pessoa não participa do projeto.');
  if (role === 'dono' && roleInProject(viewer, projectId) !== 'dono') throw forbidden('Só o dono pode passar a posse do projeto.');
  if (current.role === 'dono' && role !== 'dono' && ownerCount(projectId) === 1)
    throw badRequest('O projeto ficaria sem dono. Passe a posse para outra pessoa antes.');
  setMember(projectId, userId, role);
}

export function removeMember(projectId: number, userId: string): void {
  const current = db().prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId) as
    { role: string } | undefined;
  if (!current) throw notFound('Esta pessoa não participa do projeto.');
  if (current.role === 'dono' && ownerCount(projectId) === 1) throw badRequest('O projeto ficaria sem dono.');
  db().prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(projectId, userId);
}

// ── Convites ───────────────────────────────────────────────

export interface Invite {
  id: number;
  role: ProjectRole;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  /** só na criação: o link só aparece uma vez */
  token?: string;
}

interface InviteRow {
  id: number;
  project_id: number;
  role: string;
  created_at: string;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
  revoked_at: string | null;
}

const toInvite = (r: InviteRow): Invite => ({
  id: r.id,
  role: (isProjectRole(r.role) ? r.role : 'leitor') as ProjectRole,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  maxUses: r.max_uses,
  uses: r.uses,
});

export function listInvites(projectId: number): Invite[] {
  const rows = db()
    .prepare('SELECT * FROM project_invites WHERE project_id = ? AND revoked_at IS NULL ORDER BY created_at DESC')
    .all(projectId) as InviteRow[];
  return rows.map(toInvite);
}

export function createInvite(
  projectId: number,
  input: { role: ProjectRole; expiresInDays?: number | null; maxUses?: number | null },
  viewer: Viewer | null,
): Invite {
  if (input.role === 'dono') throw badRequest('Convite não passa a posse do projeto.');
  const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString() : null;
  const token = randomBytes(24).toString('base64url');
  const id = insertId(
    'INSERT INTO project_invites (project_id, token_hash, role, created_by, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?)',
    projectId,
    hash(token),
    input.role,
    viewer?.userId ?? null,
    expiresAt,
    input.maxUses ?? null,
  );
  const row = db().prepare('SELECT * FROM project_invites WHERE id = ?').get(id) as InviteRow;
  return { ...toInvite(row), token };
}

export function revokeInvite(projectId: number, id: number): void {
  const changes = db()
    .prepare('UPDATE project_invites SET revoked_at = ? WHERE id = ? AND project_id = ? AND revoked_at IS NULL')
    .run(nowIso(), id, projectId).changes;
  if (!changes) throw notFound('Convite não encontrado.');
}

interface InviteTarget {
  invite: InviteRow;
  project: { id: number; name: string; color: string };
}

/** Convite válido de um token, sem gastar o uso — é o que a tela do convite mostra antes de entrar. */
export function inviteByToken(token: string): InviteTarget | null {
  const invite = db().prepare('SELECT * FROM project_invites WHERE token_hash = ?').get(hash(token)) as InviteRow | undefined;
  if (!invite) return null;
  if (invite.revoked_at) return null;
  if (invite.expires_at && invite.expires_at < nowIso()) return null;
  if (invite.max_uses != null && invite.uses >= invite.max_uses) return null;
  const project = db().prepare('SELECT id, name, color FROM projects WHERE id = ?').get(invite.project_id) as
    { id: number; name: string; color: string } | undefined;
  return project ? { invite, project } : null;
}

/** Entra no projeto com o papel do convite. Quem já participa não é rebaixado nem gasta o convite. */
export function acceptInvite(token: string, viewer: Viewer): { projectId: number; role: ProjectRole; alreadyMember: boolean } {
  const target = inviteByToken(token);
  if (!target) throw badRequest('Este convite não vale mais. Peça outro link a quem administra o projeto.');
  const { invite, project } = target;
  const current = roleInProject(viewer, project.id);
  const role = (isProjectRole(invite.role) ? invite.role : 'leitor') as ProjectRole;
  if (current) return { projectId: project.id, role: current, alreadyMember: true };
  setMember(project.id, viewer.userId, role);
  db().prepare('UPDATE project_invites SET uses = uses + 1 WHERE id = ?').run(invite.id);
  return { projectId: project.id, role, alreadyMember: false };
}

// ── Tokens do MCP ──────────────────────────────────────────

export interface ApiToken {
  id: number;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** só na criação */
  token?: string;
}

interface TokenRow {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export function listApiTokens(userId: string): ApiToken[] {
  const rows = db()
    .prepare('SELECT id, name, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as TokenRow[];
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}

export function createApiToken(userId: string, name: string): ApiToken {
  const clean = name.trim().slice(0, 60) || 'Claude';
  const token = `tue_${randomBytes(24).toString('base64url')}`;
  const id = insertId('INSERT INTO api_tokens (user_id, name, token_hash) VALUES (?, ?, ?)', userId, clean, hash(token));
  const row = db().prepare('SELECT id, name, created_at, last_used_at FROM api_tokens WHERE id = ?').get(id) as TokenRow;
  return { id: row.id, name: row.name, createdAt: row.created_at, lastUsedAt: row.last_used_at, token };
}

export function revokeApiToken(userId: string, id: number): void {
  const changes = db().prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(id, userId).changes;
  if (!changes) throw notFound('Token não encontrado.');
}

/** A conta de um token do MCP (e marca o último uso). */
export function userOfApiToken(token: string): { id: string; name: string; email: string; role: string } | null {
  const row = db().prepare('SELECT id, user_id FROM api_tokens WHERE token_hash = ?').get(hash(token)) as
    { id: number; user_id: string } | undefined;
  if (!row) return null;
  const user = db().prepare('SELECT id, name, email, role FROM "user" WHERE id = ?').get(row.user_id) as
    { id: string; name: string; email: string; role: string | null } | undefined;
  if (!user) return null;
  db().prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id);
  return { ...user, role: user.role ?? 'user' };
}
