// Teste de fumaça dos hooks do Claude Code (bin/tuesday-hook.mjs) e dos comandos brief, note e setup --hooks.
// Usa um banco, um repositório e um settings.json temporários.
//   npm run test:hooks
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuesday-hooks-'));
const repo = path.join(dir, 'app');
const settingsFile = path.join(dir, 'settings.json');
fs.mkdirSync(repo);
const env = { ...process.env, TUESDAY_DB: path.join(dir, 'hooks.db'), TUESDAY_NO_SEED: '1', TUESDAY_CLAUDE_SETTINGS: settingsFile };

let failures = 0;
function check(label, condition, detail) {
  console.log(`${condition ? '✔' : '✘'} ${label}`);
  if (!condition) {
    failures++;
    if (detail !== undefined) console.log(`  ${typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)}`);
  }
}

const git = (...args) =>
  execFileSync('git', ['-c', 'user.name=Teste', '-c', 'user.email=teste@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repo,
    stdio: 'pipe',
  }).toString();

function hook(event, input) {
  const started = Date.now();
  const res = spawnSync(process.execPath, [path.join(root, 'bin', 'tuesday-hook.mjs'), event], {
    input: JSON.stringify(input),
    env,
    encoding: 'utf8',
  });
  if (res.stderr.trim()) console.log(`  stderr: ${res.stderr.trim()}`);
  return { out: res.stdout.trim() ? JSON.parse(res.stdout) : null, ms: Date.now() - started, code: res.status };
}

function cli(args, cwd = repo) {
  const res = spawnSync(process.execPath, [path.join(root, 'bin', 'tuesday.mjs'), ...args], { cwd, env, encoding: 'utf8' });
  return { stdout: res.stdout, stderr: res.stderr, code: res.status };
}

// ── Repositório e projeto de exemplo ──
git('init', '-q', '-b', 'main');
fs.writeFileSync(path.join(repo, 'README.md'), '# app\n');
git('add', '.');
git('commit', '-q', '-m', 'inicial');

const mcp = new Client({ name: 'tuesday-hooks-smoke', version: '1.0.0' });
await mcp.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, 'bin', 'tuesday-mcp.mjs')],
    env,
    cwd: repo,
    stderr: 'inherit',
  }),
);
async function call(name, args) {
  const res = await mcp.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? '';
  if (res.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
}
await call('create_project', { name: 'App', folder: '.', id_prefix: 'APP' });
await call('create_items', {
  items: [
    { name: 'Tela de login', values: { Status: 'Em andamento', Prioridade: 'Alta' } },
    { name: 'Cadastro quebrado', values: { Status: 'Bloqueado' } },
    { name: 'Relatório mensal', values: { Status: 'Pronto pra começar', Prazo: 'ontem' } },
    { name: 'Já entregue', values: { Status: 'Feito' } },
  ],
});

// ── Início de sessão ──
const outside = hook('session-start', { session_id: 'fora', cwd: os.tmpdir(), source: 'startup' });
check(
  `fora de uma pasta de projeto não faz nada (${outside.ms} ms)`,
  outside.code === 0 && outside.out === null && outside.ms < 1500,
  outside,
);

const start = hook('session-start', { session_id: 's1', cwd: repo, source: 'startup' });
const context = start.out?.hookSpecificOutput?.additionalContext ?? '';
check(
  'session-start devolve o resumo como additionalContext',
  start.out?.hookSpecificOutput?.hookEventName === 'SessionStart' && !!context,
  start,
);
check(
  'resumo traz em andamento, bloqueados e atrasados',
  /Em andamento \(1\)[\s\S]*APP-001/.test(context) &&
    /Bloqueados \(1\)[\s\S]*APP-002/.test(context) &&
    /Atrasados \(1\)[\s\S]*APP-003/.test(context),
  context,
);
check('itens concluídos ficam fora do resumo', !context.includes('APP-004'), context);

// ── Fim de sessão ──
check('stop sem mudanças não pede nada', hook('stop', { session_id: 's1', cwd: repo }).out === null);

git('checkout', '-q', '-b', 'feat/APP-001-login');
fs.writeFileSync(path.join(repo, 'login.ts'), 'export const login = () => true;\n');
const dirty = hook('stop', { session_id: 's1', cwd: repo });
check(
  'alterações na branch de um item pedem o registro',
  dirty.out?.decision === 'block' && dirty.out.reason.includes('APP-001') && dirty.out.reason.includes('não commitadas'),
  dirty.out,
);
check('stop_hook_active não pede de novo (sem loop)', hook('stop', { session_id: 's1', cwd: repo, stop_hook_active: true }).out === null);
fs.appendFileSync(path.join(repo, 'login.ts'), '// mais uma mudança\n');
check('o mesmo item da branch não é lembrado duas vezes na sessão', hook('stop', { session_id: 's1', cwd: repo }).out === null);

git('add', '.');
git('commit', '-q', '-m', 'APP-002: corrige a validação do cadastro');
const committed = hook('stop', { session_id: 's1', cwd: repo });
check(
  'commit citando um item pede a atualização dele',
  committed.out?.decision === 'block' && committed.out.reason.includes('APP-002') && committed.out.reason.includes('corrige a validação'),
  committed.out,
);
check('o mesmo commit não gera outro lembrete', hook('stop', { session_id: 's1', cwd: repo }).out === null);

fs.appendFileSync(path.join(repo, 'login.ts'), '// ajuste\n');
git('commit', '-q', '-am', 'APP-002: ajuste fino');
await call('add_update', { item: 'APP-002', body: 'Validação do cadastro corrigida.' });
check('commit que o Claude já registrou não gera lembrete', hook('stop', { session_id: 's1', cwd: repo }).out === null);

check('sessão aberta antes dos hooks só começa a acompanhar', hook('stop', { session_id: 's2', cwd: repo }).out === null);
check('…e na sequência continua quieta sem mudanças', hook('stop', { session_id: 's2', cwd: repo }).out === null);

// ── brief e note ──
const brief = cli(['brief']);
check(
  'tuesday brief mostra o resumo e o item da branch',
  brief.code === 0 && /Branch atual em app: feat\/APP-001-login → APP-001/.test(brief.stdout),
  brief,
);

const note = cli(['note', 'APP-001', '--claude', '--status', 'Em revisão', 'Login pronto para revisão']);
const item = await call('get_item', { item: 'APP-001' });
check(
  'tuesday note posta a atualização e muda o status',
  note.code === 0 && item.values?.Status === 'Em revisão' && item.updates?.[0]?.author === 'Claude',
  { note, status: item.values?.Status, updates: item.updates },
);
check('tuesday note recusa etiqueta inexistente', cli(['note', 'APP-001', '--status', 'Nao existe']).code === 1);

// ── Subitens ──
await call('add_subitems', { item: 'APP-001', subitems: ['Tela de login', 'Validação', 'Testes'] });
await call('update_subitems', { item: 'APP-001', changes: [{ subitem: '#1', done: true }] });
const briefSteps = cli(['brief']);
check(
  'o resumo mostra o progresso e os subitens do item da branch',
  /APP-001 .*subitens 1\/3/.test(briefSteps.stdout) &&
    briefSteps.stdout.includes('Subitens de APP-001: [x] Tela de login; [ ] Validação; [ ] Testes'),
  briefSteps.stdout,
);

hook('session-start', { session_id: 's3', cwd: repo, source: 'startup' });
await call('update_subitems', { item: 'APP-001', changes: [{ subitem: 'Validação', done: true }] });
const afterChecks = hook('stop', { session_id: 's3', cwd: repo });
check(
  'subitens marcados pelo Claude sem atualização pedem o registro',
  afterChecks.out?.decision === 'block' &&
    afterChecks.out.reason.includes('subitens marcados nesta sessão: Validação') &&
    afterChecks.out.reason.includes('subitens (2/3 feitos)'),
  afterChecks.out,
);
check('…e não pedem de novo na mesma sessão', hook('stop', { session_id: 's3', cwd: repo }).out === null);

const steps = cli(['steps', 'APP-003', '--add', '- Coletar os dados\n- Gerar o PDF']);
check(
  'tuesday steps --add aceita uma lista colada',
  steps.code === 0 && /1\. \[ \] Coletar os dados/.test(steps.stdout) && /2\. \[ \] Gerar o PDF/.test(steps.stdout),
  steps,
);
const checkedCli = cli(['check', 'APP-003', '2', 'coletar']);
check('tuesday check marca pelo número e pelo texto', checkedCli.code === 0 && /2\/2 subitens feitos/.test(checkedCli.stdout), checkedCli);
check('tuesday check recusa subitem inexistente', cli(['check', 'APP-003', 'nada disso']).code === 1);

// ── TODOs do código pela CLI ──
fs.writeFileSync(path.join(repo, 'relatorio.ts'), `export const gerar = () => null; // ${'FIXME'}: gerar o PDF de verdade\n`);
const listed = cli(['todos']);
check(
  'tuesday todos lista a marcação nova',
  listed.code === 0 && /nova\s+FIXME\s+relatorio\.ts:1\s+Gerar o PDF de verdade/.test(listed.stdout),
  listed,
);
const importedCli = cli(['todos', '--import', '--tag', 'FIXME']);
check(
  'tuesday todos --import cria o item',
  importedCli.code === 0 && /APP-\d+ Gerar o PDF de verdade/.test(importedCli.stdout),
  importedCli,
);
check('…e na próxima listagem ele aparece com a referência', /APP-\d+\s+FIXME\s+relatorio\.ts:1/.test(cli(['todos']).stdout));

// ── setup --hooks ──
fs.writeFileSync(
  settingsFile,
  JSON.stringify({ model: 'opus', hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo outro-hook' }] }] } }, null, 2),
);
const count = (settings, event) =>
  (settings.hooks?.[event] ?? []).flatMap((g) => g.hooks).filter((h) => h.command.includes('tuesday-hook.mjs')).length;
cli(['setup', '--hooks'], dir);
cli(['setup', '--hooks'], dir);
let settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
check(
  'setup --hooks instala uma vez só e preserva o que existia',
  count(settings, 'SessionStart') === 1 &&
    count(settings, 'Stop') === 1 &&
    settings.model === 'opus' &&
    settings.hooks.Stop.some((g) => g.hooks.some((h) => h.command === 'echo outro-hook')),
  settings,
);
check('setup --hooks guarda backup do arquivo anterior', fs.existsSync(`${settingsFile}.tuesday-backup`));
cli(['setup', '--hooks', '--remove'], dir);
settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
check(
  'setup --hooks --remove tira só os hooks do tuesday',
  count(settings, 'Stop') === 0 && !settings.hooks.SessionStart && settings.hooks.Stop.length === 1,
  settings,
);

await mcp.close();
try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  /* o Windows às vezes segura o arquivo por alguns ms */
}
console.log(failures ? `\n${failures} falha(s).` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
