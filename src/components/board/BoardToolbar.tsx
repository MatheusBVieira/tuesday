import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  CircleUserRound,
  CodeXml,
  EyeOff,
  ListFilter,
  Rows3,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Person } from '../../../shared/types';
import { cx } from '../../lib/format';
import { cardColumnIdsOf, laneColumnOf } from '../../lib/kanban';
import { activeFilterCount, filterItems, hasActiveFilters, isFilterable } from '../../lib/view';
import { navigate, type ViewKind } from '../../router';
import { actions, useStore } from '../../store';
import { ColumnTypeIcon } from '../cells/columnMeta';
import { FilterOptionList } from './FilterOptions';
import { Avatar, AvatarStack } from '../ui/Avatar';
import { Checkbox } from '../ui/Checkbox';
import { Menu, MenuItem } from '../ui/Menu';
import { PopoverPanel, usePopover } from '../ui/Popover';

const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

async function createNewItem(view: ViewKind) {
  const board = useStore.getState().board;
  const group = board?.groups[0];
  if (!board || !group) return;
  if (view === 'kanban') {
    const lane = laneColumnOf(board);
    const first = lane?.settings.labels?.[0];
    const item = await actions.createItem(group.id, 'Novo item', {
      position: 'top',
      kanbanPosition: 'top',
      values: lane && first ? { [String(lane.id)]: first.id } : undefined,
    });
    if (item) navigate({ itemId: item.id });
    return;
  }
  if (group.collapsed) await actions.updateGroup(group.id, { collapsed: false });
  const item = await actions.createItem(group.id, 'Novo item', { position: 'top', kanbanPosition: 'top' });
  if (item) actions.requestEdit(item.id);
}

function NewItemButton({ view }: { view: ViewKind }) {
  const menu = usePopover({ placement: 'bottom-start' });
  return (
    <div className="split-btn">
      <button type="button" className="btn btn--primary btn--sm split-btn__main" onClick={() => void createNewItem(view)}>
        Novo item
      </button>
      <button
        ref={menu.refs.setReference}
        {...menu.getReferenceProps({ onClick: () => menu.setOpen(!menu.open) })}
        type="button"
        className="btn btn--primary btn--sm split-btn__arrow"
        aria-label="Mais opções de criação"
      >
        <ChevronDown size={16} />
      </button>
      <PopoverPanel popover={menu}>
        <Menu>
          <MenuItem
            icon={<Rows3 size={16} />}
            label="Novo grupo de itens"
            onClick={() => {
              menu.setOpen(false);
              void actions.createGroup('top');
            }}
          />
          <MenuItem
            icon={<CodeXml size={16} />}
            label="Importar TODOs do código"
            onClick={() => {
              menu.setOpen(false);
              const board = useStore.getState().board;
              if (board) actions.openModal({ kind: 'import-todos', projectId: board.projectId, boardId: board.id });
            }}
          />
        </Menu>
      </PopoverPanel>
    </div>
  );
}

function SearchBox() {
  const search = useStore((s) => s.filters.search);
  const [open, setOpen] = useState(search !== '');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open && !search) {
    return (
      <button type="button" className="btn btn--tertiary btn--sm" onClick={() => setOpen(true)}>
        <Search size={16} /> Pesquisar
      </button>
    );
  }
  return (
    <div className="toolbar-search">
      <Search size={16} />
      <input
        ref={inputRef}
        value={search}
        placeholder="Pesquisar neste quadro"
        onChange={(e) => actions.setFilters({ search: e.target.value })}
        onBlur={() => {
          if (!search) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            actions.setFilters({ search: '' });
            setOpen(false);
          }
        }}
      />
      {search && (
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          onClick={() => actions.setFilters({ search: '' })}
          aria-label="Limpar busca"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function PersonFilter() {
  const people = useStore((s) => s.people);
  const selected = useStore((s) => s.filters.people);
  const popover = usePopover({ placement: 'bottom-start' });
  const chosen = selected.map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p);
  return (
    <>
      <button
        ref={popover.refs.setReference}
        {...popover.getReferenceProps({ onClick: () => popover.setOpen(!popover.open) })}
        type="button"
        className={cx('btn btn--tertiary btn--sm', chosen.length > 0 && 'is-active')}
      >
        {chosen.length ? <AvatarStack people={chosen} size={20} max={2} /> : <CircleUserRound size={16} />}
        Pessoa
        {chosen.length > 0 && (
          <span
            className="btn__clear"
            role="button"
            aria-label="Limpar filtro de pessoa"
            onClick={(e) => {
              e.stopPropagation();
              actions.setFilters({ people: [] });
            }}
          >
            <X size={13} />
          </span>
        )}
      </button>
      <PopoverPanel popover={popover} className="person-filter-popover">
        <div className="popover-title">Filtrar por pessoa</div>
        <p className="popover-subtitle">Mostra os itens em que a pessoa está atribuída.</p>
        <div className="person-filter__list">
          {people.map((p) => (
            <button
              key={p.id}
              type="button"
              className={cx('person-filter__avatar', selected.includes(p.id) && 'is-selected')}
              title={p.name}
              onClick={() => actions.setFilters({ people: toggle(selected, p.id) })}
            >
              <Avatar person={p} size={34} />
            </button>
          ))}
        </div>
      </PopoverPanel>
    </>
  );
}

function FilterButton() {
  const board = useStore((s) => s.board)!;
  const people = useStore((s) => s.people);
  const filters = useStore((s) => s.filters);
  const popover = usePopover({ placement: 'bottom-start' });
  const count = activeFilterCount(filters);
  const columns = board.columns.filter(isFilterable);
  const visible = useMemo(() => filterItems(board, filters, people).length, [board, filters, people]);

  return (
    <>
      <button
        ref={popover.refs.setReference}
        {...popover.getReferenceProps({ onClick: () => popover.setOpen(!popover.open) })}
        type="button"
        className={cx('btn btn--tertiary btn--sm', count > 0 && 'is-active')}
      >
        <ListFilter size={16} /> Filtrar {count > 0 && <span className="btn__badge">{count}</span>}
      </button>
      <PopoverPanel popover={popover} className="filter-popover">
        <div className="filter-popover__head">
          <div>
            <div className="popover-title">Filtro rápido</div>
            <div className="popover-subtitle">
              Mostrando {visible} de {board.items.length} itens
            </div>
          </div>
          {count > 0 && (
            <button type="button" className="btn btn--tertiary btn--sm" onClick={() => actions.setFilters({ labels: {} })}>
              Limpar tudo
            </button>
          )}
        </div>
        {columns.length === 0 ? (
          <p className="popover-subtitle">Adicione colunas de status, pessoas, data ou checkbox para filtrar.</p>
        ) : (
          <div className="filter-popover__columns">
            {columns.map((column) => (
              <div key={column.id} className="filter-col">
                <div className="filter-col__title ellipsis">{column.title}</div>
                <FilterOptionList column={column} />
              </div>
            ))}
          </div>
        )}
      </PopoverPanel>
    </>
  );
}

function SortButton() {
  const board = useStore((s) => s.board)!;
  const sort = useStore((s) => s.filters.sort);
  const popover = usePopover({ placement: 'bottom-start' });
  const itemTitle = board.settings.table?.itemColumnTitle || 'Item';
  const options = [{ id: 'name' as const, title: itemTitle }, ...board.columns.map((c) => ({ id: c.id, title: c.title }))];
  const current = sort ? options.find((o) => o.id === sort.columnId) : undefined;
  const dir = sort?.dir ?? 'asc';

  const setColumn = (raw: string) => {
    if (!raw) return actions.setFilters({ sort: null });
    actions.setFilters({ sort: { columnId: raw === 'name' ? 'name' : Number(raw), dir } });
  };

  return (
    <>
      <button
        ref={popover.refs.setReference}
        {...popover.getReferenceProps({ onClick: () => popover.setOpen(!popover.open) })}
        type="button"
        className={cx('btn btn--tertiary btn--sm', sort && 'is-active')}
      >
        <ArrowUpDown size={16} /> Ordenar{current && <span className="btn__detail">: {current.title}</span>}
      </button>
      <PopoverPanel popover={popover} className="sort-popover">
        <div className="popover-title">Ordenar por</div>
        <div className="sort-row">
          <select className="input input--sm" value={sort ? String(sort.columnId) : ''} onChange={(e) => setColumn(e.target.value)}>
            <option value="">Escolha uma coluna</option>
            {options.map((o) => (
              <option key={o.id} value={String(o.id)}>
                {o.title}
              </option>
            ))}
          </select>
          <div className="segmented">
            <button
              type="button"
              className={cx(dir === 'asc' && 'is-active')}
              disabled={!sort}
              onClick={() => sort && actions.setFilters({ sort: { ...sort, dir: 'asc' } })}
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              className={cx(dir === 'desc' && 'is-active')}
              disabled={!sort}
              onClick={() => sort && actions.setFilters({ sort: { ...sort, dir: 'desc' } })}
            >
              <ArrowDown size={14} />
            </button>
          </div>
          {sort && (
            <button
              type="button"
              className="icon-btn icon-btn--sm"
              onClick={() => actions.setFilters({ sort: null })}
              aria-label="Remover ordenação"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <p className="popover-hint">A ordenação vale só para a visualização. Para mudar a ordem de verdade, arraste os itens.</p>
      </PopoverPanel>
    </>
  );
}

function HideColumnsButton() {
  const board = useStore((s) => s.board)!;
  const hidden = board.settings.table?.hiddenColumnIds ?? [];
  const popover = usePopover({ placement: 'bottom-start' });
  const setHidden = (ids: number[]) => void actions.updateTableSettings({ hiddenColumnIds: ids });
  return (
    <>
      <button
        ref={popover.refs.setReference}
        {...popover.getReferenceProps({ onClick: () => popover.setOpen(!popover.open) })}
        type="button"
        className={cx('btn btn--tertiary btn--sm', hidden.length > 0 && 'is-active')}
      >
        <EyeOff size={16} /> Ocultar {hidden.length > 0 && <span className="btn__badge">{hidden.length}</span>}
      </button>
      <PopoverPanel popover={popover} className="hide-popover">
        <div className="popover-title">Colunas visíveis</div>
        <div className="check-list">
          <div className="check-row check-row--all" onClick={() => setHidden(hidden.length ? [] : board.columns.map((c) => c.id))}>
            <Checkbox
              checked={hidden.length === 0}
              indeterminate={hidden.length > 0 && hidden.length < board.columns.length}
              onChange={() => setHidden(hidden.length ? [] : board.columns.map((c) => c.id))}
            />
            <span>Todas as colunas</span>
          </div>
          {board.columns.map((column) => (
            <div key={column.id} className="check-row" onClick={() => setHidden(toggle(hidden, column.id))}>
              <Checkbox checked={!hidden.includes(column.id)} onChange={() => setHidden(toggle(hidden, column.id))} />
              <ColumnTypeIcon type={column.type} size={15} />
              <span className="ellipsis">{column.title}</span>
            </div>
          ))}
        </div>
      </PopoverPanel>
    </>
  );
}

function KanbanCustomizeButton() {
  const board = useStore((s) => s.board)!;
  const popover = usePopover({ placement: 'bottom-start' });
  const lane = laneColumnOf(board);
  const statusColumns = board.columns.filter((c) => c.type === 'status');
  const cardIds = cardColumnIdsOf(board, lane);
  const collapsed = board.settings.kanban?.collapsedLanes ?? [];
  return (
    <>
      <button
        ref={popover.refs.setReference}
        {...popover.getReferenceProps({ onClick: () => popover.setOpen(!popover.open) })}
        type="button"
        className="btn btn--tertiary btn--sm"
      >
        <SlidersHorizontal size={16} /> Personalizar
      </button>
      <PopoverPanel popover={popover} className="kanban-settings">
        <div className="popover-title">Coluna do Kanban</div>
        <p className="popover-subtitle">As raias são as etiquetas desta coluna de status.</p>
        <div className="radio-list">
          {statusColumns.map((column) => (
            <button
              key={column.id}
              type="button"
              className={cx('radio-row', column.id === lane?.id && 'is-selected')}
              onClick={() => void actions.updateKanbanSettings({ laneColumnId: column.id, collapsedLanes: [] })}
            >
              <span className="radio" />
              <span className="ellipsis">{column.title}</span>
            </button>
          ))}
        </div>
        <div className="popover-title kanban-settings__section">Mostrar nos cartões</div>
        <div className="check-list">
          {board.columns
            .filter((c) => c.id !== lane?.id)
            .map((column) => (
              <div
                key={column.id}
                className="check-row"
                onClick={() => void actions.updateKanbanSettings({ cardColumnIds: toggle(cardIds, column.id) })}
              >
                <Checkbox
                  checked={cardIds.includes(column.id)}
                  onChange={() => void actions.updateKanbanSettings({ cardColumnIds: toggle(cardIds, column.id) })}
                />
                <ColumnTypeIcon type={column.type} size={15} />
                <span className="ellipsis">{column.title}</span>
              </div>
            ))}
        </div>
        {collapsed.length > 0 && (
          <button
            type="button"
            className="btn btn--secondary btn--sm kanban-settings__expand"
            onClick={() => void actions.updateKanbanSettings({ collapsedLanes: [] })}
          >
            Expandir todas as raias
          </button>
        )}
      </PopoverPanel>
    </>
  );
}

export function BoardToolbar({ view }: { view: ViewKind }) {
  const filters = useStore((s) => s.filters);
  return (
    <div className="toolbar">
      <NewItemButton view={view} />
      <SearchBox />
      <PersonFilter />
      <FilterButton />
      <SortButton />
      {view === 'table' ? <HideColumnsButton /> : <KanbanCustomizeButton />}
      {hasActiveFilters(filters) && (
        <button type="button" className="btn btn--tertiary btn--sm toolbar__clear" onClick={() => actions.clearFilters()}>
          Limpar filtros
        </button>
      )}
    </div>
  );
}
