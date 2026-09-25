import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Dialect, Driver } from './driver';
import { migrate } from './migrations';
import { PostgresDriver, describeUrl, listenForChanges } from './postgres';
import { SqliteDriver, copySqliteFile } from './sqlite';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Configuração por .env na pasta do tuesday (útil ao rodar como servidor sem Docker). Variáveis já definidas vencem.
try {
  process.loadEnvFile(path.join(ROOT_DIR, '.env'));
} catch {
  /* sem .env */
}

/** PostgreSQL quando TUESDAY_DATABASE_URL está definido; senão, o arquivo SQLite local. */
const DATABASE_URL = process.env.TUESDAY_DATABASE_URL?.trim() || null;

export const DB_DIALECT: Dialect = DATABASE_URL ? 'postgres' : 'sqlite';

/**
 * Pasta de dados do app instalado. No Windows fica fora do AppData: o Claude Desktop é um app empacotado (MSIX), e
 * tudo o que ele inicia — o Claude Code, o MCP e os hooks do tuesday — enxerga uma cópia privada do AppData. Com o
 * banco lá, o app aberto pelo atalho e o MCP usariam arquivos diferentes (e o SQLite chegaria a misturar os dois).
 * Mesma regra em electron/main.mjs e server/hook-entry.mjs.
 */
export function desktopDataDir(): string {
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(home, '.tuesday');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'tuesday');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'tuesday');
}

/** Onde a 1.0.0 guardava o banco no Windows. */
const legacyDesktopDb = () => path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'tuesday', 'tuesday.db');

const samePath = (a: string, b: string) =>
  process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

/**
 * TUESDAY_DATA_DIR, se definido. O MCP configurado pela 1.0.0 passa a pasta antiga (%APPDATA%\tuesday): ela vale como
 * a nova, senão o Claude seguiria num banco e o app em outro até alguém refazer a configuração.
 */
function dataDirFromEnv(): string | null {
  const value = process.env.TUESDAY_DATA_DIR?.trim();
  if (!value) return null;
  const legacy =
    process.platform === 'win32' && process.env.TUESDAY_RUNTIME === 'desktop' && samePath(value, path.dirname(legacyDesktopDb()));
  return legacy ? desktopDataDir() : path.resolve(value);
}

/** Pasta de dados: o arquivo SQLite e o estado dos hooks do Claude Code. */
export const DATA_DIR =
  dataDirFromEnv() ??
  (process.env.TUESDAY_DB
    ? path.dirname(path.resolve(process.env.TUESDAY_DB))
    : process.env.TUESDAY_RUNTIME === 'desktop'
      ? desktopDataDir()
      : path.join(ROOT_DIR, 'data'));

export const DB_PATH = process.env.TUESDAY_DB ? path.resolve(process.env.TUESDAY_DB) : path.join(DATA_DIR, 'tuesday.db');

/** Onde estão os dados, para mostrar (sem senha). */
export const DB_LABEL = DATABASE_URL ? describeUrl(DATABASE_URL) : DB_PATH;

let instance: Driver | null = null;

/**
 * Vindo da 1.0.0: na primeira vez que o app instalado abre sem banco na pasta nova, traz uma cópia do banco de
 * %APPDATA%\tuesday. O arquivo antigo fica onde estava.
 */
function adoptLegacyDesktopDb(): void {
  if (process.platform !== 'win32' || process.env.TUESDAY_RUNTIME !== 'desktop') return;
  if (!samePath(DB_PATH, path.join(desktopDataDir(), 'tuesday.db')) || fs.existsSync(DB_PATH)) return;
  const legacy = legacyDesktopDb();
  if (!fs.existsSync(legacy)) return;
  try {
    copySqliteFile(legacy, DB_PATH);
  } catch (error) {
    // Outro processo (o app e o MCP abrindo juntos) pode ter feito a cópia primeiro.
    if (!fs.existsSync(DB_PATH)) throw error;
  }
}

/**
 * Conexão única por processo. Com SQLite, o servidor web e o MCP (stdio) abrem o mesmo arquivo (WAL); com
 * PostgreSQL, cada processo tem a sua conexão.
 */
export function getDb(): Driver {
  if (instance) return instance;
  if (!DATABASE_URL) adoptLegacyDesktopDb();
  const driver = DATABASE_URL ? new PostgresDriver(DATABASE_URL) : new SqliteDriver(DB_PATH);
  try {
    migrate(driver);
  } catch (error) {
    driver.close();
    throw error;
  }
  instance = driver;
  return driver;
}

/** Executa `fn` numa transação de escrita. Chamadas aninhadas viram savepoints. */
export function tx<T>(fn: () => T): T {
  return getDb().transaction(fn);
}

/** Chama `onChange` quando outro processo grava no banco (ex.: o Claude pelo MCP via stdio). */
export function watchExternalChanges(onChange: () => void): void {
  const db = getDb();
  if (db instanceof SqliteDriver) {
    let last = db.dataVersion();
    setInterval(() => {
      try {
        const current = db.dataVersion();
        if (current !== last) {
          last = current;
          onChange();
        }
      } catch {
        /* banco ocupado — tenta de novo no próximo ciclo */
      }
    }, 700).unref();
  } else if (DATABASE_URL) {
    void listenForChanges(DATABASE_URL, onChange);
  }
}
