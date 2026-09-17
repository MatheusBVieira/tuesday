// Demonstração com dados fictícios (os mesmos dos prints do README).
//   npm run demo             gera data/demo/ e abre o tuesday sobre ela (http://localhost:5173)
//   node scripts/demo.mjs --gerar   só gera
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEMO_DIR = path.join(root, 'data', 'demo');

/** Ambiente que aponta o tuesday para a demonstração — o seu banco em data/tuesday.db não é tocado. */
export const demoEnv = () => ({
  ...process.env,
  TUESDAY_DATA_DIR: DEMO_DIR,
  TUESDAY_NO_SEED: '1',
  TUESDAY_DATABASE_URL: '',
  TUESDAY_DB: '',
  TUESDAY_PASSWORD: '',
  TUESDAY_CLAUDE_CLI: path.join(DEMO_DIR, 'claude', 'claude.exe'),
  TUESDAY_CLAUDE_CODE_CONFIG: path.join(DEMO_DIR, 'claude', 'claude.json'),
  TUESDAY_CLAUDE_DESKTOP_CONFIG: path.join(DEMO_DIR, 'claude', 'desktop', 'claude_desktop_config.json'),
  TUESDAY_CLAUDE_SETTINGS: path.join(DEMO_DIR, 'claude', 'settings.json'),
});

export function generateDemo() {
  fs.rmSync(DEMO_DIR, { recursive: true, force: true });
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  execFileSync(process.execPath, ['--import', 'tsx', path.join(root, 'scripts', 'demo-data.ts')], {
    cwd: root,
    env: demoEnv(),
    stdio: 'inherit',
  });
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')}`) {
  generateDemo();
  if (!process.argv.includes('--gerar')) {
    const dev = spawn('npm', ['run', 'dev'], { cwd: root, env: demoEnv(), stdio: 'inherit', shell: true });
    dev.on('exit', (code) => process.exit(code ?? 0));
  }
}
