import { ArrowRightLeft, Copy, Trash, X } from 'lucide-react';
import { useEffect } from 'react';
import { actions, useStore } from '../../store';
import { Menu, MenuItem, MenuTitle } from '../ui/Menu';
import { PopoverPanel, usePopover } from '../ui/Popover';

export function BulkActionBar() {
  const selection = useStore((s) => s.selection);
  const board = useStore((s) => s.board);
  const move = usePopover({ placement: 'top' });

  useEffect(() => {
    if (!selection.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.popover, .modal-overlay, .item-panel')) return;
      if (e.target instanceof Element && e.target.closest('input, textarea')) return;
      actions.clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection.length]);

  if (!selection.length || !board) return null;
  const groupColors = [
    ...new Set(
      selection
        .map((id) => board.items.find((i) => i.id === id)?.groupId)
        .map((gid) => board.groups.find((g) => g.id === gid)?.color)
        .filter((c): c is string => !!c),
    ),
  ];

  return (
    <div className="bulk-bar" role="toolbar" aria-label="Ações para os itens selecionados">
      <div className="bulk-bar__count">{selection.length}</div>
      <div className="bulk-bar__label">
        <span>{selection.length === 1 ? 'Item selecionado' : 'Itens selecionados'}</span>
        <span className="bulk-bar__dots">
          {groupColors.map((color) => (
            <span key={color} className="bulk-bar__dot" style={{ background: color }} />
          ))}
        </span>
      </div>
      <div className="bulk-bar__actions">
        <button type="button" className="bulk-action" onClick={() => void actions.duplicateItems(selection)}>
          <Copy size={20} />
          <span>Duplicar</span>
        </button>
        <button
          ref={move.refs.setReference}
          {...move.getReferenceProps({ onClick: () => move.setOpen(!move.open) })}
          type="button"
          className="bulk-action"
        >
          <ArrowRightLeft size={20} />
          <span>Mover para</span>
        </button>
        <button type="button" className="bulk-action bulk-action--danger" onClick={() => void actions.deleteItems(selection)}>
          <Trash size={20} />
          <span>Excluir</span>
        </button>
      </div>
      <button type="button" className="bulk-bar__close" onClick={() => actions.clearSelection()} aria-label="Limpar seleção">
        <X size={20} />
      </button>
      <PopoverPanel popover={move}>
        <Menu>
          <MenuTitle>Mover para o grupo</MenuTitle>
          {board.groups.map((g) => (
            <MenuItem
              key={g.id}
              icon={<span className="menu__swatch" style={{ background: g.color }} />}
              label={g.name}
              onClick={() => {
                move.setOpen(false);
                void actions.moveItemsToGroup(selection, g.id);
                actions.clearSelection();
              }}
            />
          ))}
        </Menu>
      </PopoverPanel>
    </div>
  );
}
