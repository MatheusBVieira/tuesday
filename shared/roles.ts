// Papéis de um projeto e o que cada um deixa fazer. Vale no servidor (onde é obrigatório) e nas telas (onde
// esconde o que a pessoa não pode fazer). Rodando local, sem contas, todo mundo é dono.

export const PROJECT_ROLES = ['dono', 'admin', 'membro', 'leitor'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const isProjectRole = (value: unknown): value is ProjectRole => PROJECT_ROLES.includes(value as ProjectRole);

export const ROLE_LABELS: Record<ProjectRole, string> = {
  dono: 'Dono',
  admin: 'Administrador',
  membro: 'Membro',
  leitor: 'Leitor',
};

export const ROLE_HINTS: Record<ProjectRole, string> = {
  dono: 'Tudo, inclusive excluir o projeto e passar a posse.',
  admin: 'Quadros, colunas, grupos, membros e convites.',
  membro: 'Cria e edita itens, subitens e atualizações.',
  leitor: 'Lê o quadro e escreve atualizações.',
};

/**
 * ler       — abrir o projeto, os quadros e os itens
 * comentar  — escrever atualizações nos itens
 * itens     — criar, editar, mover e excluir itens e subitens
 * estrutura — quadros, grupos, colunas, configurações do quadro e Git
 * membros   — convites e papéis das pessoas do projeto
 * projeto   — renomear, excluir e passar a posse do projeto
 */
export const PERMISSIONS = ['ler', 'comentar', 'itens', 'estrutura', 'membros', 'projeto'] as const;
export type Permission = (typeof PERMISSIONS)[number];

const BY_ROLE: Record<ProjectRole, readonly Permission[]> = {
  leitor: ['ler', 'comentar'],
  membro: ['ler', 'comentar', 'itens'],
  admin: ['ler', 'comentar', 'itens', 'estrutura', 'membros'],
  dono: PERMISSIONS,
};

export const can = (role: ProjectRole | null | undefined, permission: Permission): boolean => !!role && BY_ROLE[role].includes(permission);

/** Papéis que alguém com o papel `role` pode conceder a outra pessoa (ninguém promove acima de si). */
export const grantableRoles = (role: ProjectRole | null): ProjectRole[] =>
  role === 'dono' ? ['admin', 'membro', 'leitor'] : role === 'admin' ? ['membro', 'leitor'] : [];
