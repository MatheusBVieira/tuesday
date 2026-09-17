import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = Number(process.env.TUESDAY_PORT ?? 4010);

export default defineConfig({
  plugins: [react()],
  server: {
    // PORT: porta escolhida por ferramentas de preview; a API continua em TUESDAY_PORT.
    port: Number(process.env.PORT) || 5173,
    strictPort: !!process.env.PORT,
    proxy: {
      '/api': { target: `http://127.0.0.1:${API_PORT}` },
      '/mcp': { target: `http://127.0.0.1:${API_PORT}` },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
