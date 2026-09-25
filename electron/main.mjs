/**
 * O processo principal do app instalado.
 *
 *   1. Guarda uma cópia do banco quando a versão do app muda (antes das migrações da versão nova).
 *   2. Sobe o servidor de sempre (o mesmo do `npm start`) dentro deste processo, em 127.0.0.1 numa porta livre.
 *      A interface continua falando HTTP com /api — nenhuma tela sabe que virou desktop.
 *   3. Abre a janela. Links para fora (sites, vscode://) abrem no programa certo, não dentro do app.
 *   4. Confere se há versão nova nos Releases do GitHub, baixa em segundo plano e instala ao fechar.
 *
 * O banco mora em %USERPROFILE%\.tuesday\tuesday.db. O Claude Code e o Claude Desktop falam com ele pelo MCP, que
 * este mesmo executável roda como Node (ELECTRON_RUN_AS_NODE) — o app não precisa estar aberto.
 *
 * Fora do AppData de propósito: o Claude Desktop é um app empacotado (MSIX), e o que ele inicia (o Claude Code, o
 * MCP, os hooks) enxerga uma cópia privada do AppData — não o mesmo arquivo que este app, aberto pelo atalho.
 */
import { app, BrowserWindow, dialog, shell } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import updater from 'electron-updater';

const here = dirname(fileURLToPath(import.meta.url));

// Uma instância só: duas subiriam dois servidores sobre o mesmo banco.
const first = app.requestSingleInstanceLock();
if (!first) app.exit(0);

/** @type {BrowserWindow | null} */
let window = null;

app.on('second-instance', () => {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});

app.on('window-all-closed', () => app.quit());

/** Uma porta livre em 127.0.0.1 — a 4010, se estiver livre. */
function freePort(preferred = 4010) {
  const tryPort = (port) =>
    new Promise((resolve, reject) => {
      const server = createServer();
      server.unref();
      server.on('error', reject);
      server.listen(port, '127.0.0.1', () => {
        const address = server.address();
        server.close(() => resolve(typeof address === 'object' && address ? address.port : port));
      });
    });
  return tryPort(preferred).catch(() => tryPort(0));
}

/** Pasta do banco — a mesma regra de desktopDataDir() em server/db/connection.ts. */
const defaultDataDir = () => (process.platform === 'win32' ? join(homedir(), '.tuesday') : app.getPath('userData'));

/** Cópia do banco antes de uma versão nova abri-lo. Ficam as cinco mais recentes, em <pasta do banco>\backups. */
function backupBeforeUpgrade(dataDir) {
  const db = join(dataDir, 'tuesday.db');
  const marker = join(dataDir, 'versao.txt');
  const current = app.getVersion();
  const previous = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : null;
  if (previous === current) return;
  if (previous && existsSync(db)) {
    const folder = join(dataDir, 'backups');
    mkdirSync(folder, { recursive: true });
    const name = `tuesday-antes-da-${current}-${Date.now()}.db`;
    // O servidor ainda não subiu: o arquivo e o WAL ao lado formam uma cópia consistente.
    for (const ext of ['', '-wal', '-shm']) if (existsSync(db + ext)) copyFileSync(db + ext, join(folder, name + ext));
    const copies = readdirSync(folder)
      .filter((f) => /^tuesday-antes-da-.*\.db$/.test(f))
      .sort((a, b) => statSync(join(folder, a)).mtimeMs - statSync(join(folder, b)).mtimeMs);
    for (const old of copies.slice(0, -5)) for (const ext of ['', '-wal', '-shm']) rmSync(join(folder, old + ext), { force: true });
  }
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(marker, current);
}

function checkForUpdates() {
  const { autoUpdater } = updater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  const check = () => autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
  setTimeout(check, 10_000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

async function start() {
  app.setAppUserModelId('dev.tuesday.app');
  // TUESDAY_DATA_DIR já definido vence (instalação portátil, testes).
  const dataDir = process.env.TUESDAY_DATA_DIR || defaultDataDir();
  const port = await freePort();

  // O servidor lê a configuração do ambiente na hora do import — por isso tudo é definido antes.
  Object.assign(process.env, {
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    TUESDAY_PORT: String(port),
    TUESDAY_RUNTIME: 'desktop',
    TUESDAY_APP_DIR: here,
    TUESDAY_DATA_DIR: dataDir,
    TUESDAY_WEB_DIR: join(here, 'web'),
    TUESDAY_VERSION: app.getVersion(),
  });
  backupBeforeUpgrade(dataDir);
  await import(pathToFileURL(join(here, 'server.mjs')).href);

  const origin = `http://127.0.0.1:${port}`;
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'tuesday',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.once('ready-to-show', () => window?.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(origin)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
  await window.loadURL(origin);

  if (app.isPackaged) checkForUpdates();
}

if (first) {
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      dialog.showErrorBox(
        'O tuesday não conseguiu abrir',
        `${error instanceof Error ? error.message : String(error)}\n\nSeus dados ficam em ${process.env.TUESDAY_DATA_DIR || defaultDataDir()} — faça uma cópia antes de apagar qualquer coisa.`,
      );
      app.exit(1);
    });
}
