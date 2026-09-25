# Segurança

## O que o tuesday faz com os seus dados

- **No computador, tudo fica nele.** Um arquivo SQLite em `%USERPROFILE%\.tuesday` no app instalado, ou em `data/`
  rodando pelo código. Não há conta, nuvem, servidor do projeto nem telemetria.
- **Servidor local fechado para fora.** Rodando em `127.0.0.1`, o servidor recusa pedidos com `Host` ou `Origin`
  de outro endereço — um site aberto no navegador não consegue usar a API por trás de você (DNS rebinding e CSRF).
- **Publicado na rede, com contas.** Com `HOST` fora do localhost, cada pessoa entra com a própria conta
  (Better Auth: e-mail e senha, senhas com hash, sessão em cookie `httpOnly`; opcionalmente Google). A primeira
  conta criada administra a instalação. O acesso a cada projeto vem do papel da pessoa nele (dono, administrador,
  membro ou leitor) e é conferido no servidor em **todo** pedido — inclusive no MCP via HTTP, onde o token é
  pessoal (`Authorization: Bearer`), guardado como hash e revogável. `TUESDAY_NO_AUTH=1` abre o servidor sem
  contas, para quando um proxy na frente já controla o acesso. Use HTTPS na frente se o acesso sair da rede local.
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
