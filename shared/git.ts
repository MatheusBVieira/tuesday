// Regras puras da integração com Git: leitura do `git log` e das referências citadas nas mensagens.

export interface RawCommit {
  hash: string;
  authorName: string;
  authorEmail: string;
  /** data do commit (committer date) em ISO/UTC */
  committedAt: string;
  subject: string;
  body: string;
}

/** Formato do `git log`: campos separados por \x1f e commits por \x1e. */
export const GIT_LOG_FORMAT = '%H%x1f%an%x1f%ae%x1f%cI%x1f%s%x1f%b%x1e';

export function parseGitLog(output: string): RawCommit[] {
  const commits: RawCommit[] = [];
  for (const record of output.split('\x1e')) {
    const [hash = '', authorName = '', authorEmail = '', date = '', subject = '', body = ''] = record.replace(/^\s+/, '').split('\x1f');
    if (!/^[0-9a-f]{40}$/.test(hash)) continue;
    const time = Date.parse(date);
    commits.push({
      hash,
      authorName,
      authorEmail,
      committedAt: new Date(Number.isNaN(time) ? 0 : time).toISOString(),
      subject: subject.trim(),
      body: body.trim(),
    });
  }
  return commits;
}

// Até 8 dígitos: a coluna de ID pode completar com zeros à esquerda (ex.: TM-00000012).
const REF_RE = /\b([A-Za-z][A-Za-z0-9_]{0,9})-(\d{1,8})\b/g;

/** Palavras que concluem o item (inglês e português), seguidas de uma ou mais referências: "fixes TUE-1, TUE-2". */
const CLOSE_RE =
  /\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?|corrig(?:e|em|ido|ida)|fech(?:a|am|ado|ada)|resolvid[oa]|conclu(?:i|[ií]do|[ií]da))\b[\s:]+((?:[A-Za-z][A-Za-z0-9_]{0,9}-\d{1,8}(?:\s*(?:,|&|\band\b|\be\b)\s*)?)+)/gi;

export const refKey = (prefix: string, number: number) => `${prefix.toUpperCase()}-${number}`;

export interface CommitRef {
  prefix: string;
  number: number;
  key: string;
}

/** Referências de prefixos conhecidos citadas numa mensagem e quais delas o commit conclui. */
export function parseCommitRefs(
  message: string,
  knownPrefixes: { has(prefix: string): boolean },
): { mentions: CommitRef[]; closes: Set<string> } {
  const mentions = new Map<string, CommitRef>();
  for (const match of message.matchAll(REF_RE)) {
    const prefix = match[1].toUpperCase();
    if (!knownPrefixes.has(prefix)) continue;
    const number = Number(match[2]);
    const key = refKey(prefix, number);
    if (!mentions.has(key)) mentions.set(key, { prefix, number, key });
  }
  const closes = new Set<string>();
  for (const match of message.matchAll(CLOSE_RE)) {
    for (const ref of match[1].matchAll(REF_RE)) {
      const key = refKey(ref[1], Number(ref[2]));
      if (mentions.has(key)) closes.add(key);
    }
  }
  return { mentions: [...mentions.values()], closes };
}

/** URL do remoto (ssh ou https) → página do repositório, sem credenciais. Só para GitHub, GitLab e Bitbucket. */
export function webUrlFromRemote(remote: string | null | undefined): string | null {
  if (!remote) return null;
  const raw = remote.trim();
  let url: string | null = null;
  if (/^https?:\/\//i.test(raw)) {
    url = raw
      .replace(/^(https?:\/\/)[^@/]+@/i, '$1')
      .replace(/\.git\/?$/i, '')
      .replace(/\/$/, '');
  } else {
    const scp = /^(?:ssh:\/\/)?(?:[^@/]+@)?([^:/]+)[:/](.+?)(?:\.git)?\/?$/.exec(raw);
    if (scp) url = `https://${scp[1]}/${scp[2]}`;
  }
  if (!url || !/^https:\/\/(?:[^/]*\.)?(github\.com|gitlab\.[a-z.]+|bitbucket\.org)\//i.test(url)) return null;
  return url;
}

export function commitUrl(webUrl: string | null, hash: string): string | null {
  if (!webUrl) return null;
  if (/bitbucket\.org/i.test(webUrl)) return `${webUrl}/commits/${hash}`;
  if (/gitlab\./i.test(webUrl)) return `${webUrl}/-/commit/${hash}`;
  return `${webUrl}/commit/${hash}`;
}
