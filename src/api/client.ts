import type {
  ActivityEntry,
  Board,
  BoardSettings,
  BoardSummary,
  BoardTemplate,
  Bootstrap,
  CellValue,
  CodeTodoImportResult,
  CodeTodoScan,
  Column,
  ColumnSettings,
  ColumnType,
  GitSyncResult,
  Group,
  IdFormat,
  Item,
  ItemDetails,
  MyWork,
  Person,
  Project,
  SetupResult,
  SetupStatus,
  Subitem,
  Update,
} from '../../shared/types';

/** Identifica esta aba — o servidor devolve no SSE para ignorarmos o eco das nossas próprias mudanças. */
export const CLIENT_ID = crypto.randomUUID();

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function errorText(error: unknown, fallback = 'Algo deu errado.'): string {
  if (error instanceof ApiError) return error.message || fallback;
  if (error instanceof TypeError) return 'Sem conexão com o servidor do tuesday.';
  return fallback;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* resposta sem JSON */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

type Position = 'top' | 'bottom' | number;

export const api = {
  bootstrap: () => request<Bootstrap>('GET', '/bootstrap'),
  myWork: (personId?: number) => request<MyWork>('GET', `/my-work${personId ? `?person=${personId}` : ''}`),

  createProject: (input: { name: string; color?: string; folder?: string | null; template?: BoardTemplate | null } & IdFormat) =>
    request<{ project: Project; boardId: number | null }>('POST', '/projects', input),
  updateProject: (id: number, patch: { name?: string; color?: string; folder?: string | null; position?: number }) =>
    request<Project>('PATCH', `/projects/${id}`, patch),
  deleteProject: (id: number) => request<void>('DELETE', `/projects/${id}`),
  codeTodos: (projectId: number) => request<CodeTodoScan>('GET', `/projects/${projectId}/code-todos`),
  importCodeTodos: (projectId: number, input: { ids?: string[]; boardId?: number; groupId?: number; completeItemIds?: number[] }) =>
    request<CodeTodoImportResult>('POST', `/projects/${projectId}/code-todos/import`, input),
  syncGit: (projectId: number) => request<GitSyncResult>('POST', `/projects/${projectId}/git/sync`, {}),

  setupStatus: () => request<SetupStatus>('GET', '/setup'),
  setupClaudeCode: () => request<SetupResult>('POST', '/setup/claude-code', {}),
  setupClaudeDesktop: () => request<SetupResult>('POST', '/setup/claude-desktop', {}),
  setupClaudeHooks: (opts: { remove?: boolean } = {}) => request<SetupResult>('POST', '/setup/claude-hooks', opts),

  getBoard: (id: number) => request<Board>('GET', `/boards/${id}`),
  createBoard: (input: { name: string; description?: string; template?: BoardTemplate; projectId?: number } & IdFormat) =>
    request<Board>('POST', '/boards', input),
  updateBoard: (
    id: number,
    patch: {
      name?: string;
      description?: string;
      position?: number;
      projectId?: number;
      settings?: BoardSettings;
      nextItemNumber?: number;
    },
  ) => request<BoardSummary>('PATCH', `/boards/${id}`, patch),
  deleteBoard: (id: number) => request<void>('DELETE', `/boards/${id}`),
  boardActivity: (id: number, before?: number) =>
    request<ActivityEntry[]>('GET', `/boards/${id}/activity?limit=100${before ? `&before=${before}` : ''}`),

  createGroup: (boardId: number, input: { name?: string; color?: string; position?: Position }) =>
    request<Group>('POST', `/boards/${boardId}/groups`, input),
  updateGroup: (id: number, patch: { name?: string; color?: string; collapsed?: boolean; position?: Position }) =>
    request<Group>('PATCH', `/groups/${id}`, patch),
  deleteGroup: (id: number) => request<void>('DELETE', `/groups/${id}`),

  createColumn: (
    boardId: number,
    input: { title?: string; type: ColumnType; settings?: ColumnSettings; afterColumnId?: number | null; position?: 'start' | 'end' },
  ) => request<Column>('POST', `/boards/${boardId}/columns`, input),
  updateColumn: (id: number, patch: { title?: string; width?: number; position?: number; settings?: ColumnSettings }) =>
    request<Column>('PATCH', `/columns/${id}`, patch),
  deleteColumn: (id: number) => request<void>('DELETE', `/columns/${id}`),

  createItem: (
    boardId: number,
    input: { name: string; groupId?: number; values?: Record<string, CellValue>; position?: Position; kanbanPosition?: Position },
  ) => request<Item>('POST', `/boards/${boardId}/items`, input),
  itemDetails: (id: number) => request<ItemDetails>('GET', `/items/${id}`),
  updateItem: (id: number, patch: { name?: string; groupId?: number; position?: Position; kanbanPosition?: number; number?: number }) =>
    request<Item>('PATCH', `/items/${id}`, patch),
  setValues: (id: number, values: Record<string, CellValue>) => request<Item>('PUT', `/items/${id}/values`, { values }),
  deleteItems: (ids: number[]) => request<{ ids: number[] }>('POST', '/items/delete', { ids }),
  restoreItems: (ids: number[]) => request<{ ids: number[] }>('POST', '/items/restore', { ids }),
  duplicateItems: (ids: number[]) => request<Item[]>('POST', '/items/duplicate', { ids }),
  moveItems: (ids: number[], groupId: number) => request<Item[]>('POST', '/items/move', { ids, groupId }),

  addSubitems: (itemId: number, subitems: { name: string; done?: boolean }[], position?: Position) =>
    request<Subitem[]>('POST', `/items/${itemId}/subitems`, { subitems, position }),
  updateSubitem: (id: number, patch: { name?: string; done?: boolean; position?: number }) =>
    request<Subitem>('PATCH', `/subitems/${id}`, patch),
  deleteSubitem: (id: number) => request<Subitem>('DELETE', `/subitems/${id}`),

  createUpdate: (itemId: number, body: string) => request<Update>('POST', `/items/${itemId}/updates`, { body }),
  editUpdate: (id: number, body: string) => request<Update>('PATCH', `/updates/${id}`, { body }),
  deleteUpdate: (id: number) => request<void>('DELETE', `/updates/${id}`),

  createPerson: (input: { name: string; color?: string }) => request<Person>('POST', '/people', input),
  updatePerson: (id: number, patch: { name?: string; color?: string }) => request<Person>('PATCH', `/people/${id}`, patch),
  deletePerson: (id: number) => request<void>('DELETE', `/people/${id}`),
  setMe: (personId: number) => request<void>('PUT', '/me', { personId }),
};
