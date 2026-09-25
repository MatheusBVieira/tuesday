// Conversa com as contas do servidor: entrar, criar conta, convites, membros, tokens do MCP e administração.
import type { ProjectRole } from '../../shared/roles';
import { ApiError, CLIENT_ID } from './client';

export interface AuthInfo {
  accounts: boolean;
  google: boolean;
  /** ainda não há nenhuma conta: quem criar a primeira administra a instalação */
  firstRun: boolean;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: ProjectRole;
  personId: number | null;
  since: string;
}

export interface Invite {
  id: number;
  role: ProjectRole;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  token?: string;
}

export interface InvitePreview {
  project: { name: string; color: string };
  role: ProjectRole;
  signedIn: boolean;
  alreadyMember: boolean;
}

export interface ApiToken {
  id: number;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  token?: string;
}

export interface AccountUser {
  id: string;
  name: string;
  email: string;
  role: string | null;
  banned: boolean | null;
  createdAt: string;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    /* resposta sem JSON */
  }
  if (!res.ok) {
    const data = payload as { error?: string; message?: string; code?: string } | null;
    throw new ApiError(res.status, data?.error ?? traduz(data?.code) ?? data?.message ?? res.statusText);
  }
  return payload as T;
}

/** As mensagens do Better Auth vêm em inglês; as que a pessoa vê com frequência ficam em português. */
function traduz(code: string | undefined): string | null {
  const messages: Record<string, string> = {
    INVALID_EMAIL_OR_PASSWORD: 'E-mail ou senha incorretos.',
    USER_ALREADY_EXISTS: 'Já existe uma conta com este e-mail.',
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Já existe uma conta com este e-mail.',
    PASSWORD_TOO_SHORT: 'A senha precisa ter pelo menos 8 caracteres.',
    INVALID_EMAIL: 'E-mail inválido.',
    FAILED_TO_CREATE_USER: 'Não foi possível criar a conta.',
    YOU_ARE_NOT_ALLOWED_TO_LIST_USERS: 'Só quem administra esta instalação pode ver as contas.',
  };
  return code ? (messages[code] ?? null) : null;
}

export const authApi = {
  info: () => call<AuthInfo>('GET', '/auth-info'),
  signIn: (email: string, password: string) => call<unknown>('POST', '/auth/sign-in/email', { email, password }),
  signUp: (name: string, email: string, password: string) => call<unknown>('POST', '/auth/sign-up/email', { name, email, password }),
  signOut: () => call<unknown>('POST', '/auth/sign-out', {}),
  changePassword: (currentPassword: string, newPassword: string) =>
    call<unknown>('POST', '/auth/change-password', { currentPassword, newPassword, revokeOtherSessions: false }),
  /** Endereço para onde mandar a pessoa no login com o Google. */
  googleUrl: (callbackURL: string) => call<{ url: string }>('POST', '/auth/sign-in/social', { provider: 'google', callbackURL }),

  invite: (token: string) => call<InvitePreview>('GET', `/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string) =>
    call<{ projectId: number; role: ProjectRole; alreadyMember: boolean }>('POST', `/invites/${encodeURIComponent(token)}/accept`),

  members: (projectId: number) => call<Member[]>('GET', `/projects/${projectId}/members`),
  setMemberRole: (projectId: number, userId: string, role: ProjectRole) =>
    call<Member[]>('PATCH', `/projects/${projectId}/members/${encodeURIComponent(userId)}`, { role }),
  removeMember: (projectId: number, userId: string) => call<void>('DELETE', `/projects/${projectId}/members/${encodeURIComponent(userId)}`),

  invites: (projectId: number) => call<Invite[]>('GET', `/projects/${projectId}/invites`),
  createInvite: (projectId: number, input: { role: ProjectRole; expiresInDays?: number | null; maxUses?: number | null }) =>
    call<Invite>('POST', `/projects/${projectId}/invites`, input),
  revokeInvite: (projectId: number, id: number) => call<void>('DELETE', `/projects/${projectId}/invites/${id}`),

  tokens: () => call<ApiToken[]>('GET', '/account/tokens'),
  createToken: (name: string) => call<ApiToken>('POST', '/account/tokens', { name }),
  revokeToken: (id: number) => call<void>('DELETE', `/account/tokens/${id}`),

  users: () => call<{ users: AccountUser[]; total: number }>('GET', '/auth/admin/list-users?limit=200&sortBy=createdAt'),
  setUserPassword: (userId: string, newPassword: string) => call<unknown>('POST', '/auth/admin/set-user-password', { userId, newPassword }),
  setUserRole: (userId: string, role: 'admin' | 'user') => call<unknown>('POST', '/auth/admin/set-role', { userId, role }),
  banUser: (userId: string) => call<unknown>('POST', '/auth/admin/ban-user', { userId }),
  unbanUser: (userId: string) => call<unknown>('POST', '/auth/admin/unban-user', { userId }),
  removeUser: (userId: string) => call<unknown>('POST', '/auth/admin/remove-user', { userId }),
};
