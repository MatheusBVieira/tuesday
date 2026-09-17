import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CodeTodo, ColumnSettings, ColumnType, StatusLabel } from '../../shared/types';
import { TODO_TAGS } from '../../shared/codetodos';
import { LABEL_COLORS, resolveColor } from '../../shared/colors';
import { WORK_BUCKETS, workBucket, type WorkBucket } from '../../shared/mywork';
import { COLUMN_TYPES, MAX_ITEM_NUMBER, fold, formatItemRef, isItemDone, statusLabelOf, todayIso } from '../../shared/values';
import { tx, type Actor } from '../services/common';
import { createBoard, getBoard, listBoards, requireBoard, resolveBoard, updateBoard } from '../services/boards';
import { createGroup, listGroups, resolveGroup, updateGroup } from '../services/groups';
import { createColumn, listColumns, resolveColumn, updateColumn } from '../services/columns';
import { createItem, deleteItems, getItemDetails, resolveItem, restoreItems, setItemValues, updateItem } from '../services/items';
import { createUpdate } from '../services/updates';
import { addSubitems, deleteSubitem, listSubitems, resolveSubitem, updateSubitem } from '../services/subitems';
import { subitemProgress } from '../../shared/subitems';
import { createPerson, getClaudeId, getMeId, listPeople, resolvePerson } from '../services/people';
import { getMyWork } from '../services/mywork';
import { createProject, listProjects, resolveProject, updateProject } from '../services/projects';
import { listActivity } from '../services/activity';
import { syncProjectGit } from '../services/git';
import { importCodeTodos, refreshCodeTodos, scanCodeTodos } from '../services/codetodos';
import {
  boardContext,
  describeActivity,
  matchesCondition,
  orderedItems,
  parseFriendlyValues,
  presentColumn,
  presentItem,
  itemRef as formatRef,
  presentSubitems,
  searchableText,
} from './present';
import { ScopeResolver, type Scope } from './scope';

const VERSION = '1.4.0';

const BASE_INSTRUCTIONS = `tuesday é o gerenciador de tarefas local do usuário (no estilo monday.com), com tabela principal e kanban.

Estrutura: projetos → quadros (boards) → grupos (seções coloridas) → itens (as tarefas). Um projeto pode estar vinculado a uma pasta local; quando você trabalha dentro dessa pasta, ele é o "projeto atual". Cada quadro tem colunas tipadas: status (etiquetas coloridas), people, date, number, text, long_text, checkbox, link e auto_number (ID do item, ex.: TUE-012).

Como usar:
- Comece com list_projects / get_board para conhecer quadros, grupos, colunas e etiquetas antes de editar.
- No projeto atual, "board" é opcional: as ferramentas usam o primeiro quadro do projeto.
- Projetos, quadros, grupos e colunas aceitam id ou nome. Itens aceitam id ou a referência (ex.: "TUE-012").
- Valores usam o TÍTULO da coluna como chave, em formato amigável: status → nome da etiqueta; people → nome(s); date → "AAAA-MM-DD" (também "hoje", "amanhã", "+3d"); number → número; checkbox → true/false; link → URL; texto → string. null limpa o valor.
- Tudo o que você faz aparece na tela do usuário em tempo real e fica no registro de atividades como "Claude". Use add_update para registrar notas, decisões ou resumos num item.
- Referências: a coluna auto_number gera refs como TUE-001 a partir do número do item. Prefixo, dígitos e próximo número são configuráveis (update_column: prefix, digits, next_number). Ao importar tarefas de outra ferramenta mantendo as referências antigas (ex.: TM-07), passe number em create_items; update_items também troca o número.
- Subitens (checklist): para um trabalho com várias etapas, quebre o item em passos com add_subitems (ou subitems em create_items) antes de começar e marque cada passo com update_subitems (done: true) assim que concluí-lo — o usuário acompanha o progresso (ex.: 2/5) em tempo real. get_item lista os subitens com os ids.
- Registro do trabalho: ao terminar algo ligado a um item, poste uma atualização curta nele (add_update: o que mudou, decisões, o que falta) e ajuste o status (update_items). Com os hooks do tuesday instalados, você recebe o resumo do projeto ao abrir a sessão e um lembrete ao encerrar.
- Meu trabalho: get_my_work mostra o que está atribuído ao usuário em todos os projetos, separado pelo prazo (atrasado, hoje, esta semana…) — use para "o que eu tenho pra hoje?".
- Git: commits na pasta do projeto que citam a referência de um item (ex.: TUE-012) são ligados a ele automaticamente, e "fixes TUE-012" (também closes, resolves, corrige, fecha) move o item para concluído. Ao commitar um trabalho ligado a um item, cite a referência na mensagem do commit. get_item mostra os commits ligados; sync_git força a leitura na hora.
- TODOs do código: find_code_todos lista as marcações TODO/FIXME/HACK/XXX dos comentários da pasta do projeto; import_code_todos cria itens com a coluna "Código" (link que abre o arquivo na linha, no VS Code), sem duplicar, e mantém a linha atualizada quando o código muda.
- delete_items é reversível por 30 dias (restore_items). Excluir projetos, quadros, grupos e colunas só pela interface.`;

function instructionsFor(scope: Scope): string {
  if (scope.project) {
    const where = scope.project.folder ? ` (pasta ${scope.project.folder})` : '';
    return `${BASE_INSTRUCTIONS}\n\nProjeto atual: "${scope.project.name}"${where}. As ferramentas usam os quadros deste projeto por padrão; use project ou all_projects para consultar outros.`;
  }
  const dir = scope.dirs[0];
  return `${BASE_INSTRUCTIONS}\n\nNenhum projeto do tuesday está vinculado à pasta atual${dir ? ` (${dir})` : ''}. Use list_projects para ver os projetos. Se o usuário quiser acompanhar esta pasta, crie um projeto com create_project (folder: ".") ou vincule um existente com update_project.`;
}

type Ref = number | string;

const refSchema = (what: string) => z.union([z.number().int(), z.string().min(1)]).describe(what);
const projectRef = refSchema('Id ou nome do projeto');
const boardRef = refSchema('Id ou nome do quadro');
const optionalBoard = refSchema('Id ou nome do quadro (opcional: padrão é o primeiro quadro do projeto atual)').optional();
const groupRef = refSchema('Id ou nome do grupo');
const columnRef = refSchema('Id ou título da coluna');
const itemRef = refSchema('Id do item ou referência como "TUE-012"');
const templateSchema = z.enum(['software', 'default', 'empty']);
const valuesSchema = z
  .record(z.string(), z.any())
  .describe(
    'Valores por título da coluna, ex.: {"Status": "Em andamento", "Responsável": "Ana", "Prazo": "2026-10-01"}. null limpa o valor.',
  );
const colorSchema = z
  .string()
  .describe(
    'Cor em hex (#579bfc) ou nome: verde, verde escuro, azul, azul escuro, roxo, rosa, laranja, amarelo, vermelho, cinza, preto...',
  );
const itemNumberSchema = z.number().int().min(1).max(MAX_ITEM_NUMBER);
const digitsSchema = z.number().int().min(1).max(8);
/** Formato das referências do primeiro quadro (modelo software). */
const idFormatShape = {
  id_prefix: z.string().optional().describe('Prefixo das referências dos itens, ex.: "TM" → TM-001 (padrão: 3 primeiras letras do nome)'),
  id_digits: digitsSchema.optional().describe('Dígitos da referência, com zeros à esquerda: 2 → TM-07 (padrão: 3)'),
  id_start: itemNumberSchema
    .optional()
    .describe('Número do primeiro item — para continuar uma numeração existente (ex.: 38 depois de TM-37)'),
};

interface ToolMeta {
  title: string;
  description: string;
  readOnly?: boolean;
  destructive?: boolean;
}

// Antes de responder, lê commits novos da pasta do projeto atual (no máximo a cada 10 s por projeto).
const lastAutoSync = new Map<number, number>();

async function autoSyncGit(scope: Scope): Promise<void> {
  const project = scope.project;
  if (!project?.folder) return;
  const now = Date.now();
  if (now - (lastAutoSync.get(project.id) ?? 0) < 10_000) return;
  lastAutoSync.set(project.id, now);
  await syncProjectGit(project.id).catch(() => undefined);
  try {
    refreshCodeTodos(project.id);
  } catch {
    /* pasta inacessível no momento */
  }
}

export interface McpServerOptions {
  transport: 'stdio' | 'http';
  /** projeto fixo desta conexão (ex.: ?project= na URL) */
  project?: string | null;
}

export function createMcpServer(options: McpServerOptions = { transport: 'stdio' }): McpServer {
  let mcp: McpServer | undefined;
  const scopes = new ScopeResolver(() => mcp?.server, {
    useProcessDirs: options.transport === 'stdio',
    fixedProject: options.project ?? null,
  });
  const server = new McpServer({ name: 'tuesday', title: 'tuesday', version: VERSION }, { instructions: instructionsFor(scopes.guess()) });
  mcp = server;

  const actor = (): Actor => ({ source: 'claude', personId: getClaudeId(), clientId: null });

  function tool<Shape extends z.ZodRawShape>(
    name: string,
    meta: ToolMeta,
    shape: Shape,
    handler: (args: z.infer<z.ZodObject<Shape>>, scope: Scope) => unknown,
  ) {
    const callback = async (args: z.infer<z.ZodObject<Shape>>) => {
      try {
        const scope = await scopes.resolve();
        await autoSyncGit(scope);
        const result = await handler(args, scope);
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text' as const, text: message }] };
      }
    };
    server.registerTool(
      name,
      {
        title: meta.title,
        description: meta.description,
        inputSchema: shape,
        annotations: {
          title: meta.title,
          readOnlyHint: meta.readOnly ?? false,
          destructiveHint: meta.destructive ?? false,
          idempotentHint: meta.readOnly ?? false,
          openWorldHint: false,
        },
      } as never,
      callback as never,
    );
  }

  // ── Auxiliares de escopo ───────────────────────────────────
  const projectName = (id: number) => listProjects().find((p) => p.id === id)?.name ?? null;
  const boardsOf = (projectId: number) => listBoards().filter((b) => b.projectId === projectId);
  const loadContext = (boardId: number) => {
    const board = getBoard(boardId);
    return boardContext(board, listPeople(), projectName(board.projectId));
  };
  const boardLabel = (b: { id: number; name: string; projectId: number }) => `${projectName(b.projectId)} / ${b.name} (id ${b.id})`;

  /** Quadros considerados numa consulta: o quadro pedido, o projeto pedido, o projeto atual ou todos. */
  function scopedBoardIds(scope: Scope, opts: { board?: Ref; project?: Ref; all?: boolean }): number[] {
    if (opts.board !== undefined) return [resolveBoard(opts.board, { projectId: scope.project?.id }).id];
    if (opts.project !== undefined) return boardsOf(resolveProject(opts.project).id).map((b) => b.id);
    if (scope.project && !opts.all) return boardsOf(scope.project.id).map((b) => b.id);
    return listBoards().map((b) => b.id);
  }

  /** Quadro alvo de uma alteração: o informado ou o primeiro do projeto atual. */
  function targetBoard(scope: Scope, ref?: Ref) {
    if (ref !== undefined) return resolveBoard(ref, { projectId: scope.project?.id });
    if (scope.project) {
      const first = boardsOf(scope.project.id)[0];
      if (!first) throw new Error(`O projeto "${scope.project.name}" ainda não tem quadros. Crie um com create_board.`);
      return requireBoard(first.id);
    }
    const boards = listBoards();
    if (boards.length === 1) return requireBoard(boards[0].id);
    throw new Error(`Informe o quadro (board). Quadros disponíveis: ${boards.map(boardLabel).join(', ') || '(nenhum)'}.`);
  }

  /** "." = pasta de trabalho atual do Claude. */
  function folderArg(value: string | null | undefined, scope: Scope): string | null | undefined {
    if (value == null) return value;
    const trimmed = value.trim();
    if (['.', './', '.\\'].includes(trimmed)) {
      if (!scope.dirs[0]) throw new Error('Não sei qual é a pasta atual nesta conexão — informe o caminho completo da pasta.');
      return scope.dirs[0];
    }
    return trimmed;
  }

  const itemScope = (scope: Scope) => ({ projectId: scope.project?.id });

  // ── Projetos ───────────────────────────────────────────────
  tool(
    'list_projects',
    {
      title: 'Listar projetos',
      description: 'Lista os projetos (com seus quadros e a pasta local vinculada) e indica o projeto atual.',
      readOnly: true,
    },
    {},
    (_args, scope) => {
      const boards = listBoards();
      return {
        current: scope.project
          ? { id: scope.project.id, name: scope.project.name, folder: scope.project.folder, detected_by: scope.source }
          : null,
        working_folder: scope.dirs[0] ?? null,
        projects: listProjects().map((p) => ({
          id: p.id,
          name: p.name,
          folder: p.folder,
          boards: boards.filter((b) => b.projectId === p.id).map((b) => b.name),
          ...(p.id === scope.project?.id ? { current: true } : {}),
        })),
      };
    },
  );

  tool(
    'use_project',
    {
      title: 'Usar projeto',
      description: 'Define o projeto atual desta sessão — útil quando a pasta de trabalho não está vinculada a um projeto.',
    },
    { project: projectRef },
    ({ project }) => {
      const target = resolveProject(project);
      scopes.use(target.id);
      return { current: target.name, boards: boardsOf(target.id).map((b) => ({ id: b.id, name: b.name, items: b.itemCount })) };
    },
  );

  tool(
    'create_project',
    {
      title: 'Criar projeto',
      description:
        'Cria um projeto já com um primeiro quadro ("Tarefas"). Informe folder para vincular uma pasta local ("." = pasta atual): ao rodar nessa pasta, o Claude passa a usar este projeto automaticamente.',
    },
    {
      name: z.string().min(1),
      folder: z.string().optional().describe('Caminho da pasta local ou "." para a pasta atual'),
      template: templateSchema.default('software').describe('Modelo do primeiro quadro: software, default ou empty'),
      color: colorSchema.optional(),
      ...idFormatShape,
    },
    ({ name, folder, template, color, id_prefix, id_digits, id_start }, scope) => {
      const { project, boardId } = createProject(
        { name, color, folder: folderArg(folder, scope) ?? null, template, idPrefix: id_prefix, idPad: id_digits, idStart: id_start },
        actor(),
      );
      scopes.use(project.id);
      const board = boardId ? getBoard(boardId) : null;
      return {
        project: { id: project.id, name: project.name, folder: project.folder },
        board: board
          ? { id: board.id, name: board.name, columns: board.columns.map(presentColumn), groups: board.groups.map((g) => g.name) }
          : null,
      };
    },
  );

  tool(
    'update_project',
    {
      title: 'Editar projeto',
      description:
        'Renomeia, muda a cor ou vincula/desvincula a pasta local de um projeto (folder: "." = pasta atual; null = desvincular).',
    },
    {
      project: projectRef,
      name: z.string().min(1).optional(),
      color: colorSchema.optional(),
      folder: z.string().nullable().optional(),
    },
    ({ project, name, color, folder }, scope) => {
      const updated = updateProject(resolveProject(project).id, { name, color, folder: folderArg(folder, scope) }, actor());
      return { id: updated.id, name: updated.name, folder: updated.folder };
    },
  );

  // ── Leitura ────────────────────────────────────────────────
  tool(
    'list_boards',
    {
      title: 'Listar quadros',
      description: 'Lista os quadros do projeto atual (ou de um projeto / de todos) com grupos e número de itens.',
      readOnly: true,
    },
    { project: projectRef.optional(), all_projects: z.boolean().optional().describe('Listar de todos os projetos') },
    ({ project, all_projects }, scope) => {
      const ids = new Set(scopedBoardIds(scope, { project, all: all_projects }));
      return {
        ...(scope.project && project === undefined && !all_projects ? { project: scope.project.name } : {}),
        boards: listBoards()
          .filter((b) => ids.has(b.id))
          .map((b) => ({
            id: b.id,
            name: b.name,
            project: projectName(b.projectId),
            ...(b.description ? { description: b.description } : {}),
            items: b.itemCount,
            groups: listGroups(b.id).map((g) => g.name),
          })),
      };
    },
  );

  tool(
    'get_board',
    {
      title: 'Ver quadro',
      description:
        'Estrutura de um quadro (colunas com tipos e etiquetas, grupos) e, por padrão, os itens de cada grupo com seus valores. Sem board, usa o primeiro quadro do projeto atual.',
      readOnly: true,
    },
    {
      board: optionalBoard,
      include_items: z.boolean().default(true).describe('Incluir os itens (padrão: sim)'),
      group: groupRef.optional().describe('Mostrar só este grupo'),
      limit: z.number().int().min(1).max(1000).default(300).describe('Máximo de itens retornados'),
    },
    ({ board, include_items, group, limit }, scope) => {
      const ctx = loadContext(targetBoard(scope, board).id);
      const only = group !== undefined ? resolveGroup(ctx.board.id, group, ctx.board.groups) : null;
      const items = orderedItems(ctx);
      let remaining = limit;
      return {
        id: ctx.board.id,
        name: ctx.board.name,
        project: ctx.projectName,
        ...(ctx.board.description ? { description: ctx.board.description } : {}),
        ...(ctx.refColumn ? { next_ref: formatItemRef(ctx.refColumn.settings, ctx.board.nextItemNumber) } : {}),
        columns: ctx.board.columns.map(presentColumn),
        groups: ctx.board.groups
          .filter((g) => !only || g.id === only.id)
          .map((g) => {
            const groupItems = items.filter((i) => i.groupId === g.id);
            const out: Record<string, unknown> = { id: g.id, name: g.name, color: g.color, item_count: groupItems.length };
            if (include_items) {
              const slice = groupItems.slice(0, Math.max(remaining, 0));
              remaining -= slice.length;
              out.items = slice.map((i) => presentItem(i, ctx, { omitGroup: true }));
              if (slice.length < groupItems.length) out.truncated = true;
            }
            return out;
          }),
      };
    },
  );

  tool(
    'find_items',
    {
      title: 'Buscar itens',
      description:
        'Busca itens por texto e/ou filtros de coluna no projeto atual (ou num quadro, noutro projeto, ou em todos). Filtros aceitam listas (qualquer um), null (vazio), {"not": ...}, datas {"before"|"after"|"on"} e números {"gt"|"gte"|"lt"|"lte"}.',
      readOnly: true,
    },
    {
      query: z.string().optional().describe('Texto procurado no nome e em todos os valores'),
      board: boardRef.optional().describe('Limita a um quadro'),
      project: projectRef.optional().describe('Limita a um projeto'),
      all_projects: z.boolean().optional().describe('Buscar em todos os projetos'),
      group: groupRef.optional().describe('Limita a um grupo (requer board)'),
      where: z
        .record(z.string(), z.any())
        .optional()
        .describe(
          'Filtros por título de coluna, ex.: {"Status": ["Bloqueado", "Em andamento"], "Responsável": "Ana", "Prazo": {"before": "hoje"}, "Prioridade": {"not": "Baixa"}}',
        ),
      limit: z.number().int().min(1).max(500).default(50),
    },
    (args, scope) => {
      if (args.group !== undefined && args.board === undefined) throw new Error('Para filtrar por grupo, informe também o quadro (board).');
      const people = listPeople();
      const boardIds = scopedBoardIds(scope, { board: args.board, project: args.project, all: args.all_projects });
      const query = args.query ? fold(args.query) : null;
      const items: unknown[] = [];
      let total = 0;
      for (const boardId of boardIds) {
        const board = getBoard(boardId);
        const ctx = boardContext(board, people, projectName(board.projectId));
        const group = args.group !== undefined ? resolveGroup(boardId, args.group, board.groups) : null;
        let conditions: [ReturnType<typeof resolveColumn>, unknown][];
        try {
          conditions = Object.entries(args.where ?? {}).map(([key, cond]) => [resolveColumn(boardId, key, board.columns), cond]);
        } catch (error) {
          if (args.board !== undefined) throw error;
          continue; // quadro sem essa coluna: nenhum item casa
        }
        for (const item of orderedItems(ctx)) {
          if (group && item.groupId !== group.id) continue;
          if (!conditions.every(([col, cond]) => matchesCondition(col, item.values[String(col.id)], cond, ctx, item))) continue;
          if (query && !searchableText(item, ctx).includes(query)) continue;
          total++;
          if (items.length < args.limit) items.push(presentItem(item, ctx, { includeBoard: boardIds.length > 1 }));
        }
      }
      return { total, returned: items.length, items };
    },
  );

  tool(
    'get_my_work',
    {
      title: 'Meu trabalho',
      description:
        'Tudo o que está atribuído ao usuário (ou a outra pessoa) em todos os projetos, separado pelo prazo: Atrasado, Hoje, Esta semana, Próxima semana, Mais tarde e Sem data. Use para "o que eu tenho pra hoje?" ou "o que está atrasado?".',
      readOnly: true,
    },
    {
      person: refSchema('Pessoa (nome ou id); padrão: o usuário').optional(),
      project: projectRef.optional().describe('Limita a um projeto'),
      include_done: z.boolean().default(false).describe('Incluir os itens concluídos'),
      limit: z.number().int().min(1).max(500).default(100).describe('Máximo de itens retornados'),
    },
    ({ person, project, include_done, limit }) => {
      const people = listPeople();
      const target = person !== undefined ? resolvePerson(person, people) : people.find((p) => p.id === getMeId());
      if (!target) throw new Error('Não sei quem é o usuário — informe person.');
      const work = getMyWork(target.id);
      const projectId = project !== undefined ? resolveProject(project).id : null;
      const projects = new Map(listProjects().map((p) => [p.id, p.name]));
      const boards = new Map(work.boards.map((b) => [b.id, b]));
      const today = todayIso();
      type Entry = { date: string | null; position: number; item: Record<string, unknown> };
      const buckets = new Map<WorkBucket, Entry[]>(WORK_BUCKETS.map((b) => [b.key, []]));
      for (const item of work.items) {
        const board = boards.get(item.boardId);
        if (!board || (projectId != null && board.projectId !== projectId)) continue;
        const done = isItemDone(board.columns, item);
        if (done && !include_done) continue;
        const status = board.columns.find((c) => c.id === board.statusColumnId);
        const date = board.dateColumnId != null ? ((item.values[String(board.dateColumnId)] as string | undefined) ?? null) : null;
        const refColumn = board.columns.find((c) => c.type === 'auto_number');
        buckets.get(workBucket(date, today, done))!.push({
          date,
          position: item.position,
          item: {
            id: item.id,
            ...(refColumn ? { ref: formatItemRef(refColumn.settings, item.number) } : {}),
            name: item.name,
            project: projects.get(board.projectId) ?? null,
            board: board.name,
            group: board.groups.find((g) => g.id === item.groupId)?.name,
            ...(status ? { status: statusLabelOf(status, item.values[String(status.id)])?.name ?? null } : {}),
            ...(date ? { date } : {}),
          },
        });
      }
      let remaining = limit;
      const result = WORK_BUCKETS.filter((b) => buckets.get(b.key)!.length).map((b) => {
        const entries = buckets.get(b.key)!.sort((x, y) => (x.date ?? '').localeCompare(y.date ?? '') || x.position - y.position);
        const shown = entries.slice(0, Math.max(remaining, 0));
        remaining -= shown.length;
        return {
          bucket: b.title,
          count: entries.length,
          items: shown.map((e) => e.item),
          ...(shown.length < entries.length ? { truncated: true } : {}),
        };
      });
      return { person: target.name, today, total: result.reduce((n, b) => n + b.count, 0), buckets: result };
    },
  );

  tool(
    'get_item',
    {
      title: 'Ver item',
      description: 'Detalhes de um item: valores, subitens (checklist), atualizações (comentários), commits e histórico recente.',
      readOnly: true,
    },
    { item: itemRef },
    ({ item }, scope) => {
      const row = resolveItem(item, itemScope(scope));
      const details = getItemDetails(row.id);
      const ctx = loadContext(row.board_id);
      const name = (id: number | null) => ctx.people.find((p) => p.id === id)?.name ?? 'Desconhecido';
      return {
        ...presentItem(details.item, ctx, { includeBoard: true }),
        created_at: details.item.createdAt,
        updated_at: details.item.updatedAt,
        ...(details.item.subitems.length ? { subitems: presentSubitems(details.item.subitems, name) } : {}),
        updates: details.updates.map((u) => ({ id: u.id, author: name(u.authorId), created_at: u.createdAt, body: u.body })),
        commits: details.commits.map((c) => ({
          hash: c.shortHash,
          ...(c.repo ? { repo: c.repo } : {}),
          subject: c.subject,
          author: c.authorName,
          date: c.committedAt,
          ...(c.closed ? { closed_item: true } : {}),
        })),
        activity: details.activity.slice(0, 30).map((a) => describeActivity(a, ctx.people)),
      };
    },
  );

  tool(
    'sync_git',
    {
      title: 'Sincronizar commits',
      description:
        'Lê o histórico Git da pasta do projeto e liga os commits que citam itens (ex.: TUE-012); "fixes TUE-012" move o item para concluído. É automático — use depois de commitar para ver o resultado na hora.',
    },
    { project: projectRef.optional() },
    async ({ project }, scope) => {
      const target = project !== undefined ? resolveProject(project) : scope.project;
      if (!target) throw new Error('Nenhum projeto atual nesta pasta — informe o projeto.');
      return { project: target.name, ...(await syncProjectGit(target.id, { force: true })) };
    },
  );

  tool(
    'get_activity',
    {
      title: 'Registro de atividades',
      description: 'Últimas alterações (quem mudou o quê) de um item, de um quadro, do projeto atual ou de tudo.',
      readOnly: true,
    },
    {
      item: itemRef.optional(),
      board: boardRef.optional(),
      project: projectRef.optional(),
      all_projects: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).default(30),
    },
    ({ item, board, project, all_projects, limit }, scope) => {
      const people = listPeople();
      const entries =
        item !== undefined
          ? listActivity({ itemId: resolveItem(item, itemScope(scope)).id, limit })
          : listActivity({ boardIds: scopedBoardIds(scope, { board, project, all: all_projects }), limit });
      return entries.map((a) => describeActivity(a, people));
    },
  );

  tool(
    'list_people',
    { title: 'Listar pessoas', description: 'Pessoas que podem ser atribuídas em colunas de pessoas.', readOnly: true },
    {},
    () => {
      const me = getMeId();
      return listPeople().map((p) => ({
        id: p.id,
        name: p.name,
        ...(p.id === me ? { is_user: true } : {}),
        ...(p.isAgent ? { is_agent: true } : {}),
      }));
    },
  );

  // ── Itens ──────────────────────────────────────────────────
  tool(
    'create_items',
    {
      title: 'Criar itens',
      description:
        'Cria um ou mais itens (até 100), já com valores. Sem board, usa o primeiro quadro do projeto atual. Para um item só, envie uma lista com um elemento.',
    },
    {
      board: optionalBoard,
      group: groupRef.optional().describe('Grupo padrão dos itens (senão, o primeiro grupo)'),
      position: z.enum(['top', 'bottom']).default('bottom').describe('Onde inserir no grupo'),
      items: z
        .array(
          z.object({
            name: z.string().min(1),
            group: groupRef.optional().describe('Grupo deste item (sobrepõe o padrão)'),
            values: valuesSchema.optional(),
            number: itemNumberSchema
              .optional()
              .describe(
                'Número fixo do item na coluna de ID (7 → TM-07). Use ao importar para manter a referência antiga; senão é o próximo número.',
              ),
            subitems: z.array(z.string().min(1)).max(50).optional().describe('Passos do item (checklist), na ordem'),
          }),
        )
        .min(1)
        .max(100),
    },
    (args, scope) => {
      const board = targetBoard(scope, args.board);
      const columns = listColumns(board.id);
      const groups = listGroups(board.id);
      const people = listPeople();
      const fallback = args.group !== undefined ? resolveGroup(board.id, args.group, groups) : groups[0];
      const act = actor();
      const specs = args.position === 'top' ? [...args.items].reverse() : args.items;
      const createdIds = tx(() =>
        specs.map((spec) => {
          try {
            const group = spec.group !== undefined ? resolveGroup(board.id, spec.group, groups) : fallback;
            const values = spec.values ? parseFriendlyValues(board.id, columns, spec.values, people) : undefined;
            const created = createItem(
              board.id,
              { name: spec.name, groupId: group.id, values, position: args.position, number: spec.number },
              act,
            );
            if (spec.subitems?.length)
              addSubitems(
                created.id,
                spec.subitems.map((name) => ({ name })),
                {},
                act,
              );
            return created.id;
          } catch (error) {
            throw new Error(`Item "${spec.name}": ${(error as Error).message}`);
          }
        }),
      );
      if (args.position === 'top') createdIds.reverse();
      const ctx = loadContext(board.id);
      return {
        board: ctx.board.name,
        created: createdIds.length,
        items: createdIds.map((id) =>
          presentItem(
            ctx.board.items.find((i) => i.id === id)!,
            ctx,
          ),
        ),
      };
    },
  );

  tool(
    'update_items',
    {
      title: 'Atualizar itens',
      description:
        'Atualiza um ou mais itens (até 100): nome, valores de colunas, grupo (mover) e/ou número da referência. Só os campos enviados mudam.',
    },
    {
      items: z
        .array(
          z.object({
            item: itemRef,
            name: z.string().min(1).optional().describe('Novo nome'),
            values: valuesSchema.optional(),
            group: groupRef.optional().describe('Move o item para este grupo'),
            position: z.enum(['top', 'bottom']).optional().describe('Posição dentro do grupo'),
            number: itemNumberSchema.optional().describe('Novo número da referência (7 → TM-07); não pode repetir no quadro'),
          }),
        )
        .min(1)
        .max(100),
    },
    ({ items }, scope) => {
      const act = actor();
      const people = listPeople();
      const touched = new Map<number, number[]>();
      tx(() => {
        for (const spec of items) {
          try {
            const row = resolveItem(spec.item, itemScope(scope));
            if (spec.name !== undefined || spec.group !== undefined || spec.position !== undefined || spec.number !== undefined) {
              const groupId = spec.group !== undefined ? resolveGroup(row.board_id, spec.group).id : undefined;
              updateItem(row.id, { name: spec.name, groupId, position: spec.position, number: spec.number }, act);
            }
            if (spec.values && Object.keys(spec.values).length) {
              setItemValues(row.id, parseFriendlyValues(row.board_id, listColumns(row.board_id), spec.values, people), act);
            }
            touched.set(row.board_id, [...(touched.get(row.board_id) ?? []), row.id]);
          } catch (error) {
            throw new Error(`Item ${String(spec.item)}: ${(error as Error).message}`);
          }
        }
      });
      const result: unknown[] = [];
      for (const [boardId, itemIds] of touched) {
        const ctx = loadContext(boardId);
        for (const id of itemIds) {
          const item = ctx.board.items.find((i) => i.id === id);
          if (item) result.push(presentItem(item, ctx));
        }
      }
      return { updated: result.length, items: result };
    },
  );

  tool(
    'delete_items',
    {
      title: 'Excluir itens',
      description: 'Exclui itens. É reversível por 30 dias com restore_items (guarde os ids retornados).',
      destructive: true,
    },
    { items: z.array(itemRef).min(1).max(100) },
    ({ items }, scope) => {
      const ids = items.map((ref) => resolveItem(ref, itemScope(scope)).id);
      return { deleted_ids: deleteItems(ids, actor()), note: 'Reversível por 30 dias com restore_items.' };
    },
  );

  tool(
    'restore_items',
    { title: 'Restaurar itens', description: 'Restaura itens excluídos (pelos ids numéricos).' },
    { ids: z.array(z.number().int().positive()).min(1).max(100) },
    ({ ids }) => ({ restored_ids: restoreItems(ids, actor()) }),
  );

  tool(
    'add_update',
    {
      title: 'Postar atualização',
      description:
        'Posta uma atualização (comentário) num item, assinada pelo Claude. Aceita Markdown. Use para registrar progresso, decisões e resumos.',
    },
    { item: itemRef, body: z.string().min(1).describe('Texto em Markdown') },
    ({ item, body }, scope) => {
      const row = resolveItem(item, itemScope(scope));
      const update = createUpdate(row.id, body, actor());
      return { id: update.id, item_id: row.id, created_at: update.createdAt };
    },
  );

  // ── Subitens ───────────────────────────────────────────────
  /** Checklist de um item como o Claude recebe: progresso e passos com ids. */
  function checklist(itemId: number) {
    const row = resolveItem(itemId);
    const ctx = loadContext(row.board_id);
    const item = ctx.board.items.find((i) => i.id === itemId)!;
    const people = (id: number | null) => ctx.people.find((p) => p.id === id)?.name ?? 'Desconhecido';
    const progress = subitemProgress(item.subitems);
    return {
      item: formatRef(item, ctx) ?? item.id,
      name: item.name,
      progress: `${progress.done}/${progress.total} feitos`,
      ...(progress.complete ? { note: 'Todos os subitens estão feitos — se o item terminou, ajuste o status com update_items.' } : {}),
      subitems: presentSubitems(item.subitems, people),
    };
  }

  const subitemRef = z
    .union([z.number().int(), z.string().min(1)])
    .describe('Id do subitem (número, veja get_item), "#2" para a posição na lista, ou o texto dele');

  tool(
    'add_subitems',
    {
      title: 'Adicionar subitens',
      description:
        'Quebra um item em passos (subitens de checklist). Planeje o trabalho antes de começar e marque cada passo com update_subitems ao concluir — o usuário acompanha o progresso (ex.: 2/5) na tabela, no Kanban e no painel do item.',
    },
    {
      item: itemRef,
      subitems: z
        .array(z.string().min(1))
        .min(1)
        .max(50)
        .describe('Passos, na ordem, ex.: ["Criar a migração", "Endpoint da API", "Tela de edição", "Testes"]'),
      position: z.enum(['top', 'bottom']).default('bottom').describe('Antes ou depois dos subitens que já existem'),
    },
    ({ item, subitems, position }, scope) => {
      const row = resolveItem(item, itemScope(scope));
      addSubitems(
        row.id,
        subitems.map((name) => ({ name })),
        { position },
        actor(),
      );
      return checklist(row.id);
    },
  );

  tool(
    'update_subitems',
    {
      title: 'Atualizar subitens',
      description:
        'Marca subitens como feitos (done: true) ou reabre (done: false), renomeia (name) ou remove (remove: true). Marque cada passo assim que concluí-lo — o usuário vê em tempo real.',
    },
    {
      item: itemRef,
      changes: z
        .array(
          z.object({
            subitem: subitemRef,
            done: z.boolean().optional().describe('true = feito · false = reabrir'),
            name: z.string().min(1).optional().describe('Novo texto do passo'),
            remove: z.boolean().optional().describe('Remove o subitem'),
          }),
        )
        .min(1)
        .max(100),
    },
    ({ item, changes }, scope) => {
      const row = resolveItem(item, itemScope(scope));
      const current = listSubitems(row.id);
      // Resolve tudo antes de alterar: nomes e posições se referem à lista como estava.
      const targets = changes.map((change) => ({ change, subitem: resolveSubitem(current, change.subitem) }));
      const act = actor();
      tx(() => {
        for (const { change, subitem } of targets) {
          if (change.remove) deleteSubitem(subitem.id, act);
          else if (change.done !== undefined || change.name !== undefined)
            updateSubitem(subitem.id, { done: change.done, name: change.name }, act);
        }
      });
      return checklist(row.id);
    },
  );

  // ── TODO/FIXME do código ───────────────────────────────────
  function codeProject(scope: Scope, project?: Ref) {
    const target = project !== undefined ? resolveProject(project) : scope.project;
    if (!target) throw new Error('Nenhum projeto atual nesta pasta — informe o projeto.');
    return target;
  }

  const presentTodo = (t: CodeTodo) => ({
    id: t.id,
    tag: t.tag,
    file: `${t.path}:${t.line}`,
    text: t.text || null,
    ...(t.item
      ? {
          item: t.item.ref ?? t.item.id,
          ...(t.status === 'cited' ? { cited_in_text: true } : {}),
          ...(t.item.deleted ? { item_deleted: true } : {}),
        }
      : {}),
  });

  tool(
    'find_code_todos',
    {
      title: 'TODOs do código',
      description:
        'Procura TODO, FIXME, HACK e XXX nos comentários do código da pasta do projeto e diz quais já viraram itens e quais saíram do código. Use antes de import_code_todos.',
      readOnly: true,
    },
    {
      project: projectRef.optional(),
      include_imported: z.boolean().default(false).describe('Listar também as marcações que já são itens'),
      limit: z.number().int().min(1).max(500).default(100),
    },
    async ({ project, include_imported, limit }, scope) => {
      const target = codeProject(scope, project);
      const scan = await scanCodeTodos(target.id);
      const fresh = scan.todos.filter((t) => t.status === 'new');
      const known = scan.todos.filter((t) => t.status !== 'new');
      return {
        project: target.name,
        folder: scan.folder,
        files_scanned: scan.files,
        new_count: fresh.length,
        new: fresh.slice(0, limit).map(presentTodo),
        ...(include_imported ? { imported: known.slice(0, limit).map(presentTodo) } : { imported_count: known.length }),
        ...(scan.removed.length
          ? {
              removed_from_code: scan.removed.map((r) => ({
                item: r.item.ref ?? r.item.id,
                name: r.item.name,
                was: `${r.path}:${r.line}`,
              })),
            }
          : {}),
        ...(scan.truncated ? { truncated: true } : {}),
        ...(scan.errors.length ? { errors: scan.errors } : {}),
      };
    },
  );

  tool(
    'import_code_todos',
    {
      title: 'Importar TODOs do código',
      description:
        'Cria itens a partir das marcações TODO/FIXME/HACK/XXX do código (padrão: todas as novas). Cada item ganha a coluna "Código" com link que abre o arquivo na linha no VS Code, e uma atualização com o trecho do código. Não duplica o que já foi importado. complete_removed conclui os itens cuja marcação saiu do código.',
    },
    {
      project: projectRef.optional(),
      todos: z.array(z.string()).max(500).optional().describe('ids de find_code_todos (padrão: todas as novas)'),
      tags: z.array(z.enum(TODO_TAGS)).optional().describe('Só estas marcações, ex.: ["FIXME"]'),
      board: boardRef.optional().describe('Quadro dos itens (padrão: o primeiro do projeto)'),
      group: groupRef.optional().describe('Grupo dos itens (padrão: Backlog, se existir)'),
      complete_removed: z.boolean().default(false).describe('Concluir os itens cuja marcação saiu do código'),
    },
    async (args, scope) => {
      const target = codeProject(scope, args.project);
      const boardId = args.board !== undefined ? resolveBoard(args.board, { projectId: target.id }).id : boardsOf(target.id)[0]?.id;
      const groupId = args.group !== undefined && boardId != null ? resolveGroup(boardId, args.group).id : undefined;
      const result = await importCodeTodos(
        target.id,
        { ids: args.todos, tags: args.tags, boardId, groupId, completeAllRemoved: args.complete_removed },
        actor(),
      );
      const ctx = loadContext(result.boardId);
      const pending = result.scan.todos.filter((t) => t.status === 'new').length - result.created.length;
      return {
        board: ctx.board.name,
        group: result.groupName,
        created: result.created.length,
        items: result.created.map((i) => presentItem(ctx.board.items.find((b) => b.id === i.id) ?? i, ctx, { omitGroup: true })),
        ...(result.completed ? { completed_removed: result.completed } : {}),
        ...(pending > 0 ? { not_imported: pending } : {}),
        ...(!result.created.length && !result.completed ? { note: 'Nenhuma marcação nova para importar.' } : {}),
      };
    },
  );

  // ── Grupos ─────────────────────────────────────────────────
  tool(
    'create_group',
    { title: 'Criar grupo', description: 'Cria um grupo (seção) num quadro.' },
    {
      board: optionalBoard,
      name: z.string().min(1),
      color: colorSchema.optional(),
      position: z.enum(['top', 'bottom']).default('bottom'),
    },
    ({ board, name, color, position }, scope) => {
      const group = createGroup(targetBoard(scope, board).id, { name, color, position }, actor());
      return { id: group.id, name: group.name, color: group.color };
    },
  );

  tool(
    'update_group',
    { title: 'Editar grupo', description: 'Renomeia, muda a cor, recolhe/expande ou reposiciona um grupo.' },
    {
      board: optionalBoard,
      group: groupRef,
      name: z.string().min(1).optional(),
      color: colorSchema.optional(),
      collapsed: z.boolean().optional(),
      position: z.enum(['top', 'bottom']).optional(),
    },
    ({ board, group, ...patch }, scope) => {
      const target = resolveGroup(targetBoard(scope, board).id, group);
      const updated = updateGroup(target.id, patch, actor());
      return { id: updated.id, name: updated.name, color: updated.color, collapsed: updated.collapsed };
    },
  );

  // ── Quadros ────────────────────────────────────────────────
  tool(
    'create_board',
    {
      title: 'Criar quadro',
      description:
        'Cria um quadro no projeto atual (ou no projeto informado). Modelos: "software" (Sprint atual/Backlog/Concluído com Status, Prioridade, Tipo, Prazo e ID), "default" (A fazer/Concluído) e "empty".',
    },
    {
      name: z.string().min(1),
      description: z.string().optional(),
      template: templateSchema.default('software'),
      project: projectRef.optional(),
      ...idFormatShape,
    },
    ({ name, description, template, project, id_prefix, id_digits, id_start }, scope) => {
      const projectId = project !== undefined ? resolveProject(project).id : scope.project?.id;
      const board = createBoard(
        { name, description, template, projectId, idPrefix: id_prefix, idPad: id_digits, idStart: id_start },
        actor(),
      );
      return {
        id: board.id,
        name: board.name,
        project: projectName(board.projectId),
        columns: board.columns.map(presentColumn),
        groups: board.groups.map((g) => ({ id: g.id, name: g.name })),
      };
    },
  );

  tool(
    'update_board',
    { title: 'Editar quadro', description: 'Renomeia um quadro, altera a descrição ou move para outro projeto.' },
    {
      board: boardRef,
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      project: projectRef.optional().describe('Move o quadro para este projeto'),
    },
    ({ board, name, description, project }, scope) => {
      const projectId = project !== undefined ? resolveProject(project).id : undefined;
      const updated = updateBoard(resolveBoard(board, { projectId: scope.project?.id }).id, { name, description, projectId }, actor());
      return { id: updated.id, name: updated.name, description: updated.description, project: projectName(updated.projectId) };
    },
  );

  // ── Colunas ────────────────────────────────────────────────
  tool(
    'create_column',
    {
      title: 'Criar coluna',
      description: `Adiciona uma coluna a um quadro. Tipos: ${COLUMN_TYPES.join(', ')}.`,
    },
    {
      board: optionalBoard,
      title: z.string().min(1),
      type: z.enum(COLUMN_TYPES as [ColumnType, ...ColumnType[]]),
      labels: z
        .array(z.object({ name: z.string().min(1), color: colorSchema.optional() }))
        .optional()
        .describe('Etiquetas (só para status)'),
      prefix: z.string().optional().describe('Só para auto_number: prefixo das referências, ex.: "TUE" → TUE-001'),
      digits: digitsSchema.optional().describe('Só para auto_number: dígitos com zeros à esquerda (2 → TM-07)'),
      unit: z.string().optional().describe('Só para number: unidade, ex.: "R$", "h", "%"'),
      after: columnRef.optional().describe('Inserir depois desta coluna (senão, no fim)'),
    },
    (args, scope) => {
      const board = targetBoard(scope, args.board);
      const settings: ColumnSettings = {};
      if (args.labels) {
        if (args.type !== 'status') throw new Error('"labels" só vale para colunas de status.');
        settings.labels = args.labels.map((l, i) => ({
          id: i + 1,
          name: l.name,
          color: resolveColor(l.color) ?? LABEL_COLORS[i % LABEL_COLORS.length],
        }));
      }
      if (args.prefix !== undefined) settings.prefix = args.prefix;
      if (args.digits !== undefined) settings.pad = args.digits;
      if (args.unit !== undefined) {
        settings.unit = args.unit;
        settings.unitPosition = /^(R\$|\$|US\$|€|£)$/.test(args.unit.trim()) ? 'left' : 'right';
      }
      const afterColumnId = args.after !== undefined ? resolveColumn(board.id, args.after).id : undefined;
      return presentColumn(createColumn(board.id, { title: args.title, type: args.type, settings, afterColumnId }, actor()));
    },
  );

  tool(
    'update_column',
    {
      title: 'Editar coluna',
      description:
        'Renomeia uma coluna e/ou altera etiquetas de status: cria as que não existem, renomeia (rename_to), recolore ou remove (remove: true; só se nenhum item a usa). Na coluna de ID (auto_number): prefixo, dígitos e próximo número.',
    },
    {
      board: optionalBoard,
      column: columnRef,
      title: z.string().min(1).optional(),
      labels: z
        .array(
          z.object({
            name: z.string().min(1).describe('Nome atual da etiqueta (ou o nome da nova)'),
            color: colorSchema.optional(),
            rename_to: z.string().min(1).optional(),
            remove: z.boolean().optional(),
          }),
        )
        .optional(),
      prefix: z.string().optional().describe('Só para auto_number: prefixo das referências ("TM" → TM-001)'),
      digits: digitsSchema.optional().describe('Só para auto_number: dígitos com zeros à esquerda (2 → TM-07)'),
      next_number: itemNumberSchema
        .optional()
        .describe(
          'Só para auto_number: número do próximo item criado (maior que todos os já usados), ex.: 38 para continuar depois de TM-37',
        ),
      unit: z.string().optional().describe('Só para number'),
    },
    (args, scope) => {
      const board = targetBoard(scope, args.board);
      const column = resolveColumn(board.id, args.column);
      const settings: ColumnSettings = {};
      if ((args.prefix !== undefined || args.digits !== undefined || args.next_number !== undefined) && column.type !== 'auto_number')
        throw new Error(`prefix, digits e next_number só valem para a coluna de ID ("${column.title}" é ${column.type}).`);
      if (args.labels) {
        if (column.type !== 'status') throw new Error(`"labels" só vale para colunas de status ("${column.title}" é ${column.type}).`);
        const labels: StatusLabel[] = [...(column.settings.labels ?? [])];
        for (const change of args.labels) {
          const index = labels.findIndex((l) => fold(l.name) === fold(change.name));
          const color = change.color !== undefined ? resolveColor(change.color) : null;
          if (change.color !== undefined && !color) throw new Error(`Cor não reconhecida: "${change.color}".`);
          if (index < 0) {
            if (change.remove) throw new Error(`A etiqueta "${change.name}" não existe em "${column.title}".`);
            const used = new Set(labels.map((l) => l.color));
            labels.push({
              id: 0,
              name: change.rename_to ?? change.name,
              color: color ?? LABEL_COLORS.find((c) => !used.has(c)) ?? LABEL_COLORS[labels.length % LABEL_COLORS.length],
            });
          } else if (change.remove) {
            labels.splice(index, 1);
          } else {
            labels[index] = { ...labels[index], name: change.rename_to ?? labels[index].name, color: color ?? labels[index].color };
          }
        }
        settings.labels = labels;
      }
      if (args.prefix !== undefined) settings.prefix = args.prefix;
      if (args.digits !== undefined) settings.pad = args.digits;
      if (args.unit !== undefined) settings.unit = args.unit;
      const updated = tx(() => {
        if (args.next_number !== undefined) updateBoard(board.id, { nextItemNumber: args.next_number }, actor());
        return updateColumn(column.id, { title: args.title, settings: Object.keys(settings).length ? settings : undefined }, actor());
      });
      return {
        ...presentColumn(updated),
        ...(updated.type === 'auto_number' ? { next_ref: formatItemRef(updated.settings, requireBoard(board.id).next_item_number) } : {}),
      };
    },
  );

  tool(
    'add_person',
    { title: 'Adicionar pessoa', description: 'Cadastra uma pessoa para poder atribuí-la em colunas de pessoas.' },
    { name: z.string().min(1), color: colorSchema.optional() },
    ({ name, color }) => {
      const person = createPerson({ name, color }, actor());
      return { id: person.id, name: person.name };
    },
  );

  return server;
}
