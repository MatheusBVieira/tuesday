// A sua conta: senha, tokens do MCP e, para quem administra a instalação, as contas das outras pessoas.
import { Check, Copy, KeyRound, LogOut, Plus, Shield, Trash, UserCog } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { authApi, type AccountUser, type ApiToken } from '../../api/auth';
import { errorText } from '../../api/client';
import { cx } from '../../lib/format';
import { actions, toast, useStore } from '../../store';
import { Modal } from '../ui/Modal';

function TokenRow({ token, fresh, onRevoke }: { token: ApiToken; fresh?: string; onRevoke: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Não consegui copiar — selecione o token e copie à mão.', 'error');
    }
  };
  return (
    <div className="member-row">
      <span className="member-row__icon">
        <KeyRound size={16} />
      </span>
      <div className="member-row__text">
        <strong>{token.name}</strong>
        <span className="member-row__hint">
          {fresh ? fresh : token.lastUsedAt ? `usado em ${new Date(token.lastUsedAt).toLocaleString('pt-BR')}` : 'ainda não usado'}
        </span>
      </div>
      {fresh && (
        <button type="button" className="btn btn--tertiary btn--sm" onClick={() => void copy()}>
          {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copiado' : 'Copiar'}
        </button>
      )}
      <button type="button" className="icon-btn icon-btn--sm" aria-label="Apagar token" onClick={onRevoke}>
        <Trash size={15} />
      </button>
    </div>
  );
}

function Tokens() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [fresh, setFresh] = useState<Record<number, string>>({});
  const [name, setName] = useState('Claude');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    authApi
      .tokens()
      .then(setTokens)
      .catch((cause) => setError(errorText(cause, 'Não consegui carregar os tokens.')));
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    try {
      const token = await authApi.createToken(name);
      if (token.token) setFresh((current) => ({ ...current, [token.id]: token.token as string }));
      load();
    } catch (cause) {
      setError(errorText(cause, 'Não consegui criar o token.'));
    }
  };

  return (
    <div className="account__section">
      <h4>Token para o Claude (MCP)</h4>
      <p className="member-row__hint">
        O Claude entra no servidor com um token seu: o que ele fizer fica registrado no seu nome. Use no cabeçalho
        <code> Authorization: Bearer …</code> do MCP via HTTP. O token aparece inteiro só agora.
      </p>
      {error && <div className="form-error">{error}</div>}
      <div className="members__invite-actions">
        <input
          className="input input--sm"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          aria-label="Nome do token"
        />
        <button type="button" className="btn btn--primary btn--sm" onClick={() => void create()}>
          <Plus size={15} /> Gerar token
        </button>
      </div>
      <div className="members__list">
        {tokens.map((token) => (
          <TokenRow
            key={token.id}
            token={token}
            fresh={fresh[token.id]}
            onRevoke={() =>
              actions.confirm({
                title: 'Apagar este token?',
                message: 'O Claude configurado com ele perde o acesso na hora.',
                confirmLabel: 'Apagar',
                danger: true,
                onConfirm: async () => {
                  await authApi.revokeToken(token.id);
                  load();
                },
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

function Password() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [state, setState] = useState<{ error?: string; ok?: boolean }>({});
  const submit = async () => {
    try {
      await authApi.changePassword(current, next);
      setState({ ok: true });
      setCurrent('');
      setNext('');
    } catch (cause) {
      setState({ error: errorText(cause, 'Não consegui trocar a senha.') });
    }
  };
  return (
    <div className="account__section">
      <h4>Trocar a senha</h4>
      <div className="members__invite-actions">
        <input
          className="input input--sm"
          type="password"
          placeholder="Senha atual"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <input
          className="input input--sm"
          type="password"
          placeholder="Nova senha"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <button type="button" className="btn btn--secondary btn--sm" disabled={!current || next.length < 8} onClick={() => void submit()}>
          Salvar
        </button>
      </div>
      {state.error && <div className="form-error">{state.error}</div>}
      {state.ok && <p className="member-row__hint">Senha trocada.</p>}
    </div>
  );
}

function Users() {
  const viewer = useStore((s) => s.viewer);
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    authApi
      .users()
      .then((data) => setUsers(data.users))
      .catch((cause) => setError(errorText(cause, 'Não consegui carregar as contas.')));
  }, []);
  useEffect(load, [load]);

  const resetPassword = (user: AccountUser) => {
    const senha = window.prompt(`Nova senha para ${user.name} (mínimo 8 caracteres):`);
    if (!senha) return;
    if (senha.length < 8) return toast('A senha precisa ter pelo menos 8 caracteres.', 'error');
    authApi
      .setUserPassword(user.id, senha)
      .then(() => toast(`Senha de ${user.name} trocada.`, 'success'))
      .catch((cause) => toast(errorText(cause, 'Não consegui trocar a senha.'), 'error'));
  };

  return (
    <div className="account__section">
      <h4>Contas desta instalação</h4>
      <p className="member-row__hint">
        Você administra este tuesday: dá para trocar a senha de alguém, tornar outra pessoa administradora ou remover uma conta.
      </p>
      {error && <div className="form-error">{error}</div>}
      <div className="members__list">
        {users.map((user) => (
          <div key={user.id} className="member-row">
            <span className="member-row__icon">{user.role === 'admin' ? <Shield size={16} /> : <UserCog size={16} />}</span>
            <div className="member-row__text">
              <strong>
                {user.name}
                {user.id === viewer?.userId && <span className="member-row__you"> · você</span>}
              </strong>
              <span className="member-row__hint">
                {user.email}
                {user.banned ? ' · bloqueada' : ''}
              </span>
            </div>
            <button type="button" className="btn btn--tertiary btn--sm" onClick={() => resetPassword(user)}>
              Trocar senha
            </button>
            {user.id !== viewer?.userId && (
              <>
                <button
                  type="button"
                  className="btn btn--tertiary btn--sm"
                  onClick={() =>
                    authApi
                      .setUserRole(user.id, user.role === 'admin' ? 'user' : 'admin')
                      .then(load)
                      .catch((cause) => toast(errorText(cause, 'Não deu certo.'), 'error'))
                  }
                >
                  {user.role === 'admin' ? 'Tirar administração' : 'Tornar administradora'}
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--sm"
                  aria-label="Remover conta"
                  onClick={() =>
                    actions.confirm({
                      title: `Remover a conta de ${user.name}?`,
                      message: 'A pessoa perde o acesso. O que ela já fez continua no histórico dos quadros.',
                      confirmLabel: 'Remover',
                      danger: true,
                      onConfirm: async () => {
                        await authApi.removeUser(user.id);
                        load();
                      },
                    })
                  }
                >
                  <Trash size={15} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AccountModal({ onClose }: { onClose: () => void }) {
  const viewer = useStore((s) => s.viewer);
  const [tab, setTab] = useState<'conta' | 'contas'>('conta');
  if (!viewer) return null;
  return (
    <Modal title={viewer.name} onClose={onClose} wide>
      <div className="account">
        <p className="member-row__hint">
          {viewer.email}
          {viewer.master ? ' · administra esta instalação' : ''}
        </p>
        {viewer.master && (
          <div className="auth__tabs account__tabs">
            <button type="button" className={cx(tab === 'conta' && 'is-active')} onClick={() => setTab('conta')}>
              Minha conta
            </button>
            <button type="button" className={cx(tab === 'contas' && 'is-active')} onClick={() => setTab('contas')}>
              Contas
            </button>
          </div>
        )}
        {tab === 'conta' ? (
          <>
            <Tokens />
            <Password />
            <div className="account__section">
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => void actions.signOut()}>
                <LogOut size={15} /> Sair da conta
              </button>
            </div>
          </>
        ) : (
          <Users />
        )}
      </div>
    </Modal>
  );
}
