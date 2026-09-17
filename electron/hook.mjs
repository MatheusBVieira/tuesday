// Hooks do Claude Code no app instalado — chamado por bin/tuesday-hook.cmd com ELECTRON_RUN_AS_NODE.
// O esbuild separa o server/hooks.ts num pedaço à parte: fora das pastas de projeto ele nem é carregado.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHookProcess } from '../server/hook-entry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

await runHookProcess(process.argv[2], here, () => import('../server/hooks.ts'));
