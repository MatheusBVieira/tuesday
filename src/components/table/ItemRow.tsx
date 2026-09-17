import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowRightLeft,
  ChevronRight,
  Copy,
  Ellipsis,
  GitCommitHorizontal,
  Hash,
  Link,
  ListPlus,
  Maximize2,
  MessageCircle,
  MessageCirclePlus,
  Pencil,
  Trash,
} from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import type { Column, Item } from '../../../shared/types';
import { formatItemRef } from '../../../shared/values';
import { domOnly } from '../../lib/dnd';
import { cx, plural } from '../../lib/format';
import { navigate, routeUrl } from '../../router';
import { actions, toast, useStore } from '../../store';
import { Cell } from '../cells/Cell';
import { SubitemsChip } from '../item/SubitemsChip';
import { Checkbox } from '../ui/Checkbox';
import { EditableText } from '../ui/EditableText';
import { Menu, MenuDivider, MenuItem, MenuTitle } from '../ui/Menu';
import { PopoverPanel, usePopover } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';

const copy = (text: string, message: string) =>
  void navigator.clipboard?.writeText(text).then(() => toast(message, 'success', undefined, 2500));

export function ItemMenu({ item, onRename, onClose }: { item: Item; onRename?: () => void; onClose: () => void }) {
  const board = useStore((s) => s.board);
  const [moving, setMoving] = useState(false);
  if (!board) return null;
  const refColumn = board.columns.find((c) => c.type === 'auto_number');
  const ref = refColumn ? formatItemRef(refColumn.settings, item.number) : null;

  if (moving) {
    return (
      <Menu>
        <MenuTitle>Mover para o grupo</MenuTitle>
        {board.groups.map((g) => (
          <MenuItem
            key={g.id}
            icon={<span className="menu__swatch" style={{ background: g.color }} />}
            label={g.name}
            selected={g.id === item.groupId}
            onClick={() => {
              onClose();
              if (g.id !== item.groupId) void actions.moveItemsToGroup([item.id], g.id);
            }}
          />
        ))}
      </Menu>
    );
  }

  const run = (fn: () => unknown) => () => {
    onClose();
    void fn();
  };

  return (
    <Menu>
      <MenuItem icon={<Maximize2 size={16} />} label="Abrir item" onClick={run(() => navigate({ itemId: item.id }))} />
      <MenuItem
        icon={<ListPlus size={16} />}
        label={item.subitems.length ? 'Ver subitens' : 'Adicionar subitens'}
        onClick={run(() => actions.openItem(item.id, 'subitems'))}
      />
      {onRename && <MenuItem icon={<Pencil size={16} />} label="Renomear" onClick={onRename} />}
      <MenuItem icon={<Copy size={16} />} label="Duplicar" onClick={run(() => actions.duplicateItems([item.id]))} />
      <MenuItem
        icon={<ArrowRightLeft size={16} />}
        label="Mover para o grupo"
        end={<ChevronRight size={14} />}
        onClick={() => setMoving(true)}
      />
      {ref && <MenuItem icon={<Hash size={16} />} label={`Copiar ID (${ref})`} onClick={run(() => copy(ref, `${ref} copiado.`))} />}
      <MenuItem
        icon={<Link size={16} />}
        label="Copiar link do item"
        onClick={run(() =>
          copy(`${window.location.origin}${routeUrl({ boardId: item.boardId, view: 'table', itemId: item.id })}`, 'Link copiado.'),
        )}
      />
      <MenuDivider />
      <MenuItem icon={<Trash size={16} />} label="Excluir" danger onClick={run(() => actions.deleteItems([item.id]))} />
    </Menu>
  );
}

export function UpdatesButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <Tooltip content={count ? plural(count, 'atualização', 'atualizações') : 'Adicionar atualização'}>
      <button type="button" className={cx('updates-btn', count > 0 && 'has-updates')} onClick={onClick} aria-label="Abrir atualizações">
        {count > 0 ? <MessageCircle size={21} strokeWidth={1.6} /> : <MessageCirclePlus size={21} strokeWidth={1.4} />}
        {count > 0 && <span className="updates-btn__count">{count > 99 ? '99+' : count}</span>}
      </button>
    </Tooltip>
  );
}

export const ItemRow = memo(function ItemRow({ item, columns, sortable }: { item: Item; columns: Column[]; sortable: boolean }) {
  const selected = useStore((s) => s.selection.includes(item.id));
  const editNonce = useStore((s) => (s.editRequest?.itemId === item.id ? s.editRequest.nonce : 0));
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !sortable });
  const [editing, setEditing] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const menu = usePopover({ placement: 'bottom-start' });

  useEffect(() => {
    if (!editNonce) return;
    setEditing(true);
    rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [editNonce]);

  const open = () => navigate({ itemId: item.id });

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        rowRef.current = el;
      }}
      className={cx('row', selected && 'is-selected', isDragging && 'is-dragging')}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...domOnly(listeners)}
    >
      <div className="row-sticky">
        <div className="row-gutter">
          <button
            ref={menu.refs.setReference}
            {...menu.getReferenceProps({ onClick: () => menu.setOpen(!menu.open) })}
            type="button"
            className={cx('icon-btn icon-btn--sm gutter-btn', menu.open && 'is-open')}
            aria-label="Ações do item"
          >
            <Ellipsis size={16} />
          </button>
        </div>
        <div className="cell cell--bar" />
        <div className="cell cell--check">
          <Checkbox checked={selected} onChange={() => actions.toggleSelected(item.id)} label={`Selecionar ${item.name}`} />
        </div>
        <div className="cell cell--name">
          <div className="name-cell">
            <EditableText
              value={item.name}
              onSave={(name) => void actions.renameItem(item.id, name)}
              editing={editing}
              onEditingChange={setEditing}
              className="name-cell__text"
              inputClassName="name-cell__input"
            />
            {!editing && <SubitemsChip item={item} />}
            {item.commitsCount > 0 && !editing && (
              <Tooltip content={plural(item.commitsCount, 'commit ligado', 'commits ligados')}>
                <span className="name-cell__commits">
                  <GitCommitHorizontal size={14} />
                  {item.commitsCount}
                </span>
              </Tooltip>
            )}
            <button type="button" className="name-cell__open" onClick={open}>
              <Maximize2 size={13} /> Abrir
            </button>
          </div>
          <UpdatesButton count={item.updatesCount} onClick={open} />
        </div>
      </div>
      {columns.map((column) => (
        <div key={column.id} className={cx('cell', `cell--${column.type}`)} style={{ width: `var(--col-${column.id})` }}>
          <Cell item={item} column={column} />
        </div>
      ))}
      <div className="cell cell--end" />
      <PopoverPanel popover={menu}>
        <ItemMenu
          item={item}
          onClose={() => menu.setOpen(false)}
          onRename={() => {
            menu.setOpen(false);
            setEditing(true);
          }}
        />
      </PopoverPanel>
    </div>
  );
});
