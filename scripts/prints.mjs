/**
 * Os prints do README — sempre com dados de mentira.
 *   npm run prints
 *
 * Gera a demonstração (scripts/demo-data.ts), sobe o servidor sobre ela, abre as telas num Chromium de 1440×900
 * e grava em docs/prints/. O seu banco não é tocado: tudo acontece em data/demo/.
 */
import { execSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { demoEnv, generateDemo } from './demo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4077;
const BASE = `http://127.0.0.1:${PORT}`;
const out = path.join(root, 'docs', 'prints');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

mkdirSync(out, { recursive: true });
generateDemo();
execSync('npx vite build', { cwd: root, stdio: 'inherit' });

const server = spawn(process.execPath, [path.join(root, 'bin', 'tuesday.mjs'), 'start'], {
  cwd: root,
  env: { ...demoEnv(), TUESDAY_PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: 'ignore',
});

const api = async (url) => (await fetch(`${BASE}/api${url}`)).json();

try {
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    try {
      ready = (await fetch(`${BASE}/api/health`)).ok;
    } catch {
      await wait(400);
    }
  }
  if (!ready) throw new Error('o servidor da demonstração não subiu');

  const boot = await api('/bootstrap');
  const aurora = boot.projects.find((p) => p.name === 'Aurora');
  const boardId = boot.boards.find((b) => b.projectId === aurora.id).id;
  const board = await api(`/boards/${boardId}`);
  const pix = board.items.find((i) => i.name === 'Checkout com Pix');

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'pt-BR' });
  await context.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      /* sem armazenamento */
    }
  });
  const page = await context.newPage();

  const open = async (url) => {
    await page.goto(BASE + url, { waitUntil: 'load' });
    await page.addStyleTag({
      content: '*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }',
    });
    await page.waitForSelector('.row, .kcard, .my-work', { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await wait(700);
  };
  // Os caminhos desta máquina não aparecem nos prints.
  const masks = [
    [path.join(root, 'data', 'demo', 'aurora'), String.raw`C:\Users\voce\projetos\aurora`],
    [root, String.raw`C:\Users\voce\tuesday`],
    [String.raw`…\demo\aurora`, String.raw`…\projetos\aurora`],
  ].flatMap(([from, to]) => [
    [from, to],
    [from.replaceAll('\\', '/'), to.replaceAll('\\', '/')],
  ]);
  const shot = async (name) => {
    await page.evaluate((pairs) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        let text = node.nodeValue ?? '';
        for (const [from, to] of pairs) text = text.split(from).join(to);
        if (text !== node.nodeValue) node.nodeValue = text;
      }
    }, masks);
    await page.mouse.move(1430, 890);
    await wait(300);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    console.log(`  docs/prints/${name}.png`);
  };

  await open(`/boards/${boardId}`);
  await shot('tabela');

  await open(`/boards/${boardId}/kanban`);
  await shot('kanban');

  await open(`/boards/${boardId}?item=${pix.id}`);
  await page.getByRole('tab', { name: /Subitens/ }).click();
  await wait(500);
  await shot('subitens');

  await page.getByRole('tab', { name: /Commits/ }).click();
  await page.waitForSelector('.commit-row');
  await wait(400);
  await shot('commits');

  await open('/my-work');
  await shot('meu-trabalho');

  await open(`/boards/${boardId}`);
  await page.getByRole('button', { name: 'Mais opções de criação' }).click();
  await page.getByText('Importar TODOs do código').click();
  await page.waitForSelector('.todo-row');
  await page.locator('.todo-known').click();
  await wait(500);
  await shot('todos');
  await page.keyboard.press('Escape');

  await open(`/boards/${boardId}`);
  await page.getByRole('button', { name: 'Claude', exact: true }).click();
  await page.waitForSelector('.setup-badge.is-ok');
  await wait(500);
  await shot('claude');

  await browser.close();
} finally {
  server.kill();
}
