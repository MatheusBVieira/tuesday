// Quem participa de um projeto e os links de convite.
import { Check, Copy, Link2, Trash, UserMinus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ROLE_HINTS, ROLE_LABELS, grantableRoles, type ProjectRole } from '../../../shared/roles';
import { authApi, type Invite, type Member } from '../../api/auth';
import { errorText } from '../../api/client';
import { useRole } from '../../lib/permissions';
import { actions, toast, useStore } from '../../store';
import { Avatar } from '../ui/Avatar';
import { Modal } from '../ui/Modal';

const roleSelect = (value: ProjectRole, options: ProjectRole[], onChange: (role: ProjectRole) => void, disabled: boolean) => (
  <select className="input input--sm" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as ProjectRole)}>
    {[...new Set([value, ...options])].map((role) => (
      <option key={role} value={role}>
        {ROLE_LABELS[role]}
      </option>
    ))}
  </select>
);

function InviteRow({ invite, link, onRevoke }: { invite: Invite; link: string | null; onRevoke: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Não consegui copiar — selecione o link e copie à mão.', 'error');
    }
  };
  return (
    <div className="member-row">
      <span className="member-row__icon">
        <Link2 size={16} />
      </span>
      <div className="member-row__text">
        <strong>Link de {ROLE_LABELS[invite.role].toLowerCase()}</strong>
        {link ? (
          <input
            className="input input--sm invite-link"
            readOnly
            value={link}
            onFocus={(e) => e.target.select()}
            aria-label="Link do convite"
          />
        ) : (
          <span className="member-row__hint">
            {invite.uses} uso{invite.uses === 1 ? '' : 's'}
            {invite.maxUses ? ` de ${invite.maxUses}` : ''}
            {invite.expiresAt ? ` · vence ${new Date(invite.expiresAt).toLocaleDateString('pt-BR')}` : ''}
          </span>
        )}
      </div>
      {link && (
        <button type="button" className="btn btn--tertiary btn--sm" onClick={() => void copy()}>
          {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copiado' : 'Copiar'}
        </button>
      )}
      <button type="button" className="icon-btn icon-btn--sm" aria-label="Revogar convite" onClick={onRevoke}>
        <Trash size={15} />
      </button>
    </div>
  );
}

export function MembersModal({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const project = useStore((s) => s.projects.find((p) => p.id === projectId));
  const viewer = useStore((s) => s.viewer);
  const people = useStore((s) => s.people);
  const myRole = useRole(projectId);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [fresh, setFresh] = useState<Record<number, string>>({});
  const [newRole, setNewRole] = useState<ProjectRole>('membro');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = grantableRoles(myRole).length > 0;

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

  return (
    <Modal title={`Quem participa de ${project?.name ?? 'projeto'}`} onClose={onClose} wide>
      <div className="members">
        {error && <div className="form-error">{error}</div>}

        <div className="members__list">
          {members.map((member) => {
            const person = people.find((p) => p.id === member.personId);
            const isYou = member.userId === viewer?.userId;
            return (
              <div key={member.userId} className="member-row">
                <Avatar person={person ?? { id: 0, name: member.name, email: member.email, color: '#9d50dd', isAgent: false }} size={28} />
                <div className="member-row__text">
                  <strong>
                    {member.name}
                    {isYou && <span className="member-row__you"> · você</span>}
                  </strong>
                  <span className="member-row__hint">{member.email}</span>
                </div>
                {canManage && !isYou ? (
                  roleSelect(
                    member.role,
                    grantableRoles(myRole),
                    (role) => void guard(() => authApi.setMemberRole(projectId, member.userId, role)),
                    busy,
                  )
                ) : (
                  <span className="member-row__role">{ROLE_LABELS[member.role]}</span>
                )}
                {(canManage || isYou) && (
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    aria-label={isYou ? 'Sair do projeto' : 'Tirar do projeto'}
                    disabled={busy}
                    onClick={() =>
                      actions.confirm({
                        title: isYou ? 'Sair do projeto?' : `Tirar ${member.name} do projeto?`,
                        message: isYou
                          ? 'Você deixa de ver este projeto. Para voltar, alguém precisa te convidar de novo.'
                          : 'A pessoa deixa de ver este projeto. O que ela já fez continua no histórico.',
                        confirmLabel: isYou ? 'Sair' : 'Tirar',
                        danger: true,
                        onConfirm: () => guard(() => authApi.removeMember(projectId, member.userId)),
                      })
                    }
                  >
                    <UserMinus size={15} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {canManage && (
          <>
            <div className="members__invite">
              <div className="members__invite-head">
                <strong>Convidar por link</strong>
                <span className="member-row__hint">{ROLE_HINTS[newRole]}</span>
              </div>
              <div className="members__invite-actions">
                {roleSelect(newRole, grantableRoles(myRole), setNewRole, busy)}
                <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void createInvite()}>
                  <Link2 size={15} /> Gerar link
                </button>
              </div>
            </div>

            {invites.length > 0 && (
              <div className="members__list">
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
            <p className="members__note">
              O link aparece inteiro só quando é criado — depois dá para revogar e gerar outro. Quem abrir o link cria a conta (ou entra na
              dela) e já entra no projeto.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
