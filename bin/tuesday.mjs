#!/usr/bin/env node
// CLI do tuesday — "tuesday help" lista os comandos.
// Para usar de qualquer pasta: rode "npm link" uma vez dentro da pasta do tuesday.
import { tsImport } from 'tsx/esm/api';

const [command = 'start', ...args] = process.argv.slice(2);

if (command === 'start' || command === 'serve') {
  await tsImport('../server/index.ts', import.meta.url);
} else if (command === 'mcp') {
  await tsImport('../server/mcp/stdio.ts', import.meta.url);
} else {
  const { runCli } = await tsImport('../server/cli.ts', import.meta.url);
  process.exitCode = await runCli(command, args);
}
