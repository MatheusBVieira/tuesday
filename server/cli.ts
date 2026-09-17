// Comandos de terminal do tuesday (bin/tuesday.mjs).
import path from 'node:path';
import { idPrefixFor } from '../shared/templates';
import { clampIdPad, fold, formatItemRef, primaryStatusColumn, sanitizeIdPrefix } from '../shared/values';
import { DB_LABEL, getDb } from './db/connection';
import { runHook } from './hooks';
import type { Subitem } from '../shared/types';
import { splitSteps, subitemProgress } from '../shared/subitems';
import { TODO_TAGS, type TodoTag } from '../shared/codetodos';
import { tx, type Actor } from './services/common';
import { getBoard, listBoards } from './services/boards';
import { addSubitems, listSubitems, resolveSubitem, updateSubitem } from './services/subitems';
import { refFormatter, resolveItem, setItemValues } from './services/items';
import { importCodeTodos, scanCodeTodos } from './services/codetodos';
import { listGroups } from './services/groups';
import { getClaudeId, getMeId } from './services/people';
import { createProject, findProjectByFolder, listProjects, normalizeFolder, sameFolder } from './services/projects';
import { claudeSettingsPath, configureClaudeCode, configureClaudeDesktop, configureClaudeHooks, setupStatus } from './services/setup';
import { createUpdate } from './services/updates';
import { syncProjectGit } from './services/git';

const HELP = `
tuesday — gestão de tarefas local, com MCP para o Claude

Uso:
  tuesday [start]         inicia o servidor (http://localhost:4010)
  tuesday init [nome]     vincula a pasta atual a um projeto (cria o projeto e o quadro "Tarefas")
                            --prefix TM  --digits 2  --start 38   referências TM-38, TM-39…
  tuesday setup           configura o MCP no Claude Code   (--desktop: também no Claude Desktop)
  tuesday setup --hooks   instala os hooks no Claude Code: resumo ao abrir, registro ao terminar (--remove desfaz)
  tuesday status          mostra o banco, os projetos e a configuração do MCP
  tuesday brief           resumo do projeto desta pasta (o que o Claude recebe ao abrir uma sessão)
  tuesday note <ref> …    posta uma atualização e/ou muda o status de um item
                            tuesday note TM-07 --status "Aguardando teste" "o que foi feito"   (--claude: assina como Claude)
  tuesday steps <ref>     lista os subitens (checklist) de um item
                            tuesday steps TM-07 --add "Criar a migração" "Tela de edição"   adiciona passos
  tuesday check <ref> …   marca subitens como feitos, pelo número ou pelo texto (--undo reabre)
                            tuesday check TM-07 1 "Tela de edição"
  tuesday todos           lista TODO/FIXME/HACK/XXX do código desta pasta e diz quais já são itens
                            tuesday todos --import [--tag FIXME] [--group Backlog]   cria os itens (link abre no VS Code)
  tuesday git sync        liga agora os commits desta pasta aos itens (com o app aberto é automático)
  tuesday mcp             servidor MCP via stdio (é o que o Claude executa)

Opções:
  --dry-run               mostra o que seria feito, sem alterar nada
`;

const ok = (text: string) => console.log(`  ✔ ${text}`);
const fail = (text: string) => console.log(`  ✘ ${text}`);
const note = (text: string) => console.log(`    ${text}`);

const cliActor = (): Actor => ({ source: 'user', personId: getMeId(), clientId: null });
/** --claude: a alteração fica registrada como feita pelo Claude */
const actorFor = (flags: Record<string, string | true>): Actor =>
  flags.claude ? { source: 'claude', personId: getClaudeId(), clientId: null } : cliActor();

const VALUE_FLAGS = new Set(['prefix', 'digits', 'start', 'status', 'tag', 'group']);

/** "init App --prefix TM --digits=2" → { positional: ["App"], flags: { prefix: "TM", digits: "2" } } */
function parseArgs(args: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split('=', 2);
    if (inline !== undefined) flags[key] = inline;
    else if (VALUE_FLAGS.has(key) && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) flags[key] = args[++i];
    else flags[key] = true;
  }
  return { positional, flags };
}

function numberFlag(flags: Record<string, string | true>, key: string): number | undefined {
  const raw = flags[key];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (raw === true || !Number.isInteger(n) || n < 1) throw new Error(`--${key} precisa de um número inteiro positivo.`);
  return n;
}

async function nextStep(): Promise<void> {
  const status = await setupStatus();
  if (!status.claudeCode.configured) note('Falta conectar o Claude Code: rode "tuesday setup" (ou use o botão "Claude" no app).');
  else note('Abra o Claude Code nesta pasta e peça, por exemplo: "quais são as minhas tarefas?"');
}

async function init(args: string[]): Promise<number> {
  getDb();
  const { positional, flags } = parseArgs(args);
  const folder = normalizeFolder(process.cwd());
  const name = positional[0]?.trim() || path.basename(folder);
  let idFormat: { idPrefix?: string; idPad?: number; idStart?: number };
  try {
    idFormat = {
      idPrefix: typeof flags.prefix === 'string' ? sanitizeIdPrefix(flags.prefix) || undefined : undefined,
      idPad: numberFlag(flags, 'digits'),
      idStart: numberFlag(flags, 'start'),
    };
  } catch (error) {
    fail((error as Error).message);
    return 1;
  }
  const settings = { prefix: idFormat.idPrefix ?? idPrefixFor(name), pad: clampIdPad(idFormat.idPad ?? 3) };
  const firstRef = formatItemRef(settings, idFormat.idStart ?? 1);
  const linked = findProjectByFolder(folder);
  if (linked?.folder && sameFolder(linked.folder, folder)) {
    ok(`Esta pasta já está vinculada ao projeto "${linked.name}".`);
    await nextStep();
    return 0;
  }
  if (flags['dry-run']) {
    ok(`Simulação: criaria o projeto "${name}" vinculado a ${folder}, com itens a partir de ${firstRef}.`);
    return 0;
  }
  const { project, boardId } = createProject({ name, folder, template: 'software', ...idFormat, idPad: settings.pad }, cliActor());
  ok(`Projeto "${project.name}" criado e vinculado a ${folder}`);
  if (boardId) ok(`Quadro "Tarefas" criado — o primeiro item será ${firstRef}`);
  if (linked) note(`A pasta acima já pertence ao projeto "${linked.name}"; esta subpasta passa a usar "${project.name}".`);
  await nextStep();
  return 0;
}

async function setup(args: string[]): Promise<number> {
  const dryRun = args.includes('--dry-run');
  if (args.includes('--hooks')) {
    try {
      const result = configureClaudeHooks({ dryRun, remove: args.includes('--remove') });
      ok(`Hooks do Claude Code: ${result.message}`);
      if (result.output) note(result.output);
      if (!dryRun) note(`Arquivo: ${claudeSettingsPath()} (backup em settings.json.tuesday-backup)`);
      return 0;
    } catch (error) {
      fail(`Hooks do Claude Code: ${(error as Error).message}`);
      return 1;
    }
  }
  let code = 0;
  try {
    const result = await configureClaudeCode({ dryRun });
    ok(`Claude Code: ${result.message}`);
    if (dryRun && result.output) note(result.output);
  } catch (error) {
    fail(`Claude Code: ${(error as Error).message}`);
    code = 1;
  }
  if (args.includes('--desktop')) {
    try {
      const result = configureClaudeDesktop({ dryRun });
      ok(`Claude Desktop: ${result.message}`);
      if (dryRun && result.output) note(result.output);
    } catch (error) {
      fail(`Claude Desktop: ${(error as Error).message}`);
      code = 1;
    }
  }
  return code;
}

async function status(): Promise<number> {
  getDb();
  console.log(`\n  Banco: ${DB_LABEL}\n`);
  const boards = listBoards();
  for (const project of listProjects()) {
    const count = boards.filter((b) => b.projectId === project.id).length;
    console.log(
      `  • ${project.name}  (${count} ${count === 1 ? 'quadro' : 'quadros'})${project.folder ? `\n      ${project.folder}` : ''}`,
    );
  }
  const s = await setupStatus();
  console.log('');
  if (s.claudeCode.configured)
    (s.claudeCode.upToDate ? ok : fail)(
      `Claude Code: configurado${s.claudeCode.upToDate ? '' : ' (aponta para outra pasta — rode "tuesday setup")'}`,
    );
  else fail(`Claude Code: não configurado${s.claudeCode.cli ? ' — rode "tuesday setup"' : ' (comando "claude" não encontrado)'}`);
  if (s.claudeDesktop.configured) ok('Claude Desktop: configurado');
  else note(`Claude Desktop: não configurado${s.claudeDesktop.found ? ' — rode "tuesday setup --desktop"' : ' (não instalado)'}`);
  if (s.claudeHooks.configured)
    (s.claudeHooks.upToDate ? ok : fail)(
      `Hooks do Claude Code: instalados${s.claudeHooks.upToDate ? '' : ' (apontam para outra pasta — rode "tuesday setup --hooks")'}`,
    );
  else note('Hooks do Claude Code: não instalados — rode "tuesday setup --hooks"');
  const here = findProjectByFolder(process.cwd());
  console.log('');
  note(here ? `Pasta atual → projeto "${here.name}"` : 'Pasta atual não está vinculada a nenhum projeto ("tuesday init" vincula).');
  console.log('');
  return 0;
}

async function gitCommand(args: string[]): Promise<number> {
  if ((args[0] ?? 'sync') !== 'sync') {
    console.log('Uso: tuesday git sync');
    return 1;
  }
  getDb();
  const project = findProjectByFolder(process.cwd());
  if (!project) {
    fail('Esta pasta não está vinculada a nenhum projeto — rode "tuesday init" primeiro.');
    return 1;
  }
  const result = await syncProjectGit(project.id, { force: true });
  (result.ok ? ok : fail)(`${project.name}: ${result.message}`);
  return result.ok ? 0 : 1;
}

async function brief(): Promise<number> {
  getDb();
  const output = await runHook('session-start', { cwd: process.cwd() });
  if (!output || !('hookSpecificOutput' in output)) {
    fail('Esta pasta não está vinculada a nenhum projeto — rode "tuesday init" primeiro.');
    return 1;
  }
  console.log(`\n${output.hookSpecificOutput.additionalContext}\n`);
  return 0;
}

/** tuesday note TM-07 [--status "Etiqueta"] [--claude] "texto da atualização" */
async function noteCommand(args: string[]): Promise<number> {
  getDb();
  const { positional, flags } = parseArgs(args);
  const [ref, ...words] = positional;
  const text = words.join(' ').trim();
  const status = typeof flags.status === 'string' ? flags.status.trim() : '';
  if (!ref || (!text && !status)) {
    console.log('Uso: tuesday note <referência> [--status "Etiqueta"] [--claude] "texto da atualização"');
    return 1;
  }
  const actor = actorFor(flags);
  try {
    const row = resolveItem(ref, { projectId: findProjectByFolder(process.cwd())?.id });
    if (text) createUpdate(row.id, text, actor);
    let statusName: string | null = null;
    if (status) {
      const board = getBoard(row.board_id);
      const column = primaryStatusColumn(board.columns, board.settings.kanban?.laneColumnId);
      if (!column) throw new Error('O quadro deste item não tem coluna de status.');
      const labels = column.settings.labels ?? [];
      const key = fold(status);
      const prefixed = labels.filter((l) => fold(l.name).startsWith(key));
      const label = labels.find((l) => fold(l.name) === key) ?? (prefixed.length === 1 ? prefixed[0] : undefined);
      if (!label) throw new Error(`A etiqueta "${status}" não existe. Opções: ${labels.map((l) => l.name).join(', ')}.`);
      setItemValues(row.id, { [String(column.id)]: label.id }, actor);
      statusName = label.name;
    }
    ok(
      `${ref.toUpperCase()} "${row.name}"${text ? ': atualização postada' : ''}${statusName ? `${text ? ' e' : ':'} status → ${statusName}` : ''}.`,
    );
    return 0;
  } catch (error) {
    fail((error as Error).message);
    return 1;
  }
}

function printChecklist(ref: string, name: string, subitems: Subitem[]): void {
  const { done, total } = subitemProgress(subitems);
  console.log(`\n  ${ref.toUpperCase()} "${name}" — ${total ? `${done}/${total} subitens feitos` : 'sem subitens'}`);
  subitems.forEach((s, i) => console.log(`    ${String(i + 1).padStart(2)}. [${s.done ? 'x' : ' '}] ${s.name}`));
  console.log('');
}

/** tuesday steps TM-07 [--add "Passo 1" "Passo 2"] [--claude] */
async function stepsCommand(args: string[]): Promise<number> {
  getDb();
  const { positional, flags } = parseArgs(args);
  const [ref, ...texts] = positional;
  if (!ref || (texts.length && !flags.add)) {
    console.log('Uso: tuesday steps <referência> [--add "passo" "outro passo"] [--claude]');
    return 1;
  }
  try {
    const row = resolveItem(ref, { projectId: findProjectByFolder(process.cwd())?.id });
    if (flags.add) {
      const steps = texts.flatMap((text) => splitSteps(text));
      if (!steps.length) throw new Error(`Informe os passos: tuesday steps ${ref} --add "Passo 1" "Passo 2"`);
      addSubitems(row.id, steps, {}, actorFor(flags));
      ok(`${steps.length === 1 ? '1 subitem adicionado' : `${steps.length} subitens adicionados`} em ${ref.toUpperCase()}.`);
    }
    printChecklist(ref, row.name, listSubitems(row.id));
    return 0;
  } catch (error) {
    fail((error as Error).message);
    return 1;
  }
}

/** tuesday check TM-07 2 "Tela de edição" [--undo] [--claude] */
async function checkCommand(args: string[]): Promise<number> {
  getDb();
  const { positional, flags } = parseArgs(args);
  const [ref, ...targets] = positional;
  if (!ref || !targets.length) {
    console.log('Uso: tuesday check <referência> <número ou texto do subitem>… [--undo] [--claude]');
    return 1;
  }
  const done = !flags.undo;
  try {
    const row = resolveItem(ref, { projectId: findProjectByFolder(process.cwd())?.id });
    const current = listSubitems(row.id);
    const chosen = targets.map((target) => resolveSubitem(current, /^\d+$/.test(target.trim()) ? `#${target.trim()}` : target));
    const actor = actorFor(flags);
    tx(() => chosen.forEach((subitem) => updateSubitem(subitem.id, { done }, actor)));
    ok(
      `${chosen.map((s) => `"${s.name}"`).join(', ')} ${done ? (chosen.length === 1 ? 'marcado como feito' : 'marcados como feitos') : chosen.length === 1 ? 'reaberto' : 'reabertos'}.`,
    );
    printChecklist(ref, row.name, listSubitems(row.id));
    return 0;
  } catch (error) {
    fail((error as Error).message);
    return 1;
  }
}

/** tuesday todos [--import] [--tag FIXME] [--group Backlog] [--complete-removed] */
async function todosCommand(args: string[]): Promise<number> {
  getDb();
  const { flags } = parseArgs(args);
  const project = findProjectByFolder(process.cwd());
  if (!project) {
    fail('Esta pasta não está vinculada a nenhum projeto — rode "tuesday init" primeiro.');
    return 1;
  }
  const tags = typeof flags.tag === 'string' ? flags.tag.split(',').map((t) => t.trim().toUpperCase()) : undefined;
  const invalid = tags?.filter((t) => !(TODO_TAGS as readonly string[]).includes(t));
  if (invalid?.length) {
    fail(`Marcação desconhecida: ${invalid.join(', ')}. Use ${TODO_TAGS.join(', ')}.`);
    return 1;
  }
  try {
    if (!flags.import) {
      const scan = await scanCodeTodos(project.id);
      const shown = scan.todos.filter((t) => !tags || tags.includes(t.tag));
      console.log(`\n  ${project.name}: ${shown.length} ${shown.length === 1 ? 'marcação' : 'marcações'} em ${scan.folder}\n`);
      for (const todo of shown) {
        const status = todo.status === 'new' ? 'nova ' : (todo.item?.ref ?? `#${todo.item?.id}`).padEnd(5);
        console.log(`  ${status}  ${todo.tag.padEnd(5)}  ${todo.path}:${todo.line}  ${todo.name}`);
      }
      for (const removed of scan.removed)
        note(`${removed.item.ref ?? `#${removed.item.id}`} saiu do código (${removed.path}:${removed.line}) — --complete-removed conclui`);
      for (const error of scan.errors) fail(error);
      const fresh = shown.filter((t) => t.status === 'new').length;
      console.log(
        fresh
          ? `\n  ${fresh} ${fresh === 1 ? 'nova' : 'novas'} — "tuesday todos --import" cria os itens.\n`
          : '\n  Nada novo para importar.\n',
      );
      return 0;
    }
    const boards = listBoards().filter((b) => b.projectId === project.id);
    const board = boards[0];
    const group =
      typeof flags.group === 'string' && board ? listGroups(board.id).find((g) => fold(g.name) === fold(String(flags.group))) : undefined;
    if (typeof flags.group === 'string' && !group)
      throw new Error(`Grupo "${flags.group}" não encontrado no quadro "${board?.name ?? '?'}".`);
    const result = await importCodeTodos(
      project.id,
      { tags: tags as TodoTag[] | undefined, groupId: group?.id, completeAllRemoved: !!flags['complete-removed'] },
      cliActor(),
    );
    const ref = refFormatter(result.boardId);
    for (const item of result.created) ok(`${ref(item.number)} ${item.name}`);
    if (result.created.length)
      ok(`${result.created.length} ${result.created.length === 1 ? 'item criado' : 'itens criados'} em "${result.groupName}".`);
    if (result.completed)
      ok(`${result.completed} ${result.completed === 1 ? 'item concluído' : 'itens concluídos'} (a marcação saiu do código).`);
    if (!result.created.length && !result.completed) note('Nada novo para importar.');
    return 0;
  } catch (error) {
    fail((error as Error).message);
    return 1;
  }
}

export async function runCli(command: string, args: string[]): Promise<number> {
  switch (command) {
    case 'todos':
      return todosCommand(args);
    case 'steps':
      return stepsCommand(args);
    case 'check':
      return checkCommand(args);
    case 'init':
      return init(args);
    case 'brief':
      return brief();
    case 'note':
      return noteCommand(args);
    case 'git':
      return gitCommand(args);
    case 'setup':
      return setup(args);
    case 'status':
      return status();
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return 0;
    default:
      console.log(`Comando desconhecido: ${command}`);
      console.log(HELP);
      return 1;
  }
}
