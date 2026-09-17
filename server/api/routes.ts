import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AppInfo, Bootstrap, ColumnSettings, ColumnType } from '../../shared/types';
import { COLUMN_TYPES } from '../../shared/values';
import { badRequest, type Actor } from '../services/common';
import { createBoard, deleteBoard, getBoard, listBoards, updateBoard } from '../services/boards';
import { createGroup, deleteGroup, updateGroup } from '../services/groups';
import { createColumn, deleteColumn, updateColumn } from '../services/columns';
import {
  createItem,
  deleteItems,
  duplicateItems,
  getItemDetails,
  moveItems,
  restoreItems,
  setItemValues,
  updateItem,
} from '../services/items';
import { createUpdate, deleteUpdate, editUpdate } from '../services/updates';
import { addSubitems, deleteSubitem, updateSubitem } from '../services/subitems';
import { createPerson, deletePerson, getClaudeId, getMeId, listPeople, setMe, updatePerson } from '../services/people';
import { createProject, deleteProject, listProjects, updateProject } from '../services/projects';
import { configureClaudeCode, configureClaudeDesktop, configureClaudeHooks, setupStatus } from '../services/setup';
import { syncProjectGit } from '../services/git';
import { listActivity } from '../services/activity';
import { getMyWork } from '../services/mywork';
import { importCodeTodos, scanCodeTodos } from '../services/codetodos';
import { TODO_TAGS } from '../../shared/codetodos';

const actorOf = (req: Request): Actor => ({
  source: 'user',
  personId: getMeId(),
  clientId: req.get('x-client-id') ?? null,
});

function idOf(req: Request, key = 'id'): number {
  const id = Number(req.params[key]);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Id inválido.');
  return id;
}

function parse<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    throw badRequest(result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  return result.data;
}

const position = z.union([z.literal('top'), z.literal('bottom'), z.number()]);
const ids = z.array(z.number().int().positive()).min(1).max(1000);
const template = z.enum(['software', 'default', 'empty']);
const itemNumber = z.number().int().positive();
/** Formato das referências dos itens de um quadro novo: prefixo, dígitos e primeiro número. */
const idFormat = {
  idPrefix: z.string().max(20).nullable().optional(),
  idPad: z.number().int().min(1).max(8).nullable().optional(),
  idStart: itemNumber.nullable().optional(),
};

const columnSettings = z
  .object({
    labels: z.array(z.object({ id: z.number().int().optional(), name: z.string(), color: z.string() })),
    doneLabelId: z.number().int().nullable(),
    unit: z.string(),
    unitPosition: z.enum(['left', 'right']),
    decimals: z.number().int().nullable(),
    prefix: z.string(),
    pad: z.number().int(),
  })
  .partial();

const boardSettings = z.object({
  kanban: z
    .object({
      laneColumnId: z.number().int().nullable(),
      cardColumnIds: z.array(z.number().int()),
      collapsedLanes: z.array(z.string()),
    })
    .partial()
    .optional(),
  table: z
    .object({
      hiddenColumnIds: z.array(z.number().int()),
      nameWidth: z.number(),
      itemColumnTitle: z.string(),
    })
    .partial()
    .optional(),
});

export function createApiRouter(app: AppInfo): Router {
  const r = Router();

  r.get('/bootstrap', (_req, res) => {
    const payload: Bootstrap = {
      projects: listProjects(),
      boards: listBoards(),
      people: listPeople(),
      meId: getMeId(),
      claudeId: getClaudeId(),
      app,
    };
    res.json(payload);
  });

  // ── Meu trabalho ───────────────────────────────────────────
  r.get('/my-work', (req, res) => {
    const person = Number(req.query.person);
    res.json(getMyWork(Number.isInteger(person) && person > 0 ? person : getMeId()));
  });

  // ── Projetos ───────────────────────────────────────────────
  r.get('/projects', (_req, res) => {
    res.json(listProjects());
  });

  r.post('/projects', (req, res) => {
    const input = parse(
      z.object({
        name: z.string(),
        color: z.string().optional(),
        folder: z.string().nullable().optional(),
        template: template.nullable().optional(),
        ...idFormat,
      }),
      req,
    );
    const result = createProject(input, actorOf(req));
    if (result.project.folder) void syncProjectGit(result.project.id).catch(() => undefined);
    res.status(201).json(result);
  });

  r.patch('/projects/:id', (req, res) => {
    const patch = parse(
      z.object({
        name: z.string().optional(),
        color: z.string().optional(),
        folder: z.string().nullable().optional(),
        position: z.number().optional(),
      }),
      req,
    );
    const project = updateProject(idOf(req), patch, actorOf(req));
    if (patch.folder !== undefined && project.folder) void syncProjectGit(project.id).catch(() => undefined);
    res.json(project);
  });

  r.delete('/projects/:id', (req, res) => {
    deleteProject(idOf(req), actorOf(req));
    res.status(204).end();
  });

  r.post('/projects/:id/git/sync', async (req, res) => {
    res.json(await syncProjectGit(idOf(req), { force: true }));
  });

  // TODO/FIXME do código
  r.get('/projects/:id/code-todos', async (req, res) => {
    res.json(await scanCodeTodos(idOf(req)));
  });

  r.post('/projects/:id/code-todos/import', async (req, res) => {
    const input = parse(
      z.object({
        ids: z.array(z.string()).max(2000).optional(),
        tags: z.array(z.enum(TODO_TAGS)).optional(),
        boardId: z.number().int().positive().optional(),
        groupId: z.number().int().positive().optional(),
        completeItemIds: z.array(z.number().int().positive()).max(2000).optional(),
      }),
      req,
    );
    const { scan: _scan, ...result } = await importCodeTodos(idOf(req), input, actorOf(req));
    res.json(result);
  });

  // ── Configuração do MCP ────────────────────────────────────
  // Configura o Claude da máquina onde o tuesday roda: publicado na rede, cada pessoa conecta o próprio Claude por HTTP.
  r.use('/setup', (req, _res, next) => {
    if (app.mode === 'server' && req.method !== 'GET')
      throw badRequest('No tuesday publicado na rede, conecte o Claude pelo MCP via HTTP.');
    next();
  });

  r.get('/setup', async (_req, res) => {
    res.json(await setupStatus());
  });

  r.post('/setup/claude-code', async (req, res) => {
    const { dryRun } = parse(z.object({ dryRun: z.boolean().optional() }), req);
    res.json(await configureClaudeCode({ dryRun }));
  });

  r.post('/setup/claude-hooks', (req, res) => {
    const { dryRun, remove } = parse(z.object({ dryRun: z.boolean().optional(), remove: z.boolean().optional() }), req);
    res.json(configureClaudeHooks({ dryRun, remove }));
  });

  r.post('/setup/claude-desktop', (req, res) => {
    const { dryRun } = parse(z.object({ dryRun: z.boolean().optional() }), req);
    res.json(configureClaudeDesktop({ dryRun }));
  });

  // ── Quadros ────────────────────────────────────────────────
  r.get('/boards', (_req, res) => {
    res.json(listBoards());
  });

  r.post('/boards', (req, res) => {
    const input = parse(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        template: template.optional(),
        projectId: z.number().int().positive().optional(),
        ...idFormat,
      }),
      req,
    );
    res.status(201).json(createBoard(input, actorOf(req)));
  });

  r.get('/boards/:id', (req, res) => {
    res.json(getBoard(idOf(req)));
  });

  r.patch('/boards/:id', (req, res) => {
    const patch = parse(
      z.object({
        name: z.string().optional(),
        description: z.string().optional(),
        position: z.number().optional(),
        projectId: z.number().int().positive().optional(),
        settings: boardSettings.optional(),
        nextItemNumber: itemNumber.optional(),
      }),
      req,
    );
    res.json(updateBoard(idOf(req), patch, actorOf(req)));
  });

  r.delete('/boards/:id', (req, res) => {
    deleteBoard(idOf(req), actorOf(req));
    res.status(204).end();
  });

  r.get('/boards/:id/activity', (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const before = Number(req.query.before) || undefined;
    res.json(listActivity({ boardId: idOf(req), limit, beforeId: before }));
  });

  // ── Grupos ─────────────────────────────────────────────────
  r.post('/boards/:id/groups', (req, res) => {
    const input = parse(z.object({ name: z.string().optional(), color: z.string().optional(), position: position.optional() }), req);
    res.status(201).json(createGroup(idOf(req), input, actorOf(req)));
  });

  r.patch('/groups/:id', (req, res) => {
    const patch = parse(
      z.object({
        name: z.string().optional(),
        color: z.string().optional(),
        collapsed: z.boolean().optional(),
        position: position.optional(),
      }),
      req,
    );
    res.json(updateGroup(idOf(req), patch, actorOf(req)));
  });

  r.delete('/groups/:id', (req, res) => {
    deleteGroup(idOf(req), actorOf(req));
    res.status(204).end();
  });

  // ── Colunas ────────────────────────────────────────────────
  r.post('/boards/:id/columns', (req, res) => {
    const input = parse(
      z.object({
        title: z.string().optional(),
        type: z.enum(COLUMN_TYPES as [string, ...string[]]),
        settings: columnSettings.optional(),
        width: z.number().optional(),
        afterColumnId: z.number().int().nullable().optional(),
        position: z.enum(['start', 'end']).optional(),
      }),
      req,
    );
    res
      .status(201)
      .json(
        createColumn(
          idOf(req),
          { ...input, type: input.type as ColumnType, settings: input.settings as ColumnSettings | undefined },
          actorOf(req),
        ),
      );
  });

  r.patch('/columns/:id', (req, res) => {
    const patch = parse(
      z.object({
        title: z.string().optional(),
        width: z.number().optional(),
        position: z.number().optional(),
        settings: columnSettings.optional(),
      }),
      req,
    );
    res.json(updateColumn(idOf(req), { ...patch, settings: patch.settings as ColumnSettings | undefined }, actorOf(req)));
  });

  r.delete('/columns/:id', (req, res) => {
    deleteColumn(idOf(req), actorOf(req));
    res.status(204).end();
  });

  // ── Itens ──────────────────────────────────────────────────
  r.post('/boards/:id/items', (req, res) => {
    const input = parse(
      z.object({
        name: z.string(),
        groupId: z.number().int().nullable().optional(),
        values: z.record(z.string(), z.unknown()).optional(),
        position: position.optional(),
        kanbanPosition: position.optional(),
        number: itemNumber.nullable().optional(),
      }),
      req,
    );
    res.status(201).json(createItem(idOf(req), input, actorOf(req)));
  });

  r.get('/items/:id', (req, res) => {
    res.json(getItemDetails(idOf(req)));
  });

  r.patch('/items/:id', (req, res) => {
    const patch = parse(
      z.object({
        name: z.string().optional(),
        groupId: z.number().int().optional(),
        position: position.optional(),
        kanbanPosition: z.number().optional(),
        number: itemNumber.optional(),
      }),
      req,
    );
    res.json(updateItem(idOf(req), patch, actorOf(req)));
  });

  r.put('/items/:id/values', (req, res) => {
    const { values } = parse(z.object({ values: z.record(z.string(), z.unknown()) }), req);
    res.json(setItemValues(idOf(req), values, actorOf(req)));
  });

  r.post('/items/delete', (req, res) => {
    const input = parse(z.object({ ids }), req);
    res.json({ ids: deleteItems(input.ids, actorOf(req)) });
  });

  r.post('/items/restore', (req, res) => {
    const input = parse(z.object({ ids }), req);
    res.json({ ids: restoreItems(input.ids, actorOf(req)) });
  });

  r.post('/items/duplicate', (req, res) => {
    const input = parse(z.object({ ids }), req);
    res.status(201).json(duplicateItems(input.ids, actorOf(req)));
  });

  r.post('/items/move', (req, res) => {
    const input = parse(z.object({ ids, groupId: z.number().int().positive() }), req);
    res.json(moveItems(input.ids, input.groupId, actorOf(req)));
  });

  // ── Subitens ───────────────────────────────────────────────
  r.post('/items/:id/subitems', (req, res) => {
    const input = parse(
      z.object({
        subitems: z
          .array(z.object({ name: z.string(), done: z.boolean().optional() }))
          .min(1)
          .max(100),
        position: position.optional(),
      }),
      req,
    );
    res.status(201).json(addSubitems(idOf(req), input.subitems, { position: input.position }, actorOf(req)));
  });

  r.patch('/subitems/:id', (req, res) => {
    const patch = parse(z.object({ name: z.string().optional(), done: z.boolean().optional(), position: z.number().optional() }), req);
    res.json(updateSubitem(idOf(req), patch, actorOf(req)));
  });

  r.delete('/subitems/:id', (req, res) => {
    res.json(deleteSubitem(idOf(req), actorOf(req)));
  });

  // ── Atualizações ───────────────────────────────────────────
  r.post('/items/:id/updates', (req, res) => {
    const { body } = parse(z.object({ body: z.string() }), req);
    res.status(201).json(createUpdate(idOf(req), body, actorOf(req)));
  });

  r.patch('/updates/:id', (req, res) => {
    const { body } = parse(z.object({ body: z.string() }), req);
    res.json(editUpdate(idOf(req), body, actorOf(req)));
  });

  r.delete('/updates/:id', (req, res) => {
    deleteUpdate(idOf(req), actorOf(req));
    res.status(204).end();
  });

  // ── Pessoas ────────────────────────────────────────────────
  r.get('/people', (_req, res) => {
    res.json(listPeople());
  });

  r.post('/people', (req, res) => {
    const input = parse(z.object({ name: z.string(), color: z.string().optional(), email: z.string().nullable().optional() }), req);
    res.status(201).json(createPerson(input, actorOf(req)));
  });

  r.patch('/people/:id', (req, res) => {
    const patch = parse(
      z.object({ name: z.string().optional(), color: z.string().optional(), email: z.string().nullable().optional() }),
      req,
    );
    res.json(updatePerson(idOf(req), patch, actorOf(req)));
  });

  r.delete('/people/:id', (req, res) => {
    deletePerson(idOf(req), actorOf(req));
    res.status(204).end();
  });

  r.put('/me', (req, res) => {
    const { personId } = parse(z.object({ personId: z.number().int().positive() }), req);
    setMe(personId, actorOf(req));
    res.status(204).end();
  });

  return r;
}
