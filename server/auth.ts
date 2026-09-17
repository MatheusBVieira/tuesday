// Senha de acesso para o tuesday publicado na rede (TUESDAY_PASSWORD).
//
// O navegador pede a senha na primeira visita (HTTP Basic, com qualquer usuário) e a reenvia sozinho, inclusive
// no tempo real. O Claude, pelo MCP via HTTP, manda "Authorization: Bearer <senha>". Use HTTPS na frente
// (nginx, Caddy, Traefik) se o acesso sair da rede local.
import type { NextFunction, Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';

const WINDOW_MS = 10 * 60_000;
const MAX_FAILURES = 10;

const digest = (text: string) => createHash('sha256').update(text).digest();

function suppliedPassword(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value = ''] = header.split(' ', 2);
  if (/^bearer$/i.test(scheme)) return value.trim();
  if (/^basic$/i.test(scheme)) {
    const decoded = Buffer.from(value.trim(), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    return colon >= 0 ? decoded.slice(colon + 1) : null;
  }
  return null;
}

export function requirePassword(password: string) {
  const expected = digest(password);
  const failures = new Map<string, { count: number; since: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api/health') return next();
    const key = req.ip ?? 'desconhecido';
    const now = Date.now();
    const record = failures.get(key);
    if (record && now - record.since > WINDOW_MS) failures.delete(key);
    if ((failures.get(key)?.count ?? 0) >= MAX_FAILURES) {
      res.status(429).json({ error: 'Muitas tentativas com a senha errada. Tente de novo em alguns minutos.' });
      return;
    }

    const supplied = suppliedPassword(req.get('authorization'));
    if (supplied !== null && timingSafeEqual(digest(supplied), expected)) {
      failures.delete(key);
      next();
      return;
    }
    if (supplied !== null) {
      const current = failures.get(key) ?? { count: 0, since: now };
      failures.set(key, { count: current.count + 1, since: current.since });
    }
    // O MCP via HTTP recebe só o 401: o desafio Basic abriria a janela de senha do navegador.
    if (req.path !== '/mcp') res.set('WWW-Authenticate', 'Basic realm="tuesday", charset="UTF-8"');
    res.status(401).json({ error: 'Senha necessária.' });
  };
}
