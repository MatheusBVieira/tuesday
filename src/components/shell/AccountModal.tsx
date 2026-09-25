// A sua conta: token do Claude, senha e — para quem administra a instalação — as contas das outras pessoas.
import { Check, Ellipsis, KeyRound, LogOut, Search, Shield, Sparkles, Trash, UserCog, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fold } from '../../../shared/values';
import { authApi, type AccountUser, type ApiToken } from '../../api/auth';
import { errorText } from '../../api/client';
import { cx } from '../../lib/format';
import { actions, toast, useStore } from '../../store';
import { Avatar } from '../ui/Avatar';
import { CopyField } from '../ui/CopyField';
import { Menu, MenuItem } from '../ui/Menu';
import { Modal } from '../ui/Modal';
import { PopoverPanel, usePopover } from '../ui/Popover';

function RowMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const menu = usePopover({ placement: 'bottom-end' });
  return (
    <>
      <button
        ref={menu.refs.setReference}
        {...menu.getReferenceProps({ onClick: () => menu.setOpen(!menu.open) })}
        type="button"
        className={cx('icon-btn icon-btn--sm team-row__menu', menu.open && 'is-open')}
        aria-label={label}
      >
        <Ellipsis size={18} />
      </button>
      <PopoverPanel popover={menu}>
        <Menu>{children(() => menu.setOpen(false))}</Menu>
      </PopoverPanel>
    </>
  );
}

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : null);

// ── Token do Claude ────────────────────────────────────────

function Tokens() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [fresh, setFresh] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    authApi
      .tokens()
      .then(setTokens)
      .catch((cause) => setError(errorText(cause, 'Não consegui carregar os tokens.')));
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await authApi.createToken(`Claude ${new Date().toLocaleDateString('pt-BR')}`);
      if (token.token) setFresh((current) => ({ ...current, [token.id]: token.token as string }));
      load();
    } catch (cause) {
      setError(errorText(cause, 'Não consegui criar o token.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="team-block">
      <div className="team-block__head">
        <h3>
          <Sparkles size={16} /> Claude (MCP)
        </h3>
        <div className="team-block__actions">
          <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void create()}>
            <KeyRound size={16} /> Gerar token
          </button>
        </div>
      </div>
      <p className="team-block__hint">
        O Claude entra no servidor com um token seu e age com as suas permissões — o que ele fizer aparece no seu nome. Use no cabeçalho{' '}
        <code>Authorization: Bearer …</code> ao conectar o MCP via HTTP. O token aparece inteiro só quando é criado.
      </p>
      {error && <div className="form-error">{error}</div>}
      {tokens.length > 0 && (
        <div className="team-list">
          {tokens.map((token) => (
            <div key={token.id} className={cx('team-row', fresh[token.id] && 'team-row--fresh')}>
              <span className="team-row__icon">
                <KeyRound size={17} />
              </span>
              <div className="team-row__who">
                <span className="team-row__name">{token.name}</span>
                {fresh[token.id] ? (
                  <CopyField value={fresh[token.id]} label="Token do Claude" />
                ) : (
                  <span className="team-row__sub">
                    criado em {quando(token.createdAt)}
                    {token.lastUsedAt ? ` · usado em ${quando(token.lastUsedAt)}` : ' · ainda não usado'}
                  </span>
                )}
              </div>
              <RowMenu label={`Opções do token ${token.name}`}>
                {(close) => (
                  <MenuItem
                    icon={<Trash size={16} />}
                    label="Apagar token"
                    danger
                    onClick={() => {
                      close();
                      actions.confirm({
                        title: 'Apagar este token?',
                        message: 'O Claude configurado com ele perde o acesso na hora. Os outros tokens continuam valendo.',
                        confirmLabel: 'Apagar',
                        danger: true,
                        onConfirm: async () => {
                          await authApi.revokeToken(token.id);
                          load();
                        },
                      });
                    }}
                  />
                )}
              </RowMenu>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Senha ──────────────────────────────────────────────────

function Password() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [state, setState] = useState<{ error?: string; ok?: boolean }>({});
  const submit = async () => {
    setState({});
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
    <section className="team-block">
      <div className="team-block__head">
        <h3>Senha</h3>
      </div>
      <form
        className="password-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
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
          placeholder="Nova senha (mínimo 8)"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <button type="submit" className="btn btn--secondary btn--sm" disabled={!current || next.length < 8}>
          Trocar senha
        </button>
      </form>
      {state.error && <div className="form-error">{state.error}</div>}
      {state.ok && (
        <p className="team-block__hint team-block__hint--ok">
          <Check size={15} /> Senha trocada.
        </p>
      )}
    </section>
  );
}

// ── Contas da instalação (só para quem administra) ─────────

function UserRow({ user, isYou, onChanged }: { user: AccountUser; isYou: boolean; onChanged: () => void }) {
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const person = { id: 0, name: user.name, email: user.email, color: user.role === 'admin' ? '#0073ea' : '#a25ddc', isAgent: false };

  const save = async () => {
    if (!newPassword || newPassword.length < 8) {
      toast('A senha precisa ter pelo menos 8 caracteres.', 'error');
      return;
    }
    try {
      await authApi.setUserPassword(user.id, newPassword);
      setNewPassword(null);
      toast(`Senha de ${user.name} trocada.`, 'success');
    } catch (cause) {
      toast(errorText(cause, 'Não consegui trocar a senha.'), 'error');
    }
  };

  const run = (fn: () => Promise<unknown>, erro: string) =>
    fn()
      .then(onChanged)
      .catch((cause) => toast(errorText(cause, erro), 'error'));

  return (
    <div className={cx('team-row', newPassword !== null && 'team-row--fresh')}>
      <Avatar person={person} size={34} />
      <div className="team-row__who">
        <span className="team-row__name">
          {user.name}
          {isYou && <span className="tag tag--me team-row__tag">Você</span>}
          {user.banned && <span className="tag team-row__tag">Bloqueada</span>}
        </span>
        {newPassword !== null ? (
          <form
            className="password-form password-form--inline"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input
              className="input input--sm"
              autoFocus
              type="text"
              placeholder={`Nova senha de ${user.name.split(' ')[0]} (mínimo 8)`}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button type="submit" className="btn btn--primary btn--sm" disabled={newPassword.length < 8}>
              Salvar
            </button>
            <button type="button" className="icon-btn icon-btn--sm" aria-label="Cancelar" onClick={() => setNewPassword(null)}>
              <X size={16} />
            </button>
          </form>
        ) : (
          <span className="team-row__sub ellipsis">{user.email}</span>
        )}
      </div>
      {user.role === 'admin' && <span className="tag tag--me">Administradora</span>}
      <RowMenu label={`Opções de ${user.name}`}>
        {(close) => (
          <>
            <MenuItem
              icon={<KeyRound size={16} />}
              label="Definir nova senha"
              hint="Não há recuperação por e-mail: a troca é por aqui"
              onClick={() => {
                close();
                setNewPassword('');
              }}
            />
            {!isYou && (
              <MenuItem
                icon={<Shield size={16} />}
                label={user.role === 'admin' ? 'Tirar a administração' : 'Tornar administradora'}
                onClick={() => {
                  close();
                  void run(() => authApi.setUserRole(user.id, user.role === 'admin' ? 'user' : 'admin'), 'Não consegui mudar o papel.');
                }}
              />
            )}
            {!isYou && (
              <MenuItem
                icon={<Trash size={16} />}
                label="Remover conta"
                danger
                onClick={() => {
                  close();
                  actions.confirm({
                    title: `Remover a conta de ${user.name}?`,
                    message: 'A pessoa perde o acesso ao servidor. O que ela já fez continua no histórico dos quadros.',
                    confirmLabel: 'Remover',
                    danger: true,
                    onConfirm: () => run(() => authApi.removeUser(user.id), 'Não consegui remover a conta.'),
                  });
                }}
              />
            )}
          </>
        )}
      </RowMenu>
    </div>
  );
}

function Users() {
  const viewer = useStore((s) => s.viewer);
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    authApi
      .users()
      .then((data) => setUsers(data.users))
      .catch((cause) => setError(errorText(cause, 'Não consegui carregar as contas.')));
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const key = fold(query.trim());
    return key ? users.filter((u) => fold(`${u.name} ${u.email}`).includes(key)) : users;
  }, [users, query]);

  return (
    <section className="team-block">
      <div className="team-block__head">
        <h3>
          Contas <span className="team-block__count">{users.length}</span>
        </h3>
        <div className="team-block__actions">
          <div className="search-field">
            <Search size={15} />
            <input
              className="input input--sm"
              placeholder="Buscar por nome ou e-mail"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </div>
      <p className="team-block__hint">
        Você administra este tuesday: pode definir a senha de quem esqueceu, passar a administração para outra pessoa ou remover uma conta.
        Quem participa de cada projeto se resolve dentro do projeto, em <strong>Quem participa</strong>.
      </p>
      {error && <div className="form-error">{error}</div>}
      <div className="team-list">
        {shown.map((user) => (
          <UserRow key={user.id} user={user} isYou={user.id === viewer?.userId} onChanged={load} />
        ))}
        {shown.length === 0 && <p className="team-block__hint">Nenhuma conta com esse nome.</p>}
      </div>
    </section>
  );
}

export function AccountModal({ onClose }: { onClose: () => void }) {
  const viewer = useStore((s) => s.viewer);
  const [tab, setTab] = useState<'conta' | 'contas'>('conta');
  if (!viewer) return null;
  return (
    <Modal title={viewer.name} onClose={onClose} wide>
      <div className="account-head">
        <Avatar person={{ id: viewer.personId, name: viewer.name, email: viewer.email, color: '#0073ea', isAgent: false }} size={40} />
        <div className="account-head__text">
          <span className="team-row__name">{viewer.email}</span>
          <span className="team-row__sub">{viewer.master ? 'Administra esta instalação do tuesday' : 'Conta neste tuesday'}</span>
        </div>
        <button type="button" className="btn btn--tertiary btn--sm" onClick={() => void actions.signOut()}>
          <LogOut size={16} /> Sair da conta
        </button>
      </div>

      {viewer.master && (
        <div className="segmented account-tabs">
          <button type="button" className={cx(tab === 'conta' && 'is-active')} onClick={() => setTab('conta')}>
            <UserCog size={15} /> Minha conta
          </button>
          <button type="button" className={cx(tab === 'contas' && 'is-active')} onClick={() => setTab('contas')}>
            <Shield size={15} /> Contas da instalação
          </button>
        </div>
      )}

      {tab === 'conta' ? (
        <>
          <Tokens />
          <Password />
        </>
      ) : (
        <Users />
      )}
    </Modal>
  );
}
