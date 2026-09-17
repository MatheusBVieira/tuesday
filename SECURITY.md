# Segurança

## O que o tuesday faz com os seus dados

- **No computador, tudo fica nele.** Um arquivo SQLite em `%APPDATA%\tuesday` no app instalado, ou em `data/`
  rodando pelo código. Não há conta, nuvem, servidor do projeto nem telemetria.
- **Servidor local fechado para fora.** Rodando em `127.0.0.1`, o servidor recusa pedidos com `Host` ou `Origin`
  de outro endereço — um site aberto no navegador não consegue usar a API por trás de você (DNS rebinding e CSRF).
- **Publicado na rede, com senha.** Com `HOST` fora do localhost, o tuesday não sobe sem `TUESDAY_PASSWORD`
  (a não ser com `TUESDAY_ALLOW_NO_PASSWORD=1`, para quando um proxy já controla o acesso). A senha vale para a
  interface (HTTP Basic) e para o MCP via HTTP (`Authorization: Bearer`), é comparada em tempo constante, e dez
  tentativas erradas bloqueiam o IP por dez minutos. Use HTTPS na frente se o acesso sair da rede local.
- **Git e TODOs só leem.** O tuesday roda `git log` e `git grep` e lê os arquivos das pastas vinculadas. Nunca
  escreve nelas.
- **Configurar o Claude mexe em arquivos seus**, e só quando você pede: `~/.claude.json` (pelo comando
  `claude mcp add`), `~/.claude/settings.json` (hooks) e o `claude_desktop_config.json`. O que já existe é
  preservado, e a versão anterior fica em `.tuesday-backup`.
- **Atualizações do app.** Vêm dos Releases deste repositório e são conferidas por hash (SHA-512) antes de
  instalar. O instalador ainda não é assinado com certificado de código.

## Encontrou uma falha?

Não abra uma issue pública. Use **Report a vulnerability**, na aba *Security* deste repositório, e descreva como
reproduzir. A resposta vem por lá.
