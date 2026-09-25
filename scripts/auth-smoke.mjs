// Teste de fumaça das contas: cadastro, convite por link, papéis (RBAC) e token do MCP.
// Sobe um servidor de verdade (modo servidor, banco temporário) e usa a API como o navegador usaria.
//   npm run test:auth
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuesday-auth-'));
/** Porta livre de verdade: sorteada e confirmada pelo sistema, para não cair num servidor de outro teste. */
const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const base = `http://127.0.0.1:${port}`;

let failures = 0;
function check(label, condition, detail) {
  console.log(`${condition ? '✔' : '✘'} ${label}`);
  if (!condition) {
    failures++;
    if (detail !== undefined) console.log(`  ${typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)}`);
  }
}

/** Um "navegador": guarda os cookies da sessão. */
function session() {
  const jar = new Map();
  return {
    jar,
    async fetch(url, options = {}) {
      const headers = new Headers(options.headers ?? {});
      if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
      const cookies = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookies) headers.set('cookie', cookies);
      const res = await fetch(`${base}${url}`, { ...options, headers, redirect: 'manual' });
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const index = pair.indexOf('=');
        jar.set(pair.slice(0, index), pair.slice(index + 1));
      }
      const text = await res.text();
      let body = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        /* resposta não-JSON (HTML da interface, por exemplo) */
      }
      return { status: res.status, body };
    },
  };
}

const anon = session();

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

const server = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'server', 'index.ts')], {
  cwd: root,
  env: {
    ...process.env,
    HOST: '0.0.0.0',
    TUESDAY_PORT: String(port),
    TUESDAY_DB: path.join(dir, 'tuesday.db'),
    TUESDAY_DATA_DIR: dir,
    TUESDAY_URL: base,
    TUESDAY_RUNTIME: 'source',
    TUESDAY_DATABASE_URL: process.env.TUESDAY_DATABASE_URL ?? '',
    NODE_ENV: 'test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const logs = [];
server.stdout.on('data', (d) => logs.push(String(d)));
server.stderr.on('data', (d) => logs.push(String(d)));

const finish = (code) => {
  server.kill();
  setTimeout(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* o Windows às vezes segura o arquivo por alguns ms */
    }
    process.exit(code);
  }, 300);
};

if (!(await waitForServer())) {
  console.log('O servidor não subiu:\n' + logs.join(''));
  finish(1);
}

// ── Sem conta, nada passa ──────────────────────────────────
{
  const res = await anon.fetch('/api/bootstrap');
  check('sem entrar, a API responde 401', res.status === 401, res);
  const info = await anon.fetch('/api/auth-info');
  check('a tela de entrada sabe que é a primeira conta', info.status === 200 && info.body.accounts && info.body.firstRun === true, info);
}

// ── Primeira conta: o dono da instalação ───────────────────
const master = session();
{
  const res = await master.fetch('/api/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({ name: 'Ana', email: 'ana@example.com', password: 'senha-forte-123' }),
  });
  check('cria a primeira conta', res.status === 200, res);
  const boot = await master.fetch('/api/bootstrap');
  check('a primeira conta é a dona da instalação', boot.body?.viewer?.master === true, boot.body?.viewer);
  check('a conta ganhou uma pessoa no quadro', typeof boot.body?.viewer?.personId === 'number', boot.body?.viewer);
  check('o projeto de exemplo ficou com a primeira conta', boot.body?.projects?.length === 1, boot.body);
}

// ── Um projeto novo é do criador ───────────────────────────
let projectId = 0;
let boardId = 0;
{
  const res = await master.fetch('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Servidor', template: 'software' }) });
  check('cria projeto', res.status === 201, res);
  projectId = res.body.project.id;
  boardId = res.body.boardId;
  const members = await master.fetch(`/api/projects/${projectId}/members`);
  check('quem cria o projeto vira dono', members.body.length === 1 && members.body[0].role === 'dono', members.body);
}

// ── Convite por link ───────────────────────────────────────
let inviteToken = '';
{
  const res = await master.fetch(`/api/projects/${projectId}/invites`, { method: 'POST', body: JSON.stringify({ role: 'membro' }) });
  check('cria o link de convite', res.status === 201 && typeof res.body.token === 'string', res);
  inviteToken = res.body.token;
  const preview = await anon.fetch(`/api/invites/${inviteToken}`);
  check('o convite se apresenta antes de entrar', preview.status === 200 && preview.body.project.name === 'Servidor', preview.body);
  check('e diz que falta entrar na conta', preview.body.signedIn === false, preview.body);
  const invalid = await anon.fetch('/api/invites/nao-existe');
  check('convite inventado não vale', invalid.status === 400, invalid);
}

// ── Segunda conta entra pelo convite ───────────────────────
const membro = session();
{
  await membro.fetch('/api/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({ name: 'Bruno', email: 'bruno@example.com', password: 'senha-forte-123' }),
  });
  const boot = await membro.fetch('/api/bootstrap');
  check('a segunda conta não administra a instalação', boot.body?.viewer?.master === false, boot.body?.viewer);
  check('e ainda não vê projeto nenhum', boot.body.projects.length === 0, boot.body.projects);
  const accept = await membro.fetch(`/api/invites/${inviteToken}/accept`, { method: 'POST' });
  check('aceita o convite', accept.status === 200 && accept.body.role === 'membro', accept);
  const after = await membro.fetch('/api/bootstrap');
  check('e passa a ver o projeto', after.body.projects.length === 1 && after.body.projects[0].id === projectId, after.body.projects);
  check('com o papel de membro', after.body.viewer.roles[projectId] === 'membro', after.body.viewer.roles);
}

// ── O que cada papel pode ──────────────────────────────────
let itemId = 0;
{
  const item = await membro.fetch(`/api/boards/${boardId}/items`, { method: 'POST', body: JSON.stringify({ name: 'Tarefa do Bruno' }) });
  check('membro cria item', item.status === 201, item);
  itemId = item.body?.id;
  const column = await membro.fetch(`/api/boards/${boardId}/columns`, { method: 'POST', body: JSON.stringify({ type: 'text' }) });
  check('membro não mexe nas colunas', column.status === 403, column);
  const removal = await membro.fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
  check('membro não exclui o projeto', removal.status === 403, removal);
  const invite = await membro.fetch(`/api/projects/${projectId}/invites`, { method: 'POST', body: JSON.stringify({ role: 'leitor' }) });
  check('membro não convida ninguém', invite.status === 403, invite);
}

// ── Leitor: lê e comenta, não edita ────────────────────────
{
  const bruno = (await master.fetch(`/api/projects/${projectId}/members`)).body.find((m) => m.email === 'bruno@example.com');
  const change = await master.fetch(`/api/projects/${projectId}/members/${bruno.userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'leitor' }),
  });
  check('o dono muda o papel de quem participa', change.status === 200, change);
  const item = await membro.fetch(`/api/boards/${boardId}/items`, { method: 'POST', body: JSON.stringify({ name: 'Não deveria entrar' }) });
  check('leitor não cria item', item.status === 403, item);
  const update = await membro.fetch(`/api/items/${itemId}/updates`, { method: 'POST', body: JSON.stringify({ body: 'comentário' }) });
  check('leitor comenta', update.status === 201, update);
  const board = await membro.fetch(`/api/boards/${boardId}`);
  check('leitor lê o quadro', board.status === 200, board.status);
}

// ── Fora do projeto, nada ──────────────────────────────────
const estranho = session();
{
  await estranho.fetch('/api/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({ name: 'Carla', email: 'carla@example.com', password: 'senha-forte-123' }),
  });
  const board = await estranho.fetch(`/api/boards/${boardId}`);
  check('quem não participa não abre o quadro', board.status === 404, board);
  const item = await estranho.fetch(`/api/items/${itemId}`);
  check('nem o item', item.status === 404, item);
  const members = await estranho.fetch(`/api/projects/${projectId}/members`);
  check('nem a lista de quem participa', members.status === 404, members);
}

// ── Administração das contas: só o dono da instalação ──────
{
  const list = await master.fetch('/api/auth/admin/list-users?limit=10');
  check('a dona da instalação lista as contas', list.status === 200 && list.body.users.length === 3, list.body?.users?.length);
  const denied = await membro.fetch('/api/auth/admin/list-users?limit=10');
  check('quem não é dona não lista', denied.status === 403, denied.status);
  const reset = await master.fetch('/api/auth/admin/set-user-password', {
    method: 'POST',
    body: JSON.stringify({
      userId: (await master.fetch('/api/auth/admin/list-users?limit=10')).body.users.find((u) => u.email === 'carla@example.com').id,
      newPassword: 'outra-senha-123',
    }),
  });
  check('e troca a senha de alguém', reset.status === 200, reset);
  const login = await session().fetch('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email: 'carla@example.com', password: 'outra-senha-123' }),
  });
  check('a pessoa entra com a senha nova', login.status === 200, login.status);
}

// ── Token do MCP ───────────────────────────────────────────
{
  const created = await master.fetch('/api/account/tokens', { method: 'POST', body: JSON.stringify({ name: 'Claude da Ana' }) });
  check('cria token do MCP', created.status === 201 && created.body.token.startsWith('tue_'), created.body);
  const token = created.body.token;
  const withToken = await fetch(`${base}/api/bootstrap`, { headers: { authorization: `Bearer ${token}` } });
  const boot = await withToken.json();
  check('o token abre a API no nome da pessoa', withToken.status === 200 && boot.viewer.email === 'ana@example.com', boot.viewer);
  const mcp = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'teste', version: '1' } },
    }),
  });
  check('o MCP aceita o token', mcp.status === 200, mcp.status);
  const semToken = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  check('e recusa quem não tem token', semToken.status === 401, semToken.status);
}

// ── O MCP respeita o papel de quem é o token ───────────────
{
  /** Chama uma ferramenta do MCP com o token de alguém. */
  async function callTool(token, name, args) {
    const send = (body) =>
      fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify(body),
      }).then((r) => r.json());
    await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'teste', version: '1' } },
    });
    const res = await send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
    const text = res.result?.content?.[0]?.text ?? JSON.stringify(res.error ?? res);
    return { failed: !!res.result?.isError, text };
  }

  const tokenOf = async (who) => (await who.fetch('/api/account/tokens', { method: 'POST', body: JSON.stringify({}) })).body.token;
  const leitor = await tokenOf(membro); // o Bruno virou leitor acima
  const fora = await tokenOf(estranho);

  const read = await callTool(leitor, 'get_board', { board: boardId });
  check('pelo MCP, leitor lê o quadro', !read.failed, read.text.slice(0, 120));
  const write = await callTool(leitor, 'create_items', { board: boardId, items: [{ name: 'pelo MCP' }] });
  check('pelo MCP, leitor não cria item', write.failed && /papel/i.test(write.text), write.text.slice(0, 160));
  const outside = await callTool(fora, 'get_board', { board: boardId });
  check('pelo MCP, quem não participa não abre o quadro', outside.failed, outside.text.slice(0, 160));
  const projects = await callTool(fora, 'list_projects', {});
  check('e não enxerga projeto nenhum', JSON.parse(projects.text).projects.length === 0, projects.text.slice(0, 160));
}

if (failures) console.log('\n── servidor ──\n' + logs.join('').split('\n').slice(-40).join('\n'));
console.log(failures ? `\n${failures} falha(s).` : '\nTudo certo.');
finish(failures ? 1 : 0);
