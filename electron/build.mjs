/**
 * Monta a pasta que vira o instalador: electron/app.
 *
 * O instalador nunca vê a pasta do projeto. Ele recebe só isto:
 *
 *   main.mjs      o processo principal do Electron
 *   server.mjs    o servidor (interface + API + MCP via HTTP)
 *   mcp.mjs       o MCP via stdio, que o Claude Code e o Claude Desktop iniciam
 *   hook.mjs      os hooks do Claude Code (o resto do servidor fica num pedaço carregado só quando precisa)
 *   cli.mjs       a CLI (bin\tuesday.cmd)
 *   chunks/       código compartilhado entre os quatro
 *   web/          a interface, saída do `vite build`
 *   package.json  com as dependências que o código importa de verdade
 *   node_modules/ só essas dependências — o better-sqlite3 é recompilado para o Electron pelo electron-builder
 *
 * A pasta data/ com o seu banco, o .env e os scripts ficam de fora por construção: nada entra sem estar nesta lista.
 */
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = resolve(here, 'app');

const step = (text) => console.log(`\n▸ ${text}`);

step('Limpando electron/app');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

step('Interface: vite build');
execSync('npx vite build', { cwd: root, stdio: 'inherit' });
cpSync(resolve(root, 'dist'), resolve(out, 'web'), { recursive: true });

step('Servidor, MCP, hooks e CLI');
const result = await build({
  entryPoints: {
    server: resolve(root, 'server/index.ts'),
    mcp: resolve(root, 'server/mcp/stdio.ts'),
    hook: resolve(here, 'hook.mjs'),
    cli: resolve(here, 'cli.mjs'),
  },
  outdir: out,
  outExtension: { '.js': '.mjs' },
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true,
  splitting: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  legalComments: 'none',
  // Pacotes ficam em node_modules: empacotar CommonJS dentro de ESM quebra require dinâmico.
  packages: 'external',
  // Várias partes do código usam require (better-sqlite3 no atalho dos hooks).
  banner: { js: "import { createRequire as __tuesdayRequire } from 'node:module'; const require = __tuesdayRequire(import.meta.url);" },
  metafile: true,
  logLevel: 'warning',
});

// O app desktop usa SQLite: o driver do PostgreSQL (pg) fica de fora.
const DESKTOP_ONLY_SKIP = new Set(['pg']);
const imported = new Set(['electron-updater']);
for (const output of Object.values(result.metafile.outputs)) {
  for (const imp of output.imports) {
    if (!imp.external || isBuiltin(imp.path)) continue;
    const parts = imp.path.split('/');
    const name = imp.path.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
    if (!DESKTOP_ONLY_SKIP.has(name)) imported.add(name);
  }
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const dependencies = {};
for (const name of [...imported].sort()) {
  const version = pkg.dependencies?.[name];
  if (!version) throw new Error(`O app importa "${name}", mas ele não está em dependencies do package.json.`);
  dependencies[name] = version;
}
console.log('  dependências do app:', Object.keys(dependencies).join(', '));

cpSync(resolve(here, 'main.mjs'), resolve(out, 'main.mjs'));
writeFileSync(
  resolve(out, 'package.json'),
  JSON.stringify(
    {
      name: 'tuesday',
      productName: 'tuesday',
      version: pkg.version,
      description: pkg.description,
      author: pkg.author,
      license: pkg.license,
      private: true,
      type: 'module',
      main: 'main.mjs',
      dependencies,
    },
    null,
    2,
  ),
);

step('Instalando as dependências do app');
execSync('npm install --omit=dev --no-audit --no-fund --loglevel=error', {
  cwd: out,
  stdio: 'inherit',
  // O better-sqlite3 vai ser recompilado para o Electron pelo electron-builder.
  env: { ...process.env, npm_config_ignore_scripts: 'true' },
});

console.log('\n✓ electron/app pronto.');
