import { create } from 'zustand';
import type {
  AppInfo,
  Board,
  BoardSummary,
  BoardTemplate,
  CellValue,
  ColumnSettings,
  ColumnType,
  Group,
  IdFormat,
  Item,
  KanbanSettings,
  MyWork,
  Person,
  Project,
  Subitem,
  TableSettings,
} from '../shared/types';
import { positionBetween } from '../shared/values';
import { ApiError, api, errorText } from './api/client';
import { getRoute, navigate } from './router';

export interface SortSpec {
  columnId: number | 'name';
  dir: 'asc' | 'desc';
}

export interface ViewFilters {
  search: string;
  /** pessoas atribuídas em qualquer coluna de pessoas */
  people: number[];
  /** coluna → ids das etiquetas selecionadas (0 = vazio) */
  labels: Record<string, number[]>;
  sort: SortSpec | null;
}

export const EMPTY_FILTERS: ViewFilters = { search: '', people: [], labels: {}, sort: null };

export interface ToastSpec {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
  duration: number;
}

export type ConfirmSpec = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => unknown;
};

/** Abas do painel do item. */
export type PanelTab = 'updates' | 'subitems' | 'info' | 'commits' | 'activity';

export type ModalSpec =
  | ({ kind: 'confirm' } & ConfirmSpec)
  | { kind: 'new-board' }
  | { kind: 'people' }
  | { kind: 'connect-claude' }
  | { kind: 'project'; projectId?: number }
  | { kind: 'import-todos'; projectId: number; boardId?: number | null };

interface State {
  ready: boolean;
  loadError: string | null;
  connected: boolean;
  projects: Project[];
  /** projeto selecionado na barra lateral */
  projectId: number | null;
  boards: BoardSummary[];
  people: Person[];
  meId: number | null;
  claudeId: number | null;
  app: AppInfo | null;
  board: Board | null;
  boardLoading: boolean;
  boardMissing: boolean;
  /** incrementa a cada recarga/alteração — o painel do item usa para se atualizar */
  revision: number;
  filters: ViewFilters;
  selection: number[];
  toasts: ToastSpec[];
  modal: ModalSpec | null;
  sidebarCollapsed: boolean;
  activityOpen: boolean;
  /** arrastos/redimensionamentos em andamento: adia recargas vindas do tempo real */
  interacting: number;
  pendingRefresh: boolean;
  /** pedido para a linha do item entrar em modo de edição do nome (ex.: após "Novo item") */
  editRequest: { itemId: number; nonce: number } | null;
  /** pedido para o painel do item abrir numa aba (ex.: subitens, pelo contador da tabela) */
  panelTab: { itemId: number; tab: PanelTab; nonce: number } | null;
  /** "Meu trabalho": itens atribuídos a uma pessoa em todos os projetos */
  myWork: MyWork | null;
  /** pessoa mostrada em "Meu trabalho" (null = você) */
  myWorkPersonId: number | null;
}

const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* armazenamento indisponível */
    }
  },
};

const filtersKey = (boardId: number) => `tuesday:filters:${boardId}`;
const PROJECT_KEY = 'tuesday:project';

function loadFilters(boardId: number): ViewFilters {
  const raw = storage.get(filtersKey(boardId));
  if (!raw) return EMPTY_FILTERS;
  try {
    return { ...EMPTY_FILTERS, ...(JSON.parse(raw) as Partial<ViewFilters>), search: '' };
  } catch {
    return EMPTY_FILTERS;
  }
}

function pickProject(projects: Project[], preferred: number | null): number | null {
  if (preferred != null && projects.some((p) => p.id === preferred)) return preferred;
  return projects[0]?.id ?? null;
}

function rememberProject(id: number | null): void {
  if (id != null) storage.set(PROJECT_KEY, String(id));
}

export const useStore = create<State>(() => ({
  ready: false,
  loadError: null,
  connected: true,
  projects: [],
  projectId: null,
  boards: [],
  people: [],
  meId: null,
  claudeId: null,
  app: null,
  board: null,
  boardLoading: false,
  boardMissing: false,
  revision: 0,
  filters: EMPTY_FILTERS,
  selection: [],
  toasts: [],
  modal: null,
  sidebarCollapsed: storage.get('tuesday:sidebar-collapsed') === '1',
  activityOpen: false,
  interacting: 0,
  pendingRefresh: false,
  editRequest: null,
  panelTab: null,
  myWork: null,
  myWorkPersonId: null,
}));

const get = useStore.getState;
const set = useStore.setState;

export const byPosition = <T extends { position: number; id: number }>(a: T, b: T) => a.position - b.position || a.id - b.id;

function patchBoard(fn: (board: Board) => Board): void {
  const board = get().board;
  if (board) set({ board: fn(board) });
}

function patchItems(ids: number[], fn: (item: Item) => Item): void {
  const targets = new Set(ids);
  patchBoard((b) => ({ ...b, items: b.items.map((i) => (targets.has(i.id) ? fn(i) : i)) }));
  const work = get().myWork;
  if (work?.items.some((i) => targets.has(i.id)))
    set({ myWork: { ...work, items: work.items.map((i) => (targets.has(i.id) ? fn(i) : i)) } });
}

function patchSubitems(itemId: number, fn: (subitems: Subitem[]) => Subitem[]): void {
  patchItems([itemId], (i) => ({ ...i, subitems: fn(i.subitems).sort(byPosition) }));
}

function withValue(item: Item, columnId: number, value: CellValue): Item {
  const values = { ...item.values };
  if (value === null || (Array.isArray(value) && value.length === 0)) delete values[String(columnId)];
  else values[String(columnId)] = value;
  return { ...item, values };
}

const bump = () => set((s) => ({ revision: s.revision + 1 }));

const summaryOf = (board: Board): BoardSummary => ({
  id: board.id,
  projectId: board.projectId,
  name: board.name,
  description: board.description,
  position: board.position,
  itemCount: board.items.length,
  updatedAt: board.updatedAt,
});

let toastSeq = 0;

export function toast(message: string, kind: ToastSpec['kind'] = 'info', action?: ToastSpec['action'], duration = 5000): number {
  const id = ++toastSeq;
  set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, kind, action, duration }] }));
  return id;
}

/** Aplica a mudança otimista, chama a API e desfaz (com aviso) se der erro. */
async function mutate<T>(optimistic: (() => void) | null, request: () => Promise<T>, failure?: string): Promise<T | undefined> {
  const snapshot = get().board;
  const workSnapshot = get().myWork;
  optimistic?.();
  try {
    const result = await request();
    // O eco das nossas mudanças no tempo real é ignorado: em "Meu trabalho", relê a lista.
    if (getRoute().page === 'my-work') scheduleMyWorkReload();
    return result;
  } catch (error) {
    if (optimistic) set({ board: snapshot, myWork: workSnapshot });
    toast(errorText(error, failure ?? 'Não foi possível salvar a alteração.'), 'error');
    void actions.refreshAll();
    return undefined;
  }
}

let myWorkTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleMyWorkReload(): void {
  clearTimeout(myWorkTimer);
  myWorkTimer = setTimeout(() => void actions.loadMyWork({ silent: true }), 250);
}

let boardTicket = 0;
let myWorkTicket = 0;

export const actions = {
  // ── Carregamento ───────────────────────────────────────────
  async init() {
    for (let attempt = 0; ; attempt++) {
      try {
        const boot = await api.bootstrap();
        set({
          projects: boot.projects,
          projectId: pickProject(boot.projects, Number(storage.get(PROJECT_KEY)) || null),
          boards: boot.boards,
          people: boot.people,
          meId: boot.meId,
          claudeId: boot.claudeId,
          app: boot.app,
          ready: true,
          loadError: null,
        });
        return;
      } catch (error) {
        // No `npm run dev` o Vite sobe antes da API: tenta de novo por alguns segundos antes de desistir.
        const retriable = !(error instanceof ApiError) || error.status >= 500;
        if (!retriable || attempt >= 12) {
          set({ loadError: errorText(error, 'Não foi possível conectar ao servidor do tuesday.') });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
  },

  async loadBoard(id: number, opts: { silent?: boolean } = {}) {
    const ticket = ++boardTicket;
    if (!opts.silent) set({ boardLoading: true, boardMissing: false });
    try {
      const board = await api.getBoard(id);
      if (ticket !== boardTicket) return;
      const switching = get().board?.id !== board.id;
      // Fora da página do quadro (ex.: painel aberto em "Meu trabalho"), não troca o projeto da barra lateral.
      const onBoardPage = getRoute().page === 'board';
      set((s) => ({
        board,
        boardLoading: false,
        boardMissing: false,
        revision: s.revision + 1,
        projectId: onBoardPage ? board.projectId : s.projectId,
        filters: switching ? loadFilters(board.id) : s.filters,
        selection: switching ? [] : s.selection.filter((sel) => board.items.some((i) => i.id === sel)),
      }));
      if (onBoardPage) rememberProject(board.projectId);
    } catch (error) {
      if (ticket !== boardTicket) return;
      set({ boardLoading: false });
      if (error instanceof ApiError && error.status === 404) set({ board: null, boardMissing: true });
      else if (!opts.silent) toast(errorText(error), 'error');
    }
  },

  async refreshAll() {
    if (get().interacting > 0) {
      set({ pendingRefresh: true });
      return;
    }
    try {
      const boot = await api.bootstrap();
      set((s) => ({
        projects: boot.projects,
        projectId: pickProject(boot.projects, s.projectId),
        boards: boot.boards,
        people: boot.people,
        meId: boot.meId,
        claudeId: boot.claudeId,
        connected: true,
      }));
    } catch {
      return;
    }
    if (getRoute().page === 'my-work') void actions.loadMyWork({ silent: true });
    const id = get().board?.id ?? getRoute().boardId;
    if (id) await actions.loadBoard(id, { silent: true });
  },

  // ── Meu trabalho ───────────────────────────────────────────
  async loadMyWork(opts: { silent?: boolean } = {}) {
    const ticket = ++myWorkTicket;
    try {
      const work = await api.myWork(get().myWorkPersonId ?? undefined);
      if (ticket === myWorkTicket) set({ myWork: work });
    } catch (error) {
      if (ticket === myWorkTicket && !opts.silent) toast(errorText(error, 'Não foi possível carregar o seu trabalho.'), 'error');
    }
  },

  /** Mostra o trabalho de outra pessoa (null = você). */
  setMyWorkPerson(personId: number | null) {
    set({ myWorkPersonId: personId, myWork: null });
    void actions.loadMyWork();
  },

  beginInteraction() {
    set((s) => ({ interacting: s.interacting + 1 }));
  },

  endInteraction() {
    set((s) => ({ interacting: Math.max(0, s.interacting - 1) }));
    if (get().interacting === 0 && get().pendingRefresh) {
      set({ pendingRefresh: false });
      void actions.refreshAll();
    }
  },

  // ── Interface ──────────────────────────────────────────────
  openModal(modal: ModalSpec) {
    set({ modal });
  },

  closeModal() {
    set({ modal: null });
  },

  confirm(spec: ConfirmSpec) {
    set({ modal: { kind: 'confirm', ...spec } });
  },

  dismissToast(id: number) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  toggleSidebar() {
    const next = !get().sidebarCollapsed;
    set({ sidebarCollapsed: next });
    storage.set('tuesday:sidebar-collapsed', next ? '1' : '0');
  },

  setActivityOpen(open: boolean) {
    set({ activityOpen: open });
  },

  requestEdit(itemId: number) {
    set((s) => ({ editRequest: { itemId, nonce: (s.editRequest?.nonce ?? 0) + 1 } }));
  },

  /** Abre o painel do item, opcionalmente numa aba. */
  openItem(itemId: number, tab?: PanelTab) {
    if (tab) set((s) => ({ panelTab: { itemId, tab, nonce: (s.panelTab?.nonce ?? 0) + 1 } }));
    navigate({ itemId });
  },

  clearPanelTab() {
    set({ panelTab: null });
  },

  // ── Filtros e seleção ──────────────────────────────────────
  setFilters(patch: Partial<ViewFilters>) {
    set((s) => ({ filters: { ...s.filters, ...patch } }));
    const board = get().board;
    if (board) {
      const { search: _search, ...persisted } = get().filters;
      storage.set(filtersKey(board.id), JSON.stringify(persisted));
    }
  },

  clearFilters() {
    actions.setFilters({ search: '', people: [], labels: {} });
  },

  toggleSelected(id: number) {
    set((s) => ({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] }));
  },

  setSelected(ids: number[], selected: boolean) {
    set((s) => ({
      selection: selected ? [...new Set([...s.selection, ...ids])] : s.selection.filter((x) => !ids.includes(x)),
    }));
  },

  clearSelection() {
    set({ selection: [] });
  },

  // ── Projetos ───────────────────────────────────────────────
  selectProject(id: number) {
    set({ projectId: id });
    rememberProject(id);
    const first = get().boards.find((b) => b.projectId === id);
    navigate({ boardId: first?.id ?? null, view: getRoute().view, itemId: null });
  },

  /** Lança o erro da API (o modal mostra a mensagem, ex.: pasta inexistente). */
  async createProject(input: { name: string; color?: string; folder?: string | null; template?: BoardTemplate | null } & IdFormat) {
    const { project, boardId } = await api.createProject(input);
    const boot = await api.bootstrap();
    set({ projects: boot.projects, boards: boot.boards, projectId: project.id });
    rememberProject(project.id);
    navigate({ boardId, view: 'table', itemId: null });
    toast(`Projeto "${project.name}" criado.`, 'success');
    return project;
  },

  /** Lança o erro da API (o modal mostra a mensagem). */
  async updateProject(id: number, patch: { name?: string; color?: string; folder?: string | null }) {
    const project = await api.updateProject(id, patch);
    set((s) => ({ projects: s.projects.map((p) => (p.id === id ? project : p)) }));
    return project;
  },

  async deleteProject(id: number) {
    const ok = await mutate(null, () => api.deleteProject(id).then(() => true), 'Não foi possível excluir o projeto.');
    if (!ok) return;
    const projects = get().projects.filter((p) => p.id !== id);
    const boardWasHere = get().board?.projectId === id;
    set((s) => ({ projects, boards: s.boards.filter((b) => b.projectId !== id), ...(boardWasHere ? { board: null } : {}) }));
    if ((get().projectId === id || boardWasHere) && projects[0]) actions.selectProject(projects[0].id);
    toast('Projeto excluído.', 'success');
  },

  /** Lê agora os commits da pasta do projeto (normalmente o servidor faz isso sozinho a cada 10 s). */
  async syncGit(projectId: number) {
    try {
      const result = await api.syncGit(projectId);
      toast(result.message, result.ok ? 'success' : 'error', undefined, 3500);
      await actions.refreshAll();
      return result;
    } catch (error) {
      toast(errorText(error, 'Não foi possível ler o Git.'), 'error');
      return undefined;
    }
  },

  /** Cria itens a partir de TODO/FIXME do código e/ou conclui os que saíram do código. Lança o erro da API (o modal mostra). */
  async importCodeTodos(projectId: number, input: { ids?: string[]; boardId?: number; groupId?: number; completeItemIds?: number[] }) {
    const result = await api.importCodeTodos(projectId, input);
    const created = result.created.length;
    const parts = [
      created ? `${created === 1 ? '1 item criado' : `${created} itens criados`} em "${result.groupName}"` : null,
      result.completed ? `${result.completed === 1 ? '1 item concluído' : `${result.completed} itens concluídos`}` : null,
    ].filter(Boolean);
    toast(parts.length ? `${parts.join(' e ')}.` : 'Nada novo para importar.', parts.length ? 'success' : 'info');
    if (get().board?.id === result.boardId && getRoute().page === 'board') await actions.loadBoard(result.boardId, { silent: true });
    else if (created) navigate({ boardId: result.boardId, view: 'table', itemId: null });
    void actions.refreshAll();
    return result;
  },

  async moveBoardToProject(boardId: number, projectId: number) {
    const target = get().projects.find((p) => p.id === projectId);
    const moved = await mutate(null, () => api.updateBoard(boardId, { projectId }), 'Não foi possível mover o quadro.');
    if (!moved) return;
    set((s) => ({
      boards: s.boards.map((b) => (b.id === boardId ? { ...b, projectId } : b)),
      board: s.board?.id === boardId ? { ...s.board, projectId } : s.board,
      ...(s.board?.id === boardId ? { projectId } : {}),
    }));
    if (get().board?.id === boardId) rememberProject(projectId);
    toast(`Quadro movido para "${target?.name ?? 'outro projeto'}".`, 'success');
    void actions.refreshAll();
  },

  // ── Quadros ────────────────────────────────────────────────
  async createBoard(name: string, template: BoardTemplate = 'software', projectId?: number | null, idFormat: IdFormat = {}) {
    const target = projectId ?? get().projectId ?? undefined;
    const board = await mutate(
      null,
      () => api.createBoard({ name, template, projectId: target, ...idFormat }),
      'Não foi possível criar o quadro.',
    );
    if (!board) return;
    set((s) => ({
      boards: [...s.boards.filter((b) => b.id !== board.id), summaryOf(board)].sort(byPosition),
      projects: s.projects.map((p) => (p.id === board.projectId ? { ...p, boardCount: p.boardCount + 1 } : p)),
      projectId: board.projectId,
      board,
      filters: EMPTY_FILTERS,
      selection: [],
    }));
    rememberProject(board.projectId);
    navigate({ boardId: board.id, view: 'table', itemId: null });
  },

  async updateBoard(id: number, patch: { name?: string; description?: string }) {
    await mutate(
      () => {
        set((s) => ({ boards: s.boards.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
        patchBoard((b) => (b.id === id ? { ...b, ...patch } : b));
      },
      () => api.updateBoard(id, patch),
    );
  },

  async updateKanbanSettings(patch: Partial<KanbanSettings>) {
    const board = get().board;
    if (!board) return;
    const kanban = { ...board.settings.kanban, ...patch };
    await mutate(
      () => patchBoard((b) => ({ ...b, settings: { ...b.settings, kanban } })),
      () => api.updateBoard(board.id, { settings: { kanban } }),
    );
  },

  async updateTableSettings(patch: Partial<TableSettings>) {
    const board = get().board;
    if (!board) return;
    const table = { ...board.settings.table, ...patch };
    await mutate(
      () => patchBoard((b) => ({ ...b, settings: { ...b.settings, table } })),
      () => api.updateBoard(board.id, { settings: { table } }),
    );
  },

  /** Número que o próximo item vai receber (coluna "ID do item"). */
  async setNextItemNumber(boardId: number, nextItemNumber: number) {
    const ok = await mutate(
      () => patchBoard((b) => (b.id === boardId ? { ...b, nextItemNumber } : b)),
      () => api.updateBoard(boardId, { nextItemNumber }),
      'Não foi possível alterar o próximo número.',
    );
    return !!ok;
  },

  async deleteBoard(id: number) {
    const deleted = get().boards.find((b) => b.id === id);
    const ok = await mutate(null, () => api.deleteBoard(id).then(() => true), 'Não foi possível excluir o quadro.');
    if (!ok) return;
    const boards = get().boards.filter((b) => b.id !== id);
    set((s) => ({
      boards,
      projects: s.projects.map((p) => (p.id === deleted?.projectId ? { ...p, boardCount: Math.max(0, p.boardCount - 1) } : p)),
    }));
    if (get().board?.id === id) {
      set({ board: null });
      const next = boards.find((b) => b.projectId === deleted?.projectId);
      navigate({ boardId: next?.id ?? null, view: 'table', itemId: null }, { replace: true });
    }
    toast('Quadro excluído.', 'success');
  },

  // ── Grupos ─────────────────────────────────────────────────
  async createGroup(position: 'top' | 'bottom' = 'bottom'): Promise<Group | undefined> {
    const board = get().board;
    if (!board) return undefined;
    const group = await mutate(null, () => api.createGroup(board.id, { position }));
    if (group) patchBoard((b) => ({ ...b, groups: [...b.groups.filter((g) => g.id !== group.id), group].sort(byPosition) }));
    return group;
  },

  async updateGroup(id: number, patch: Partial<Pick<Group, 'name' | 'color' | 'collapsed' | 'position'>>) {
    await mutate(
      () =>
        patchBoard((b) => ({
          ...b,
          groups: b.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)).sort(byPosition),
        })),
      () => api.updateGroup(id, patch),
    );
  },

  async setAllGroupsCollapsed(collapsed: boolean) {
    const groups = get().board?.groups ?? [];
    await Promise.all(groups.filter((g) => g.collapsed !== collapsed).map((g) => actions.updateGroup(g.id, { collapsed })));
  },

  async moveGroup(id: number, direction: -1 | 1) {
    const groups = get().board?.groups ?? [];
    const index = groups.findIndex((g) => g.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= groups.length) return;
    const neighbor = groups[target];
    const beyond = groups[target + direction];
    const position =
      direction < 0 ? positionBetween(beyond?.position, neighbor.position) : positionBetween(neighbor.position, beyond?.position);
    await actions.updateGroup(id, { position });
  },

  async deleteGroup(id: number) {
    await mutate(
      () =>
        patchBoard((b) => ({
          ...b,
          groups: b.groups.filter((g) => g.id !== id),
          items: b.items.filter((i) => i.groupId !== id),
        })),
      () => api.deleteGroup(id),
      'Não foi possível excluir o grupo.',
    );
  },

  // ── Colunas ────────────────────────────────────────────────
  async createColumn(type: ColumnType, afterColumnId?: number | null) {
    const board = get().board;
    if (!board) return undefined;
    const column = await mutate(null, () => api.createColumn(board.id, { type, afterColumnId: afterColumnId ?? undefined }));
    if (column) patchBoard((b) => ({ ...b, columns: [...b.columns.filter((c) => c.id !== column.id), column].sort(byPosition) }));
    return column;
  },

  async updateColumn(id: number, patch: { title?: string; width?: number; position?: number; settings?: ColumnSettings }) {
    const column = await mutate(
      () =>
        patchBoard((b) => ({
          ...b,
          columns: b.columns
            .map((c) =>
              c.id === id ? { ...c, ...patch, settings: patch.settings ? { ...c.settings, ...patch.settings } : c.settings } : c,
            )
            .sort(byPosition),
        })),
      () => api.updateColumn(id, patch),
    );
    if (column) patchBoard((b) => ({ ...b, columns: b.columns.map((c) => (c.id === id ? column : c)).sort(byPosition) }));
    return column;
  },

  /** Reposiciona uma coluna entre duas vizinhas (null = ponta). */
  async moveColumn(id: number, prevId: number | null, nextId: number | null) {
    const columns = get().board?.columns ?? [];
    const prev = columns.find((c) => c.id === prevId);
    const next = columns.find((c) => c.id === nextId);
    await actions.updateColumn(id, { position: positionBetween(prev?.position, next?.position) });
  },

  async deleteColumn(id: number) {
    const board = get().board;
    const ok = await mutate(
      () =>
        patchBoard((b) => ({
          ...b,
          columns: b.columns.filter((c) => c.id !== id),
          items: b.items.map((i) => withValue(i, id, null)),
        })),
      () => api.deleteColumn(id).then(() => true),
      'Não foi possível excluir a coluna.',
    );
    if (ok && board) void actions.loadBoard(board.id, { silent: true });
  },

  // ── Itens ──────────────────────────────────────────────────
  async createItem(
    groupId: number,
    name: string,
    opts: { position?: 'top' | 'bottom'; values?: Record<string, CellValue>; kanbanPosition?: number | 'top' | 'bottom' } = {},
  ): Promise<Item | undefined> {
    const board = get().board;
    if (!board) return undefined;
    const item = await mutate(
      null,
      () =>
        api.createItem(board.id, {
          name,
          groupId,
          position: opts.position ?? 'bottom',
          values: opts.values,
          kanbanPosition: opts.kanbanPosition,
        }),
      'Não foi possível criar o item.',
    );
    if (item)
      patchBoard((b) =>
        b.id !== item.boardId || b.items.some((i) => i.id === item.id)
          ? b
          : { ...b, items: [...b.items, item], nextItemNumber: Math.max(b.nextItemNumber, item.number + 1) },
      );
    return item;
  },

  /** Troca o número do item — a referência da coluna de ID (ex.: TM-07). */
  async setItemNumber(itemId: number, number: number) {
    const ok = await mutate(
      () => {
        patchItems([itemId], (i) => ({ ...i, number }));
        patchBoard((b) => (b.items.some((i) => i.id === itemId) ? { ...b, nextItemNumber: Math.max(b.nextItemNumber, number + 1) } : b));
      },
      () => api.updateItem(itemId, { number }),
      'Não foi possível alterar o número do item.',
    );
    if (ok) bump();
    return !!ok;
  },

  async renameItem(id: number, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const ok = await mutate(
      () => patchItems([id], (i) => ({ ...i, name: trimmed })),
      () => api.updateItem(id, { name: trimmed }),
    );
    if (ok) bump();
  },

  async setValue(itemId: number, columnId: number, value: CellValue) {
    const ok = await mutate(
      () => patchItems([itemId], (i) => withValue(i, columnId, value)),
      () => api.setValues(itemId, { [String(columnId)]: value }),
    );
    if (ok) bump();
  },

  async moveItem(itemId: number, groupId: number, position: number) {
    await mutate(
      () => patchItems([itemId], (i) => ({ ...i, groupId, position })),
      () => api.updateItem(itemId, { groupId, position }),
    );
  },

  async moveItemInKanban(itemId: number, columnId: number, value: CellValue, kanbanPosition: number) {
    const item = get().board?.items.find((i) => i.id === itemId);
    if (!item) return;
    const changed = JSON.stringify(item.values[String(columnId)] ?? null) !== JSON.stringify(value ?? null);
    const ok = await mutate(
      () => patchItems([itemId], (i) => ({ ...withValue(i, columnId, value), kanbanPosition })),
      async () => {
        if (changed) await api.setValues(itemId, { [String(columnId)]: value });
        return api.updateItem(itemId, { kanbanPosition });
      },
    );
    if (ok) bump();
  },

  async deleteItems(ids: number[]) {
    if (!ids.length) return;
    const res = await mutate(
      () => {
        patchBoard((b) => ({ ...b, items: b.items.filter((i) => !ids.includes(i.id)) }));
        set((s) => ({
          selection: s.selection.filter((id) => !ids.includes(id)),
          myWork: s.myWork ? { ...s.myWork, items: s.myWork.items.filter((i) => !ids.includes(i.id)) } : null,
        }));
      },
      () => api.deleteItems(ids),
      'Não foi possível excluir.',
    );
    if (!res) return;
    const open = getRoute().itemId;
    if (open && ids.includes(open)) navigate({ itemId: null });
    toast(res.ids.length === 1 ? 'Item excluído.' : `${res.ids.length} itens excluídos.`, 'info', {
      label: 'Desfazer',
      run: () => void actions.restoreItems(res.ids),
    });
  },

  async restoreItems(ids: number[]) {
    const res = await mutate(null, () => api.restoreItems(ids));
    const board = get().board;
    if (res && board) await actions.loadBoard(board.id, { silent: true });
  },

  async duplicateItems(ids: number[]) {
    const created = await mutate(null, () => api.duplicateItems(ids), 'Não foi possível duplicar.');
    if (!created) return;
    patchBoard((b) => ({
      ...b,
      items: [...b.items, ...created.filter((c) => !b.items.some((i) => i.id === c.id))],
      nextItemNumber: Math.max(b.nextItemNumber, ...created.map((c) => c.number + 1)),
    }));
    toast(created.length === 1 ? 'Item duplicado.' : `${created.length} itens duplicados.`, 'success');
  },

  async moveItemsToGroup(ids: number[], groupId: number) {
    const group = get().board?.groups.find((g) => g.id === groupId);
    const moved = await mutate(
      () => patchItems(ids, (i) => ({ ...i, groupId })),
      () => api.moveItems(ids, groupId),
    );
    if (!moved) return;
    patchBoard((b) => ({ ...b, items: b.items.map((i) => moved.find((m) => m.id === i.id) ?? i) }));
    toast(`${ids.length === 1 ? 'Item movido' : `${ids.length} itens movidos`} para ${group?.name ?? 'o grupo'}.`, 'success');
  },

  // ── Subitens ───────────────────────────────────────────────
  async addSubitems(itemId: number, steps: { name: string; done?: boolean }[], position?: 'top' | 'bottom' | number) {
    const created = await mutate(null, () => api.addSubitems(itemId, steps, position), 'Não foi possível adicionar o subitem.');
    if (created) {
      patchSubitems(itemId, (list) => [...list.filter((s) => !created.some((c) => c.id === s.id)), ...created]);
      bump();
    }
    return created;
  },

  async setSubitemDone(itemId: number, subitemId: number, done: boolean) {
    const meId = get().meId;
    const ok = await mutate(
      () =>
        patchSubitems(itemId, (list) =>
          list.map((s) =>
            s.id === subitemId ? { ...s, done, doneAt: done ? new Date().toISOString() : null, doneBy: done ? meId : null } : s,
          ),
        ),
      () => api.updateSubitem(subitemId, { done }),
      'Não foi possível marcar o subitem.',
    );
    if (ok) bump();
  },

  async renameSubitem(itemId: number, subitemId: number, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const ok = await mutate(
      () => patchSubitems(itemId, (list) => list.map((s) => (s.id === subitemId ? { ...s, name: trimmed } : s))),
      () => api.updateSubitem(subitemId, { name: trimmed }),
    );
    if (ok) bump();
  },

  async moveSubitem(itemId: number, subitemId: number, position: number) {
    await mutate(
      () => patchSubitems(itemId, (list) => list.map((s) => (s.id === subitemId ? { ...s, position } : s))),
      () => api.updateSubitem(subitemId, { position }),
    );
  },

  async deleteSubitem(itemId: number, subitemId: number) {
    const removed = await mutate(
      () => patchSubitems(itemId, (list) => list.filter((s) => s.id !== subitemId)),
      () => api.deleteSubitem(subitemId),
      'Não foi possível excluir o subitem.',
    );
    if (!removed) return;
    bump();
    toast('Subitem excluído.', 'info', {
      label: 'Desfazer',
      run: () => void actions.addSubitems(itemId, [{ name: removed.name, done: removed.done }], removed.position),
    });
  },

  // ── Atualizações ───────────────────────────────────────────
  async postUpdate(itemId: number, body: string) {
    const update = await mutate(null, () => api.createUpdate(itemId, body), 'Não foi possível publicar a atualização.');
    if (update) {
      patchItems([itemId], (i) => ({ ...i, updatesCount: i.updatesCount + 1 }));
      bump();
    }
    return update;
  },

  async editUpdate(updateId: number, body: string) {
    const update = await mutate(null, () => api.editUpdate(updateId, body));
    if (update) bump();
    return update;
  },

  async deleteUpdate(itemId: number, updateId: number) {
    const ok = await mutate(null, () => api.deleteUpdate(updateId).then(() => true));
    if (ok) {
      patchItems([itemId], (i) => ({ ...i, updatesCount: Math.max(0, i.updatesCount - 1) }));
      bump();
    }
  },

  // ── Pessoas ────────────────────────────────────────────────
  async createPerson(name: string) {
    const person = await mutate(null, () => api.createPerson({ name }), 'Não foi possível adicionar a pessoa.');
    if (person) set((s) => ({ people: [...s.people.filter((p) => p.id !== person.id), person] }));
    return person;
  },

  async updatePerson(id: number, patch: { name?: string; color?: string }) {
    const person = await mutate(
      () => set((s) => ({ people: s.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      () => api.updatePerson(id, patch),
    );
    if (person) set((s) => ({ people: s.people.map((p) => (p.id === id ? person : p)) }));
  },

  async deletePerson(id: number) {
    const ok = await mutate(null, () => api.deletePerson(id).then(() => true));
    if (!ok) return;
    set((s) => ({ people: s.people.filter((p) => p.id !== id) }));
    const board = get().board;
    if (board) void actions.loadBoard(board.id, { silent: true });
  },

  async setMe(id: number) {
    const ok = await mutate(null, () => api.setMe(id).then(() => true));
    if (ok) set({ meId: id });
  },
};
