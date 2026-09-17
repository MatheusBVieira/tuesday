// Banco de demonstração com dados fictícios — é o que aparece nos prints do README.
//   npm run demo      gera e abre o tuesday sobre ele
//   npm run prints    gera e refaz os prints
// Tudo fica em data/demo/ (o seu banco não é tocado): o banco, uma pasta de código com Git e TODOs, e
// configurações de mentira do Claude para a tela "Conectar o Claude".
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { todayIso } from '../shared/values';
import { DATA_DIR, getDb } from '../server/db/connection';
import type { Actor } from '../server/services/common';
import { db } from '../server/services/common';
import { getBoard, updateBoard } from '../server/services/boards';
import { importCodeTodos, scanCodeTodos } from '../server/services/codetodos';
import { syncProjectGit } from '../server/services/git';
import { createItem } from '../server/services/items';
import { createPerson, getClaudeId, getMeId, updatePerson } from '../server/services/people';
import { createProject } from '../server/services/projects';
import { addSubitems, updateSubitem } from '../server/services/subitems';
import { createUpdate } from '../server/services/updates';
import { hookCommand, mcpLauncher } from '../server/runtime';

const DEMO = DATA_DIR;
if (path.basename(DEMO) !== 'demo') throw new Error(`Rode pelo npm run demo (a pasta de dados precisa ser data/demo, não ${DEMO}).`);

const code = path.join(DEMO, 'aurora');
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

// ── Código de mentira, com Git e TODOs ──
function writeCode(): void {
  const files: Record<string, string> = {
    'README.md': '# Aurora\n\nLoja online de exemplo.\n',
    'src/payments/gateway.ts': [
      "import { psp } from './psp';",
      '',
      'export async function charge(orderId: string, cents: number) {',
      '  // FIXME: tratar o timeout do gateway — hoje o pedido fica "processando" para sempre',
      '  const response = await psp.charges.create({ orderId, amount: cents });',
      '  return response.status === "paid";',
      '}',
      '',
    ].join('\n'),
    'src/payments/retry.ts': [
      'export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {',
      '  // HACK: retry manual enquanto o SDK do PSP não respeita o Retry-After do 429',
      '  for (let i = 0; ; i++) {',
      '    try {',
      '      return await fn();',
      '    } catch (error) {',
      '      if (i >= attempts) throw error;',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n'),
    'src/customers/signup.ts': [
      'export function signup(input: { name: string; cpf: string; email: string }) {',
      '  // TODO: validar o CPF no cadastro antes de chamar a API',
      '  return api.post("/customers", input);',
      '}',
      '',
    ].join('\n'),
    'src/search/filters.ts': [
      'export interface PriceFilter { min?: number; max?: number }',
      '',
      'export function parsePrice(query: string): PriceFilter {',
      '  // TODO(ana): aceitar faixa de preço aberta, como "até R$ 100"',
      '  const [min, max] = query.split("-").map(Number);',
      '  return { min, max };',
      '}',
      '',
    ].join('\n'),
  };
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(code, file)), { recursive: true });
    fs.writeFileSync(path.join(code, file), content);
  }
  const git = (args: string[], author: [string, string], hoursAgo: number) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: code,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: author[0],
        GIT_AUTHOR_EMAIL: author[1],
        GIT_COMMITTER_NAME: author[0],
        GIT_COMMITTER_EMAIL: author[1],
        GIT_AUTHOR_DATE: ago(hoursAgo),
        GIT_COMMITTER_DATE: ago(hoursAgo),
      },
    });
  const marina: [string, string] = ['Marina Lima', 'marina@aurora.exemplo'];
  const rafael: [string, string] = ['Rafael Souza', 'rafael@aurora.exemplo'];
  const diego: [string, string] = ['Diego Martins', 'diego@aurora.exemplo'];
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: code });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/exemplo/aurora.git'], { cwd: code });
  git(['add', '.'], marina, 200);
  git(['commit', '-q', '-m', 'Estrutura inicial da loja'], marina, 200);
  const commit = (message: string, author: [string, string], hoursAgo: number) =>
    git(['commit', '-q', '--allow-empty', '-m', message], author, hoursAgo);
  commit('AUR-013: login com Google', rafael, 150);
  commit('fixes AUR-015: trava a baixa de estoque em pedidos simultâneos', diego, 52);
  commit('AUR-001: gera o QR Code do Pix pela API do PSP', marina, 30);
  commit('AUR-002: cupom não zera o frete grátis', rafael, 20);
  commit('AUR-001: tela de pagamento com o QR Code e o copia e cola', marina, 6);
}

// ── Configurações de mentira do Claude (todas apontando para este tuesday) ──
function writeClaudeConfigs(): void {
  const claude = path.join(DEMO, 'claude');
  fs.mkdirSync(path.join(claude, 'desktop'), { recursive: true });
  const server = { tuesday: mcpLauncher() };
  fs.writeFileSync(path.join(claude, 'claude.json'), JSON.stringify({ mcpServers: server }, null, 2));
  fs.writeFileSync(path.join(claude, 'desktop', 'claude_desktop_config.json'), JSON.stringify({ mcpServers: server }, null, 2));
  const hook = (event: string) => [{ hooks: [{ type: 'command', command: hookCommand(event), timeout: 30 }] }];
  fs.writeFileSync(
    path.join(claude, 'settings.json'),
    JSON.stringify({ hooks: { SessionStart: hook('session-start'), Stop: hook('stop') } }, null, 2),
  );
}

writeCode();
writeClaudeConfigs();
getDb();

const me = getMeId()!;
const claudeId = getClaudeId()!;
const user: Actor = { source: 'user', personId: me, clientId: null };
const claude: Actor = { source: 'claude', personId: claudeId, clientId: null };

updatePerson(me, { name: 'Marina Lima', color: '#579bfc' }, user);
const rafael = createPerson({ name: 'Rafael Souza', color: '#ff642e' }, user).id;
const ana = createPerson({ name: 'Ana Beatriz', color: '#9d50dd' }, user).id;
const diego = createPerson({ name: 'Diego Martins', color: '#00a9ff' }, user).id;

// ── Projeto principal ──
const { project, boardId } = createProject(
  { name: 'Aurora', color: '#0073ea', folder: code, template: 'software', idPrefix: 'AUR', boardName: 'Sprint 14' },
  user,
);
updateBoard(boardId!, { description: 'Loja online — sprint de 2 semanas' }, user);
const board = getBoard(boardId!);
const col = (title: string) => board.columns.find((c) => c.title === title)!;
const label = (title: string, name: string) => col(title).settings.labels!.find((l) => l.name === name)!.id;
const group = (name: string) => board.groups.find((g) => g.name === name)!;

interface Spec {
  name: string;
  group: string;
  status: string;
  priority: string;
  type: string;
  owners: number[];
  due?: number;
  steps?: [string, 'claude' | 'user' | null][];
  updates?: [Actor, number, string][];
}

const specs: Spec[] = [
  {
    name: 'Checkout com Pix',
    group: 'Sprint atual',
    status: 'Em andamento',
    priority: 'Alta',
    type: 'Funcionalidade',
    owners: [me, claudeId],
    due: 2,
    steps: [
      ['Gerar o QR Code pela API do PSP', 'claude'],
      ['Tela de pagamento com QR Code e copia e cola', 'claude'],
      ['Webhook de confirmação do pagamento', null],
      ['Expirar o QR Code depois de 30 minutos', null],
      ['Testes de ponta a ponta do checkout', null],
    ],
    updates: [
      [
        claude,
        5,
        '**Tela de pagamento pronta** — QR Code e copia e cola funcionando no ambiente de teste do PSP.\n\n- Commit `AUR-001: tela de pagamento…`\n- Falta o webhook de confirmação: o PSP chama `/webhooks/pix` e o pedido vai para **pago**.\n\nPróximo passo: webhook, depois a expiração do QR Code.',
      ],
      [user, 26, 'Combinei com o time do PSP: o QR Code expira em 30 minutos. Pode seguir.'],
    ],
  },
  {
    name: 'Cupom de desconto zera o frete grátis',
    group: 'Sprint atual',
    status: 'Em revisão',
    priority: 'Crítica',
    type: 'Bug',
    owners: [rafael, me],
    due: 0,
    updates: [[{ source: 'user', personId: rafael, clientId: null }, 19, 'PR aberto. Cupons acima de R$ 50 agora mantêm o frete grátis.']],
  },
  {
    name: 'Busca com filtros por categoria e preço',
    group: 'Sprint atual',
    status: 'Em andamento',
    priority: 'Normal',
    type: 'Funcionalidade',
    owners: [ana],
    due: 5,
    steps: [
      ['Índice de busca por categoria', 'user'],
      ['Filtro de faixa de preço', null],
      ['Ordenar por relevância', null],
    ],
  },
  {
    name: 'Migrar imagens dos produtos para a CDN',
    group: 'Sprint atual',
    status: 'Bloqueado',
    priority: 'Alta',
    type: 'Infraestrutura',
    owners: [diego, me],
    due: -1,
    updates: [
      [{ source: 'user', personId: diego, clientId: null }, 28, 'Parado até chegarem as credenciais da CDN. Já pedi para o financeiro.'],
    ],
  },
  {
    name: 'Página de pedidos no app',
    group: 'Sprint atual',
    status: 'Pronto pra começar',
    priority: 'Normal',
    type: 'Funcionalidade',
    owners: [me],
    due: 6,
  },
  {
    name: 'Atualizar o Node do deploy para a versão 22',
    group: 'Sprint atual',
    status: 'Pronto pra começar',
    priority: 'Baixa',
    type: 'Infraestrutura',
    owners: [claudeId],
    due: 3,
  },
  {
    name: 'Programa de indicação (ganhe R$ 20)',
    group: 'Backlog',
    status: 'Pronto pra começar',
    priority: 'Normal',
    type: 'Funcionalidade',
    owners: [],
  },
  {
    name: 'Relatório de vendas por canal',
    group: 'Backlog',
    status: 'Pronto pra começar',
    priority: 'Normal',
    type: 'Funcionalidade',
    owners: [ana],
    due: 12,
  },
  { name: 'Modo escuro na loja', group: 'Backlog', status: 'Pronto pra começar', priority: 'Baixa', type: 'Melhoria', owners: [] },
  {
    name: 'Revisar textos da página de trocas',
    group: 'Backlog',
    status: 'Pronto pra começar',
    priority: 'Baixa',
    type: 'Outro',
    owners: [me],
    due: 9,
  },
  {
    name: 'Frete por CEP com a nova transportadora',
    group: 'Backlog',
    status: 'Pronto pra começar',
    priority: 'Alta',
    type: 'Funcionalidade',
    owners: [rafael],
  },
  {
    name: 'Alerta de estoque baixo por e-mail',
    group: 'Backlog',
    status: 'Pronto pra começar',
    priority: 'Normal',
    type: 'Melhoria',
    owners: [diego],
  },
  { name: 'Login com Google', group: 'Concluído', status: 'Feito', priority: 'Alta', type: 'Funcionalidade', owners: [rafael], due: -6 },
  {
    name: 'Carrinho salvo entre dispositivos',
    group: 'Concluído',
    status: 'Feito',
    priority: 'Normal',
    type: 'Melhoria',
    owners: [ana],
    due: -4,
  },
  {
    name: 'Estoque negativo em pedidos simultâneos',
    group: 'Concluído',
    status: 'Feito',
    priority: 'Crítica',
    type: 'Bug',
    owners: [claudeId, diego],
    due: -2,
    steps: [
      ['Reproduzir com dois pedidos ao mesmo tempo', 'claude'],
      ['Travar a baixa de estoque numa transação', 'claude'],
      ['Teste de concorrência', 'claude'],
    ],
  },
];

for (const [index, spec] of specs.entries()) {
  const target = group(spec.group);
  const item = createItem(
    board.id,
    {
      name: spec.name,
      groupId: target.id,
      number: index + 1,
      values: {
        [col('Status').id]: label('Status', spec.status),
        [col('Prioridade').id]: label('Prioridade', spec.priority),
        [col('Tipo').id]: label('Tipo', spec.type),
        ...(spec.owners.length ? { [col('Responsável').id]: spec.owners } : {}),
        ...(spec.due !== undefined ? { [col('Prazo').id]: todayIso(spec.due) } : {}),
      },
    },
    user,
  );
  if (spec.steps) {
    const steps = addSubitems(
      item.id,
      spec.steps.map(([name]) => ({ name })),
      {},
      user,
    );
    spec.steps.forEach(([, doneBy], i) => {
      if (doneBy) updateSubitem(steps[i].id, { done: true }, doneBy === 'claude' ? claude : user);
    });
  }
  for (const [actor, hours, body] of spec.updates ?? []) {
    const update = createUpdate(item.id, body, actor);
    db().prepare('UPDATE updates SET created_at = ?, updated_at = ? WHERE id = ?').run(ago(hours), ago(hours), update.id);
  }
}

// Commits da pasta e os TODOs do código (três importados, um fica para a tela de importação).
await syncProjectGit(project.id, { force: true });
const scan = await scanCodeTodos(project.id);
const toImport = scan.todos.filter((t) => t.status === 'new' && t.author !== 'ana').map((t) => t.id);
await importCodeTodos(project.id, { ids: toImport, groupId: group('Backlog').id }, user);

// Um projeto a mais, para a barra lateral.
const site = createProject({ name: 'Site institucional', color: '#00c875', template: 'default', boardName: 'Conteúdo' }, user);
const siteBoard = getBoard(site.boardId!);
for (const name of ['Página "Sobre nós"', 'Fotos da equipe', 'Política de privacidade']) {
  createItem(siteBoard.id, { name }, user);
}

// Datas do registro de atividades espalhadas pelos últimos dias, em vez de "agora".
const rows = db().prepare('SELECT id FROM activity ORDER BY id').all() as { id: number }[];
rows.forEach((row, i) => {
  db()
    .prepare('UPDATE activity SET created_at = ? WHERE id = ?')
    .run(ago(((rows.length - i) / rows.length) * 72), row.id);
});

console.log(`Demonstração pronta em ${DEMO}`);
process.exit(0);
