import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Ellipsis,
  Palette,
  Pencil,
  Plus,
  Trash,
} from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import type { Column, Group, Item } from '../../../shared/types';
import { cx, plural } from '../../lib/format';
import { actions, useStore } from '../../store';
import { ColorPalette } from '../ui/ColorPalette';
import { EditableText } from '../ui/EditableText';
import { Menu, MenuDivider, MenuItem, MenuTitle } from '../ui/Menu';
import { PopoverPanel, usePopover } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';
import { AddItemRow } from './AddItemRow';
import { HeaderRow } from './HeaderRow';
import { ItemRow } from './ItemRow';
import { ColumnSummary, SummaryRow } from './Summary';

interface Position {
  isFirst: boolean;
  isLast: boolean;
  groupCount: number;
}

function GroupMenu({
  group,
  onRename,
  onClose,
  isFirst,
  isLast,
  groupCount,
}: { group: Group; onRename: () => void; onClose: () => void } & Position) {
  const [view, setView] = useState<'main' | 'color'>('main');
  const total = useStore((s) => s.board?.items.filter((i) => i.groupId === group.id).length ?? 0);

  if (view === 'color') {
    return (
      <div>
        <MenuTitle>Cor do grupo</MenuTitle>
        <ColorPalette
          value={group.color}
          onSelect={(color) => {
            onClose();
            void actions.updateGroup(group.id, { color });
          }}
        />
      </div>
    );
  }

  const run = (fn: () => unknown) => () => {
    onClose();
    void fn();
  };

  return (
    <Menu>
      <MenuItem
        icon={<ChevronsDownUp size={16} />}
        label={group.collapsed ? 'Expandir este grupo' : 'Recolher este grupo'}
        onClick={run(() => actions.updateGroup(group.id, { collapsed: !group.collapsed }))}
      />
      <MenuItem
        icon={<ChevronsDownUp size={16} />}
        label="Recolher todos os grupos"
        onClick={run(() => actions.setAllGroupsCollapsed(true))}
      />
      <MenuItem
        icon={<ChevronsUpDown size={16} />}
        label="Expandir todos os grupos"
        onClick={run(() => actions.setAllGroupsCollapsed(false))}
      />
      <MenuDivider />
      <MenuItem icon={<Plus size={16} />} label="Adicionar grupo" onClick={run(() => actions.createGroup('bottom'))} />
      <MenuItem icon={<Pencil size={16} />} label="Renomear grupo" onClick={onRename} />
      <MenuItem icon={<Palette size={16} />} label="Mudar cor do grupo" onClick={() => setView('color')} />
      <MenuItem
        icon={<ArrowUp size={16} />}
        label="Mover para cima"
        disabled={isFirst}
        onClick={run(() => actions.moveGroup(group.id, -1))}
      />
      <MenuItem
        icon={<ArrowDown size={16} />}
        label="Mover para baixo"
        disabled={isLast}
        onClick={run(() => actions.moveGroup(group.id, 1))}
      />
      <MenuDivider />
      <MenuItem
        icon={<Trash size={16} />}
        label="Excluir grupo"
        danger
        disabled={groupCount <= 1}
        onClick={run(() =>
          actions.confirm({
            title: 'Excluir grupo?',
            message: total
              ? `O grupo "${group.name}" e ${plural(total, 'item', 'itens')} serão excluídos permanentemente.`
              : `O grupo "${group.name}" será excluído.`,
            confirmLabel: 'Excluir grupo',
            danger: true,
            onConfirm: () => actions.deleteGroup(group.id),
          }),
        )}
      />
    </Menu>
  );
}

function GroupMenuButton({ group, onRename, ...pos }: { group: Group; onRename: () => void } & Position) {
  const menu = usePopover({ placement: 'bottom-start' });
  return (
    <>
      <button
        ref={menu.refs.setReference}
        {...menu.getReferenceProps({ onClick: () => menu.setOpen(!menu.open) })}
        type="button"
        className={cx('icon-btn icon-btn--sm gutter-btn', menu.open && 'is-open')}
        aria-label="Ações do grupo"
      >
        <Ellipsis size={16} />
      </button>
      <PopoverPanel popover={menu}>
        <GroupMenu
          group={group}
          {...pos}
          onClose={() => menu.setOpen(false)}
          onRename={() => {
            menu.setOpen(false);
            onRename();
          }}
        />
      </PopoverPanel>
    </>
  );
}

function GroupTitle({ group, count, ...pos }: { group: Group; count: number } & Position) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="group-title">
      <div className="group-title__sticky">
        <div className="row-gutter">
          <GroupMenuButton group={group} onRename={() => setEditing(true)} {...pos} />
        </div>
        <Tooltip content="Recolher grupo">
          <button
            type="button"
            className="group-title__chevron"
            onClick={() => void actions.updateGroup(group.id, { collapsed: true })}
            aria-label="Recolher grupo"
          >
            <ChevronDown size={20} />
          </button>
        </Tooltip>
        <EditableText
          value={group.name}
          onSave={(name) => void actions.updateGroup(group.id, { name })}
          editing={editing}
          onEditingChange={setEditing}
          className="group-title__name"
          inputClassName="group-title__input"
        />
        <span className="group-title__count">{plural(count, 'item', 'itens')}</span>
      </div>
    </div>
  );
}

function CollapsedGroupRow({ group, items, columns, ...pos }: { group: Group; items: Item[]; columns: Column[] } & Position) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="collapsed-row">
      <div className="row-sticky">
        <div className="row-gutter">
          <GroupMenuButton group={group} onRename={() => setEditing(true)} {...pos} />
        </div>
        <div className="cell cell--bar" />
        <div className="collapsed-row__title">
          <Tooltip content="Expandir grupo">
            <button
              type="button"
              className="group-title__chevron"
              onClick={() => void actions.updateGroup(group.id, { collapsed: false })}
              aria-label="Expandir grupo"
            >
              <ChevronRight size={20} />
            </button>
          </Tooltip>
          <div className="collapsed-row__text">
            <EditableText
              value={group.name}
              onSave={(name) => void actions.updateGroup(group.id, { name })}
              editing={editing}
              onEditingChange={setEditing}
              className="group-title__name"
              inputClassName="group-title__input"
            />
            <span className="collapsed-row__count">{plural(items.length, 'item', 'itens')}</span>
          </div>
        </div>
      </div>
      {columns.map((column) => (
        <div key={column.id} className="collapsed-cell" style={{ width: `var(--col-${column.id})` }}>
          <span className="collapsed-cell__title ellipsis">{column.title}</span>
          <div className="collapsed-cell__summary">
            <ColumnSummary column={column} items={items} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function GroupSection({
  group,
  items,
  columns,
  sortable,
  ...pos
}: {
  group: Group;
  items: Item[];
  columns: Column[];
  sortable: boolean;
} & Position) {
  const { setNodeRef } = useDroppable({ id: `group-${group.id}` });
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const style = { '--group-color': group.color } as CSSProperties;

  if (group.collapsed) {
    return (
      <section ref={setNodeRef} className="group group--collapsed" style={style}>
        <CollapsedGroupRow group={group} items={items} columns={columns} {...pos} />
      </section>
    );
  }

  return (
    <section ref={setNodeRef} className="group" style={style}>
      <div className="group__head">
        <GroupTitle group={group} count={items.length} {...pos} />
        <HeaderRow columns={columns} itemIds={ids} />
      </div>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {items.map((item) => (
          <ItemRow key={item.id} item={item} columns={columns} sortable={sortable} />
        ))}
      </SortableContext>
      <AddItemRow group={group} />
      <SummaryRow items={items} columns={columns} />
    </section>
  );
}
