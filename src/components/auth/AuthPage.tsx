// Tela de entrada do tuesday publicado num servidor: criar conta, entrar e aceitar convite de projeto.
import { ArrowRight, Check, LogIn, UserPlus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ROLE_HINTS, ROLE_LABELS } from '../../../shared/roles';
import { authApi, type AuthInfo, type InvitePreview } from '../../api/auth';
import { errorText } from '../../api/client';
import { cx } from '../../lib/format';
import { navigate, useRoute } from '../../router';
import { actions, useStore } from '../../store';
import { Logo } from '../shell/Logo';
import './auth.css';

type Tab = 'entrar' | 'criar';

function InviteCard({ preview }: { preview: InvitePreview }) {
  return (
    <div className="auth-invite">
      <span className="auth-invite__dot" style={{ background: preview.project.color }} />
      <div>
        <strong>{preview.project.name}</strong>
        <span className="auth-invite__role">
          Convite para entrar como {ROLE_LABELS[preview.role].toLowerCase()} — {ROLE_HINTS[preview.role].toLowerCase()}
        </span>
      </div>
    </div>
  );
}

export function AuthPage() {
  const route = useRoute();
  const viewer = useStore((s) => s.viewer);
  const [info, setInfo] = useState<AuthInfo | null>(null);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('entrar');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = route.page === 'invite' ? route.invite : null;

  useEffect(() => {
    authApi
      .info()
      .then((data) => {
        setInfo(data);
        setTab(data.firstRun ? 'criar' : 'entrar');
      })
      .catch(() => setInfo({ accounts: true, google: false, firstRun: false }));
  }, []);

  useEffect(() => {
    if (!token) return;
    authApi
      .invite(token)
      .then((data) => {
        setPreview(data);
        setTab((current) => (info?.firstRun ? 'criar' : current));
      })
      .catch((cause) => setInviteError(errorText(cause, 'Este convite não vale mais.')));
  }, [token, info?.firstRun]);

  // Já entrou e o link é de convite: basta aceitar.
  const accept = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.acceptInvite(token);
      await actions.init();
      navigate({ page: 'board', boardId: null, invite: null }, { replace: true });
      window.location.assign('/');
      return result;
    } catch (cause) {
      setError(errorText(cause, 'Não foi possível entrar no projeto.'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (tab === 'criar') await actions.signUp(name, email, password);
      else await actions.signIn(email, password);
      if (token) {
        await authApi.acceptInvite(token).catch(() => undefined);
        await actions.init();
      }
      if (route.page === 'invite') window.location.assign('/');
    } catch (cause) {
      setError(errorText(cause, 'Não foi possível entrar.'));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    try {
      const { url } = await authApi.googleUrl(
        token ? `${window.location.origin}/convite/${encodeURIComponent(token)}` : window.location.origin,
      );
      window.location.assign(url);
    } catch (cause) {
      setError(errorText(cause, 'Não foi possível entrar com o Google.'));
    }
  };

  const firstRun = !!info?.firstRun;

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <Logo />
          <span>tuesday</span>
        </div>

        {preview && <InviteCard preview={preview} />}
        {inviteError && <div className="auth__error">{inviteError}</div>}

        {viewer && preview ? (
          <>
            <p className="auth__lead">
              Você já está na conta <strong>{viewer.email}</strong>.
            </p>
            <button type="button" className="btn btn--primary auth__submit" disabled={busy} onClick={() => void accept()}>
              {preview.alreadyMember ? 'Abrir o projeto' : 'Entrar no projeto'} <ArrowRight size={16} />
            </button>
            <button type="button" className="auth__link" onClick={() => void actions.signOut()}>
              Entrar com outra conta
            </button>
          </>
        ) : (
          <>
            {firstRun ? (
              <p className="auth__lead">
                Primeira vez aqui: a conta que você criar agora administra este tuesday — é ela que vê e gerencia as outras contas.
              </p>
            ) : (
              <div className="auth__tabs">
                <button type="button" className={cx(tab === 'entrar' && 'is-active')} onClick={() => setTab('entrar')}>
                  <LogIn size={15} /> Entrar
                </button>
                <button type="button" className={cx(tab === 'criar' && 'is-active')} onClick={() => setTab('criar')}>
                  <UserPlus size={15} /> Criar conta
                </button>
              </div>
            )}

            <form className="auth__form" onSubmit={(e) => void submit(e)}>
              {tab === 'criar' && (
                <label className="auth__field">
                  Nome
                  <input
                    className="input"
                    autoFocus
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={80}
                  />
                </label>
              )}
              <label className="auth__field">
                E-mail
                <input
                  className="input"
                  type="email"
                  autoComplete="email"
                  autoFocus={tab === 'entrar'}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label className="auth__field">
                Senha
                <input
                  className="input"
                  type="password"
                  autoComplete={tab === 'criar' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
                {tab === 'criar' && <span className="auth__hint">Pelo menos 8 caracteres.</span>}
              </label>

              {error && <div className="auth__error">{error}</div>}

              <button type="submit" className="btn btn--primary auth__submit" disabled={busy}>
                {tab === 'criar' ? (
                  <>
                    <Check size={16} /> Criar conta {preview ? 'e entrar no projeto' : ''}
                  </>
                ) : (
                  <>
                    <LogIn size={16} /> Entrar
                  </>
                )}
              </button>
            </form>

            {info?.google && (
              <button type="button" className="btn btn--secondary auth__google" onClick={() => void google()}>
                Entrar com o Google
              </button>
            )}
          </>
        )}
      </div>
      <p className="auth__foot">tuesday — gestão de tarefas open source, no seu servidor.</p>
    </div>
  );
}
