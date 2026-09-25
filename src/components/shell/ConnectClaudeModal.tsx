import { Check, CircleAlert, Copy, FolderOpen, Globe, LoaderCircle, Monitor, Server, Sparkles, Terminal, Webhook } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AppInfo, SetupStatus } from '../../../shared/types';
import { api, errorText } from '../../api/client';
import { cx } from '../../lib/format';
import { actions, useStore } from '../../store';
import { Modal } from '../ui/Modal';

export function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-block">
      <pre>{text}</pre>
      <button
        type="button"
        aria-label="Copiar"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
  );
}

function SetupCard({
  icon,
  title,
  configured,
  upToDate,
  available,
  detail,
  busy,
  onRun,
}: {
  icon: ReactNode;
  title: string;
  configured: boolean;
  upToDate: boolean;
  available: boolean;
  detail: string;
  busy: boolean;
  onRun: () => void;
}) {
  const done = configured && upToDate;
  return (
    <div className={cx('setup-card', done && 'is-done')}>
      <div className="setup-card__head">
        <span className="setup-card__icon">{icon}</span>
        <span className="setup-card__title">{title}</span>
        {configured ? (
          upToDate ? (
            <span className="setup-badge is-ok">
              <Check size={12} strokeWidth={3} /> Configurado
            </span>
          ) : (
            <span className="setup-badge is-warn">Aponta para outra pasta</span>
          )
        ) : (
          <span className="setup-badge">Não configurado</span>
        )}
      </div>
      <p className="setup-card__detail">{detail}</p>
      <button
        type="button"
        className={cx('btn btn--sm', done ? 'btn--secondary' : 'btn--primary')}
        disabled={!available || busy}
        onClick={onRun}
      >
        {busy ? (
          <>
            <LoaderCircle size={14} className="spin" /> Configurando…
          </>
        ) : !configured ? (
          'Configurar agora'
        ) : upToDate ? (
          'Reconfigurar'
        ) : (
          'Atualizar'
        )}
      </button>
    </div>
  );
}

const EXAMPLES = [
  'Quais tarefas estão bloqueadas?',
  'Crie 5 tarefas para a próxima versão no grupo Sprint atual',
  'O que está atrasado e é de prioridade alta?',
  'Crie um projeto no tuesday para esta pasta',
  'Poste no item que estamos fazendo um resumo do que mudou hoje',
];

const quoteArg = (arg: string) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);

/** Publicado na rede: o Claude de cada pessoa conecta pelo MCP via HTTP. */
function ServerConnect({ app }: { app: AppInfo }) {
  const url = `${window.location.origin}/mcp`;
  const header = app.accounts ? ' --header "Authorization: Bearer SEU_TOKEN"' : '';
  const desktop = JSON.stringify(
    {
      mcpServers: {
        tuesday: {
          command: 'npx',
          args: ['-y', 'mcp-remote', url, ...(app.accounts ? ['--header', 'Authorization: Bearer SEU_TOKEN'] : [])],
        },
      },
    },
    null,
    2,
  );
  return (
    <>
      <h3>
        <Server size={18} /> Este tuesday está publicado na rede
      </h3>
      <p>
        Cada pessoa conecta o próprio Claude pelo endereço deste servidor.{' '}
        {app.accounts ? (
          <>
            Troque <code>SEU_TOKEN</code> pelo token que você gera em <strong>Minha conta</strong> — o que o Claude fizer fica registrado no
            seu nome, com as suas permissões.
          </>
        ) : null}
      </p>
      <h3>
        <Terminal size={18} /> Claude Code
      </h3>
      <CopyBlock text={`claude mcp add --transport http tuesday ${url}${header}`} />
      <p className="connect__hint">
        Para fixar um projeto, use <code>{url}?project=Nome</code>.
      </p>
      <h3>
        <Monitor size={18} /> Claude Desktop
      </h3>
      <p>
        Em <em>Configurações → Desenvolvedor → Editar configuração</em>, inclua no <code>claude_desktop_config.json</code> (precisa do Node
        instalado):
      </p>
      <CopyBlock text={desktop} />
    </>
  );
}

export function ConnectClaudeModal({ onClose }: { onClose: () => void }) {
  const app = useStore((s) => s.app);
  const project = useStore((s) => s.projects.find((p) => p.id === s.projectId));
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [busy, setBusy] = useState<'code' | 'desktop' | 'hooks' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(() => {
    api
      .setupStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    if (app?.mode !== 'server') load();
  }, [app?.mode, load]);

  const run = async (target: 'code' | 'desktop' | 'hooks') => {
    setBusy(target);
    setResult(null);
    try {
      const res =
        target === 'code'
          ? await api.setupClaudeCode()
          : target === 'desktop'
            ? await api.setupClaudeDesktop()
            : await api.setupClaudeHooks();
      setResult({ ok: true, message: res.message });
    } catch (error) {
      setResult({ ok: false, message: errorText(error) });
    } finally {
      setBusy(null);
      load();
    }
  };

  if (!app) return null;
  const root = app.root.replace(/\\/g, '/');
  const desktopConfig = JSON.stringify({ mcpServers: { tuesday: app.mcp } }, null, 2);
  const envArgs = Object.entries(app.mcp.env ?? {}).map(([key, value]) => `-e ${key}=${value}`);
  const manualCommand = ['claude mcp add tuesday --scope user', ...envArgs, '--', ...[app.mcp.command, ...app.mcp.args].map(quoteArg)].join(
    ' ',
  );

  return (
    <Modal title="Conectar o Claude" onClose={onClose} wide>
      <div className="connect">
        <p className="modal__lead">
          O tuesday tem um servidor <strong>MCP</strong>: com ele o Claude lê e edita seus quadros — cria tarefas, muda status, move itens e
          posta atualizações. Tudo aparece aqui em tempo real, marcado como{' '}
          <span className="via-claude">
            <Sparkles size={11} /> Claude
          </span>{' '}
          no registro de atividades.
        </p>

        {app.mode === 'server' ? (
          <ServerConnect app={app} />
        ) : (
          <>
            <div className="setup-cards">
              <SetupCard
                icon={<Terminal size={18} />}
                title="Claude Code"
                configured={!!status?.claudeCode.configured}
                upToDate={!!status?.claudeCode.upToDate}
                available={!!status?.claudeCode.cli}
                busy={busy === 'code'}
                detail={
                  !status
                    ? 'Verificando…'
                    : status.claudeCode.cli
                      ? 'Registra o tuesday uma vez, para todas as pastas.'
                      : 'O comando "claude" não foi encontrado neste computador.'
                }
                onRun={() => void run('code')}
              />
              <SetupCard
                icon={<Monitor size={18} />}
                title="Claude Desktop"
                configured={!!status?.claudeDesktop.configured}
                upToDate={!!status?.claudeDesktop.upToDate}
                available={!!status?.claudeDesktop.found}
                busy={busy === 'desktop'}
                detail={
                  !status
                    ? 'Verificando…'
                    : status.claudeDesktop.found
                      ? 'Inclui o tuesday na configuração do app (com backup do arquivo).'
                      : 'O Claude Desktop não foi encontrado neste computador.'
                }
                onRun={() => void run('desktop')}
              />
              <SetupCard
                icon={<Webhook size={18} />}
                title="Hooks do Claude Code"
                configured={!!status?.claudeHooks.configured}
                upToDate={!!status?.claudeHooks.upToDate}
                available={!!status}
                busy={busy === 'hooks'}
                detail={
                  !status
                    ? 'Verificando…'
                    : 'Ao abrir numa pasta de projeto, o Claude recebe o que está em andamento e bloqueado; ao terminar, registra a atualização e o status.'
                }
                onRun={() => void run('hooks')}
              />
            </div>
            {result && (
              <div className={cx('setup-result', result.ok ? 'is-ok' : 'is-error')}>
                {result.ok ? <Check size={16} /> : <CircleAlert size={16} />}
                <span>{result.message}</span>
              </div>
            )}

            <h3>
              <FolderOpen size={18} /> Um projeto por pasta
            </h3>
            <p>
              Vincule cada projeto à pasta do código. Quando o Claude Code roda dentro dessa pasta, ele usa o quadro desse projeto
              automaticamente — nada para configurar por projeto.
            </p>
            {project && (
              <div className="project-link">
                {project.folder ? (
                  <>
                    <Check size={16} className="project-link__ok" />
                    <span>
                      <strong>{project.name}</strong> está vinculado a <code>{project.folder}</code>
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      O projeto <strong>{project.name}</strong> ainda não tem pasta.
                    </span>
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() => actions.openModal({ kind: 'project', projectId: project.id })}
                    >
                      Vincular pasta
                    </button>
                  </>
                )}
              </div>
            )}
            {app.runtime === 'source' && (
              <>
                <p>Ou, pelo terminal, dentro da pasta do seu projeto (cria o projeto e já vincula):</p>
                <CopyBlock text={`node "${root}/bin/tuesday.mjs" init`} />
                <p className="connect__hint">
                  Dica: rode <code>npm link</code> uma vez na pasta do tuesday para poder digitar só <code>tuesday init</code>.
                </p>
              </>
            )}

            <details className="connect-manual">
              <summary>Configuração manual</summary>
              <h3>
                <Terminal size={18} /> Claude Code
              </h3>
              <CopyBlock text={status?.claudeCode.command ?? manualCommand} />
              <h3>
                <Monitor size={18} /> Claude Desktop
              </h3>
              <p>
                Em <em>Configurações → Desenvolvedor → Editar configuração</em>, inclua no <code>claude_desktop_config.json</code>:
              </p>
              <CopyBlock text={desktopConfig} />
              <h3>
                <Globe size={18} /> Via HTTP
              </h3>
              <p>Com o tuesday aberto (acrescente ?project=Nome para fixar um projeto):</p>
              <CopyBlock text={`claude mcp add --transport http tuesday http://localhost:${app.port}/mcp`} />
            </details>
          </>
        )}

        <h3>Experimente pedir</h3>
        <div className="prompt-examples">
          {EXAMPLES.map((example) => (
            <span key={example} className="prompt-example">
              "{example}"
            </span>
          ))}
        </div>
      </div>
    </Modal>
  );
}
