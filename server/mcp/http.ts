// Servidor MCP via Streamable HTTP (sem sessão), montado em /mcp no próprio servidor do tuesday.
// Use /mcp?project=<nome ou id> para fixar o projeto da conexão.
import type { Express, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './tools';

export function mountMcpHttp(app: Express): void {
  app.post('/mcp', async (req: Request, res: Response) => {
    const project = typeof req.query.project === 'string' ? req.query.project : null;
    const server = createMcpServer({ transport: 'http', project });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[mcp]', error);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Erro interno.' }, id: null });
      }
    }
  });

  const notAllowed = (_req: Request, res: Response) => {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Método não permitido.' }, id: null });
  };
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);
}
