// CLI no app instalado — bin\tuesday.cmd (tuesday init, brief, note, steps, check, todos, status…).
import { runCli } from '../server/cli.ts';

const [command = 'help', ...args] = process.argv.slice(2);
if (command === 'mcp') {
  await import('../server/mcp/stdio.ts');
} else {
  process.exitCode = await runCli(command, args);
}
