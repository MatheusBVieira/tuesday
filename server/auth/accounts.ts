// Contas e sessões do modo servidor (Better Auth). No app instalado nada disto roda: lá é uma pessoa só, sem login.
//
// As tabelas de contas (user, session, account, verification) são do Better Auth e ele mesmo as cria na subida.
// As nossas (membros, convites, tokens) ficam nas migrações de sempre. Os dois lados falam com o mesmo banco.
import { randomBytes } from 'node:crypto';
import type { betterAuth } from 'better-auth';
import { DB_DIALECT, DB_PATH } from '../db/connection';
import { adoptOrphanProjects } from '../services/access';
import { db } from '../services/common';
import { ensurePersonForUser, getMeta, setMeta } from '../services/people';

export type AuthInstance = ReturnType<typeof betterAuth>;

export interface AuthSettings {
  /** Endereço público do servidor, quando configurado (TUESDAY_URL). */
  baseUrl: string | null;
  google: boolean;
}

let instance: AuthInstance | null = null;

export const authInstance = (): AuthInstance => {
  if (!instance) throw new Error('As contas ainda não foram iniciadas.');
  return instance;
};

/** Quantas contas existem — a primeira criada vira a dona da instalação. */
export function userCount(): number {
  return (db().prepare('SELECT count(*) AS n FROM "user"').get() as { n: number }).n;
}

/** Segredo dos cookies de sessão: do ambiente ou gerado uma vez e guardado no banco. */
function sessionSecret(): string {
  const fromEnv = process.env.TUESDAY_AUTH_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const saved = getMeta('auth_secret');
  if (saved) return saved;
  const generated = randomBytes(32).toString('base64url');
  setMeta('auth_secret', generated);
  return generated;
}

function google() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { google: { clientId, clientSecret } } : {};
}

export function authSettings(): AuthSettings {
  return { baseUrl: process.env.TUESDAY_URL?.trim() || null, google: !!google().google };
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

/**
 * De onde o navegador pode falar com a API: o que estiver em TUESDAY_URL/TUESDAY_TRUSTED_ORIGINS e, sempre, o
 * próprio endereço pelo qual o servidor foi aberto — é o que faz funcionar direto pelo IP da máquina na rede,
 * sem domínio nenhum. Pedido vindo de outro site tem Origin diferente do Host e continua recusado.
 */
function trustedOrigins(request?: Request): string[] {
  const configured = [process.env.TUESDAY_URL, ...(process.env.TUESDAY_TRUSTED_ORIGINS ?? '').split(',')]
    .map((origin) => origin?.trim())
    .filter((origin): origin is string => !!origin);
  const origin = request?.headers.get('origin');
  const host = request?.headers.get('host');
  const sameOrigin = origin && host && hostOf(origin) === host ? [origin] : [];
  return [...new Set([...configured, ...sameOrigin])];
}

async function database(): Promise<unknown> {
  if (DB_DIALECT === 'postgres') {
    const { default: pg } = await import('pg');
    return new pg.Pool({ connectionString: process.env.TUESDAY_DATABASE_URL, max: 4 });
  }
  const { default: Database } = await import('better-sqlite3');
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('journal_mode = WAL');
  return sqlite;
}

/**
 * Sobe as contas: cria as tabelas do Better Auth se faltarem e devolve a instância.
 * As importações são dinâmicas porque o app instalado não leva o Better Auth junto.
 */
export async function initAccounts(): Promise<AuthInstance> {
  const [{ betterAuth }, { admin }, { getMigrations }] = await Promise.all([
    import('better-auth'),
    import('better-auth/plugins/admin'),
    import('better-auth/db/migration'),
  ]);

  const options = {
    appName: 'tuesday',
    database: await database(),
    secret: sessionSecret(),
    basePath: '/api/auth',
    baseURL: process.env.TUESDAY_URL?.trim() || undefined,
    trustedOrigins,
    // Sem envio de e-mail: a conta já entra valendo e o convite é um link que a pessoa recebe por onde quiser.
    emailAndPassword: { enabled: true, requireEmailVerification: false, autoSignIn: true, minPasswordLength: 8 },
    socialProviders: google(),
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    user: { changeEmail: { enabled: false } },
    plugins: [admin({ defaultRole: 'user', adminRoles: ['admin'] })],
    databaseHooks: {
      user: {
        create: {
          // A primeira conta da instalação é a dona: ela administra as outras.
          before: async (user: Record<string, unknown>) => ({ data: { ...user, role: userCount() === 0 ? 'admin' : 'user' } }),
          after: async (user: { id: string; name?: string | null; email: string }) => {
            ensurePersonForUser({ id: user.id, name: user.name ?? user.email, email: user.email });
            if (userCount() === 1) adoptOrphanProjects(user.id);
          },
        },
      },
    },
  };

  const { runMigrations } = await getMigrations(options as Parameters<typeof getMigrations>[0]);
  await runMigrations();
  instance = betterAuth(options as Parameters<typeof betterAuth>[0]);
  return instance;
}
