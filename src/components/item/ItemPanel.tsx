import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock,
  Copy,
  Ellipsis,
  FolderOpen,
  GitCommitHorizontal,
  ListChecks,
  MessageCircle,
  Pencil,
  RefreshCw,
  Trash,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Board, Item, ItemCommit, ItemDetails, Person, Update } from '../../../shared/types';
import { subitemProgress } from '../../../shared/subitems';
import { formatItemRef } from '../../../shared/values';
import { ApiError, api, errorText } from '../../api/client';
import { ago, cx, formatDateTime, relativeTime, shortPath } from '../../lib/format';
import { getRoute, navigate } from '../../router';
import { actions, toast, useStore, type PanelTab } from '../../store';
import { Cell } from '../cells/Cell';
import { ColumnTypeIcon } from '../cells/columnMeta';
import { ItemMenu } from '../table/ItemRow';
import { Avatar } from '../ui/Avatar';
import { EditableText } from '../ui/EditableText';
import { Markdown } from '../ui/Markdown';
import { Menu, MenuDivider, MenuItem } from '../ui/Menu';
import { PopoverPanel, usePopover } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';
import { ActivityList } from './ActivityList';
import { SubitemsTab } from './SubitemsTab';
import './item.css';

const copyText = (text: string, message = 'Copiado.') =>
  void navigator.clipboard?.writeText(text).then(() => toast(message, 'success', undefined, 2000));

function UpdateCard({ update, author, itemId }: { update: Update; author: Person | undefined; itemId: number }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(update.body);
  const menu = usePopover({ placement: 'bottom-end' });
  const edited = update.updatedAt !== update.createdAt;

  return (
    <article className={cx('update-card', author?.isAgent && 'update-card--agent')}>
      <header className="update-card__head">
        <Avatar person={author} size={32} />
        <div className="update-card__author">
          <span className="ellipsis">{author?.name ?? 'Desconhecido'}</span>
          {author?.isAgent && <span className="tag tag--agent">via MCP</span>}
        </div>
        <Tooltip content={formatDateTime(update.createdAt)}>
          <span className="update-card__time">
            <Clock size={14} /> {relativeTime(update.createdAt)}
            {edited && ' · editado'}
          </span>
        </Tooltip>
        <button
          ref={menu.refs.setReference}
          {...menu.getReferenceProps({ onClick: () => menu.setOpen(!menu.open) })}
          type="button"
          className="icon-btn icon-btn--sm"
          aria-label="Ações da atualização"
        >
          <Ellipsis size={16} />
        </button>
      </header>
      {editing ? (
        <div className="update-card__edit">
          <textarea autoFocus className="textarea" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="update-card__edit-actions">
            <button type="button" className="btn btn--tertiary btn--sm" onClick={() => setEditing(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={!draft.trim()}
              onClick={async () => {
                const saved = await actions.editUpdate(update.id, draft);
                if (saved) setEditing(false);
              }}
            >
              Salvar
            </button>
          </div>
        </div>
      ) : (
        <Markdown source={update.body} className="update-card__body" />
      )}
      <PopoverPanel popover={menu}>
        <Menu>
          <MenuItem
            icon={<Pencil size={16} />}
            label="Editar"
            onClick={() => {
              menu.setOpen(false);
              setDraft(update.body);
              setEditing(true);
            }}
          />
          <MenuItem
            icon={<Copy size={16} />}
            label="Copiar texto"
            onClick={() => {
              menu.setOpen(false);
              copyText(update.body, 'Texto copiado.');
            }}
          />
          <MenuDivider />
          <MenuItem
            icon={<Trash size={16} />}
            label="Excluir atualização"
            danger
            onClick={() => {
              menu.setOpen(false);
              actions.confirm({
                title: 'Excluir atualização?',
                message: 'A atualização será removida permanentemente.',
                confirmLabel: 'Excluir',
                danger: true,
                onConfirm: () => actions.deleteUpdate(itemId, update.id),
              });
            }}
          />
        </Menu>
      </PopoverPanel>
    </article>
  );
}

function UpdatesTab({ item, updates }: { item: Item; updates: Update[] | undefined }) {
  const people = useStore((s) => s.people);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [posting, setPosting] = useState(false);

  const submit = async () => {
    if (!draft.trim() || posting) return;
    setPosting(true);
    const created = await actions.postUpdate(item.id, draft);
    setPosting(false);
    if (created) {
      setDraft('');
      setOpen(false);
    }
  };

  return (
    <div className="updates">
      <div className={cx('composer', (open || draft) && 'is-open')}>
        {open || draft ? (
          <>
            <textarea
              autoFocus
              className="composer__input"
              value={draft}
              placeholder="Escreva uma atualização…"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (!draft) setOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void submit();
                }
                if (e.key === 'Escape' && !draft) setOpen(false);
              }}
            />
            <div className="composer__footer">
              <span className="composer__hint">
                Markdown suportado · <span className="kbd">Ctrl</span> + <span className="kbd">Enter</span> publica
              </span>
              <button type="button" className="btn btn--primary btn--sm" disabled={!draft.trim() || posting} onClick={() => void submit()}>
                Atualizar
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="composer__placeholder" onClick={() => setOpen(true)}>
            Escreva uma atualização…
          </button>
        )}
      </div>

      {updates === undefined ? (
        <div className="panel-loading">
          <div className="spinner" />
        </div>
      ) : updates.length === 0 ? (
        <div className="empty-state updates-empty">
          <MessageCircle size={44} strokeWidth={1.3} />
          <h3>Nenhuma atualização ainda</h3>
          <p>Registre progresso, decisões e perguntas deste item. O Claude também pode postar aqui pelo MCP.</p>
        </div>
      ) : (
        updates.map((update) => (
          <UpdateCard key={update.id} update={update} author={people.find((p) => p.id === update.authorId)} itemId={item.id} />
        ))
      )}
    </div>
  );
}

function CommitRow({ commit, showRepo }: { commit: ItemCommit; showRepo: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="commit-row">
      <span className={cx('commit-row__dot', commit.closed && 'is-closed')}>
        <GitCommitHorizontal size={16} />
      </span>
      <div className="commit-row__main">
        <div className="commit-row__subject">
          <span>{commit.subject}</span>
          {commit.closed && (
            <span className="commit-badge">
              <CircleCheck size={12} /> concluiu o item
            </span>
          )}
        </div>
        <div className="commit-row__meta">
          {commit.url ? (
            <a className="commit-hash" href={commit.url} target="_blank" rel="noopener noreferrer" title="Abrir no repositório">
              {commit.shortHash}
            </a>
          ) : (
            <button type="button" className="commit-hash" onClick={() => copyText(commit.hash, 'Hash copiado.')} title="Copiar hash">
              {commit.shortHash}
            </button>
          )}
          {showRepo && commit.repo && <span className="commit-row__repo">{commit.repo}</span>}
          <span>{commit.authorName}</span>
          <Tooltip content={formatDateTime(commit.committedAt)}>
            <span>{ago(commit.committedAt)}</span>
          </Tooltip>
          {commit.body && (
            <button type="button" className="commit-row__more" onClick={() => setOpen(!open)}>
              {open ? 'menos' : 'mais'}
            </button>
          )}
        </div>
        {open && <pre className="commit-row__body">{commit.body}</pre>}
      </div>
    </li>
  );
}

function CommitsTab({ item, commits, board }: { item: Item; commits: ItemCommit[] | undefined; board: Board | null }) {
  const project = useStore((s) => s.projects.find((p) => p.id === board?.projectId));
  const [syncing, setSyncing] = useState(false);
  const refColumn = board?.columns.find((c) => c.type === 'auto_number');
  const ref = refColumn ? formatItemRef(refColumn.settings, item.number) : null;
  const repoCount = project?.git?.repos.length ?? 0;
  const fromSeveralRepos = new Set((commits ?? []).map((c) => c.repo)).size > 1;

  if (commits === undefined) {
    return (
      <div className="panel-loading">
        <div className="spinner" />
      </div>
    );
  }

  if (!ref) {
    return (
      <div className="empty-state commits-empty">
        <GitCommitHorizontal size={44} strokeWidth={1.3} />
        <h3>Este quadro não tem a coluna "ID do item"</h3>
        <p>
          Os commits são ligados pela referência do item (ex.: TUE-012). Adicione uma coluna "ID do item" ao quadro para usar a integração
          com Git.
        </p>
      </div>
    );
  }

  const sync = async () => {
    if (!project) return;
    setSyncing(true);
    await actions.syncGit(project.id);
    setSyncing(false);
  };

  return (
    <div className="commits">
      {project?.folder && (
        <div className="commits-head">
          <span className="commits-head__info">
            {project.git?.error && !project.git.repos.length ? (
              <>
                <CircleAlert size={14} /> {project.git.error}
              </>
            ) : (
              <>
                Commits {repoCount > 1 ? `de ${repoCount} repositórios em ` : 'em '}
                <code>{shortPath(project.folder)}</code> que citam <code>{ref}</code>
              </>
            )}
          </span>
          <button type="button" className="btn btn--tertiary btn--sm" disabled={syncing} onClick={() => void sync()}>
            <RefreshCw size={14} className={syncing ? 'spin' : undefined} /> Sincronizar
          </button>
        </div>
      )}
      {commits.length === 0 ? (
        <div className="empty-state commits-empty">
          <GitCommitHorizontal size={44} strokeWidth={1.3} />
          <h3>Nenhum commit ligado ainda</h3>
          <p>
            Cite <code>{ref}</code> na mensagem de um commit{project?.folder ? ' na pasta do projeto' : ''} e ele aparece aqui. Com{' '}
            <code>fixes {ref}</code> o item também vai para concluído.
          </p>
          <div className="empty-state__actions">
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => copyText(`fixes ${ref}`)}>
              <Copy size={14} /> Copiar "fixes {ref}"
            </button>
            {project && !project.folder && (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => actions.openModal({ kind: 'project', projectId: project.id })}
              >
                <FolderOpen size={14} /> Vincular pasta do projeto
              </button>
            )}
          </div>
        </div>
      ) : (
        <ul className="commit-list">
          {commits.map((commit) => (
            <CommitRow key={commit.hash} commit={commit} showRepo={fromSeveralRepos} />
          ))}
        </ul>
      )}
    </div>
  );
}

function GroupSelect({ item, board }: { item: Item; board: Board }) {
  const popover = usePopover({ placement: 'bottom-start', matchWidth: true });
  const group = board.groups.find((g) => g.id === item.groupId);
  return (
    <>
      <button
        ref={popover.refs.setReference}
        {...popover.getReferenceProps({ onClick: () => popover.setOpen(!popover.open) })}
        type="button"
        className={cx('group-select', popover.open && 'is-open')}
      >
        <span className="menu__swatch" style={{ background: group?.color }} />
        <span className="ellipsis">{group?.name ?? '—'}</span>
        <ChevronDown size={16} className="group-select__chevron" />
      </button>
      <PopoverPanel popover={popover}>
        <Menu>
          {board.groups.map((g) => (
            <MenuItem
              key={g.id}
              icon={<span className="menu__swatch" style={{ background: g.color }} />}
              label={g.name}
              selected={g.id === item.groupId}
              onClick={() => {
                popover.setOpen(false);
                if (g.id !== item.groupId) void actions.moveItemsToGroup([item.id], g.id);
              }}
            />
          ))}
        </Menu>
      </PopoverPanel>
    </>
  );
}

function InfoTab({ item, board }: { item: Item; board: Board }) {
  return (
    <div className="info-fields">
      <div className="info-field">
        <div className="info-field__label">Grupo</div>
        <div className="info-field__value info-field__value--plain">
          <GroupSelect item={item} board={board} />
        </div>
      </div>
      {board.columns.map((column) => (
        <div key={column.id} className="info-field">
          <div className="info-field__label">
            <ColumnTypeIcon type={column.type} size={16} />
            <span className="ellipsis">{column.title}</span>
          </div>
          <div className={cx('info-field__value', `info-field__value--${column.type}`)}>
            <Cell item={item} column={column} variant="panel" />
          </div>
        </div>
      ))}
      <p className="info-meta">
        Criado em {formatDateTime(item.createdAt)} · atualizado {relativeTime(item.updatedAt)}
      </p>
    </div>
  );
}

function PanelMenu({ item }: { item: Item }) {
  const menu = usePopover({ placement: 'bottom-end' });
  return (
    <>
      <button
        ref={menu.refs.setReference}
        {...menu.getReferenceProps({ onClick: () => menu.setOpen(!menu.open) })}
        type="button"
        className={cx('icon-btn', menu.open && 'is-active')}
        aria-label="Mais ações"
      >
        <Ellipsis size={18} />
      </button>
      <PopoverPanel popover={menu}>
        <ItemMenu item={item} onClose={() => menu.setOpen(false)} />
      </PopoverPanel>
    </>
  );
}

export function ItemPanel({ itemId }: { itemId: number }) {
  const board = useStore((s) => s.board);
  const storeItem = useStore((s) => s.board?.items.find((i) => i.id === itemId) ?? s.myWork?.items.find((i) => i.id === itemId));
  const revision = useStore((s) => s.revision);
  const [details, setDetails] = useState<ItemDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>('updates');
  const tabRequest = useStore((s) => s.panelTab);
  const close = useCallback(() => navigate({ itemId: null }), []);

  useEffect(() => {
    setDetails(null);
    setError(null);
    setTab('updates');
  }, [itemId]);

  useEffect(() => {
    if (!tabRequest || tabRequest.itemId !== itemId) return;
    setTab(tabRequest.tab);
    actions.clearPanelTab();
  }, [tabRequest, itemId]);

  useEffect(() => {
    let cancelled = false;
    api
      .itemDetails(itemId)
      .then((d) => {
        if (cancelled) return;
        setDetails(d);
        setError(null);
        const route = getRoute();
        if (route.page === 'board') {
          if (d.item.boardId !== route.boardId) navigate({ boardId: d.item.boardId, itemId }, { replace: true });
        } else if (useStore.getState().board?.id !== d.item.boardId) {
          // Fora do quadro (ex.: "Meu trabalho"): carrega o quadro do item sem sair da tela.
          void actions.loadBoard(d.item.boardId, { silent: true });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError && e.status === 404 ? 'Este item não existe mais.' : errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, revision]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.popover, .modal-overlay')) return;
      if (e.target instanceof Element && e.target.closest('input, textarea')) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const item = storeItem ?? details?.item ?? null;
  const group = item && board ? board.groups.find((g) => g.id === item.groupId) : undefined;
  const refColumn = board?.columns.find((c) => c.type === 'auto_number');
  const sameBoard = !!item && board?.id === item.boardId;
  const reference = refColumn && item && sameBoard ? formatItemRef(refColumn.settings, item.number) : null;
  const progress = subitemProgress(item?.subitems ?? []);

  return createPortal(
    <>
      <div className="panel-backdrop" onMouseDown={close} />
      <aside className="item-panel" role="dialog" aria-label={item?.name ?? 'Item'}>
        <div className="item-panel__header">
          <Tooltip content="Fechar (Esc)">
            <button type="button" className="icon-btn" onClick={close} aria-label="Fechar">
              <X size={20} />
            </button>
          </Tooltip>
          <div className="item-panel__crumbs">
            {board && item && sameBoard && (
              <>
                <span className="ellipsis">{board.name}</span>
                <span className="item-panel__crumb-sep">/</span>
                {group && (
                  <span className="item-panel__crumb-group">
                    <span className="menu__swatch" style={{ background: group.color }} />
                    <span className="ellipsis">{group.name}</span>
                  </span>
                )}
                {reference && <span className="item-panel__ref">{reference}</span>}
              </>
            )}
          </div>
          {item && <PanelMenu item={item} />}
        </div>

        {!item ? (
          error ? (
            <div className="empty-state">
              <CircleAlert size={40} strokeWidth={1.4} />
              <h3>{error}</h3>
              <button type="button" className="btn btn--secondary btn--sm" onClick={close}>
                Fechar
              </button>
            </div>
          ) : (
            <div className="panel-loading">
              <div className="spinner" />
            </div>
          )
        ) : (
          <>
            <div className="item-panel__title-row">
              <EditableText
                value={item.name}
                onSave={(name) => void actions.renameItem(item.id, name)}
                className="item-panel__title"
                inputClassName="item-panel__title-input"
              />
            </div>
            <div className="item-panel__tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'updates'}
                className={cx('panel-tab', tab === 'updates' && 'is-active')}
                onClick={() => setTab('updates')}
              >
                Atualizações {item.updatesCount > 0 && <span className="panel-tab__count">{item.updatesCount}</span>}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'subitems'}
                className={cx('panel-tab', tab === 'subitems' && 'is-active')}
                onClick={() => setTab('subitems')}
              >
                <ListChecks size={15} /> Subitens{' '}
                {progress.total > 0 && (
                  <span className={cx('panel-tab__count', progress.complete && 'is-complete')}>
                    {progress.done}/{progress.total}
                  </span>
                )}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'info'}
                className={cx('panel-tab', tab === 'info' && 'is-active')}
                onClick={() => setTab('info')}
              >
                Informações
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'commits'}
                className={cx('panel-tab', tab === 'commits' && 'is-active')}
                onClick={() => setTab('commits')}
              >
                <GitCommitHorizontal size={15} /> Commits{' '}
                {item.commitsCount > 0 && <span className="panel-tab__count">{item.commitsCount}</span>}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'activity'}
                className={cx('panel-tab', tab === 'activity' && 'is-active')}
                onClick={() => setTab('activity')}
              >
                Registro de atividades
              </button>
            </div>
            <div className="item-panel__content">
              {tab === 'updates' && <UpdatesTab item={item} updates={details?.updates} />}
              {tab === 'subitems' && <SubitemsTab item={item} reference={reference} />}
              {tab === 'info' && board && sameBoard && <InfoTab item={item} board={board} />}
              {tab === 'commits' && <CommitsTab item={item} commits={details?.commits} board={sameBoard ? board : null} />}
              {tab === 'activity' && <ActivityList entries={details?.activity} />}
            </div>
          </>
        )}
      </aside>
    </>,
    document.body,
  );
}
