#!/usr/bin/env node
// Servidor MCP do tuesday (stdio).
//   Claude Code:  claude mcp add tuesday -- node "<pasta do tuesday>/bin/tuesday-mcp.mjs"
// Funciona de qualquer diretório: o banco fica em <pasta do tuesday>/data (ou em TUESDAY_DB).
import { tsImport } from 'tsx/esm/api';

await tsImport('../server/mcp/stdio.ts', import.meta.url);
