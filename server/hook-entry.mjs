// Entrada dos hooks do Claude Code, comum ao código-fonte (bin/tuesday-hook.mjs) e ao app desktop (electron/hook.mjs).
//
// O Claude Code roda o hook ao fim de toda resposta, em qualquer pasta. Fora das pastas de projetos do tuesday ele
// sai em milissegundos: só lê as pastas vinculadas, sem carregar o resto do servidor. Nunca falha a sessão — erros
// vão para o stderr e o processo sai com 0.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

const caseless = process.platform === 'win32' || process.platform === 'darwin';
const comparable = (p) => {
  const resolved = path.resolve(p);
  return caseless ? resolved.toLowerCase() : resolved;
};

const within = (cwd, folders) => {
  const dir = comparable(cwd);
  return folders.some((folder) => {
    const base = comparable(folder);
    return dir === base || dir.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
  });
};

/** A mesma regra de server/db/connection.ts, sem importá-lo (ele carrega o banco inteiro). */
function sqlitePath(root) {
  if (process.env.TUESDAY_DB) return path.resolve(process.env.TUESDAY_DB);
  if (process.env.TUESDAY_DATA_DIR) return path.join(path.resolve(process.env.TUESDAY_DATA_DIR), 'tuesday.db');
  if (process.env.TUESDAY_RUNTIME === 'desktop') {
    const home = os.homedir();
    const dir =
      process.platform === 'win32'
        ? path.join(home, '.tuesday')
        : process.platform === 'darwin'
          ? path.join(home, 'Library', 'Application Support', 'tuesday')
          : path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'tuesday');
    return path.join(dir, 'tuesday.db');
  }
  return path.join(root, 'data', 'tuesday.db');
}

async function projectFolders(root) {
  const url = process.env.TUESDAY_DATABASE_URL?.trim();
  if (url) {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
    await client.connect();
    try {
      return (await client.query('SELECT folder FROM projects WHERE folder IS NOT NULL')).rows.map((r) => r.folder);
    } catch {
      return []; // banco ainda sem a tabela de projetos
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  const file = sqlitePath(root);
  if (!fs.existsSync(file)) return [];
  const Database = createRequire(import.meta.url)('better-sqlite3');
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return db
      .prepare('SELECT folder FROM projects WHERE folder IS NOT NULL')
      .all()
      .map((r) => r.folder);
  } catch {
    return []; // banco antigo, sem a tabela de projetos
  } finally {
    db.close();
  }
}

/**
 * @param {string} event session-start | stop
 * @param {string} root pasta do tuesday (para o .env e o banco padrão)
 * @param {() => Promise<{ runHook: (event: string, input: unknown) => Promise<unknown> }>} loadHooks
 */
export async function runHookProcess(event, root, loadHooks) {
  try {
    if (process.env.TUESDAY_RUNTIME !== 'desktop') {
      try {
        process.loadEnvFile(path.join(root, '.env'));
      } catch {
        /* sem .env */
      }
    }
    const raw = await readStdin();
    const input = raw.trim() ? JSON.parse(raw) : {};
    const cwd = input.cwd || process.cwd();
    if ((event === 'session-start' || event === 'stop') && within(cwd, await projectFolders(root))) {
      const { runHook } = await loadHooks();
      const output = await runHook(event, input);
      if (output) process.stdout.write(JSON.stringify(output));
    }
  } catch (error) {
    process.stderr.write(`tuesday hook: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exit(0);
}
