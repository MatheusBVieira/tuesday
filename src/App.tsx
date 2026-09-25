import { FolderOpen, LayoutGrid, Plus, Unplug } from 'lucide-react';
import { useEffect } from 'react';
import { AuthPage } from './components/auth/AuthPage';
import { BoardPage } from './components/board/BoardPage';
import { ActivityDrawer } from './components/item/ActivityDrawer';
import { ItemPanel } from './components/item/ItemPanel';
import { MyWorkPage } from './components/mywork/MyWorkPage';
import { ModalHost } from './components/shell/ModalHost';
import { Sidebar } from './components/shell/Sidebar';
import { TopBar } from './components/shell/TopBar';
import { Toasts } from './components/ui/Toasts';
import { useLiveSync } from './lib/live';
import { navigate, useRoute } from './router';
import { actions, toast, useStore } from './store';
import './styles/app.css';

function ConnectionError({ message }: { message: string }) {
  return (
    <div className="connection-error">
      <div className="connection-error__card">
        <Unplug size={40} strokeWidth={1.4} />
        <h2>Não foi possível abrir o tuesday</h2>
        <p>{message}</p>
        <p className="connection-error__hint">
          Verifique se o servidor está rodando (<code>npm run dev</code> ou <code>npm start</code>).
        </p>
        <button type="button" className="btn btn--primary" onClick={() => void actions.init()}>
          Tentar de novo
        </button>
      </div>
    </div>
  );
}

function ProjectEmpty() {
  const project = useStore((s) => s.projects.find((p) => p.id === s.projectId));
  if (!project) {
    return (
      <div className="empty-state app-empty">
        <LayoutGrid size={48} strokeWidth={1.3} />
        <h3>Crie seu primeiro projeto</h3>
        <p>Projetos agrupam quadros. Vincule cada um à pasta do código para o Claude saber onde trabalhar.</p>
        <button type="button" className="btn btn--primary" onClick={() => actions.openModal({ kind: 'project' })}>
          <Plus size={16} /> Novo projeto
        </button>
      </div>
    );
  }
  return (
    <div className="empty-state app-empty">
      <LayoutGrid size={48} strokeWidth={1.3} />
      <h3>{project.name} ainda não tem quadros</h3>
      <p>Crie um quadro para organizar as tarefas em grupos, acompanhar o status e ver tudo no Kanban.</p>
      <div className="empty-state__actions">
        <button type="button" className="btn btn--primary" onClick={() => actions.openModal({ kind: 'new-board' })}>
          <Plus size={16} /> Criar quadro
        </button>
        {!project.folder && (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => actions.openModal({ kind: 'project', projectId: project.id })}
          >
            <FolderOpen size={16} /> Vincular pasta
          </button>
        )}
      </div>
    </div>
  );
}

export function App() {
  const ready = useStore((s) => s.ready);
  const signedOut = useStore((s) => s.signedOut);
  const loadError = useStore((s) => s.loadError);
  const boards = useStore((s) => s.boards);
  const projectId = useStore((s) => s.projectId);
  const board = useStore((s) => s.board);
  const boardMissing = useStore((s) => s.boardMissing);
  const activityOpen = useStore((s) => s.activityOpen);
  const route = useRoute();
  const onBoardPage = route.page === 'board';

  useLiveSync();

  useEffect(() => {
    void actions.init();
  }, []);

  useEffect(() => {
    if (!ready || !onBoardPage) return;
    if (route.boardId == null) {
      const first = boards.find((b) => b.projectId === projectId);
      if (first) navigate({ boardId: first.id }, { replace: true });
      return;
    }
    if (useStore.getState().board?.id !== route.boardId) {
      actions.setActivityOpen(false);
      void actions.loadBoard(route.boardId);
    }
  }, [ready, onBoardPage, route.boardId, boards, projectId]);

  useEffect(() => {
    // Relê o estado: o quadro pode ter sido recarregado ao voltar de "Meu trabalho".
    if (!boardMissing || !onBoardPage || !useStore.getState().boardMissing) return;
    toast('Esse quadro não existe mais.', 'error');
    const next = boards.find((b) => b.projectId === projectId) ?? boards[0];
    navigate({ boardId: next?.id ?? null, itemId: null }, { replace: true });
  }, [boardMissing, onBoardPage, boards, projectId]);

  useEffect(() => {
    document.title = !onBoardPage ? 'Meu trabalho · tuesday' : board ? `${board.name} · tuesday` : 'tuesday';
  }, [onBoardPage, board?.name, board]);

  if (loadError) return <ConnectionError message={loadError} />;
  // Servidor com contas: entrar vem antes de tudo; o link de convite também abre esta tela.
  if (signedOut || route.page === 'invite') return <AuthPage />;

  const showBoard = onBoardPage && board && board.id === route.boardId;
  const projectIsEmpty = ready && onBoardPage && route.boardId == null && !boards.some((b) => b.projectId === projectId);

  return (
    <div className="app">
      <TopBar />
      <div className="app__body">
        <Sidebar />
        <main className="app__main">
          {route.page === 'my-work' && ready ? (
            <MyWorkPage />
          ) : showBoard ? (
            <BoardPage view={route.view} />
          ) : projectIsEmpty ? (
            <ProjectEmpty />
          ) : (
            <div className="app-loading">
              <div className="spinner" />
            </div>
          )}
        </main>
      </div>
      {route.itemId != null && ready && <ItemPanel itemId={route.itemId} />}
      {activityOpen && showBoard && <ActivityDrawer />}
      <ModalHost />
      <Toasts />
    </div>
  );
}
