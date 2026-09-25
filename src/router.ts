import { useSyncExternalStore } from 'react';

export type ViewKind = 'table' | 'kanban';
/** board: um quadro (tabela ou Kanban) · my-work: "Meu trabalho" */
export type PageKind = 'board' | 'my-work' | 'invite';

export interface Route {
  page: PageKind;
  boardId: number | null;
  view: ViewKind;
  itemId: number | null;
  /** token do link de convite (/convite/<token>) */
  invite: string | null;
}

function parse(): Route {
  const path = window.location.pathname;
  const item = Number(new URLSearchParams(window.location.search).get('item'));
  const itemId = Number.isInteger(item) && item > 0 ? item : null;
  const invite = /^\/convite\/([^/]+)\/?$/.exec(path);
  if (invite) return { page: 'invite', boardId: null, view: 'table', itemId: null, invite: decodeURIComponent(invite[1]) };
  if (/^\/my-work\/?$/.test(path)) return { page: 'my-work', boardId: null, view: 'table', itemId, invite: null };
  const match = /^\/boards\/(\d+)(?:\/(kanban|table))?\/?$/.exec(path);
  return {
    page: 'board',
    boardId: match ? Number(match[1]) : null,
    view: match?.[2] === 'kanban' ? 'kanban' : 'table',
    itemId,
    invite: null,
  };
}

let current = parse();
const listeners = new Set<() => void>();

function emit() {
  current = parse();
  for (const listener of listeners) listener();
}

window.addEventListener('popstate', emit);

export function routeUrl(route: Omit<Route, 'page' | 'invite'> & { page?: PageKind; invite?: string | null }): string {
  const path =
    route.page === 'invite' && route.invite
      ? `/convite/${encodeURIComponent(route.invite)}`
      : route.page === 'my-work'
        ? '/my-work'
        : route.boardId
          ? `/boards/${route.boardId}${route.view === 'kanban' ? '/kanban' : ''}`
          : '/';
  return route.itemId ? `${path}?item=${route.itemId}` : path;
}

export function navigate(to: Partial<Route>, opts: { replace?: boolean } = {}): void {
  // Escolher um quadro sai de "Meu trabalho".
  const page = to.page ?? (to.boardId !== undefined ? 'board' : current.page);
  const url = routeUrl({ ...current, ...to, page });
  if (url === window.location.pathname + window.location.search) return;
  window.history[opts.replace ? 'replaceState' : 'pushState'](null, '', url);
  emit();
}

export function getRoute(): Route {
  return current;
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
