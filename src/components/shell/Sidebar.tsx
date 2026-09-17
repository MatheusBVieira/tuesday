import {
  CalendarCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  ExternalLink,
  Folder,
  Pencil,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Table2,
  Trash,
} from 'lucide-react';
import { useState } from 'react';
import type { BoardSummary } from '../../../shared/types';
import { fold } from '../../../shared/values';
import { cx, plural, shortPath } from '../../lib/format';
import { getRoute, navigate, routeUrl, useRoute } from '../../router';
import { actions, useStore } from '../../store';
import { EditableText } from '../ui/EditableText';
import { Menu, MenuDivider, MenuItem, MenuTitle } from '../ui/Menu';
import { PopoverPanel, usePopover } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';
import { ProjectBadge } from './ProjectModal';

function ProjectSwitcher() {
  const projects = useStore((s) => s.projects);
  const projectId = useStore((s) => s.projectId);
  const current = projects.find((p) => p.id === projectId);
  const popover = usePopover({ placement: 'bottom-start', matchWidth: true });
  const [query, setQuery] = useState('');
  const shown = projects.filter((p) => fold(p.name).includes(fold(query)));

  return (
    <>
      <button
        ref={popover.refs.setReference}
        {...popover.getReferenceProps({ onClick: () => popover.setOpen(!popover.open) })}
        type="button"
        className={cx('workspace', popover.open && 'is-open')}
        aria-label="Trocar de projeto"
      >
        <ProjectBadge name={current?.name ?? '?'} color={current?.color ?? '#c4c4c4'} size={30} />
        <span className="workspace__text">
          <span className="workspace__name ellipsis">{current?.name ?? 'Nenhum projeto'}</span>
          <span className="workspace__meta ellipsis">
            {current?.folder ? (
              <>
                <Folder size={11} /> {shortPath(current.folder)}
              </>
            ) : (
              plural(current?.boardCount ?? 0, 'quadro', 'quadros')
            )}
          </span>
        </span>
        <ChevronDown size={16} className="workspace__chevron" />
      </button>
      <PopoverPanel popover={popover} className="project-popover">
        {projects.length > 5 && (
          <div className="search-field project-popover__search">
            <Search size={15} />
            <input
              autoFocus
              className="input input--sm"
              placeholder="Buscar projetos"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}
        <MenuTitle>Projetos</MenuTitle>
        <div className="project-popover__list">
          {shown.map((p) => (
            <button
              key={p.id}
              type="button"
              className={cx('project-option', p.id === projectId && 'is-selected')}
              onClick={() => {
                popover.setOpen(false);
                setQuery('');
                actions.selectProject(p.id);
              }}
            >
              <ProjectBadge name={p.name} color={p.color} size={26} />
              <span className="project-option__text">
                <span className="ellipsis">{p.name}</span>
                {p.folder && (
                  <span className="project-option__folder ellipsis" title={p.folder}>
                    <Folder size={11} /> {shortPath(p.folder)}
                  </span>
                )}
              </span>
              <span className="project-option__count">{p.boardCount}</span>
            </button>
          ))}
        </div>
        <MenuDivider />
        <MenuItem
          icon={<Plus size={16} />}
          label="Novo projeto"
          onClick={() => {
            popover.setOpen(false);
            actions.openModal({ kind: 'project' });
          }}
        />
        {current && (
          <MenuItem
            icon={<Settings2 size={16} />}
            label="Configurações do projeto"
            onClick={() => {
              popover.setOpen(false);
              actions.openModal({ kind: 'project', projectId: current.id });
            }}
          />
        )}
      </PopoverPanel>
    </>
  );
}

function BoardLink({ board, active }: { board: BoardSummary; active: boolean }) {
  const menu = usePopover({ placement: 'right-start' });
  const [editing, setEditing] = useState(false);
  const url = routeUrl({ boardId: board.id, view: 'table', itemId: null });

  return (
    <li className={cx('board-link', active && 'is-active')}>
      {editing ? (
        <div className="board-link__main">
          <Table2 size={18} />
          <EditableText
            value={board.name}
            editing
            onEditingChange={setEditing}
            onSave={(name) => void actions.updateBoard(board.id, { name })}
            inputClassName="board-link__input"
          />
        </div>
      ) : (
        <a
          href={url}
          className="board-link__main"
          onClick={(e) => {
            if (e.ctrlKey || e.metaKey || e.button === 1) return;
            e.preventDefault();
            navigate({ boardId: board.id, view: getRoute().view, itemId: null });
          }}
          title={board.name}
        >
          <Table2 size={18} />
          <span className="ellipsis">{board.name}</span>
        </a>
      )}
      <button
        ref={menu.refs.setReference}
        {...menu.getReferenceProps({ onClick: () => menu.setOpen(!menu.open) })}
        type="button"
        className={cx('icon-btn icon-btn--sm board-link__menu', menu.open && 'is-open')}
        aria-label={`Opções de ${board.name}`}
      >
        <Ellipsis size={16} />
      </button>
      <PopoverPanel popover={menu}>
        <Menu>
          <MenuItem
            icon={<ExternalLink size={16} />}
            label="Abrir em nova aba"
            onClick={() => {
              menu.setOpen(false);
              window.open(url, '_blank');
            }}
          />
          <MenuItem
            icon={<Pencil size={16} />}
            label="Renomear"
            onClick={() => {
              menu.setOpen(false);
              setEditing(true);
            }}
          />
          <MenuDivider />
          <MenuItem
            icon={<Trash size={16} />}
            label="Excluir quadro"
            danger
            onClick={() => {
              menu.setOpen(false);
              actions.confirm({
                title: 'Excluir quadro?',
                message: `O quadro "${board.name}" e ${plural(board.itemCount, 'item', 'itens')} serão excluídos permanentemente.`,
                confirmLabel: 'Excluir quadro',
                danger: true,
                onConfirm: () => actions.deleteBoard(board.id),
              });
            }}
          />
        </Menu>
      </PopoverPanel>
    </li>
  );
}

function MyWorkLink({ active }: { active: boolean }) {
  return (
    <nav className="sidebar__nav" aria-label="Navegação">
      <a
        href={routeUrl({ page: 'my-work', boardId: null, view: 'table', itemId: null })}
        className={cx('sidebar-link', active && 'is-active')}
        aria-current={active ? 'page' : undefined}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey || e.button === 1) return;
          e.preventDefault();
          navigate({ page: 'my-work', boardId: null, itemId: null });
        }}
      >
        <CalendarCheck size={18} />
        <span>Meu trabalho</span>
      </a>
    </nav>
  );
}

export function Sidebar() {
  const boards = useStore((s) => s.boards);
  const projectId = useStore((s) => s.projectId);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const route = useRoute();
  const [query, setQuery] = useState('');
  const shown = boards.filter((b) => b.projectId === projectId && fold(b.name).includes(fold(query)));

  if (collapsed) {
    return (
      <aside className="sidebar sidebar--collapsed">
        <Tooltip content="Expandir barra lateral" placement="right">
          <button
            type="button"
            className="sidebar__toggle is-visible"
            onClick={() => actions.toggleSidebar()}
            aria-label="Expandir barra lateral"
          >
            <ChevronRight size={14} />
          </button>
        </Tooltip>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <Tooltip content="Recolher barra lateral" placement="right">
        <button type="button" className="sidebar__toggle" onClick={() => actions.toggleSidebar()} aria-label="Recolher barra lateral">
          <ChevronLeft size={14} />
        </button>
      </Tooltip>

      <MyWorkLink active={route.page === 'my-work'} />

      <ProjectSwitcher />

      <div className="sidebar__tools">
        <div className="search-field">
          <Search size={15} />
          <input className="input input--sm" placeholder="Buscar quadros" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Tooltip content="Novo quadro neste projeto">
          <button
            type="button"
            className="icon-btn sidebar__add"
            onClick={() => actions.openModal({ kind: 'new-board' })}
            aria-label="Novo quadro"
          >
            <Plus size={18} />
          </button>
        </Tooltip>
      </div>

      <nav className="sidebar__boards" aria-label="Quadros">
        <ul className="board-list">
          {shown.map((board) => (
            <BoardLink key={board.id} board={board} active={route.page === 'board' && route.boardId === board.id} />
          ))}
        </ul>
        {shown.length === 0 && <p className="sidebar__empty">{query ? 'Nenhum quadro encontrado.' : 'Nenhum quadro neste projeto.'}</p>}
      </nav>

      <button type="button" className="sidebar__claude" onClick={() => actions.openModal({ kind: 'connect-claude' })}>
        <span className="sidebar__claude-icon">
          <Sparkles size={16} />
        </span>
        <span className="sidebar__claude-text">
          <strong>Use com o Claude</strong>
          <span>Conecte o MCP e peça tarefas em linguagem natural.</span>
        </span>
      </button>
    </aside>
  );
}
