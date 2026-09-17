// Servidor MCP via stdio — é este que o Claude Code / Claude Desktop inicia.
// O projeto atual é detectado pela pasta onde o Claude está rodando (veja scope.ts).
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getDb } from '../db/connection';
import { createMcpServer } from './tools';

// stdout é exclusivo do protocolo MCP: qualquer log vai para stderr.
console.log = (...args: unknown[]) => console.error(...args);

getDb();
const server = createMcpServer({ transport: 'stdio' });
await server.connect(new StdioServerTransport());
