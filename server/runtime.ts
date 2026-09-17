// Como esta instalação do tuesday é executada por outros programas: o Claude Code e o Claude Desktop iniciam o
// servidor MCP (stdio), e o Claude Code roda os hooks.
//
//   código-fonte  node <pasta>/bin/tuesday-mcp.mjs            (npm install / npm start)
//   app desktop   tuesday.exe <recursos>/mcp.mjs              com ELECTRON_RUN_AS_NODE=1, sem precisar de Node
import path from 'node:path';
import { DATA_DIR, ROOT_DIR } from './db/connection';

export type Runtime = 'source' | 'desktop';

export interface Launcher {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** O app desktop (electron/main.mjs) define TUESDAY_RUNTIME=desktop e TUESDAY_APP_DIR. */
export const RUNTIME: Runtime = process.env.TUESDAY_RUNTIME === 'desktop' ? 'desktop' : 'source';

const APP_DIR = process.env.TUESDAY_APP_DIR ? path.resolve(process.env.TUESDAY_APP_DIR) : ROOT_DIR;

const forwardSlashes = (p: string) => p.replace(/\\/g, '/');

export function mcpLauncher(): Launcher {
  if (RUNTIME === 'desktop') {
    return {
      command: process.execPath,
      args: [path.join(APP_DIR, 'mcp.mjs')],
      env: { ELECTRON_RUN_AS_NODE: '1', TUESDAY_RUNTIME: 'desktop', TUESDAY_DATA_DIR: DATA_DIR },
    };
  }
  return { command: process.execPath, args: [path.join(ROOT_DIR, 'bin', 'tuesday-mcp.mjs')] };
}

/** Script do MCP desta instalação — identifica se uma configuração do Claude aponta para cá. */
export const mcpScriptPath = () => mcpLauncher().args[0];

/** Comando que o Claude Code roda nos hooks (uma linha de shell). */
export function hookCommand(event: string): string {
  if (RUNTIME === 'desktop') {
    // O .cmd liga o ELECTRON_RUN_AS_NODE antes de chamar o executável — funciona no cmd e no Git Bash.
    const wrapper = path.join(path.dirname(process.execPath), 'bin', process.platform === 'win32' ? 'tuesday-hook.cmd' : 'tuesday-hook');
    return `"${forwardSlashes(wrapper)}" ${event}`;
  }
  return `"${forwardSlashes(process.execPath)}" "${forwardSlashes(path.join(ROOT_DIR, 'bin', 'tuesday-hook.mjs'))}" ${event}`;
}
