import type { Driver } from './driver';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardSettings, StatusLabel } from '../../shared/types';
import { DEV_PRIORITY, DEV_STATUS, DEV_TYPE } from '../../shared/templates';
import { todayIso } from '../../shared/values';

interface CoreIds {
  me: number;
  claude: number;
}

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * O exemplo fica vinculado à pasta do tuesday só num clone do repositório — não no servidor nem no app instalado.
 * TUESDAY_SEED_FOLDER escolhe a pasta (os testes usam).
 */
const demoFolder = () => process.env.TUESDAY_SEED_FOLDER || (fs.existsSync(path.join(ROOT_DIR, '.git')) ? ROOT_DIR : null);

function getMeta(db: Driver, key: string): string | undefined {
  return (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}

function setMeta(db: Driver, key: string, value: string) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** Garante a pessoa "você" (usuário local) e o "Claude" (autor das ações via MCP). */
export function ensureCorePeople(db: Driver): CoreIds {
  const insert = db.prepare('INSERT INTO people (name, color, is_agent) VALUES (?, ?, ?) RETURNING id');
  const insertedId = (...params: unknown[]) => String((insert.get(...params) as { id: number }).id);
  const exists = (id: string | undefined) => id != null && db.prepare('SELECT 1 FROM people WHERE id = ?').get(Number(id)) != null;

  let me = getMeta(db, 'me_id');
  if (!exists(me)) {
    me = insertedId('Você', '#579bfc', 0);
    setMeta(db, 'me_id', me);
  }
  let claude = getMeta(db, 'claude_id');
  if (!exists(claude)) {
    claude = insertedId('Claude', '#d97757', 1);
    setMeta(db, 'claude_id', claude);
  }
  return { me: Number(me), claude: Number(claude) };
}

const labels = (...list: [string, string][]): StatusLabel[] => list.map(([name, color], i) => ({ id: i + 1, name, color }));

/** Projeto de exemplo (vinculado à pasta do próprio tuesday) criado no primeiro uso. */
export function seedDemo(db: Driver, ids: CoreIds): void {
  const idOf = (row: unknown) => (row as { id: number }).id;
  const projectId = idOf(
    db
      .prepare('INSERT INTO projects (name, color, folder, position) VALUES (?, ?, ?, ?) RETURNING id')
      .get('tuesday', '#0073ea', demoFolder(), 1000),
  );

  const boardId = idOf(
    db
      .prepare('INSERT INTO boards (name, description, position, project_id) VALUES (?, ?, ?, ?) RETURNING id')
      .get('Tarefas', 'Quadro de exemplo — edite à vontade ou peça ao Claude para organizar.', 1000, projectId),
  );

  const insertColumn = db.prepare(
    'INSERT INTO board_columns (board_id, title, type, settings, width, position) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
  );
  let columnPos = 0;
  const column = (title: string, type: string, settings: object, width: number) =>
    idOf(insertColumn.get(boardId, title, type, JSON.stringify(settings), width, (columnPos += 1000)));

  const cOwner = column('Responsável', 'people', {}, 136);
  const cStatus = column('Status', 'status', { labels: DEV_STATUS, doneLabelId: 5 }, 150);
  const cPriority = column('Prioridade', 'status', { labels: DEV_PRIORITY }, 120);
  const cType = column('Tipo', 'status', { labels: DEV_TYPE }, 140);
  const cEpic = column(
    'Épico',
    'status',
    {
      labels: labels(['Design system & UI', '#ff007f'], ['Plataforma', '#333333'], ['Integrações', '#175a63'], ['Documentação', '#037f4c']),
    },
    170,
  );
  const cDue = column('Prazo', 'date', {}, 120);
  column('ID', 'auto_number', { prefix: 'TUE', pad: 3 }, 100);

  const insertGroup = db.prepare('INSERT INTO board_groups (board_id, name, color, position) VALUES (?, ?, ?, ?) RETURNING id');
  const gSprint = idOf(insertGroup.get(boardId, 'Sprint atual', '#579bfc', 1000));
  const gBacklog = idOf(insertGroup.get(boardId, 'Backlog', '#9d50dd', 2000));
  const gDone = idOf(insertGroup.get(boardId, 'Concluído', '#00c875', 3000));

  type Row = [
    group: number,
    name: string,
    status: number,
    priority: number,
    type: number,
    epic: number,
    due: number | null,
    owners: number[],
  ];
  const rows: Row[] = [
    [gSprint, 'Conectar o Claude ao tuesday via MCP', 2, 2, 1, 3, 2, [ids.claude]],
    [gSprint, 'Revisar as cores das etiquetas de status', 1, 3, 2, 1, 5, [ids.me]],
    [gSprint, 'Configurar backup automático do banco SQLite', 4, 2, 4, 2, -1, [ids.me]],
    [gSprint, 'Escrever o guia de atalhos de teclado', 3, 4, 6, 4, 7, []],
    [gBacklog, 'Importar quadros exportados do monday (Excel)', 1, 3, 1, 3, null, []],
    [gBacklog, 'Modo escuro', 1, 4, 2, 1, null, []],
    [gBacklog, 'Testes de ponta a ponta no CI', 1, 3, 5, 2, null, []],
    [gBacklog, 'Corrigir foco perdido ao renomear grupo', 1, 1, 3, 1, 1, [ids.me]],
    [gDone, 'Tabela principal com grupos e resumo', 5, 2, 1, 1, -3, [ids.me]],
    [gDone, 'Kanban com arrastar e soltar', 5, 2, 1, 1, -2, [ids.me, ids.claude]],
  ];

  const insertItem = db.prepare(
    'INSERT INTO items (board_id, group_id, number, name, position, kanban_position) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
  );
  const insertValue = db.prepare('INSERT INTO item_values (item_id, column_id, value) VALUES (?, ?, ?)');
  const positions = new Map<number, number>();
  const itemIds: number[] = [];

  rows.forEach(([group, name, status, priority, type, epic, due, owners], index) => {
    const pos = (positions.get(group) ?? 0) + 1000;
    positions.set(group, pos);
    const itemId = idOf(insertItem.get(boardId, group, index + 1, name, pos, (index + 1) * 1000));
    itemIds.push(itemId);
    insertValue.run(itemId, cStatus, JSON.stringify(status));
    insertValue.run(itemId, cPriority, JSON.stringify(priority));
    insertValue.run(itemId, cType, JSON.stringify(type));
    insertValue.run(itemId, cEpic, JSON.stringify(epic));
    if (due != null) insertValue.run(itemId, cDue, JSON.stringify(todayIso(due)));
    if (owners.length) insertValue.run(itemId, cOwner, JSON.stringify(owners));
  });

  db.prepare('UPDATE boards SET next_item_number = ?, settings = ? WHERE id = ?').run(
    rows.length + 1,
    JSON.stringify({
      kanban: { laneColumnId: cStatus, cardColumnIds: [cOwner, cPriority, cType, cDue] },
      table: {},
    } satisfies BoardSettings),
    boardId,
  );

  const insertUpdate = db.prepare('INSERT INTO updates (item_id, author_id, body) VALUES (?, ?, ?)');
  insertUpdate.run(
    itemIds[0],
    ids.claude,
    [
      'Olá! 👋 Sou o **Claude**. Pelo servidor MCP do tuesday eu consigo:',
      '',
      '- criar, editar e mover itens entre grupos',
      '- trocar status, responsáveis e prazos',
      '- postar atualizações como esta',
      '',
      'Experimente pedir: _"Claude, quais tarefas estão bloqueadas?"_',
    ].join('\n'),
  );
  insertUpdate.run(itemIds[2], ids.me, 'Falta decidir onde os backups vão ficar — talvez numa pasta sincronizada.');

  const insertSubitem = db.prepare('INSERT INTO subitems (item_id, name, done, position, done_at, done_by) VALUES (?, ?, ?, ?, ?, ?)');
  const steps: [string, boolean][] = [
    ['Rodar "npm run setup" (ou o botão Claude no app)', true],
    ['Abrir o Claude Code na pasta do projeto', true],
    ['Pedir: "quais tarefas estão bloqueadas?"', false],
    ['Pedir para quebrar uma tarefa em subitens', false],
  ];
  steps.forEach(([name, done], index) =>
    insertSubitem.run(itemIds[0], name, done ? 1 : 0, (index + 1) * 1000, done ? new Date().toISOString() : null, done ? ids.claude : null),
  );

  db.prepare('INSERT INTO activity (board_id, item_id, item_name, actor_id, source, action, data) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    boardId,
    itemIds[0],
    rows[0][1],
    ids.claude,
    'claude',
    'value_changed',
    JSON.stringify({
      columnId: cStatus,
      columnTitle: 'Status',
      columnType: 'status',
      from: { text: 'Pronto pra começar', color: '#579bfc' },
      to: { text: 'Em andamento', color: '#fdab3d' },
    }),
  );
}
