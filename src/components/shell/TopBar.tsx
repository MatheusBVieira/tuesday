import { Info, Sparkles, Unplug, UserCog, Users } from 'lucide-react';
import { cx } from '../../lib/format';
import { navigate } from '../../router';
import { actions, useStore } from '../../store';
import { Avatar } from '../ui/Avatar';
import { Menu, MenuDivider, MenuItem, MenuTitle } from '../ui/Menu';
import { PopoverPanel, usePopover } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';
import { Logo } from './Logo';

export function TopBar() {
  const connected = useStore((s) => s.connected);
  const me = useStore((s) => s.people.find((p) => p.id === s.meId));
  const viewer = useStore((s) => s.viewer);
  const projectId = useStore((s) => s.projectId);
  const app = useStore((s) => s.app);
  const firstBoard = useStore((s) => s.boards[0]?.id ?? null);
  const menu = usePopover({ placement: 'bottom-end' });

  return (
    <header className="topbar">
      <div className="topbar__left">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate({ boardId: firstBoard, view: 'table', itemId: null });
          }}
        >
          <Logo />
          <span className="brand__name">tuesday</span>
        </a>
      </div>
      <div className="topbar__right">
        {!connected && (
          <span className="topbar__offline">
            <Unplug size={14} /> Reconectando ao servidor…
          </span>
        )}
        <Tooltip content="Conectar o Claude via MCP">
          <button type="button" className="topbar__claude" onClick={() => actions.openModal({ kind: 'connect-claude' })}>
            <Sparkles size={16} /> Claude
          </button>
        </Tooltip>
        <Tooltip content="Pessoas">
          <button
            type="button"
            className="icon-btn topbar__icon"
            onClick={() => actions.openModal({ kind: 'people' })}
            aria-label="Pessoas"
          >
            <Users size={19} />
          </button>
        </Tooltip>
        <span className="topbar__divider" />
        <button
          ref={menu.refs.setReference}
          {...menu.getReferenceProps({ onClick: () => menu.setOpen(!menu.open) })}
          type="button"
          className={cx('topbar__me', menu.open && 'is-open')}
          aria-label="Minha conta"
        >
          <Avatar person={me} size={32} />
        </button>
      </div>
      <PopoverPanel popover={menu}>
        <Menu>
          <MenuTitle>{viewer?.name ?? me?.name ?? 'Você'}</MenuTitle>
          {viewer && (
            <MenuItem
              icon={<UserCog size={16} />}
              label={viewer.master ? 'Minha conta e as contas' : 'Minha conta'}
              onClick={() => {
                menu.setOpen(false);
                actions.openModal({ kind: 'account' });
              }}
            />
          )}
          {viewer && projectId != null && (
            <MenuItem
              icon={<Users size={16} />}
              label="Quem participa do projeto"
              onClick={() => {
                menu.setOpen(false);
                actions.openModal({ kind: 'members', projectId });
              }}
            />
          )}
          <MenuItem
            icon={<Users size={16} />}
            label="Pessoas e perfil"
            onClick={() => {
              menu.setOpen(false);
              actions.openModal({ kind: 'people' });
            }}
          />
          <MenuItem
            icon={<Sparkles size={16} />}
            label="Conectar o Claude (MCP)"
            onClick={() => {
              menu.setOpen(false);
              actions.openModal({ kind: 'connect-claude' });
            }}
          />
          <MenuDivider />
          <MenuItem icon={<Info size={16} />} label={`tuesday v${app?.version ?? ''} · open source`} disabled />
        </Menu>
      </PopoverPanel>
    </header>
  );
}
