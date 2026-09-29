// Tela de entrada do tuesday publicado num servidor: criar conta, entrar e aceitar convite de projeto.
import { ArrowRight } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ROLE_HINTS, ROLE_LABELS } from '../../../shared/roles';
import { authApi, type AuthInfo, type InvitePreview } from '../../api/auth';
import { errorText } from '../../api/client';
import { navigate, useRoute } from '../../router';
import { actions, useStore } from '../../store';
import { Logo } from '../shell/Logo';
import './auth.css';

type Tab = 'entrar' | 'criar';

/** O "G" do Google, como no botão de entrar deles. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18A13.2 13.2 0 0 1 11 24c0-1.45.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

/** O projeto do convite, na mesma pílula colorida que o app usa em outros lugares. */
function ProjectChip({ preview }: { preview: InvitePreview }) {
  return (
    <span className="auth__chip">
      <span className="auth__chip-dot" style={{ background: preview.project.color }} />
      {preview.project.name}
    </span>
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

  // Relê o convite quando a conta muda: quem sai da conta não pode continuar vendo "você já está no projeto".
  useEffect(() => {
    if (!token) return;
    authApi
      .invite(token)
      .then((data) => {
        setPreview(data);
        // Quem chega por um convite quase nunca tem conta ainda: já abre em "criar conta".
        setTab(data.alreadyMember ? 'entrar' : 'criar');
      })
      .catch((cause) => setInviteError(errorText(cause, 'Este convite não vale mais.')));
  }, [token, viewer?.userId]);

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
  const criando = tab === 'criar';

  // Título e linha de apoio mudam com o contexto, como nas telas de entrada do monday.
  const head = preview
    ? {
        title: preview.alreadyMember ? `Você já está em ${preview.project.name}` : `Entre em ${preview.project.name}`,
        sub: preview.alreadyMember
          ? 'Entre na sua conta para abrir o projeto.'
          : `Convite para participar como ${ROLE_LABELS[preview.role].toLowerCase()}: ${ROLE_HINTS[preview.role].toLowerCase().replace(/\.$/, '')}.`,
      }
    : firstRun
      ? {
          title: 'Boas-vindas ao tuesday',
          sub: 'A conta que você criar agora administra este tuesday — é ela que vê e gerencia as outras contas.',
        }
      : criando
        ? { title: 'Crie a sua conta', sub: 'Nome, e-mail e senha. Não enviamos e-mail nenhum: nada para confirmar depois.' }
        : { title: 'Fazer login na sua conta', sub: 'Entre para ver os projetos em que você participa.' };

  return (
    <div className="auth">
      <div className="auth__col">
        <div className="auth__brand">
          <Logo />
          <span>tuesday</span>
        </div>

        {preview && <ProjectChip preview={preview} />}
        <h1 className="auth__title">{inviteError ? 'Convite indisponível' : head.title}</h1>
        <p className="auth__sub">{inviteError ?? head.sub}</p>

        {viewer && preview ? (
          <>
            <button type="button" className="btn btn--primary auth__cta" disabled={busy} onClick={() => void accept()}>
              {preview.alreadyMember ? 'Abrir o projeto' : 'Entrar no projeto'} <ArrowRight size={18} />
            </button>
            {error && <p className="auth__error">{error}</p>}
            <p className="auth__foot-line">
              Na conta <strong>{viewer.email}</strong> —{' '}
              <button type="button" className="auth__link" onClick={() => void actions.signOut()}>
                entrar com outra
              </button>
            </p>
          </>
        ) : (
          !inviteError && (
            <>
              {info?.google && (
                <>
                  <button type="button" className="btn btn--secondary auth__google" onClick={() => void google()}>
                    <GoogleMark /> Continuar com o Google
                  </button>
                  <div className="auth__or">Ou</div>
                </>
              )}

              <form className="auth__form" onSubmit={(e) => void submit(e)}>
                {criando && (
                  <input
                    className="input auth__input"
                    autoFocus
                    autoComplete="name"
                    placeholder="Seu nome"
                    aria-label="Seu nome"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={80}
                  />
                )}
                <input
                  className="input auth__input"
                  type="email"
                  autoComplete="email"
                  autoFocus={!criando}
                  placeholder="nome@empresa.com"
                  aria-label="E-mail"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <input
                  className="input auth__input"
                  type="password"
                  autoComplete={criando ? 'new-password' : 'current-password'}
                  placeholder={criando ? 'Senha (mínimo 8 caracteres)' : 'Senha'}
                  aria-label="Senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />

                {error && <p className="auth__error">{error}</p>}

                <button type="submit" className="btn btn--primary auth__cta" disabled={busy}>
                  {criando ? (preview ? 'Criar conta e entrar' : 'Criar conta') : preview ? 'Entrar no projeto' : 'Entrar'}{' '}
                  <ArrowRight size={18} />
                </button>
              </form>

              {!firstRun && (
                <p className="auth__foot-line">
                  {criando ? 'Já tem uma conta?' : 'Ainda não tem uma conta?'}{' '}
                  <button type="button" className="auth__link" onClick={() => setTab(criando ? 'entrar' : 'criar')}>
                    {criando ? 'Entrar' : 'Criar conta'}
                  </button>
                </p>
              )}
            </>
          )
        )}
      </div>
      <p className="auth__note">tuesday — gestão de tarefas open source, no seu servidor.</p>
    </div>
  );
}
