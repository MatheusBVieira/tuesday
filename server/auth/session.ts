// De quem é cada pedido: a sessão do navegador (cookie do Better Auth) ou um token do MCP.
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { HttpError } from '../services/common';
import { ensurePersonForUser } from '../services/people';
import { adoptOrphanProjects, userOfApiToken, type Viewer } from '../services/access';
import type { AuthInstance } from './accounts';

declare module 'express-serve-static-core' {
  interface Request {
    /** Quem está fazendo o pedido; ausente no app instalado, que não tem contas. */
    viewer?: Viewer;
  }
}

/** Quem está pedindo — null quando o tuesday roda sem contas. */
export const viewerOf = (req: Request): Viewer | null => req.viewer ?? null;

function headersOf(req: Request): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value) headers.set(name, value);
  }
  return headers;
}

function bearer(req: Request): string | null {
  const header = req.get('authorization');
  if (!header) return null;
  const [scheme, value = ''] = header.split(' ', 2);
  return /^bearer$/i.test(scheme) && value.trim() ? value.trim() : null;
}

function toViewer(user: { id: string; name?: string | null; email: string; role?: string | null }, via: Viewer['via']): Viewer {
  const name = user.name ?? user.email;
  const master = user.role === 'admin';
  // Fora da transação do Better Auth (ver o comentário em accounts.ts): é aqui que a conta ganha a sua pessoa e,
  // sendo a dona da instalação, adota os projetos que ainda não têm ninguém.
  const personId = ensurePersonForUser({ id: user.id, name, email: user.email });
  if (master) adoptOrphanProjects(user.id);
  return { userId: user.id, name, email: user.email, master, personId, via };
}

/** Descobre quem está pedindo, sem barrar ninguém — quem barra é requireViewer. */
export function withViewer(auth: AuthInstance): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (token) {
      const user = userOfApiToken(token);
      if (user) req.viewer = toViewer(user, 'token');
      next();
      return;
    }
    auth.api
      .getSession({ headers: headersOf(req) })
      .then((session) => {
        if (session?.user) req.viewer = toViewer(session.user, 'sessao');
        next();
      })
      .catch(next);
  };
}

/** Caminhos abertos: o que a tela de entrada e o convite precisam antes de haver sessão. */
const PUBLIC = [/^\/health$/, /^\/auth(\/|$)/, /^\/auth-info$/, /^\/invites\/[^/]+$/];

export function requireViewer(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.viewer || PUBLIC.some((rule) => rule.test(req.path))) {
      next();
      return;
    }
    res.status(401).json({ error: 'Entre na sua conta para continuar.' });
  };
}

/** Só o dono da instalação (a primeira conta criada). */
export function requireMaster(req: Request): Viewer {
  const viewer = viewerOf(req);
  if (!viewer) throw new HttpError(401, 'Entre na sua conta para continuar.');
  if (!viewer.master) throw new HttpError(403, 'Só quem administra esta instalação pode fazer isso.');
  return viewer;
}
