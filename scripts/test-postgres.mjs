// Roda os testes de fumaça no PostgreSQL, cada um num banco novo, e confere gravações simultâneas de vários processos.
//   npm run test:postgres
// Precisa de um PostgreSQL acessível. Padrão: o do docker compose de desenvolvimento (npm run db:up).
//   TUESDAY_TEST_DATABASE_URL=postgres://usuario:senha@host:5432/postgres npm run test:postgres
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminUrl = process.env.TUESDAY_TEST_DATABASE_URL ?? 'postgres://tuesday:tuesday@localhost:55432/postgres';
const created = [];

function databaseUrl(name) {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function admin(sql) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function freshDatabase(label) {
  const name = `tuesday_test_${label}_${randomBytes(4).toString('hex')}`;
  await admin(`CREATE DATABASE ${name}`);
  created.push(name);
  return databaseUrl(name);
}

function run(script, env, { quiet = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (!quiet) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on('close', (code) => resolve({ code, output }));
  });
}

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (!ok) {
    failures++;
    if (detail) console.log(`  ${detail}`);
  }
};

try {
  await admin('SELECT 1');
} catch (error) {
  console.error(`Não consegui conectar em ${adminUrl.replace(/:[^:@/]+@/, ':***@')}: ${error.message}`);
  console.error('Suba um PostgreSQL (npm run db:up) ou defina TUESDAY_TEST_DATABASE_URL.');
  process.exit(1);
}

try {
  console.log('\n── Teste de fumaça do MCP no PostgreSQL ──');
  const mcp = await run('scripts/mcp-smoke.mjs', { TUESDAY_DATABASE_URL: await freshDatabase('mcp') });
  check('test:mcp no PostgreSQL', mcp.code === 0);

  console.log('\n── Teste de fumaça dos hooks no PostgreSQL ──');
  const hooks = await run('scripts/hooks-smoke.mjs', { TUESDAY_DATABASE_URL: await freshDatabase('hooks') });
  check('test:hooks no PostgreSQL', hooks.code === 0);

  console.log('\n── Teste de fumaça das contas no PostgreSQL ──');
  const auth = await run('scripts/auth-smoke.mjs', { TUESDAY_DATABASE_URL: await freshDatabase('auth') });
  check('test:auth no PostgreSQL', auth.code === 0);

  console.log('\n── Gravações simultâneas de vários processos ──');
  const url = await freshDatabase('concorrencia');
  // Dentro de scripts/ para achar o tsx do projeto.
  const writer = path.join(root, 'scripts', `.writer-${process.pid}.mjs`);
  fs.writeFileSync(
    writer,
    `import { tsImport } from 'tsx/esm/api';
const { getDb } = await tsImport(${JSON.stringify(pathToFileURL(path.join(root, 'server/db/connection.ts')).href)}, import.meta.url);
const { listBoards } = await tsImport(${JSON.stringify(pathToFileURL(path.join(root, 'server/services/boards.ts')).href)}, import.meta.url);
const { createItem } = await tsImport(${JSON.stringify(pathToFileURL(path.join(root, 'server/services/items.ts')).href)}, import.meta.url);
getDb();
const board = listBoards()[0];
for (let i = 0; i < 15; i++) createItem(board.id, { name: 'Paralelo ' + process.pid + ' #' + i }, { source: 'user', personId: null });
process.exit(0);
`,
  );
  const env = { TUESDAY_DATABASE_URL: url };
  try {
    // O primeiro cria o schema e o quadro de exemplo; os outros quatro gravam ao mesmo tempo.
    const first = await run(writer, env, { quiet: true });
    const results = [first, ...(await Promise.all([1, 2, 3, 4].map(() => run(writer, env, { quiet: true }))))];
    check(
      'cinco processos gravaram sem erro',
      results.every((r) => r.code === 0),
      results.map((r) => r.output.trim()).join('\n'),
    );
  } finally {
    fs.rmSync(writer, { force: true });
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const { rows } = await client.query(
    "SELECT COUNT(*)::int AS total, COUNT(DISTINCT number)::int AS distintos FROM items WHERE name LIKE 'Paralelo %'",
  );
  await client.end();
  check('75 itens criados, cada um com o seu número', rows[0].total === 75 && rows[0].distintos === 75, JSON.stringify(rows[0]));
} finally {
  for (const name of created) await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined);
}

console.log(failures ? `\n${failures} falha(s).` : '\nTudo certo no PostgreSQL.');
process.exit(failures ? 1 : 0);
