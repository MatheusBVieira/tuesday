// Rotas das contas: quem participa de cada projeto, os links de convite e os tokens do MCP.
import { Router, type Request } from 'express';
import { z } from 'zod';
import { PROJECT_ROLES, can, grantableRoles, type ProjectRole } from '../../shared/roles';
import { authSettings, userCount } from '../auth/accounts';
import { viewerOf } from '../auth/session';
import {
  acceptInvite,
  changeMemberRole,
  createApiToken,
  createInvite,
  forbidden,
  inviteByToken,
  listApiTokens,
  listInvites,
  listMembers,
  removeMember,
  revokeApiToken,
  revokeInvite,
  roleInProject,
  type Viewer,
} from '../services/access';
import { HttpError, badRequest, notFound } from '../services/common';

const role = z.enum(PROJECT_ROLES);

function parse<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) throw badRequest(result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return result.data;
}

function idOf(req: Request, key: string): number {
  const id = Number(req.params[key]);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Id inválido.');
  return id;
}

/** Quem está pedindo, já com sessão. */
function viewer(req: Request): Viewer {
  const found = viewerOf(req);
  if (!found) throw new HttpError(401, 'Entre na sua conta para continuar.');
  return found;
}

/** Quem administra o projeto (papel com permissão de membros). */
function manager(req: Request, projectId: number): Viewer {
  const current = viewer(req);
  const projectRole = roleInProject(current, projectId);
  if (!projectRole) throw notFound('Projeto não encontrado.');
  if (!can(projectRole, 'membros')) throw forbidden('Só quem administra o projeto convida e remove pessoas.');
  return current;
}

export function createTeamRouter(): Router {
  const r = Router();

  // ── Tela de entrada ────────────────────────────────────────
  r.get('/auth-info', (_req, res) => {
    const settings = authSettings();
    res.json({ accounts: true, google: settings.google, firstRun: userCount() === 0 });
  });

  // ── Convites ───────────────────────────────────────────────
  r.get('/invites/:token', (req, res) => {
    const target = inviteByToken(req.params.token);
    if (!target) throw badRequest('Este convite não vale mais. Peça outro link a quem administra o projeto.');
    const current = viewerOf(req);
    res.json({
      project: { name: target.project.name, color: target.project.color },
      role: target.invite.role as ProjectRole,
      signedIn: !!current,
      alreadyMember: current ? !!roleInProject(current, target.project.id) : false,
    });
  });

  r.post('/invites/:token/accept', (req, res) => {
    res.json(acceptInvite(req.params.token, viewer(req)));
  });

  r.get('/projects/:id/invites', (req, res) => {
    const projectId = idOf(req, 'id');
    manager(req, projectId);
    res.json(listInvites(projectId));
  });

  r.post('/projects/:id/invites', (req, res) => {
    const projectId = idOf(req, 'id');
    const current = manager(req, projectId);
    const input = parse(
      z.object({
        role: role.default('membro'),
        expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
        maxUses: z.number().int().min(1).max(500).nullable().optional(),
      }),
      req,
    );
    if (!grantableRoles(roleInProject(current, projectId)).includes(input.role))
      throw forbidden('Você não pode convidar alguém para um papel acima do seu.');
    res.status(201).json(createInvite(projectId, input, current));
  });

  r.delete('/projects/:id/invites/:inviteId', (req, res) => {
    const projectId = idOf(req, 'id');
    manager(req, projectId);
    revokeInvite(projectId, idOf(req, 'inviteId'));
    res.status(204).end();
  });

  // ── Membros ────────────────────────────────────────────────
  r.get('/projects/:id/members', (req, res) => {
    const projectId = idOf(req, 'id');
    const current = viewer(req);
    if (!roleInProject(current, projectId)) throw notFound('Projeto não encontrado.');
    res.json(listMembers(projectId));
  });

  r.patch('/projects/:id/members/:userId', (req, res) => {
    const projectId = idOf(req, 'id');
    const current = manager(req, projectId);
    const { role: next } = parse(z.object({ role }), req);
    if (req.params.userId === current.userId && next !== 'dono') throw badRequest('Peça a outra pessoa para mudar o seu papel.');
    changeMemberRole(projectId, req.params.userId, next, current);
    res.json(listMembers(projectId));
  });

  r.delete('/projects/:id/members/:userId', (req, res) => {
    const projectId = idOf(req, 'id');
    const current = viewer(req);
    // Sair do projeto é sempre permitido; tirar outra pessoa exige administrar o projeto.
    if (req.params.userId !== current.userId) manager(req, projectId);
    removeMember(projectId, req.params.userId);
    res.status(204).end();
  });

  // ── Tokens do MCP ──────────────────────────────────────────
  r.get('/account/tokens', (req, res) => {
    res.json(listApiTokens(viewer(req).userId));
  });

  r.post('/account/tokens', (req, res) => {
    const { name } = parse(z.object({ name: z.string().max(60).optional() }), req);
    res.status(201).json(createApiToken(viewer(req).userId, name ?? 'Claude'));
  });

  r.delete('/account/tokens/:id', (req, res) => {
    revokeApiToken(viewer(req).userId, idOf(req, 'id'));
    res.status(204).end();
  });

  return r;
}
