// Descobre em qual projeto do tuesday o Claude está trabalhando.
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { fileURLToPath } from 'node:url';
import type { Project } from '../../shared/types';
import { findProjectByFolder, getProject, resolveProject } from '../services/projects';

export interface Scope {
  project: Project | null;
  /** como o projeto foi escolhido */
  source: 'sessão' | 'configuração' | 'pasta' | null;
  /** pastas de trabalho conhecidas (roots do cliente, variáveis de ambiente, cwd) */
  dirs: string[];
}

interface ScopeOptions {
  /** usar a pasta do processo (stdio: é a pasta onde o Claude Code foi aberto) */
  useProcessDirs: boolean;
  /** projeto fixo (ex.: ?project= na URL do MCP via HTTP) */
  fixedProject: string | null;
}

/**
 * Ordem: projeto escolhido na sessão (use_project) → TUESDAY_PROJECT / ?project= →
 * roots informados pelo cliente MCP → TUESDAY_PROJECT_DIR / CLAUDE_PROJECT_DIR / cwd.
 */
export class ScopeResolver {
  private override: number | null = null;
  private roots: string[] = [];
  private rootsLoaded = false;
  private readonly getServer: () => Server | undefined;
  private readonly options: ScopeOptions;

  constructor(getServer: () => Server | undefined, options: ScopeOptions) {
    this.getServer = getServer;
    this.options = options;
  }

  use(projectId: number | null): void {
    this.override = projectId;
  }

  private processDirs(): string[] {
    if (!this.options.useProcessDirs) return [];
    const dirs = [process.env.TUESDAY_PROJECT_DIR, process.env.CLAUDE_PROJECT_DIR, process.cwd()];
    return [...new Set(dirs.filter((d): d is string => !!d?.trim()))];
  }

  private fixed(): Project | null {
    if (this.override != null) {
      const project = getProject(this.override);
      if (project) return project;
    }
    const ref = this.options.fixedProject ?? process.env.TUESDAY_PROJECT;
    if (!ref?.trim()) return null;
    try {
      return resolveProject(ref);
    } catch {
      return null;
    }
  }

  private async clientRoots(): Promise<string[]> {
    if (this.rootsLoaded) return this.roots;
    this.rootsLoaded = true;
    const server = this.getServer();
    try {
      if (!server?.getClientCapabilities()?.roots) return this.roots;
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500));
      const result = await Promise.race([server.listRoots(), timeout]);
      this.roots = result.roots.filter((r) => r.uri.startsWith('file:')).map((r) => fileURLToPath(r.uri));
    } catch {
      this.roots = [];
    }
    return this.roots;
  }

  private byFolder(dirs: string[]): Scope {
    for (const dir of dirs) {
      const project = findProjectByFolder(dir);
      if (project) return { project, source: 'pasta', dirs };
    }
    return { project: null, source: null, dirs };
  }

  /** Versão síncrona (sem roots) — usada nas instruções do servidor. */
  guess(): Scope {
    const fixed = this.fixed();
    if (fixed) return { project: fixed, source: this.override != null ? 'sessão' : 'configuração', dirs: this.processDirs() };
    return this.byFolder(this.processDirs());
  }

  async resolve(): Promise<Scope> {
    const fixed = this.fixed();
    const dirs = [...(await this.clientRoots()), ...this.processDirs()];
    if (fixed) return { project: fixed, source: this.override != null ? 'sessão' : 'configuração', dirs };
    return this.byFolder(dirs);
  }
}
