// Tipos compartilhados entre o servidor (API + MCP) e o cliente.
import type { TodoTag } from './codetodos';

export type ColumnType = 'status' | 'text' | 'long_text' | 'people' | 'date' | 'number' | 'checkbox' | 'link' | 'auto_number';

export interface StatusLabel {
  id: number;
  name: string;
  color: string;
}

export interface ColumnSettings {
  /** status */
  labels?: StatusLabel[];
  /** status: etiqueta que representa "concluído" (usada no alerta de prazo vencido) */
  doneLabelId?: number | null;
  /** number */
  unit?: string;
  unitPosition?: 'left' | 'right';
  decimals?: number | null;
  /** auto_number */
  prefix?: string;
  pad?: number;
}

export interface Column {
  id: number;
  boardId: number;
  title: string;
  type: ColumnType;
  settings: ColumnSettings;
  width: number;
  position: number;
}

export interface Group {
  id: number;
  boardId: number;
  name: string;
  color: string;
  position: number;
  collapsed: boolean;
}

export interface Person {
  id: number;
  name: string;
  email: string | null;
  color: string;
  isAgent: boolean;
}

/** Repositório encontrado na pasta do projeto (a própria pasta ou uma subpasta dela). */
export interface GitRepo {
  /** nome da pasta do repositório */
  name: string;
  path: string;
  remote: string | null;
  /** página do repositório (GitHub/GitLab/Bitbucket), se o remoto for conhecido */
  webUrl: string | null;
}

/** Estado da integração com Git da pasta vinculada. */
export interface ProjectGit {
  repos: GitRepo[];
  lastSyncAt: string | null;
  error: string | null;
  linkedCommits: number;
}

/** Projeto = espaço de trabalho com seus quadros; pode estar vinculado a uma pasta local. */
export interface Project {
  id: number;
  name: string;
  color: string;
  /** pasta local vinculada — o MCP usa este projeto quando o Claude roda dentro dela */
  folder: string | null;
  position: number;
  boardCount: number;
  /** null quando o projeto não tem pasta */
  git: ProjectGit | null;
}

/** Commit ligado a um item por citar a referência dele (ex.: TUE-012). */
export interface ItemCommit {
  hash: string;
  shortHash: string;
  /** nome da pasta do repositório de onde veio o commit */
  repo: string | null;
  subject: string;
  body: string;
  authorName: string;
  authorEmail: string;
  committedAt: string;
  /** o commit usou "fixes TUE-012" (ou equivalente) e concluiu o item */
  closed: boolean;
  url: string | null;
}

export interface GitSyncResult {
  ok: boolean;
  message: string;
  scanned: number;
  linked: number;
  closed: number;
}

export type BoardTemplate = 'software' | 'default' | 'empty';

/** Formato das referências dos itens de um quadro novo (coluna "ID do item" do modelo de software). */
export interface IdFormat {
  /** ex.: "TM" → TM-001 (padrão: 3 primeiras letras do nome) */
  idPrefix?: string | null;
  /** dígitos, com zeros à esquerda (padrão: 3) */
  idPad?: number | null;
  /** número do primeiro item (padrão: 1) — para continuar uma numeração que já existia */
  idStart?: number | null;
}

export interface LinkValue {
  url: string;
  text?: string;
}

/**
 * Formato interno de cada valor:
 * status → id da etiqueta · people → ids · date → "AAAA-MM-DD" · number → número
 * checkbox → true · link → { url, text } · text/long_text → string
 */
export type CellValue = string | number | boolean | number[] | LinkValue | null;

/** Passo de um item (checklist): o Claude quebra a tarefa em subitens e vai marcando. */
export interface Subitem {
  id: number;
  itemId: number;
  name: string;
  done: boolean;
  position: number;
  /** quando foi marcado como feito */
  doneAt: string | null;
  /** quem marcou como feito */
  doneBy: number | null;
  createdAt: string;
}

export interface Item {
  id: number;
  boardId: number;
  groupId: number;
  /** número sequencial do item no quadro (usado pela coluna "ID do item") */
  number: number;
  name: string;
  position: number;
  kanbanPosition: number;
  /** valores indexados pelo id da coluna */
  values: Record<string, CellValue>;
  /** subitens (checklist), na ordem */
  subitems: Subitem[];
  updatesCount: number;
  commitsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanSettings {
  laneColumnId?: number | null;
  cardColumnIds?: number[];
  /** chaves das raias recolhidas: id da etiqueta ou "none" */
  collapsedLanes?: string[];
}

export interface TableSettings {
  hiddenColumnIds?: number[];
  nameWidth?: number;
  itemColumnTitle?: string;
}

export interface BoardSettings {
  kanban?: KanbanSettings;
  table?: TableSettings;
}

export interface BoardSummary {
  id: number;
  projectId: number;
  name: string;
  description: string;
  position: number;
  itemCount: number;
  updatedAt: string;
}

export interface Board extends BoardSummary {
  /** número que o próximo item criado vai receber (coluna "ID do item") */
  nextItemNumber: number;
  settings: BoardSettings;
  groups: Group[];
  columns: Column[];
  items: Item[];
}

export interface Update {
  id: number;
  itemId: number;
  authorId: number | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export type ActivitySource = 'user' | 'claude' | 'git';

export type ActivityAction =
  | 'item_created'
  | 'item_renamed'
  | 'value_changed'
  | 'item_moved'
  | 'item_deleted'
  | 'item_restored'
  | 'item_duplicated'
  | 'update_posted'
  | 'commit_linked'
  | 'subitems_added'
  | 'subitem_checked'
  | 'subitem_unchecked'
  | 'subitem_renamed'
  | 'subitem_deleted';

export interface ActivitySnapshot {
  text: string;
  color?: string;
}

export interface ActivityData {
  columnId?: number;
  columnTitle?: string;
  columnType?: ColumnType | 'name' | 'group';
  from?: ActivitySnapshot | null;
  to?: ActivitySnapshot | null;
  text?: string;
  /** hash curto do commit (commit_linked) */
  hash?: string;
  /** quantos subitens foram adicionados (subitems_added) */
  count?: number;
}

export interface ActivityEntry {
  id: number;
  boardId: number;
  itemId: number | null;
  itemName: string | null;
  actorId: number | null;
  source: ActivitySource;
  action: ActivityAction;
  data: ActivityData;
  createdAt: string;
}

export interface ItemDetails {
  item: Item;
  updates: Update[];
  activity: ActivityEntry[];
  commits: ItemCommit[];
}

/** Item ligado a uma marcação do código. */
export interface CodeTodoItem {
  id: number;
  boardId: number;
  ref: string | null;
  name: string;
  done: boolean;
  /** item excluído (na lixeira) */
  deleted: boolean;
}

/** Marcação TODO/FIXME/HACK/XXX encontrada na pasta do projeto. */
export interface CodeTodo {
  /** identidade estável: arquivo + marcação + texto (não muda quando a linha muda) */
  id: string;
  tag: TodoTag;
  /** caminho relativo à pasta do projeto, com "/" */
  path: string;
  /** repositório de onde veio, quando a pasta do projeto tem vários */
  repo: string | null;
  line: number;
  column: number;
  author: string | null;
  text: string;
  /** nome que o item recebe ao importar */
  name: string;
  /** abre o arquivo na linha, no editor (vscode://file/…) */
  url: string;
  /** new: ainda não é item · imported: já foi importado · cited: o texto cita um item (ex.: "TODO TM-40: …") */
  status: 'new' | 'imported' | 'cited';
  item: CodeTodoItem | null;
}

/** Marcação importada que não está mais no código — o item ainda não foi concluído. */
export interface RemovedCodeTodo {
  tag: TodoTag;
  path: string;
  line: number;
  text: string;
  item: CodeTodoItem;
}

export interface CodeTodoScan {
  projectId: number;
  folder: string;
  scannedAt: string;
  /** arquivos lidos */
  files: number;
  todos: CodeTodo[];
  removed: RemovedCodeTodo[];
  /** parou antes do fim (pasta grande demais) */
  truncated: boolean;
  /** falhas ao ler algum repositório */
  errors: string[];
}

export interface CodeTodoImportResult {
  boardId: number;
  groupName: string;
  created: Item[];
  /** itens concluídos porque a marcação saiu do código */
  completed: number;
}

/** Quadro de um item em "Meu trabalho": colunas e grupos para mostrar e editar o item fora do quadro. */
export interface MyWorkBoard {
  id: number;
  name: string;
  projectId: number;
  columns: Column[];
  groups: Group[];
  /** coluna de status mostrada (a do Kanban, de preferência) */
  statusColumnId: number | null;
  /** coluna de data que define a faixa (Atrasado, Hoje…) */
  dateColumnId: number | null;
}

/** "Meu trabalho": itens atribuídos a uma pessoa em todos os projetos. */
export interface MyWork {
  personId: number;
  boards: MyWorkBoard[];
  items: Item[];
}

export interface AppInfo {
  root: string;
  version: string;
  port: number;
  /** local: roda neste computador · server: publicado na rede (Docker, servidor da empresa) */
  mode: 'local' | 'server';
  /** source: pelo código (npm) · desktop: app instalado */
  runtime: 'source' | 'desktop';
  database: { dialect: 'sqlite' | 'postgres'; label: string };
  /** como o Claude Code / Claude Desktop inicia o MCP (stdio) desta instalação */
  mcp: { command: string; args: string[]; env?: Record<string, string> };
  /** o servidor pede senha */
  auth: boolean;
}

export interface SetupStatus {
  claudeCode: { cli: string | null; configured: boolean; upToDate: boolean; command: string };
  claudeDesktop: { configPath: string; found: boolean; configured: boolean; upToDate: boolean };
  /** hooks do Claude Code: resumo ao abrir a sessão e registro do trabalho ao terminar */
  claudeHooks: { settingsPath: string; configured: boolean; upToDate: boolean };
  nodePath: string;
  mcpScript: string;
}

export interface SetupResult {
  ok: boolean;
  message: string;
  output?: string;
}

export interface Bootstrap {
  projects: Project[];
  boards: BoardSummary[];
  people: Person[];
  meId: number | null;
  claudeId: number | null;
  app: AppInfo;
}

export interface ChangeEvent {
  /** board: mudança num quadro · global: lista de quadros/pessoas · external: outro processo (ex.: MCP via stdio) */
  scope: 'board' | 'global' | 'external';
  boardId?: number | null;
  clientId?: string | null;
}
