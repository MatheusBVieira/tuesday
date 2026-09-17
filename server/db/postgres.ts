// PostgreSQL para quem publica o tuesday num servidor.
//
// O código do tuesday usa a API síncrona do better-sqlite3. Para não reescrevê-lo inteiro como assíncrono,
// cada consulta vai para um worker que fala com o PostgreSQL, e a thread principal espera a resposta
// (Atomics.wait). No PostgreSQL local ou na mesma rede, isso custa alguns milissegundos por consulta.
//
// Escritas de processos diferentes (servidor web, MCP via stdio, hooks) são serializadas por um advisory lock
// em cada transação — o mesmo comportamento das transações IMMEDIATE do SQLite. Cada gravação avisa os outros
// processos por NOTIFY, e o servidor web repassa para as telas abertas em tempo real.
import { randomUUID } from 'node:crypto';
import { MessageChannel, Worker, receiveMessageOnPort, type MessagePort } from 'node:worker_threads';
import type { Driver, Statement } from './driver';

const TIMEOUT_MS = Number(process.env.TUESDAY_DB_TIMEOUT_MS) || 30_000;
/** Chave do advisory lock das transações de escrita. */
const WRITE_LOCK = 7_426_553;
export const CHANGES_CHANNEL = 'tuesday_changes';
/** Identifica este processo nas notificações (para ignorar o próprio eco). */
export const INSTANCE_ID = randomUUID();

const WRITE_SQL = /^\s*(insert|update|delete|create|alter|drop|truncate)\b/i;

type Reply =
  { id: number; ok: true; rows: Record<string, unknown>[]; rowCount: number } | { id: number; ok: false; message: string; code?: string };

export class PostgresError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'PostgresError';
    this.code = code;
  }
}

/** "?" → "$1, $2…", sem mexer em textos entre aspas. */
export function toPostgres(sql: string): string {
  let out = '';
  let n = 0;
  let quote: string | null = null;
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === '?') {
      out += `$${++n}`;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Endereço sem a senha, para mostrar na tela e nos logs. */
export function describeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `postgres://${parsed.username ? `${decodeURIComponent(parsed.username)}@` : ''}${parsed.host}${parsed.pathname}`;
  } catch {
    return 'postgres://…';
  }
}

export class PostgresDriver implements Driver {
  readonly dialect = 'postgres' as const;
  private worker!: Worker;
  private port!: MessagePort;
  private signal!: Int32Array;
  private nextId = 0;
  private depth = 0;
  private dirty = false;
  private readonly translated = new Map<string, string>();

  constructor(private readonly url: string) {
    this.start();
    try {
      this.query('SELECT 1');
    } catch (error) {
      this.close();
      throw new Error(`Não foi possível conectar ao PostgreSQL (${describeUrl(url)}): ${(error as Error).message}`);
    }
  }

  private start(): void {
    const { port1, port2 } = new MessageChannel();
    this.signal = new Int32Array(new SharedArrayBuffer(4));
    this.worker = new Worker(new URL('./pg-worker.mjs', import.meta.url), {
      workerData: { url: this.url, port: port2, signal: this.signal },
      transferList: [port2],
    });
    this.worker.unref();
    this.port = port1;
    this.port.unref();
  }

  private query(text: string, params?: unknown[]): { rows: Record<string, unknown>[]; rowCount: number } {
    const id = ++this.nextId;
    Atomics.store(this.signal, 0, 0);
    this.port.postMessage({ id, text, params: params?.map((p) => (p === undefined ? null : p)) });
    const deadline = Date.now() + TIMEOUT_MS;
    for (;;) {
      const received = receiveMessageOnPort(this.port);
      if (received) {
        const reply = received.message as Reply;
        if (reply.id !== id) continue; // resposta atrasada de uma consulta que já estourou o tempo
        if (!reply.ok) throw new PostgresError(reply.message, reply.code);
        return reply;
      }
      const left = deadline - Date.now();
      if (left <= 0) {
        // O worker ficou preso: recomeça com outro, e a transação em andamento (se houver) está perdida.
        void this.worker.terminate();
        this.depth = 0;
        this.start();
        throw new PostgresError(`O PostgreSQL não respondeu em ${Math.round(TIMEOUT_MS / 1000)} s.`);
      }
      Atomics.wait(this.signal, 0, 0, left);
      Atomics.store(this.signal, 0, 0);
    }
  }

  private wrote(): void {
    if (this.depth > 0) this.dirty = true;
    else this.notify();
  }

  private notify(): void {
    this.query('SELECT pg_notify($1, $2)', [CHANGES_CHANNEL, INSTANCE_ID]);
  }

  prepare(sql: string): Statement {
    let text = this.translated.get(sql);
    if (text === undefined) this.translated.set(sql, (text = toPostgres(sql)));
    const writes = WRITE_SQL.test(sql);
    const exec = (params: unknown[]) => {
      const result = this.query(text!, params);
      if (writes) this.wrote();
      return result;
    };
    return {
      get: (...params) => exec(params).rows[0],
      all: (...params) => exec(params).rows,
      run: (...params) => ({ changes: exec(params).rowCount }),
    };
  }

  exec(sql: string): void {
    this.query(sql);
    this.wrote();
  }

  transaction<T>(fn: () => T): T {
    const outer = this.depth === 0;
    if (outer) {
      this.query('BEGIN');
      this.dirty = false;
      try {
        this.query('SELECT pg_advisory_xact_lock($1)', [WRITE_LOCK]);
      } catch (error) {
        this.safely('ROLLBACK');
        throw error;
      }
    } else {
      this.query(`SAVEPOINT tuesday_${this.depth}`);
    }
    this.depth++;
    let result: T;
    try {
      result = fn();
      if (result instanceof Promise) throw new TypeError('A função da transação precisa ser síncrona.');
    } catch (error) {
      this.depth--;
      this.safely(outer ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT tuesday_${this.depth}`);
      if (outer) this.dirty = false;
      throw error;
    }
    this.depth--;
    if (!outer) {
      this.query(`RELEASE SAVEPOINT tuesday_${this.depth}`);
      return result;
    }
    try {
      if (this.dirty) this.notify(); // entregue no COMMIT
      this.query('COMMIT');
    } catch (error) {
      this.safely('ROLLBACK');
      throw error;
    } finally {
      this.dirty = false;
    }
    return result;
  }

  private safely(sql: string): void {
    try {
      this.query(sql);
    } catch {
      /* a conexão pode ter caído — o PostgreSQL desfaz sozinho */
    }
  }

  get inTransaction(): boolean {
    return this.depth > 0;
  }

  close(): void {
    void this.worker.terminate();
  }
}

/**
 * Avisa quando outro processo grava no banco (o servidor web usa para atualizar as telas abertas).
 * Conexão própria, assíncrona, que se refaz sozinha se cair.
 */
export async function listenForChanges(url: string, onChange: () => void): Promise<void> {
  const { default: pg } = await import('pg');
  let retry = 1000;
  const connect = async () => {
    const client = new pg.Client({ connectionString: url, application_name: 'tuesday (tempo real)' });
    const reconnect = () => {
      client.removeAllListeners();
      void client.end().catch(() => undefined);
      setTimeout(() => void connect(), retry).unref();
      retry = Math.min(retry * 2, 30_000);
    };
    client.on('error', reconnect);
    client.on('end', reconnect);
    client.on('notification', (message) => {
      if (message.channel === CHANGES_CHANNEL && message.payload !== INSTANCE_ID) onChange();
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANGES_CHANNEL}`);
      retry = 1000;
    } catch {
      reconnect();
    }
  };
  await connect();
}
