// Worker do driver PostgreSQL (postgres.ts): recebe uma consulta por vez, responde pela porta e acorda a thread
// principal, que está esperando com Atomics.wait. JavaScript puro — roda igual com tsx, no Docker e no bundle.
import pg from 'pg';
import { workerData } from 'node:worker_threads';

// COUNT(*) e SUM() voltam como bigint/numeric: o tuesday trabalha com number.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

const { url, port, signal } = workerData;
let client = null;

async function connection() {
  if (client) return client;
  const next = new pg.Client({ connectionString: url, application_name: 'tuesday' });
  next.on('error', () => {
    if (client === next) client = null;
  });
  await next.connect();
  client = next;
  return next;
}

port.on('message', async ({ id, text, params }) => {
  let reply;
  try {
    const db = await connection();
    // Sem parâmetros vai pelo protocolo simples, que aceita vários comandos (migrações).
    const result = await db.query(params ? { text, values: params } : text);
    const last = Array.isArray(result) ? result.at(-1) : result;
    reply = { id, ok: true, rows: last?.rows ?? [], rowCount: last?.rowCount ?? 0 };
  } catch (error) {
    reply = { id, ok: false, message: error?.message ?? String(error), code: error?.code };
    // Sem código SQLSTATE (ou classe 08/57P): foi a conexão. A próxima consulta reconecta.
    if (!error?.code || /^(08|57P)/.test(error.code) || /^E[A-Z]+/.test(error.code)) {
      const broken = client;
      client = null;
      broken?.end().catch(() => undefined);
    }
  }
  port.postMessage(reply);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
});
