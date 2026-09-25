# tuesday

[![CI](https://github.com/MatheusBVieira/tuesday/actions/workflows/ci.yml/badge.svg)](https://github.com/MatheusBVieira/tuesday/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/MatheusBVieira/tuesday?label=vers%C3%A3o)](https://github.com/MatheusBVieira/tuesday/releases/latest)
[![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-green)](LICENSE)

Gestão de tarefas no estilo do monday.com — tabela, Kanban, subitens e "Meu trabalho" — feita para trabalhar
**junto com o Claude**. Pelo servidor MCP, o Claude lê e edita os seus quadros, quebra tarefas em passos e vai
marcando o que concluiu; os commits que citam um item aparecem nele, e os `TODO` do código viram itens com link
para a linha certa no VS Code.

Duas formas de usar: **instalado no seu computador**, com SQLite, ou **publicado num servidor** para o time, com
PostgreSQL.

![Tabela principal](docs/prints/tabela.png)

<sub>Todos os prints usam dados fictícios, gerados por `npm run prints`.</sub>

## O que ele faz

- **Tabela principal** — grupos coloridos, colunas de status, pessoas, datas, números, links e ID do item
  (`AUR-012`), resumo por coluna, arrastar e soltar, filtros, busca e seleção múltipla.
- **Kanban** — raias pelas etiquetas de qualquer coluna de status; arrastar o cartão muda o status.
- **Meu trabalho** — tudo o que está com você, em todos os projetos: Atrasado, Hoje, Esta semana e depois.
- **Subitens** — a tarefa quebrada em passos. O Claude planeja os passos e marca cada um ao concluir; o
  progresso (`2/5`) aparece na tabela, no Kanban e em Meu trabalho.
- **Claude (MCP)** — 28 ferramentas para criar, buscar, mover e atualizar itens em linguagem natural. Tudo
  aparece na tela em tempo real, marcado como feito pelo Claude.
- **Hooks do Claude Code** — ao abrir numa pasta de projeto, o Claude recebe o que está em andamento, bloqueado e
  atrasado; ao terminar, registra a atualização e ajusta o status.
- **Git** — commits que citam `AUR-012` aparecem no item, e `fixes AUR-012` conclui. Sem instalar nada nos
  repositórios, e uma pasta pode ter vários (backend e front lado a lado).
- **TODOs do código** — `TODO`, `FIXME`, `HACK` e `XXX` dos comentários viram itens com link que abre o arquivo
  no VS Code na linha certa, e a linha acompanha o código.

| | |
|---|---|
| ![Kanban](docs/prints/kanban.png) | ![Subitens marcados pelo Claude](docs/prints/subitens.png) |
| ![Commits ligados ao item](docs/prints/commits.png) | ![Meu trabalho](docs/prints/meu-trabalho.png) |
| ![Importar TODOs do código](docs/prints/todos.png) | ![Conectar o Claude](docs/prints/claude.png) |

## Duas formas de usar

| | No seu computador | Num servidor |
|---|---|---|
| **Para quem** | você e o seu Claude | um time, no navegador |
| **Banco** | SQLite, um arquivo | PostgreSQL |
| **Instalação** | instalador do Windows, ou pelo código | Docker Compose, ou pelo código |
| **Acesso** | só este computador | pela rede, cada pessoa com a sua conta |
| **Claude** | MCP local e hooks, configurados por um botão | MCP via HTTP, com um token por pessoa |

## Instalar no Windows

1. Baixe o `tuesday-Setup-x.y.z.exe` em [Releases](https://github.com/MatheusBVieira/tuesday/releases/latest).
2. O instalador ainda não é assinado, então o Windows avisa na primeira vez: clique em
   **Mais informações → Executar assim mesmo**.
3. No app, clique em **Claude** (no topo) e em **Configurar agora** — Claude Code, Claude Desktop e os hooks.
   Não precisa ter Node instalado: o próprio tuesday roda o servidor MCP.

**O app se atualiza sozinho.** Quando sai versão nova, ele baixa em segundo plano e instala quando você fechar.
Antes de uma versão nova abrir o banco, ele guarda uma cópia em `%USERPROFILE%\.tuesday\backups`.

Os dados ficam em `%USERPROFILE%\.tuesday`. Desinstalar não apaga essa pasta. (Fora do `AppData` de propósito: o
Claude Desktop é um app empacotado, e o que ele inicia — o Claude Code e o MCP do tuesday — enxerga uma cópia
privada do `AppData`, não os arquivos do app aberto pelo atalho. Quem vem da 1.0.0 tem o banco trazido de
`%APPDATA%\tuesday` na primeira abertura.) Para usar a CLI (`tuesday init`,
`tuesday brief`, `tuesday todos`…), coloque a pasta `bin` da instalação no PATH:
`%LOCALAPPDATA%\Programs\tuesday\bin`.

### Pelo código (Windows, macOS e Linux)

Precisa do [Node.js](https://nodejs.org) 22 ou mais novo.

```bash
git clone https://github.com/MatheusBVieira/tuesday.git
cd tuesday
npm install
npm run build
npm start        # http://localhost:4010
npm run setup    # registra o MCP no Claude Code
```

O banco fica em `data/tuesday.db`. Na primeira execução é criado um projeto de exemplo.

## Publicar num servidor

Com [Docker](https://docs.docker.com/get-docker/), numa máquina da rede (ou numa VPS):

```bash
git clone https://github.com/MatheusBVieira/tuesday.git
cd tuesday
cp .env.example .env     # defina POSTGRES_PASSWORD
docker compose up -d
```

Abra `http://<servidor>:4010` e **crie a primeira conta**: ela administra a instalação (vê as contas, troca
senhas, promove e remove). O compose sobe o tuesday e um PostgreSQL 17 com volume próprio.

### Contas, convites e papéis

Quem tem conta cria os próprios projetos e chama quem quiser: em **Quem participa**, gere um link de convite e
mande pela ferramenta que preferir — quem abrir cria a conta (ou entra na dela) e já entra no projeto.

| Papel | O que pode fazer |
|---|---|
| **Dono** | tudo, inclusive excluir o projeto e passar a posse |
| **Administrador** | quadros, grupos, colunas, membros e convites |
| **Membro** | cria e edita itens, subitens e atualizações |
| **Leitor** | lê o quadro e escreve atualizações |

Cada pessoa só enxerga os projetos em que participa — na tela e também pelo MCP. O servidor confere o papel em
todo pedido, não só na interface.

**Conectar o Claude de cada pessoa** — gere um token em **Minha conta** e use no cabeçalho. O que o Claude fizer
com ele fica registrado no nome da pessoa, com as permissões dela:

```bash
claude mcp add --transport http tuesday http://<servidor>:4010/mcp --header "Authorization: Bearer <seu-token>"
```

Algumas coisas a saber:

- **Quem pode criar conta.** Qualquer pessoa que alcance o endereço do servidor pode se cadastrar — mas não vê
  projeto nenhum até ser convidada. Fora de uma rede de confiança, deixe o tuesday atrás de VPN (Tailscale,
  WireGuard) ou de um proxy com autenticação.
- **Endereço.** Acessando direto pelo IP da máquina na rede, não precisa configurar nada: o servidor confia no
  endereço por onde foi aberto. Com domínio ou proxy na frente, defina `TUESDAY_URL` com o endereço público.
- **HTTPS.** Fora da rede local, coloque um proxy com HTTPS na frente (Caddy, nginx, Traefik) e defina
  `TUESDAY_TRUST_PROXY=1`.
- **Login com o Google** (opcional): defina `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`; o botão aparece sozinho
  na tela de entrada. Sem isso, é e-mail e senha — não há envio de e-mail, então não há verificação nem
  recuperação por e-mail: quem administra troca a senha de quem esqueceu.
- **Pastas de código.** Git e TODOs leem pastas do servidor. Monte as pastas no contêiner (veja o comentário em
  `compose.yaml`) e vincule os projetos a elas.
- **Backup.** `docker compose exec postgres pg_dump -U tuesday tuesday > tuesday.sql`
- **Atualizar.** `docker compose pull && docker compose up -d` — as migrações do banco rodam sozinhas. Para não
  precisar fazer isso a cada versão, suba com `docker compose --profile auto up -d`: junto vai um
  [watchtower](https://containrrr.dev/watchtower/) que, de madrugada, confere se saiu imagem nova do tuesday,
  baixa e recria o contêiner sozinho (só o do tuesday — o PostgreSQL fica de fora de propósito). Ele precisa do
  socket do Docker, e quem manda nesse socket manda no servidor: ligue só se confia em quem tem acesso à máquina.
  Preferindo não expor o socket, o mesmo efeito sai de uma linha no cron do servidor:
  `0 4 * * * cd /srv/tuesday && docker compose pull -q && docker compose up -d`.
- **Ficar numa major.** A imagem sai com as tags `1.1.0`, `1.1`, `1` e `latest`. Trocando `:latest` por `:1` no
  `compose.yaml`, a atualização automática pega correções e novidades, mas não pula para a 2.x sozinha.
- **Sem contas.** Se um proxy na frente já controla quem entra, `TUESDAY_NO_AUTH=1` deixa o servidor aberto,
  sem login.

**Sem Docker**, com um PostgreSQL seu: defina as variáveis num `.env` na pasta do tuesday e rode pelo código.

```bash
TUESDAY_DATABASE_URL=postgres://tuesday:senha@localhost:5432/tuesday
TUESDAY_URL=https://tuesday.seudominio.com
HOST=0.0.0.0
```

```bash
npm install && npm run build && npm start
```

## Conectar o Claude

No computador, o jeito mais simples é o botão: **Claude → Configurar agora**. Ele registra o MCP no Claude
Code (vale para todas as pastas), inclui o tuesday no Claude Desktop e instala os hooks — preservando o que você
já tem e guardando backup dos arquivos.

Pelo terminal, a partir do código:

```bash
npm run setup                          # MCP no Claude Code
node bin/tuesday.mjs setup --desktop   # também no Claude Desktop
node bin/tuesday.mjs setup --hooks     # hooks do Claude Code (--remove desfaz)
```

O MCP roda por stdio e abre o mesmo banco: o tuesday **não precisa estar aberto** para o Claude trabalhar — se
estiver, a tela atualiza sozinha.

### Um projeto por pasta

Vincule cada projeto à pasta do código — nas configurações do projeto, na barra lateral, ou pelo terminal,
dentro da pasta:

```bash
tuesday init "Meu App" --prefix APP
```

O Claude Code aberto nessa pasta (ou numa subpasta) passa a trabalhar naquele projeto: "crie uma tarefa X" cai
no quadro certo. Numa pasta sem projeto, o Claude pode criar um ("crie um projeto no tuesday para esta pasta").

### Exemplos do que pedir

- "O que eu tenho pra hoje?"
- "Quais tarefas estão bloqueadas?"
- "Crie 5 tarefas para o lançamento no grupo Sprint atual, todas com prioridade Alta"
- "Quebre o APP-007 em subitens e vá marcando conforme implementa"
- "Poste no APP-004 um resumo do que mudou hoje"
- "Importe os FIXME do código para o Backlog"

### Ferramentas

| Ferramenta | O que faz |
| --- | --- |
| `list_projects` · `use_project` | Projetos, quadros e pastas; escolhe o projeto da sessão |
| `create_project` · `update_project` | Cria projeto (com o primeiro quadro) e vincula a pasta |
| `list_boards` · `get_board` | Quadros, colunas, etiquetas, grupos e itens |
| `find_items` | Busca por texto e filtros de coluna, num projeto, num quadro ou em todos |
| `get_my_work` | O que está com você (ou com outra pessoa), separado pelo prazo |
| `get_item` · `get_activity` | Valores, subitens, atualizações, commits e histórico |
| `create_items` · `update_items` | Cria e altera até 100 itens de uma vez, com valores e subitens |
| `delete_items` · `restore_items` | Exclui (reversível por 30 dias) e restaura |
| `add_update` | Posta uma atualização em Markdown |
| `add_subitems` · `update_subitems` | Quebra o item em passos; marca, renomeia e remove |
| `sync_git` | Lê agora os commits da pasta (normalmente é automático) |
| `find_code_todos` · `import_code_todos` | TODO/FIXME do código e importação como itens |
| `create_group` · `update_group` | Grupos |
| `create_board` · `update_board` | Quadros |
| `create_column` · `update_column` | Colunas, etiquetas e a numeração do ID |
| `list_people` · `add_person` | Pessoas |

Os valores usam o **título da coluna** em formato amigável: nome da etiqueta, nome da pessoa, datas `AAAA-MM-DD`
(ou `hoje`, `amanhã`, `+3d`). Itens aceitam o id ou a referência (`APP-012`). Excluir projetos, quadros, grupos e
colunas só pela interface.

## Recursos em detalhe

### Referências dos itens

A coluna **ID do item** gera referências como `APP-001`. No menu da coluna, **Prefixo e numeração** troca o
prefixo, os dígitos e o próximo número — útil para continuar do `TM-37` de outra ferramenta. O número de um item
muda no lápis da própria célula; números repetidos são recusados. Ao importar tarefas pelo Claude, ele mantém as
referências antigas (`number` em `create_items`).

### Commits ligados aos itens

Com a pasta vinculada, o tuesday lê o histórico Git dela — a cada 10 s com o app aberto, e o MCP antes de
responder.

- Um commit que cita `APP-012` aparece na aba **Commits** do item, com link para o GitHub, GitLab ou Bitbucket.
- `fixes APP-012` — ou `closes`, `resolves`, `corrige`, `fecha`, `concluído` — move o item para concluído. Listas
  valem: `fixes APP-1, APP-2`.
- Só commits feitos depois de vincular a pasta concluem itens; o histórico antigo é apenas ligado, e um item
  reaberto não é fechado de novo pelo mesmo commit.

### Subitens

Na aba **Subitens**, Enter adiciona um passo, e colar uma lista (`- passo`, `1. passo`, `[x] passo`) cria vários.
Os passos são marcados, renomeados, reordenados arrastando e excluídos com desfazer; cada um mostra quem marcou.

### TODOs do código

Em **Novo item ▾ → Importar TODOs do código**, o tuesday lista as marcações da pasta do projeto, arquivo a
arquivo. Cada uma escolhida vira um item com a coluna **Código** (`pagamento.ts:42`, que abre no VS Code na linha)
e uma atualização com o trecho do código; `FIXME` vira **Bug** e `HACK`, **Débito técnico**.

Só contam marcações logo depois de quem abre o comentário (`//`, `#`, `/*`, `*`, `--`, `<!--`): "TODOS os campos",
máscaras como `XXX.XXX.XXX-XX`, Markdown e arquivos ignorados pelo Git ficam de fora. Importar de novo não duplica,
a linha do link acompanha o código, e o que saiu do código aparece para você concluir. Para o Cursor ou o VS Code
Insiders, defina `TUESDAY_EDITOR`.

### Hooks do Claude Code

- **Ao abrir** numa pasta de projeto, o Claude recebe o item da branch atual (ex.: `fix/APP-07-…`) com os
  subitens, e o que está bloqueado, em andamento, atrasado e na fila.
- **Ao terminar**, se houve commits citando itens, alterações na branch de um item ou subitens marcados, e ele
  ainda não registrou nada, o Claude posta a atualização e ajusta o status. Um lembrete por commit ou item, sem
  loops; fora das pastas de projeto nada acontece.

`tuesday brief` mostra o resumo que o Claude recebe na pasta atual.

## Terminal

| Comando | O que faz |
| --- | --- |
| `tuesday` | Inicia o servidor |
| `tuesday init [nome]` | Vincula a pasta atual a um projeto; `--prefix TM --digits 2 --start 38` define as referências |
| `tuesday setup [--desktop] [--hooks]` | Configura o MCP no Claude Code, no Claude Desktop e os hooks |
| `tuesday status` | Banco, projetos, pastas e o que está configurado |
| `tuesday brief` | O resumo que o Claude recebe nesta pasta |
| `tuesday note <ref> [--status X] "texto"` | Posta uma atualização e/ou muda o status |
| `tuesday steps <ref> [--add "passo" …]` | Lista ou adiciona subitens |
| `tuesday check <ref> <nº ou texto>… [--undo]` | Marca subitens como feitos |
| `tuesday todos [--import] [--tag FIXME]` | Lista ou importa os TODOs do código desta pasta |
| `tuesday git sync` | Liga agora os commits desta pasta aos itens |
| `tuesday mcp` | Servidor MCP via stdio |

Pelo código, sem `npm link`: `node bin/tuesday.mjs <comando>`.

## Seus dados

- **No computador, tudo fica nele.** Um arquivo SQLite, sem conta, sem nuvem e sem telemetria. O servidor local
  só escuta em `127.0.0.1` e recusa pedidos de outras origens.
- **No servidor, com contas.** Cada pessoa entra com a sua; o papel no projeto é conferido em todo pedido.
  Tentativas erradas demais
  bloqueiam por alguns minutos.
- **O Claude só mexe no que você pede**, e tudo o que ele faz fica no registro de atividades, marcado como Claude.
- **Git e TODOs só leem.** O tuesday lê o histórico e os arquivos das pastas vinculadas; não escreve nelas.
- **Configurar o Claude** altera `~/.claude.json`, `~/.claude/settings.json` e o arquivo do Claude Desktop, sempre
  preservando o que existe e com backup (`.tuesday-backup`).

Detalhes, e como reportar uma falha, em [SECURITY.md](SECURITY.md).

## Configuração

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `TUESDAY_DATABASE_URL` | — | PostgreSQL (`postgres://…`). Sem ela, SQLite |
| `TUESDAY_URL` | — | Endereço público do servidor (cookies de sessão e login com o Google) |
| `TUESDAY_AUTH_SECRET` | gerado | Segredo dos cookies de sessão (fica no banco quando não definido) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Liga o login com o Google |
| `HOST` | `127.0.0.1` | Interface de rede; `0.0.0.0` publica na rede |
| `TUESDAY_PORT` | `4010` | Porta |
| `TUESDAY_DATA_DIR` | `./data` | Pasta do SQLite e do estado dos hooks |
| `TUESDAY_DB` | `<dados>/tuesday.db` | Caminho do arquivo SQLite |
| `TUESDAY_TRUST_PROXY` | — | `1` atrás de um proxy (nginx, Caddy, Traefik) |
| `TUESDAY_NO_AUTH` | — | `1` para abrir na rede sem contas (quando um proxy já controla o acesso) |
| `TUESDAY_EDITOR` | `vscode` | Editor dos links de código: `vscode`, `vscode-insiders`, `cursor` ou `windsurf` |
| `TUESDAY_PROJECT` | — | Fixa o projeto do MCP (nome ou id), ignorando a pasta |
| `TUESDAY_NO_SEED` | — | `1` para não criar o projeto de exemplo |

Rodando pelo código, as variáveis podem ficar num `.env` na pasta do tuesday.

## Desenvolvimento

```bash
npm install
npm run dev              # API em http://localhost:4010 e interface em http://localhost:5173
npm run demo             # o mesmo, com os dados fictícios dos prints (data/demo/)
npm test                 # testes de fumaça do MCP, dos hooks e da CLI (SQLite)
npm run db:up            # PostgreSQL de desenvolvimento no Docker (porta 55432)
npm run test:postgres    # os mesmos testes no PostgreSQL, mais gravações simultâneas
npm run typecheck
npm run format
```

O app desktop é o mesmo servidor e a mesma interface dentro de uma janela do Electron:

```bash
npm run desktop:testar       # monta em release/win-unpacked, sem instalar
npm run desktop:instalador   # gera release/tuesday-Setup-<versão>.exe
npm run prints               # refaz os prints do README a partir da demonstração
```

## Como funciona

**Um código, dois bancos.** Todo o servidor usa uma API síncrona de banco — a do better-sqlite3. No PostgreSQL,
o driver roda cada consulta num worker e a thread principal espera a resposta (`Atomics.wait`), então nenhuma
regra de negócio precisou virar assíncrona. O SQL é escrito para os dois (`RETURNING id`, `ON CONFLICT`), e as
migrações existem nas duas versões — o servidor recusa subir se uma faltar.

**Vários processos, um banco.** O servidor web, o MCP via stdio de cada sessão do Claude e os hooks gravam no
mesmo banco. No SQLite, o modo WAL e as transações `IMMEDIATE` serializam as escritas; no PostgreSQL, um advisory
lock por transação faz o mesmo papel — é o que impede dois processos de darem o mesmo número a itens diferentes.

**Tempo real.** A interface recebe as mudanças por Server-Sent Events. Mudanças de outros processos chegam pelo
`data_version` do SQLite ou por `LISTEN/NOTIFY` no PostgreSQL.

**Sem hooks nos repositórios.** O tuesday lê `git log` das pastas vinculadas e procura as referências dos
prefixos conhecidos. Um commit só conclui um item se foi feito depois do vínculo — importar um histórico antigo não
fecha nada.

**A identidade de um TODO não é a linha.** É o arquivo, a marcação e o texto. Por isso importar de novo não
duplica, e quando o código acima muda, o tuesday só corrige o número da linha no link.

**O app desktop dispensa o Node.** O Claude inicia o MCP com o próprio `tuesday.exe` em modo Node
(`ELECTRON_RUN_AS_NODE`), e os hooks passam por um `.cmd` ao lado do executável.

## Estrutura

```
bin/                 CLI, MCP via stdio e hooks (pelo código)
server/
  db/                driver (SQLite e PostgreSQL), migrações, schema do PostgreSQL e exemplo
  services/          regras de negócio — usadas pela API, pelo MCP, pela CLI e pelos hooks
  api/routes.ts      API REST
  mcp/               ferramentas MCP, detecção do projeto, stdio e HTTP
  hooks.ts           hooks do Claude Code
  auth/              contas e sessões (Better Auth), no modo servidor
  index.ts           servidor HTTP e tempo real (SSE)
shared/              tipos e regras usadas no cliente e no servidor
src/                 interface React
electron/            app desktop: processo principal, montagem, ícone e wrappers .cmd
scripts/             testes de fumaça, demonstração e prints
compose.yaml         tuesday + PostgreSQL para servidor
Dockerfile           imagem do servidor
```

Stack: React 19, Vite, TypeScript, Zustand, dnd-kit, Floating UI, Express 5, better-sqlite3, node-postgres,
Electron e o SDK oficial do MCP.

## Publicando uma versão

```bash
npm version patch        # 1.0.0 → 1.0.1: cria o commit e a tag v1.0.1
git push --follow-tags
```

A tag dispara o workflow *Release*: roda os testes, gera o instalador do Windows e cria um **rascunho** de release,
e publica a imagem `ghcr.io/matheusbvieira/tuesday`. Instale o rascunho, confira, e publique — só então os apps
instalados enxergam a versão nova.

## Aviso

O tuesday é um projeto independente, sem vínculo com a monday.com Ltd. "monday.com" é marca registrada de seus
respectivos donos.

## Licença

[MIT](LICENSE).
