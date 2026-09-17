// Teste de fumaça do servidor MCP (stdio): sobe o servidor num banco temporário e chama cada ferramenta.
//   npm run test:mcp            (--verbose mostra todas as respostas)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuesday-mcp-'));
const appDir = path.join(dir, 'meu-app');
fs.mkdirSync(appDir);
const verbose = process.argv.includes('--verbose');
// O projeto de exemplo fica vinculado à pasta do tuesday (mesmo sem .git, como num download em zip).
const env = { ...process.env, TUESDAY_DB: path.join(dir, 'smoke.db'), TUESDAY_SEED_FOLDER: root };

async function connect(cwd) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, 'bin', 'tuesday-mcp.mjs')],
    env,
    cwd,
    stderr: 'inherit',
  });
  const client = new Client({ name: 'tuesday-smoke', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

let failures = 0;

function check(label, condition, detail) {
  console.log(`${condition ? '✔' : '✘'} ${label}`);
  if (!condition) {
    failures++;
    if (detail !== undefined) console.log(`  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
}

async function call(client, name, args = {}, { expectError = false, show = false } = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? '';
  const ok = expectError ? res.isError === true : !res.isError;
  console.log(`${ok ? '✔' : '✘'} ${name}${expectError ? ' (erro esperado)' : ''}`);
  if (!ok) failures++;
  if (!ok || show || verbose || expectError) console.log(`  ${text.split('\n').join('\n  ')}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── Cliente na pasta do tuesday: o projeto de exemplo está vinculado a ela ──
const a = await connect(root);
const { tools } = await a.listTools();
console.log(`${tools.length} ferramentas: ${tools.map((t) => t.name).join(', ')}\n`);

const projects = await call(a, 'list_projects');
check('projeto atual detectado pela pasta', projects.current?.name === 'tuesday', projects.current);
const board = await call(a, 'get_board', { include_items: false });
check('get_board sem "board" usa o quadro do projeto', board.name === 'Tarefas', board.name);
const boardId = board.id;

await call(a, 'find_items', { where: { Status: 'Bloqueado' } }, { show: true });
await call(a, 'find_items', { board: boardId, where: { Status: { not: 'Feito' }, Prazo: { before: '+30d' } } });
const created = await call(a, 'create_items', {
  group: 'Backlog',
  items: [
    { name: 'Item criado pelo teste', values: { Status: 'Em andamento', Prioridade: 'alta', Responsável: 'Claude', Prazo: 'amanhã' } },
    { name: 'Segundo item', values: { Tipo: 'bug' } },
  ],
});
const ref = created.items[0].ref;
await call(a, 'update_items', {
  items: [
    { item: ref, values: { Status: 'Feito' }, group: 'Concluído' },
    { item: created.items[1].id, name: 'Segundo item (renomeado)' },
  ],
});
await call(a, 'add_update', { item: ref, body: '**Teste** automatizado ✅' });
await call(a, 'get_item', { item: ref });
await call(a, 'create_group', { name: 'Ideias', color: 'laranja' });
await call(a, 'update_group', { group: 'Ideias', name: 'Ideias futuras', collapsed: true });
await call(a, 'create_column', { title: 'Estimativa', type: 'number', unit: 'h' });
await call(a, 'create_column', { title: 'Fase', type: 'status', labels: [{ name: 'Descoberta', color: 'roxo' }, { name: 'Entrega' }] });
await call(a, 'update_column', {
  column: 'Fase',
  labels: [{ name: 'Entrega', rename_to: 'Entregue', color: 'verde' }, { name: 'Validação' }],
});
await call(a, 'update_items', { items: [{ item: ref, values: { Estimativa: '3,5', Fase: 'Validação' } }] });
await call(a, 'update_items', { items: [{ item: ref, values: { Status: 'Inexistente' } }] }, { expectError: true });
await call(a, 'update_column', { column: 'Fase', labels: [{ name: 'Validação', remove: true }] }, { expectError: true });
const removed = await call(a, 'delete_items', { items: [created.items[1].id] });
await call(a, 'restore_items', { ids: removed.deleted_ids });
await call(a, 'add_person', { name: 'Ana Souza', color: 'rosa' });
await call(a, 'update_items', { items: [{ item: ref, values: { Responsável: ['Ana', 'Claude'] } }] });
await call(a, 'list_people');
await call(a, 'get_activity', { limit: 5 });
await call(a, 'create_board', { name: 'Quadro do teste', template: 'default' });
await call(a, 'update_board', { board: 'Quadro do teste', description: 'Criado pelo teste' });

// ── Projetos ──
const project = await call(a, 'create_project', { name: 'Meu App', folder: appDir });
check('create_project vincula a pasta', project.project?.folder === appDir, project.project);
const inProject = await call(a, 'create_items', { items: [{ name: 'Tarefa do Meu App', values: { Status: 'Em andamento' } }] });
check('após create_project, itens vão para o novo projeto', inProject.items?.[0]?.ref === 'MEU-001', inProject.items?.[0]);
await call(a, 'create_project', { name: 'Duplicado', folder: '.' }, { expectError: true });
await call(a, 'use_project', { project: 'tuesday' });
const everywhere = await call(a, 'find_items', { all_projects: true, where: { Status: 'Em andamento' } });
check(
  'find_items com all_projects enxerga os dois projetos',
  everywhere.items?.some((i) => i.project === 'Meu App'),
  everywhere,
);
const scoped = await call(a, 'list_boards');
check('list_boards fica no projeto atual', scoped.project === 'tuesday' && scoped.boards.every((b) => b.project === 'tuesday'), scoped);

// ── Cliente dentro da pasta do "Meu App": detecção automática ──
const b = await connect(appDir);
const detected = await call(b, 'list_projects');
check(
  'outro cliente, outra pasta → outro projeto',
  detected.current?.name === 'Meu App' && detected.current?.detected_by === 'pasta',
  detected.current,
);
await call(b, 'create_items', { items: [{ name: 'Criada de dentro da pasta' }] });
const appBoard = await call(b, 'get_board', {});
check(
  'quadro do Meu App tem os dois itens',
  appBoard.groups?.flatMap((g) => g.items ?? []).length === 2,
  appBoard.groups?.map((g) => g.items?.map((i) => i.name)),
);
await b.close();

const unlinked = await call(a, 'update_project', { project: 'Meu App', folder: null });
check('update_project desvincula a pasta', unlinked.folder === null, unlinked);

// ── Git: commits que citam itens ──
const repoDir = path.join(dir, 'repo');
fs.mkdirSync(repoDir);
const git = (...args) =>
  execFileSync('git', ['-c', 'user.name=Teste', '-c', 'user.email=teste@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repoDir,
    stdio: 'pipe',
  });
git('init', '-q', '-b', 'main');
git('remote', 'add', 'origin', 'git@github.com:exemplo/repo.git');
await call(a, 'create_project', { name: 'Repo', folder: repoDir });
const repoItems = await call(a, 'create_items', {
  items: [
    { name: 'Tela de login', values: { Status: 'Em andamento' } },
    { name: 'Bug no cadastro', values: { Status: 'Em andamento' } },
  ],
});
check('itens do projeto Repo usam o prefixo REP', repoItems.items?.[0]?.ref === 'REP-001', repoItems.items?.[0]);
git('commit', '-q', '--allow-empty', '-m', 'feat: início da tela de login (rep-1)');
git('commit', '-q', '--allow-empty', '-m', 'fixes REP-002: valida CPF no cadastro', '-m', 'Detalhes no corpo do commit.');
git('commit', '-q', '--allow-empty', '-m', 'chore: sem referência nenhuma');
const synced = await call(a, 'sync_git', {});
check('sync_git liga 2 commits e conclui 1 item', synced.linked === 2 && synced.closed === 1, synced);
const closedItem = await call(a, 'get_item', { item: 'REP-002' });
check('"fixes REP-002" moveu o item para Feito', closedItem.values?.Status === 'Feito' && closedItem.commits?.[0]?.closed_item === true, {
  status: closedItem.values?.Status,
  commits: closedItem.commits,
});
const mentioned = await call(a, 'get_item', { item: 'REP-001' });
check(
  'REP-001 ganhou o commit e continua Em andamento',
  mentioned.commits?.length === 1 && mentioned.values?.Status === 'Em andamento',
  mentioned,
);
const again = await call(a, 'sync_git', {});
check('sincronizar de novo não duplica nada', again.linked === 0 && again.closed === 0, again);
await call(a, 'update_items', { items: [{ item: 'REP-002', values: { Status: 'Em andamento' } }] });
await call(a, 'sync_git', {});
const reopened = await call(a, 'get_item', { item: 'REP-002' });
check('item reaberto não é concluído de novo pelo mesmo commit', reopened.values?.Status === 'Em andamento', reopened.values);
const gitActivity = await call(a, 'get_activity', { item: 'REP-002', limit: 6 });
check(
  'registro de atividades mostra o Git',
  gitActivity.some?.((line) => line.includes('· Git ·')),
  gitActivity,
);

// ── Git: vários repositórios na mesma pasta do projeto ──
const monoDir = path.join(dir, 'mono');
const gitIn =
  (cwd) =>
  (...args) =>
    execFileSync('git', ['-c', 'user.name=Teste', '-c', 'user.email=teste@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd,
      stdio: 'pipe',
    });
for (const name of ['api', 'web']) fs.mkdirSync(path.join(monoDir, name), { recursive: true });
const apiGit = gitIn(path.join(monoDir, 'api'));
const webGit = gitIn(path.join(monoDir, 'web'));
apiGit('init', '-q', '-b', 'main');
apiGit('remote', 'add', 'origin', 'git@github.com:exemplo/api.git');
webGit('init', '-q', '-b', 'main');
await call(a, 'create_project', { name: 'Mono', folder: monoDir, id_prefix: 'MON' });
await call(a, 'create_items', {
  items: [
    { name: 'Endpoint de login', values: { Status: 'Em andamento' } },
    { name: 'Tela de login', values: { Status: 'Em andamento' } },
  ],
});
apiGit('commit', '-q', '--allow-empty', '-m', 'feat: endpoint de login (MON-001)');
webGit('commit', '-q', '--allow-empty', '-m', 'fixes MON-002: tela de login');
const mono = await call(a, 'sync_git', {});
check(
  'sync_git lê os dois repositórios da pasta do projeto',
  mono.linked === 2 && mono.closed === 1 && /2 repositórios/.test(mono.message),
  mono,
);
const apiItem = await call(a, 'get_item', { item: 'MON-001' });
check('o commit indica de qual repositório veio', apiItem.commits?.[0]?.repo === 'api', apiItem.commits);
const webItem = await call(a, 'get_item', { item: 'MON-002' });
check('"fixes" num repositório irmão conclui o item', webItem.values?.Status === 'Feito' && webItem.commits?.[0]?.repo === 'web', {
  status: webItem.values?.Status,
  commits: webItem.commits,
});

// ── Referências: prefixo, dígitos, próximo número e número de cada item ──
const migrated = await call(a, 'create_project', { name: 'Migrado', id_prefix: 'TM', id_digits: 2, id_start: 38 });
check(
  'create_project aceita prefixo e dígitos',
  migrated.board?.columns?.some((c) => c.type === 'auto_number' && c.prefix === 'TM' && c.digits === 2),
  migrated.board?.columns,
);
const imported = await call(a, 'create_items', { items: [{ name: 'Importado do monday', number: 7 }, { name: 'Primeiro item novo' }] });
check('number em create_items mantém a referência antiga', imported.items?.[0]?.ref === 'TM-07', imported.items?.[0]);
check('o próximo item continua a numeração (TM-38)', imported.items?.[1]?.ref === 'TM-38', imported.items?.[1]);
await call(a, 'create_items', { items: [{ name: 'Número repetido', number: 7 }] }, { expectError: true });
const renumbered = await call(a, 'update_items', { items: [{ item: 'TM-38', number: 40 }] });
check('update_items troca o número do item', renumbered.items?.[0]?.ref === 'TM-40', renumbered.items?.[0]);
await call(a, 'update_column', { column: 'ID', next_number: 12 }, { expectError: true });
const idColumn = await call(a, 'update_column', { column: 'ID', digits: 3, next_number: 50 });
check('update_column ajusta dígitos e próximo número', idColumn.next_ref === 'TM-050', idColumn);
const byRef = await call(a, 'get_item', { item: 'TM-7' });
check('TM-7 encontra o item TM-007', byRef.ref === 'TM-007', byRef.ref);
const next = await call(a, 'create_items', { items: [{ name: 'Depois do ajuste' }] });
check('item novo usa o próximo número configurado', next.items?.[0]?.ref === 'TM-050', next.items?.[0]);
const numberActivity = await call(a, 'get_activity', { item: 'TM-040', limit: 5 });
check(
  'a troca de número fica no registro',
  numberActivity.some?.((line) => line.includes('"TM-38" → "TM-40"')),
  numberActivity,
);

// ── Meu trabalho ──
await call(a, 'create_items', {
  items: [
    { name: 'Trabalho atrasado', values: { Responsável: 'Você', Prazo: 'ontem' } },
    { name: 'Trabalho de hoje', values: { Responsável: 'Você', Prazo: 'hoje' } },
    { name: 'Trabalho futuro', values: { Responsável: ['Você', 'Claude'], Prazo: '+30d' } },
    { name: 'Trabalho sem data', values: { Responsável: 'Você' } },
    { name: 'Trabalho feito', values: { Responsável: 'Você', Prazo: 'ontem', Status: 'Feito' } },
    { name: 'Trabalho de outra pessoa', values: { Responsável: 'Claude', Prazo: 'hoje' } },
  ],
});
const bucketOf = (result, name) => result.buckets?.find((b) => b.items.some((i) => i.name === name))?.bucket;
const work = await call(a, 'get_my_work', {});
check('get_my_work: prazo vencido fica em Atrasado', bucketOf(work, 'Trabalho atrasado') === 'Atrasado', work.buckets);
check('get_my_work: prazo hoje fica em Hoje', bucketOf(work, 'Trabalho de hoje') === 'Hoje');
check('get_my_work: daqui a 30 dias fica em Mais tarde', bucketOf(work, 'Trabalho futuro') === 'Mais tarde');
check('get_my_work: sem prazo fica em Sem data', bucketOf(work, 'Trabalho sem data') === 'Sem data');
check(
  'get_my_work: concluídos e itens de outra pessoa ficam de fora',
  !bucketOf(work, 'Trabalho feito') && !bucketOf(work, 'Trabalho de outra pessoa'),
);
const withDone = await call(a, 'get_my_work', { include_done: true, project: 'Migrado' });
check('get_my_work com include_done mostra Concluído', bucketOf(withDone, 'Trabalho feito') === 'Concluído', withDone.buckets);
const claudeWork = await call(a, 'get_my_work', { person: 'Claude', project: 'Migrado' });
check(
  'get_my_work de outra pessoa',
  claudeWork.person === 'Claude' &&
    bucketOf(claudeWork, 'Trabalho de outra pessoa') === 'Hoje' &&
    !bucketOf(claudeWork, 'Trabalho sem data'),
  claudeWork,
);

// ── Subitens (checklist) ──
const planned = await call(a, 'create_items', {
  items: [
    { name: 'Tarefa com passos', values: { Status: 'Em andamento' }, subitems: ['Criar a migração', 'Endpoint da API', 'Tela de edição'] },
  ],
});
const plannedRef = planned.items?.[0]?.ref;
check('create_items cria os subitens junto', planned.items?.[0]?.subitems === '0/3 feitos', planned.items?.[0]);
const added = await call(a, 'add_subitems', { item: plannedRef, subitems: ['Testes'] });
check(
  'add_subitems acrescenta no fim e devolve a checklist com ids',
  added.progress === '0/4 feitos' && added.subitems?.[3]?.name === 'Testes' && Number.isInteger(added.subitems?.[0]?.id),
  added,
);
const top = await call(a, 'add_subitems', { item: plannedRef, subitems: ['Ler o código atual'], position: 'top' });
check('add_subitems com position "top" entra no começo', top.subitems?.[0]?.name === 'Ler o código atual', top.subitems);
const checked = await call(a, 'update_subitems', {
  item: plannedRef,
  changes: [
    { subitem: '#1', done: true },
    { subitem: 'criar a migr', done: true },
    { subitem: added.subitems[1].id, name: 'Endpoint REST da API' },
    { subitem: 'Testes', remove: true },
  ],
});
check(
  'update_subitems marca (posição e texto), renomeia (id) e remove',
  checked.progress === '2/4 feitos' &&
    checked.subitems?.[0]?.done_by === 'Claude' &&
    checked.subitems?.some((s) => s.name === 'Endpoint REST da API') &&
    !checked.subitems?.some((s) => s.name === 'Testes'),
  checked,
);
await call(a, 'update_subitems', { item: plannedRef, changes: [{ subitem: 'não existe', done: true }] }, { expectError: true });
await call(a, 'update_subitems', { item: plannedRef, changes: [{ subitem: 'ção', done: true }] }, { expectError: true });
const detail = await call(a, 'get_item', { item: plannedRef });
check('get_item lista os subitens', detail.subitems?.length === 4 && detail.subitems[0].done === true, detail.subitems);
const bySubitem = await call(a, 'find_items', { query: 'tela de edicao' });
check(
  'find_items encontra pelo texto de um subitem',
  bySubitem.items?.some((i) => i.ref === plannedRef),
  bySubitem,
);
const allDone = await call(a, 'update_subitems', {
  item: plannedRef,
  changes: checked.subitems.filter((s) => !s.done).map((s) => ({ subitem: s.id, done: true })),
});
check('com todos os subitens feitos, lembra de ajustar o status', allDone.progress === '4/4 feitos' && !!allDone.note, allDone);
const subActivity = await call(a, 'get_activity', { item: plannedRef, limit: 20 });
check(
  'marcar subitens fica no registro de atividades',
  subActivity.some?.((line) => line.includes('marcou como feito') && line.includes('Criar a migração')),
  subActivity,
);

// ── TODOs do código ──
const codeDir = path.join(dir, 'codigo');
fs.mkdirSync(path.join(codeDir, 'src'), { recursive: true });
fs.mkdirSync(path.join(codeDir, 'node_modules', 'lib'), { recursive: true });
gitIn(codeDir)('init', '-q', '-b', 'main');
const payment = path.join(codeDir, 'src', 'pagamento.ts');
const marker = (tag, text) => `// ${tag}${text}`; // monta as marcações em tempo de execução: este arquivo não tem TODOs
fs.writeFileSync(
  payment,
  [
    'export function pagar() {',
    `  ${marker('TODO', ': validar o valor mínimo')}`,
    `  ${marker('FIXME', '(ana): tratar o timeout do gateway')}`,
    '  const mascara = "XXX.XXX.XXX-XX"; // formato do CPF',
    '  return TODOS;',
    '}',
  ].join('\n'),
);
fs.writeFileSync(path.join(codeDir, 'src', 'script.py'), `x = 1  #${' HACK'}: contorno temporário\n`);
fs.writeFileSync(path.join(codeDir, 'NOTAS.md'), `#${' TODO'}: documentação não conta\n`);
fs.writeFileSync(path.join(codeDir, '.gitignore'), 'node_modules\n');
fs.writeFileSync(path.join(codeDir, 'node_modules', 'lib', 'index.js'), `${marker('TODO', ': dependência não conta')}\n`);
await call(a, 'create_project', { name: 'Codigo', folder: codeDir, id_prefix: 'COD' });
const todosFound = await call(a, 'find_code_todos', {});
check(
  'find_code_todos acha só marcações em comentários de código (sem .md, node_modules, TODOS ou máscaras)',
  todosFound.new_count === 3 &&
    todosFound.new
      .map((t) => t.tag)
      .sort()
      .join() === 'FIXME,HACK,TODO',
  todosFound,
);
check(
  'arquivo e linha da marcação',
  todosFound.new?.some((t) => t.file === 'src/pagamento.ts:3' && t.tag === 'FIXME'),
  todosFound.new,
);
const firstImport = await call(a, 'import_code_todos', { tags: ['TODO', 'FIXME'] });
const fixme = firstImport.items?.find((i) => i.name === 'Tratar o timeout do gateway');
check(
  'import_code_todos cria os itens com link para o editor na linha e tipo Bug no FIXME',
  firstImport.created === 2 &&
    /^vscode:\/\/file\/.+\/src\/pagamento\.ts:3:6$/.test(fixme?.values?.['Código']?.url ?? '') &&
    fixme?.values?.['Código']?.text === 'pagamento.ts:3' &&
    fixme?.values?.Tipo === 'Bug',
  firstImport,
);
const fixmeDetail = await call(a, 'get_item', { item: fixme.ref });
check(
  'a atualização traz o trecho do código',
  /FIXME\*\* \(ana\)[\s\S]*> 3 \|/.test(fixmeDetail.updates?.[0]?.body ?? ''),
  fixmeDetail.updates,
);
const secondImport = await call(a, 'import_code_todos', {});
check(
  'importar de novo não duplica (só cria o que faltava)',
  secondImport.created === 1 && secondImport.items?.[0]?.name === 'Contorno temporário',
  secondImport,
);

fs.writeFileSync(payment, `// cabeçalho novo\n\n${fs.readFileSync(payment, 'utf8')}`);
const rescan = await call(a, 'find_code_todos', { include_imported: true });
const moved = await call(a, 'get_item', { item: fixme.ref });
check(
  'a linha do link acompanha o código que mudou',
  moved.values?.['Código']?.text === 'pagamento.ts:5' && /pagamento\.ts:5:6$/.test(moved.values?.['Código']?.url ?? ''),
  moved.values,
);
check('marcações importadas aparecem ligadas aos itens', rescan.new_count === 0 && rescan.imported?.length === 3, rescan);
const movedActivity = await call(a, 'get_activity', { item: fixme.ref, limit: 10 });
check(
  'mudar só a linha não polui o registro de atividades',
  Array.isArray(movedActivity) && !movedActivity.some((line) => line.includes('· Código:')),
  movedActivity,
);

fs.writeFileSync(
  payment,
  `${fs.readFileSync(payment, 'utf8').replace(/.*FIXME.*\n/, '')}\n  ${marker('TODO', ` ${fixme.ref}: revisar depois`)}\n`,
);
const gone = await call(a, 'find_code_todos', { include_imported: true });
check('marcação que saiu do código aparece em removed_from_code', gone.removed_from_code?.[0]?.item === fixme.ref, gone);
check(
  '"TODO COD-…" que cita um item fica ligado a ele',
  gone.imported?.some((t) => t.item === fixme.ref && t.cited_in_text),
  gone.imported,
);
const completedTodo = await call(a, 'import_code_todos', { complete_removed: true });
const closedTodo = await call(a, 'get_item', { item: fixme.ref });
check(
  'complete_removed conclui o item (e não importa a marcação que só cita o item)',
  completedTodo.completed_removed === 1 && completedTodo.created === 0 && closedTodo.values?.Status === 'Feito',
  { completedTodo, status: closedTodo.values?.Status },
);

const looseDir = path.join(dir, 'sem-git');
fs.mkdirSync(path.join(looseDir, 'node_modules'), { recursive: true });
fs.writeFileSync(path.join(looseDir, 'app.js'), `${marker('TODO', ': pasta sem Git')}\n`);
fs.writeFileSync(path.join(looseDir, 'node_modules', 'dep.js'), `${marker('TODO', ': dependência')}\n`);
await call(a, 'create_project', { name: 'Sem Git', folder: looseDir });
const loose = await call(a, 'find_code_todos', {});
check('pasta sem Git também é lida (pulando dependências)', loose.new_count === 1 && loose.new[0].file === 'app.js:1', loose);

await a.close();
try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  /* o Windows às vezes segura o arquivo por alguns ms */
}
console.log(failures ? `\n${failures} falha(s).` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
