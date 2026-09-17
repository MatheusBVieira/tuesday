# tuesday para servidor: a interface, a API e o MCP via HTTP numa imagem só.
# O banco é o PostgreSQL (TUESDAY_DATABASE_URL) — veja o compose.yaml. Sem ele, usa SQLite em /data.

FROM node:22-bookworm-slim AS build
# O better-sqlite3 é compilado na instalação.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# O Electron e o Playwright (app desktop e prints) não entram na imagem.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
# Git: commits ligados aos itens e TODOs do código, nas pastas montadas no contêiner.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && git config --system --add safe.directory '*'
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    TUESDAY_PORT=4010 \
    TUESDAY_DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4010
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:4010/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "bin/tuesday.mjs", "start"]
