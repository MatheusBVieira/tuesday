import { Activity, ChevronRight, Ellipsis, FolderInput, House, Info, Pencil, Sparkles, SquareKanban, Trash, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cx, plural } from '../../lib/format';
import { navigate, type ViewKind } from '../../router';
import { actions, useStore } from '../../store';
import { AvatarStack } from '../ui/Avatar';
import { EditableText } from '../ui/EditableText';
import { Menu, MenuDivider, MenuItem, MenuTitle } from '../ui/Menu';
import { PopoverPanel, usePopover } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';

function BoardDescription({ boardId, description, onDone }: { boardId: number; description: string; onDone: () => void }) {
  const [draft, setDraft] = useState(description);
  return (
    <div className="board-info">
      <div className="popover-title">Descrição do quadro</div>
      <textarea
        autoFocus
        className="textarea"
        value={draft}
        maxLength={2000}
        placeholder="Para que serve este quadro?"
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="popover-actions">
        <button type="button" className="btn btn--tertiary btn--sm" onClick={onDone}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => {
            if (draft.trim() !== description) void actions.updateBoard(boardId, { description: draft.trim() });
            onDone();
          }}
        >
          Salvar
        </button>
      </div>
    </div>
  );
}

function MoveToProjectMenu({ boardId, currentProjectId, onDone }: { boardId: number; currentProjectId: number; onDone: () => void }) {
  const projects = useStore((s) => s.projects);
  const others = projects.filter((p) => p.id !== currentProjectId);
  return (
    <Menu>
      <MenuTitle>Mover quadro para o projeto</MenuTitle>
      {others.length === 0 && <div className="menu__empty">Crie outro projeto primeiro.</div>}
      {others.map((p) => (
        <MenuItem
          key={p.id}
          icon={<span className="menu__swatch menu__swatch--square" style={{ background: p.color }} />}
          label={p.name}
          onClick={() => {
            onDone();
            void actions.moveBoardToProject(boardId, p.id);
          }}
        />
      ))}
    </Menu>
  );
}

export function BoardHeader({ view }: { view: ViewKind }) {
  const board = useStore((s) => s.board)!;
  const people = useStore((s) => s.people);
  const [editing, setEditing] = useState(false);
  const [menuView, setMenuView] = useState<'main' | 'move'>('main');
  const info = usePopover({ placement: 'bottom-start' });
  const menu = usePopover({ placement: 'bottom-end', onOpenChange: (open) => !open && setMenuView('main') });

  const assigned = useMemo(() => {
    const columns = board.columns.filter((c) => c.type === 'people');
    const ids = new Set<number>();
    for (const item of board.items)
      for (const column of columns) for (const id of (item.values[String(column.id)] as number[] | undefined) ?? []) ids.add(id);
    return people.filter((p) => ids.has(p.id));
  }, [board, people]);

  const run = (fn: () => unknown) => () => {
    menu.setOpen(false);
    void fn();
  };

  return (
    <header className="board-header">
      <div className="board-header__top">
        <div className="board-header__title-wrap">
          <EditableText
            value={board.name}
            onSave={(name) => void actions.updateBoard(board.id, { name })}
            editing={editing}
            onEditingChange={setEditing}
            className="board-header__title"
            inputClassName="board-header__title-input"
            maxLength={120}
          />
          <Tooltip content="Descrição do quadro">
            <button
              ref={info.refs.setReference}
              {...info.getReferenceProps({ onClick: () => info.setOpen(!info.open) })}
              type="button"
              className={cx('icon-btn', info.open && 'is-active')}
              aria-label="Descrição do quadro"
            >
              <Info size={18} />
            </button>
          </Tooltip>
        </div>
        <div className="board-header__actions">
          {assigned.length > 0 && (
            <Tooltip content={assigned.map((p) => p.name).join(', ')}>
              <span className="board-header__people">
                <AvatarStack people={assigned} size={28} max={4} />
              </span>
            </Tooltip>
          )}
          <button type="button" className="btn btn--tertiary btn--sm" onClick={() => actions.setActivityOpen(true)}>
            <Activity size={16} /> Atividade
          </button>
          <button
            ref={menu.refs.setReference}
            {...menu.getReferenceProps({ onClick: () => menu.setOpen(!menu.open) })}
            type="button"
            className={cx('icon-btn', menu.open && 'is-active')}
            aria-label="Mais ações do quadro"
          >
            <Ellipsis size={18} />
          </button>
        </div>
      </div>
      {board.description && (
        <p className="board-header__desc ellipsis" title={board.description}>
          {board.description}
        </p>
      )}
      <nav className="board-tabs" role="tablist" aria-label="Visualizações">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'table'}
          className={cx('board-tab', view === 'table' && 'is-active')}
          onClick={() => navigate({ view: 'table' })}
        >
          <House size={16} /> Tabela principal
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'kanban'}
          className={cx('board-tab', view === 'kanban' && 'is-active')}
          onClick={() => navigate({ view: 'kanban' })}
        >
          <SquareKanban size={16} /> Kanban
        </button>
      </nav>

      <PopoverPanel popover={info} className="board-info-popover">
        <BoardDescription boardId={board.id} description={board.description} onDone={() => info.setOpen(false)} />
      </PopoverPanel>
      <PopoverPanel popover={menu}>
        {menuView === 'move' ? (
          <MoveToProjectMenu boardId={board.id} currentProjectId={board.projectId} onDone={() => menu.setOpen(false)} />
        ) : (
          <Menu>
            <MenuItem
              icon={<Pencil size={16} />}
              label="Renomear quadro"
              onClick={() => {
                menu.setOpen(false);
                setEditing(true);
              }}
            />
            <MenuItem
              icon={<FolderInput size={16} />}
              label="Mover para outro projeto"
              end={<ChevronRight size={14} />}
              onClick={() => setMenuView('move')}
            />
            <MenuItem icon={<Activity size={16} />} label="Registro de atividades" onClick={run(() => actions.setActivityOpen(true))} />
            <MenuItem icon={<Users size={16} />} label="Gerenciar pessoas" onClick={run(() => actions.openModal({ kind: 'people' }))} />
            <MenuItem
              icon={<Sparkles size={16} />}
              label="Conectar o Claude"
              onClick={run(() => actions.openModal({ kind: 'connect-claude' }))}
            />
            <MenuDivider />
            <MenuItem
              icon={<Trash size={16} />}
              label="Excluir quadro"
              danger
              onClick={run(() =>
                actions.confirm({
                  title: 'Excluir quadro?',
                  message: `O quadro "${board.name}" e ${plural(board.items.length, 'item', 'itens')} serão excluídos permanentemente.`,
                  confirmLabel: 'Excluir quadro',
                  danger: true,
                  onConfirm: () => actions.deleteBoard(board.id),
                }),
              )}
            />
          </Menu>
        )}
      </PopoverPanel>
    </header>
  );
}
