// Quem participa de um projeto e os links de convite.
import { ChevronDown, Ellipsis, Link2, LogOut, UserMinus, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ROLE_HINTS, ROLE_LABELS, grantableRoles, type ProjectRole } from '../../../shared/roles';
import { authApi, type Invite, type Member } from '../../api/auth';
import { errorText } from '../../api/client';
import { cx } from '../../lib/format';
import { useRole } from '../../lib/permissions';
import { actions, useStore } from '../../store';
import { Avatar } from '../ui/Avatar';
import { CopyField } from '../ui/CopyField';
import { Menu, MenuItem, MenuTitle } from '../ui/Menu';
import { Modal } from '../ui/Modal';
import { PopoverPanel, usePopover } from '../ui/Popover';

/** O papel à mostra e, no clique, um menu com o que cada um permite. */
function RolePicker({
  value,
  options,
  disabled,
  onChange,
}: {
  value: ProjectRole;
  options: ProjectRole[];
  disabled?: boolean;
  onChange: (role: ProjectRole) => void;
}) {
  const menu = usePopover({ placement: 'bottom-end' });
  if (disabled || options.length === 0) return <span className="role-static">{ROLE_LABELS[value]}</span>;
  return (
    <>
      <button
        ref={menu.refs.setReference}
        {...menu.getReferenceProps({ onClick: () => menu.setOpen(!menu.open) })}
        type="button"
        className={cx('role-picker', menu.open && 'is-open')}
      >
        {ROLE_LABELS[value]} <ChevronDown size={14} />
      </button>
      <PopoverPanel popover={menu}>
        <Menu className="role-menu">
          <MenuTitle>Papel no projeto</MenuTitle>
          {[...new Set([value, ...options])].map((role) => (
            <MenuItem
              key={role}
              label={ROLE_LABELS[role]}
              hint={ROLE_HINTS[role]}
              selected={role === value}
              onClick={() => {
                menu.setOpen(false);
                if (role !== value) onChange(role);
              }}
            />
          ))}
        </Menu>
      </PopoverPanel>
    </>
  );
}

/** Menu "..." de uma linha da lista. */
function RowMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const menu = usePopover({ placement: 'bottom-end' });
  return (
    <>
      <button
        ref={menu.refs.setReference}
        {...menu.getReferenceProps({ onClick: () => menu.setOpen(!menu.open) })}
        type="button"
        className={cx('icon-btn icon-btn--sm team-row__menu', menu.open && 'is-open')}
        aria-label={label}
      >
        <Ellipsis size={18} />
      </button>
      <PopoverPanel popover={menu}>
        <Menu>{children(() => menu.setOpen(false))}</Menu>
      </PopoverPanel>
    </>
  );
}

function MemberRow({
  member,
  isYou,
  canManage,
  grantable,
  onRole,
  onRemove,
}: {
  member: Member;
  isYou: boolean;
  canManage: boolean;
  grantable: ProjectRole[];
  onRole: (role: ProjectRole) => void;
  onRemove: () => void;
}) {
  const people = useStore((s) => s.people);
  const person = people.find((p) => p.id === member.personId);
  return (
    <div className="team-row">
      <Avatar person={person ?? { id: 0, name: member.name, email: member.email, color: '#579bfc', isAgent: false }} size={34} />
      <div className="team-row__who">
        <span className="team-row__name">
          {member.name}
          {isYou && <span className="tag tag--me team-row__tag">Você</span>}
        </span>
        <span className="team-row__sub ellipsis">{member.email}</span>
      </div>
      <RolePicker value={member.role} options={grantable} disabled={!canManage || isYou} onChange={onRole} />
      {(canManage || isYou) && (
        <RowMenu label={`Opções de ${member.name}`}>
          {(close) => (
            <MenuItem
              icon={isYou ? <LogOut size={16} /> : <UserMinus size={16} />}
              label={isYou ? 'Sair do projeto' : 'Tirar do projeto'}
              danger
              onClick={() => {
                close();
                onRemove();
              }}
            />
          )}
        </RowMenu>
      )}
    </div>
  );
}

function InviteRow({ invite, link, onRevoke }: { invite: Invite; link: string | null; onRevoke: () => void }) {
  const detalhe = [
    `${invite.uses} uso${invite.uses === 1 ? '' : 's'}${invite.maxUses ? ` de ${invite.maxUses}` : ''}`,
    invite.expiresAt ? `vence em ${new Date(invite.expiresAt).toLocaleDateString('pt-BR')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className={cx('team-row', link && 'team-row--fresh')}>
      <span className="team-row__icon">
        <Link2 size={17} />
      </span>
      <div className="team-row__who">
        <span className="team-row__name">Link de {ROLE_LABELS[invite.role].toLowerCase()}</span>
        {link ? <CopyField value={link} label="Link do convite" mono={false} /> : <span className="team-row__sub">{detalhe}</span>}
      </div>
      {link && <span className="team-row__sub team-row__sub--right">{detalhe}</span>}
      <RowMenu label="Opções do convite">
        {(close) => (
          <MenuItem
            icon={<UserMinus size={16} />}
            label="Revogar convite"
            danger
            onClick={() => {
              close();
              onRevoke();
            }}
          />
        )}
      </RowMenu>
    </div>
  );
}

export function MembersModal({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const project = useStore((s) => s.projects.find((p) => p.id === projectId));
  const viewer = useStore((s) => s.viewer);
  const myRole = useRole(projectId);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [fresh, setFresh] = useState<Record<number, string>>({});
  const [newRole, setNewRole] = useState<ProjectRole>('membro');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const grantable = grantableRoles(myRole);
  const canManage = grantable.length > 0;

  const load = useCallback(async () => {
    try {
      setMembers(await authApi.members(projectId));
      if (canManage) setInvites(await authApi.invites(projectId));
    } catch (cause) {
      setError(errorText(cause, 'Não consegui carregar quem participa.'));
    }
  }, [projectId, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  const guard = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      await actions.init();
    } catch (cause) {
      setError(errorText(cause, 'Não deu certo.'));
    } finally {
      setBusy(false);
    }
  };

  const createInvite = () =>
    guard(async () => {
      const invite = await authApi.createInvite(projectId, { role: newRole });
      if (invite.token) setFresh((current) => ({ ...current, [invite.id]: `${window.location.origin}/convite/${invite.token}` }));
    });

  const removeMember = (member: Member) => {
    const isYou = member.userId === viewer?.userId;
    actions.confirm({
      title: isYou ? 'Sair do projeto?' : `Tirar ${member.name} do projeto?`,
      message: isYou
        ? 'Você deixa de ver este projeto. Para voltar, alguém precisa te convidar de novo.'
        : 'A pessoa deixa de ver este projeto. O que ela já fez continua no histórico.',
      confirmLabel: isYou ? 'Sair' : 'Tirar',
      danger: true,
      onConfirm: () => guard(() => authApi.removeMember(projectId, member.userId)),
    });
  };

  return (
    <Modal title={`Quem participa de ${project?.name ?? 'projeto'}`} onClose={onClose} wide>
      <p className="modal__lead">
        Cada pessoa enxerga só os projetos em que participa. O papel define o que ela pode fazer — e vale também para o Claude que ela
        conectar.
      </p>

      {error && <div className="form-error">{error}</div>}

      {canManage && (
        <section className="team-block">
          <div className="team-block__head">
            <h3>Convidar por link</h3>
            <div className="team-block__actions">
              <RolePicker value={newRole} options={grantable} onChange={setNewRole} />
              <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void createInvite()}>
                <UserPlus size={16} /> Gerar link
              </button>
            </div>
          </div>
          <p className="team-block__hint">
            Quem abrir o link cria a conta (ou entra na dela) e já entra no projeto como{' '}
            <strong>{ROLE_LABELS[newRole].toLowerCase()}</strong>. O link aparece inteiro só quando é criado.
          </p>
          {invites.length > 0 && (
            <div className="team-list">
              {invites.map((invite) => (
                <InviteRow
                  key={invite.id}
                  invite={invite}
                  link={fresh[invite.id] ?? null}
                  onRevoke={() => void guard(() => authApi.revokeInvite(projectId, invite.id))}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <section className="team-block">
        <div className="team-block__head">
          <h3>
            No projeto <span className="team-block__count">{members.length}</span>
          </h3>
        </div>
        <div className="team-list">
          {members.map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              isYou={member.userId === viewer?.userId}
              canManage={canManage}
              grantable={grantable}
              onRole={(role) => void guard(() => authApi.setMemberRole(projectId, member.userId, role))}
              onRemove={() => removeMember(member)}
            />
          ))}
        </div>
      </section>
    </Modal>
  );
}
