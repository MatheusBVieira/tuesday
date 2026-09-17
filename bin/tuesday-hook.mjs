#!/usr/bin/env node
// Hooks do Claude Code — instalados por "tuesday setup --hooks".
//   tuesday-hook.mjs session-start   resumo do projeto ao abrir a sessão
//   tuesday-hook.mjs stop            lembrete para registrar o trabalho ao terminar
// Fora das pastas de projetos do tuesday sai em milissegundos, sem carregar o TypeScript (veja server/hook-entry.mjs).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHookProcess } from '../server/hook-entry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await runHookProcess(process.argv[2], root, async () => {
  const { tsImport } = await import('tsx/esm/api');
  return tsImport('../server/hooks.ts', import.meta.url);
});
