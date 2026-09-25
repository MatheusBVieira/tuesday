// O que a pessoa pode fazer no projeto — para a tela esconder o que ela não pode.
// Sem contas (app instalado), todo mundo é dono. O servidor checa de novo em cada pedido.
import { can, type Permission, type ProjectRole } from '../../shared/roles';
import { useStore } from '../store';

/** Papel no projeto informado (ou no projeto selecionado na barra lateral). */
export function useRole(projectId?: number | null): ProjectRole | null {
  return useStore((s) => {
    if (!s.viewer) return 'dono';
    const id = projectId === undefined ? s.projectId : projectId;
    return id == null ? null : (s.viewer.roles[id] ?? null);
  });
}

export function useCan(permission: Permission, projectId?: number | null): boolean {
  return can(useRole(projectId), permission);
}

/** Papel no projeto de um quadro (o quadro aberto, quando não vier id). */
export function useBoardRole(boardId?: number | null): ProjectRole | null {
  return useStore((s) => {
    if (!s.viewer) return 'dono';
    const id = boardId ?? s.board?.id ?? null;
    const projectId = id == null ? null : (s.boards.find((b) => b.id === id)?.projectId ?? s.board?.projectId ?? null);
    return projectId == null ? null : (s.viewer.roles[projectId] ?? null);
  });
}

export function useCanInBoard(permission: Permission, boardId?: number | null): boolean {
  return can(useBoardRole(boardId), permission);
}
