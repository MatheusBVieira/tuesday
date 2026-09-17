// Marcações TODO/FIXME/HACK/XXX em comentários do código: leitura, identidade estável e link para o editor.

export const TODO_TAGS = ['TODO', 'FIXME', 'HACK', 'XXX'] as const;
export type TodoTag = (typeof TODO_TAGS)[number];

/** Uma marcação encontrada num arquivo. */
export interface ParsedTodo {
  tag: TodoTag;
  /** linha (1 = primeira) */
  line: number;
  /** coluna da marcação (1 = primeira) */
  column: number;
  /** nome entre parênteses, ex.: TODO(ana) */
  author: string | null;
  /** texto da própria linha — é o que identifica a marcação entre varreduras */
  firstLine: string;
  /** texto completo, com as linhas de continuação do comentário */
  text: string;
}

// A marcação precisa vir logo depois de quem abre o comentário (//, /*, *, #, --, <!--, ; ou %) e ser a palavra
// inteira: "TODOS os campos", "# recebe TODO e-mail" e máscaras como "XXX.XXX-XX" não contam.
const MARKER =
  /(?:(?:^|[\s({,])(?:\/\/+|\/\*+|#+|--|<!--)|^\s*(?:\*+|;+|%+))!?\s*@?(TODO|FIXME|HACK|XXX)(?=[\s:(]|$)(?:\(([^)]{0,40})\))?\s*[:\-–—]?\s*(.*)$/;

const CLOSERS = /\s*(?:\*+\/\}?|-->|#\}|%>)\s*$/;

/** Arquivos que não são código (documentação, dados, travas de dependências). */
const SKIP_FILE =
  /(?:\.(?:md|mdx|markdown|txt|rst|json|jsonl|csv|tsv|lock|svg|map|snap|log|min\.js|min\.css)|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i;

export const isScannableFile = (file: string) => !SKIP_FILE.test(file);

const MAX_LINE = 400;
const MAX_CONTINUATION = 4;

function continuationPattern(opener: string): RegExp | null {
  if (opener.startsWith('//')) return /^\s*\/\/+\s?(.*)$/;
  if (opener.startsWith('#')) return /^\s*#+\s?(.*)$/;
  if (opener.startsWith('--')) return /^\s*--\s?(.*)$/;
  if (opener.startsWith('/*') || opener.startsWith('*')) return /^\s*\*(?!\/)\s?(.*)$/;
  return null;
}

const cleanText = (text: string) => text.replace(CLOSERS, '').replace(/\s+/g, ' ').trim();

/** Marcações de um arquivo, na ordem. */
export function parseTodos(content: string): ParsedTodo[] {
  if (!/TODO|FIXME|HACK|XXX/.test(content)) return [];
  const lines = content.split(/\r?\n/);
  const found: ParsedTodo[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.length > MAX_LINE) continue;
    const match = MARKER.exec(line);
    if (!match) continue;
    const tag = match[1] as TodoTag;
    const firstLine = cleanText(match[3] ?? '');
    const parts = firstLine ? [firstLine] : [];
    const opener =
      line
        .slice(0, match.index + match[0].indexOf(tag))
        .trim()
        .split(/\s+/)
        .pop() ?? '';
    const pattern = CLOSERS.test(line) ? null : continuationPattern(opener);
    for (let next = index + 1; pattern && next < lines.length && next <= index + MAX_CONTINUATION; next++) {
      const more = pattern.exec(lines[next]);
      const text = more ? cleanText(more[1]) : '';
      // Continua só o que parece a mesma frase: "^ nota", "- item", "@param" ou outra marcação começam outra coisa.
      if (!more || !text || !/^[\p{L}\p{N}"'`(]/u.test(text) || /^(TODO|FIXME|HACK|XXX|NOTE|OBS)\b/.test(text)) break;
      parts.push(text);
      if (CLOSERS.test(lines[next])) break;
    }
    found.push({
      tag,
      line: index + 1,
      column: line.indexOf(tag, match.index) + 1,
      author: match[2]?.trim() || null,
      firstLine,
      text: parts.join(' '),
    });
  }
  return found;
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Chave de identidade de uma marcação: arquivo + marcação + texto da linha (+ ordem entre repetidas).
 * Não usa o número da linha — o item continua o mesmo quando o código acima muda.
 */
export function todoKey(path: string, todo: Pick<ParsedTodo, 'tag' | 'firstLine'>, occurrence: number): string {
  return `${path.replace(/\\/g, '/')}\n${todo.tag}\n${fold(todo.firstLine)}\n${occurrence}`;
}

/** Nome do item: a primeira frase da marcação ("FIXME em pagamento.ts:42" quando não há texto). */
export function todoItemName(todo: Pick<ParsedTodo, 'tag' | 'text' | 'line'>, file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file;
  let text = todo.text.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ú])/)[0].trim();
  if (!text) return `${todo.tag} em ${base}:${todo.line}`;
  // "ADICIONAR VERIFICAÇÃO…" → "Adicionar verificação…"
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length > 12 && letters === letters.toUpperCase()) text = text.toLowerCase();
  text = text.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
  return text.length > 200 ? `${text.slice(0, 199).replace(/\s+\S*$/, '')}…` : text;
}

/** Editores que abrem arquivos por link (vscode://file/…:linha:coluna). */
export const EDITOR_SCHEMES = ['vscode', 'vscode-insiders', 'cursor', 'windsurf'] as const;

/** vscode://file/F:/pasta/arquivo.ts:42:5 — cada trecho do caminho vai codificado (ex.: "$id", "#", espaços). */
export function editorUrl(absolutePath: string, line: number, column = 1, scheme = 'vscode'): string {
  const file = absolutePath
    .replace(/\\/g, '/')
    .split('/')
    .map((segment, index) => (index === 0 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/');
  return `${scheme}://file${file.startsWith('/') ? '' : '/'}${file}:${line}:${column}`;
}

export const isEditorUrl = (url: string) => /^(?:vscode|vscode-insiders|cursor|windsurf):\/\/file\//i.test(url);

/** Linguagem do bloco de código (Markdown) pela extensão do arquivo. */
export function codeLanguage(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'ts',
    tsx: 'tsx',
    js: 'js',
    jsx: 'jsx',
    mjs: 'js',
    cjs: 'js',
    java: 'java',
    kt: 'kotlin',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    cs: 'csharp',
    php: 'php',
    sql: 'sql',
    sh: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
    html: 'html',
    css: 'css',
    scss: 'scss',
    vue: 'vue',
    svelte: 'svelte',
    swift: 'swift',
    dart: 'dart',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
  };
  return map[ext] ?? '';
}
