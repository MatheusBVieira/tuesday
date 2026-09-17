import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { AppInfo } from '../shared/types';
import { ValidationError } from '../shared/values';
import { DB_DIALECT, DB_LABEL, ROOT_DIR, getDb, watchExternalChanges } from './db/connection';
import { createApiRouter } from './api/routes';
import { requirePassword } from './auth';
import { notifyChange, onChange } from './events';
import { RUNTIME, mcpLauncher } from './runtime';
import { HttpError } from './services/common';
import { purgeDeletedItems } from './services/items';
import { startGitWatcher } from './services/git';
import { mountMcpHttp } from './mcp/http';

// Só TUESDAY_PORT: ferramentas de dev costumam injetar PORT para o Vite.
const PORT = Number(process.env.TUESDAY_PORT ?? 4010);
const HOST = process.env.HOST ?? '127.0.0.1';
const DIST_DIR = process.env.TUESDAY_WEB_DIR ? path.resolve(process.env.TUESDAY_WEB_DIR) : path.join(ROOT_DIR, 'dist');
const version =
  process.env.TUESDAY_VERSION ?? (JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')) as { version: string }).version;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
/** local: só este computador acessa · server: publicado na rede (Docker, servidor da empresa) */
const MODE = LOCAL_HOSTS.has(HOST) ? 'local' : 'server';
const PASSWORD = process.env.TUESDAY_PASSWORD ?? '';

if (MODE === 'server' && !PASSWORD && process.env.TUESDAY_ALLOW_NO_PASSWORD !== '1') {
  console.error(
    `\n  O tuesday ia escutar em ${HOST}, aberto para a rede, sem senha.\n` +
      '  Defina TUESDAY_PASSWORD — ou TUESDAY_ALLOW_NO_PASSWORD=1 se um proxy na frente já controla o acesso.\n',
  );
  process.exit(1);
}

getDb();
purgeDeletedItems();

const appInfo: AppInfo = {
  root: ROOT_DIR,
  version,
  port: PORT,
  mode: MODE,
  runtime: RUNTIME,
  database: { dialect: DB_DIALECT, label: MODE === 'server' ? DB_DIALECT : DB_LABEL },
  mcp: mcpLauncher(),
  auth: !!PASSWORD,
};

const app = express();
app.disable('x-powered-by');
// Atrás de um proxy (nginx, Caddy, Traefik): req.ip vem do X-Forwarded-For.
if (process.env.TUESDAY_TRUST_PROXY) app.set('trust proxy', process.env.TUESDAY_TRUST_PROXY);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version, database: DB_DIALECT });
});

// Rodando só em localhost: recusa Host/Origin estranhos (proteção contra DNS rebinding e CSRF).
if (MODE === 'local') {
  app.use((req, res, next) => {
    const origin = req.get('origin');
    let originHost: string | null = null;
    try {
      originHost = origin ? new URL(origin).hostname : null;
    } catch {
      originHost = 'invalid';
    }
    if (!LOCAL_HOSTS.has(req.hostname) || (originHost && !LOCAL_HOSTS.has(originHost))) {
      res.status(403).json({ error: 'Origem não permitida.' });
      return;
    }
    next();
  });
}

if (PASSWORD) app.use(requirePassword(PASSWORD));

app.use(express.json({ limit: '5mb' }));

// ── Tempo real (Server-Sent Events) ──────────────────────────
const clients = new Set<Response>();

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

onChange((event) => {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) client.write(payload);
});

// Mudanças feitas por outro processo (ex.: o MCP rodando via stdio no Claude).
watchExternalChanges(() => notifyChange({ scope: 'external', boardId: null, clientId: null }));

// ── Rotas ────────────────────────────────────────────────────
app.use('/api', createApiRouter(appInfo));
mountMcpHttp(app);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  app.use(express.static(DIST_DIR, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/|mcp).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .type('html')
      .send(
        '<p style="font-family:sans-serif">Interface ainda não compilada. Rode <code>npm run build</code> ou use <code>npm run dev</code> e abra <a href="http://localhost:5173">localhost:5173</a>.</p>',
      );
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  let status = 500;
  if (err instanceof HttpError) status = err.status;
  else if (err instanceof ValidationError) status = 400;
  else if ((err as { type?: string })?.type === 'entity.parse.failed') status = 400;
  if (status === 500) console.error(err);
  const message = status === 500 ? 'Erro interno do servidor.' : (err as Error).message;
  res.status(status).json({ error: message });
});

const server = app.listen(PORT, HOST, () => {
  const url = `http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`;
  console.log(`\n  tuesday v${version} rodando em ${url}`);
  console.log(`  banco: ${DB_LABEL}`);
  console.log(`  MCP (HTTP): ${url}/mcp`);
  if (MODE === 'server')
    console.log(PASSWORD ? '  acesso: com senha (TUESDAY_PASSWORD)' : '  acesso: SEM senha (TUESDAY_ALLOW_NO_PASSWORD=1)');
  console.log('');
});

// Commits que citam itens nas pastas vinculadas aos projetos.
startGitWatcher();

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`A porta ${PORT} já está em uso. Defina outra com TUESDAY_PORT=xxxx.`);
    process.exit(1);
  }
  throw error;
});
