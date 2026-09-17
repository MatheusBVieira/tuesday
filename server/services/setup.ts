// Configuração automática do MCP no Claude Code e no Claude Desktop.
import { exec, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SetupResult, SetupStatus } from '../../shared/types';
import { hookCommand as launcherHookCommand, mcpLauncher, mcpScriptPath } from '../runtime';
import { badRequest } from './common';

const MCP_NAME = 'tuesday';

export function claudeCodeConfigPath(): string {
  return process.env.TUESDAY_CLAUDE_CODE_CONFIG
    ? path.resolve(process.env.TUESDAY_CLAUDE_CODE_CONFIG)
    : path.join(os.homedir(), '.claude.json');
}

export function claudeDesktopConfigPath(): string {
  if (process.env.TUESDAY_CLAUDE_DESKTOP_CONFIG) return path.resolve(process.env.TUESDAY_CLAUDE_DESKTOP_CONFIG);
  if (process.platform === 'win32')
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'Claude', 'claude_desktop_config.json');
}

const quote = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

const mcpArgs = () => {
  const launcher = mcpLauncher();
  const env = Object.entries(launcher.env ?? {}).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  return ['mcp', 'add', MCP_NAME, '--scope', 'user', ...env, '--', launcher.command, ...launcher.args];
};

export const claudeCodeCommand = () => ['claude', ...mcpArgs()].map(quote).join(' ');

function readJson(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  if (!raw.trim()) return {};
  const data = JSON.parse(raw) as unknown;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON inesperado');
  return data as Record<string, unknown>;
}

interface ServerEntry {
  command?: string;
  args?: string[];
}

function serverEntry(file: string): ServerEntry | undefined {
  try {
    return (readJson(file)?.mcpServers as Record<string, ServerEntry> | undefined)?.[MCP_NAME];
  } catch {
    return undefined;
  }
}

/** A entrada aponta para o script desta instalação do tuesday? */
function pointsHere(entry: ServerEntry | undefined): boolean {
  const target = path.resolve(mcpScriptPath());
  const same = (a: string) =>
    process.platform === 'win32' ? path.resolve(a).toLowerCase() === target.toLowerCase() : path.resolve(a) === target;
  return !!entry?.args?.some((a) => typeof a === 'string' && same(a));
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const done = (error: Error | null, stdout: string, stderr: string) => {
      if (error) reject(new Error((stderr || stdout || error.message).trim()));
      else resolve(`${stdout}${stderr}`.trim());
    };
    const options = { timeout: 30_000, windowsHide: true, encoding: 'utf8' as const };
    // .cmd/.bat (instalação via npm no Windows) só rodam através do shell
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)) exec([file, ...args].map(quote).join(' '), options, done);
    else execFile(file, args, options, done);
  });
}

async function findClaudeCli(): Promise<string | null> {
  if (process.env.TUESDAY_CLAUDE_CLI) return process.env.TUESDAY_CLAUDE_CLI;
  try {
    const out = await run(process.platform === 'win32' ? 'where' : 'which', ['claude']);
    const lines = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return process.platform === 'win32' ? (lines.find((l) => /\.(exe|cmd|bat)$/i.test(l)) ?? lines[0] ?? null) : (lines[0] ?? null);
  } catch {
    return null;
  }
}

export async function setupStatus(): Promise<SetupStatus> {
  const code = serverEntry(claudeCodeConfigPath());
  const desktopFile = claudeDesktopConfigPath();
  const desktop = serverEntry(desktopFile);
  return {
    claudeCode: { cli: await findClaudeCli(), configured: !!code, upToDate: pointsHere(code), command: claudeCodeCommand() },
    claudeDesktop: {
      configPath: desktopFile,
      found: fs.existsSync(path.dirname(desktopFile)),
      configured: !!desktop,
      upToDate: pointsHere(desktop),
    },
    claudeHooks: claudeHooksStatus(),
    nodePath: mcpLauncher().command,
    mcpScript: mcpScriptPath(),
  };
}

// ── Hooks do Claude Code ───────────────────────────────────

export function claudeSettingsPath(): string {
  return process.env.TUESDAY_CLAUDE_SETTINGS
    ? path.resolve(process.env.TUESDAY_CLAUDE_SETTINGS)
    : path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'settings.json');
}

/** Evento do Claude Code → argumento do tuesday-hook.mjs */
const HOOK_EVENTS = { SessionStart: 'session-start', Stop: 'stop' } as const;
type HookEvent = keyof typeof HOOK_EVENTS;

interface HookEntry {
  type?: string;
  command?: string;
  [key: string]: unknown;
}

interface HookGroup {
  matcher?: string;
  hooks?: HookEntry[];
  [key: string]: unknown;
}

export const hookCommand = (event: HookEvent) => launcherHookCommand(HOOK_EVENTS[event]);
/** Hook do tuesday: da instalação pelo código (tuesday-hook.mjs) ou do app desktop (tuesday-hook.cmd). */
const isTuesdayHook = (hook: HookEntry) => typeof hook?.command === 'string' && /tuesday-hook(\.mjs|\.cmd)?["\s]/.test(hook.command);

function tuesdayHooks(settings: Record<string, unknown> | null, event: HookEvent): HookEntry[] {
  const groups = ((settings?.hooks as Record<string, HookGroup[]> | undefined)?.[event] ?? []) as HookGroup[];
  return Array.isArray(groups) ? groups.flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks.filter(isTuesdayHook) : [])) : [];
}

export function claudeHooksStatus(): SetupStatus['claudeHooks'] {
  const file = claudeSettingsPath();
  let settings: Record<string, unknown> | null = null;
  try {
    settings = readJson(file);
  } catch {
    /* JSON inválido: aparece como não configurado */
  }
  const events = Object.keys(HOOK_EVENTS) as HookEvent[];
  return {
    settingsPath: file,
    configured: events.every((e) => tuesdayHooks(settings, e).length > 0),
    upToDate: events.every((e) => tuesdayHooks(settings, e).some((h) => h.command === hookCommand(e))),
  };
}

/**
 * Instala (ou remove) os hooks do tuesday no settings.json do Claude Code, preservando os hooks que já existem.
 * Faz backup do arquivo anterior em settings.json.tuesday-backup.
 */
export function configureClaudeHooks({ dryRun = false, remove = false } = {}): SetupResult {
  const file = claudeSettingsPath();
  let data: Record<string, unknown>;
  try {
    data = readJson(file) ?? {};
  } catch {
    throw badRequest(`O arquivo ${file} não é um JSON válido. Corrija-o antes de instalar os hooks.`);
  }
  const hooks = { ...((data.hooks as Record<string, unknown> | undefined) ?? {}) } as Record<string, HookGroup[]>;
  for (const event of Object.keys(HOOK_EVENTS) as HookEvent[]) {
    const groups: HookGroup[] = [];
    for (const group of Array.isArray(hooks[event]) ? hooks[event] : []) {
      const entries = Array.isArray(group?.hooks) ? group.hooks : null;
      const kept = entries?.filter((h) => !isTuesdayHook(h));
      if (!entries || kept!.length === entries.length) groups.push(group);
      else if (kept!.length) groups.push({ ...group, hooks: kept });
    }
    if (!remove) {
      groups.push({
        hooks: [
          {
            type: 'command',
            command: hookCommand(event),
            timeout: 30,
            ...(event === 'SessionStart' ? { statusMessage: 'tuesday: lendo o quadro do projeto' } : {}),
          },
        ],
      });
    }
    if (groups.length) hooks[event] = groups;
    else delete hooks[event];
  }
  const next: Record<string, unknown> = { ...data, hooks };
  if (!Object.keys(hooks).length) delete next.hooks;

  if (dryRun) {
    return {
      ok: true,
      message: 'Simulação — nada foi alterado.',
      output: JSON.stringify({ SessionStart: hooks.SessionStart ?? [], Stop: hooks.Stop ?? [] }, null, 2),
    };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.tuesday-backup`);
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return {
    ok: true,
    message: remove
      ? 'Hooks do tuesday removidos do Claude Code.'
      : 'Hooks instalados. Nas próximas sessões do Claude Code numa pasta de projeto, ele recebe o resumo ao abrir e registra o trabalho ao terminar.',
  };
}

/** Registra (ou atualiza) o MCP no Claude Code, no escopo do usuário — vale para todas as pastas. */
export async function configureClaudeCode({ dryRun = false } = {}): Promise<SetupResult> {
  const cli = await findClaudeCli();
  if (!cli)
    throw badRequest(
      'Não encontrei o comando "claude" no PATH. Instale o Claude Code ou rode o comando manualmente: ' + claudeCodeCommand(),
    );
  if (dryRun) return { ok: true, message: 'Simulação — nada foi alterado.', output: [cli, ...mcpArgs()].map(quote).join(' ') };
  await run(cli, ['mcp', 'remove', MCP_NAME, '--scope', 'user']).catch(() => undefined);
  const output = await run(cli, mcpArgs());
  return {
    ok: true,
    message: 'Claude Code configurado. Abra uma nova sessão do Claude Code para carregar o tuesday.',
    output,
  };
}

/** Inclui o tuesday no claude_desktop_config.json (com backup do arquivo anterior). */
export function configureClaudeDesktop({ dryRun = false } = {}): SetupResult {
  const file = claudeDesktopConfigPath();
  if (!fs.existsSync(path.dirname(file)))
    throw badRequest(`Não encontrei o Claude Desktop (${path.dirname(file)} não existe). Abra o Claude Desktop uma vez e tente de novo.`);
  let data: Record<string, unknown>;
  try {
    data = readJson(file) ?? {};
  } catch {
    throw badRequest(`O arquivo ${file} não é um JSON válido. Corrija-o antes de configurar.`);
  }
  const servers = (data.mcpServers && typeof data.mcpServers === 'object' ? data.mcpServers : {}) as Record<string, unknown>;
  const next = { ...data, mcpServers: { ...servers, [MCP_NAME]: mcpLauncher() } };
  if (dryRun) return { ok: true, message: 'Simulação — nada foi alterado.', output: JSON.stringify(next.mcpServers[MCP_NAME]) };
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.tuesday-backup`);
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return { ok: true, message: 'Claude Desktop configurado. Feche e abra o Claude Desktop para carregar o tuesday.' };
}
