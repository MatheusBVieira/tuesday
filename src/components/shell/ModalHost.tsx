import { Trash, UserCheck, UserPlus } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { BoardTemplate, Person } from '../../../shared/types';
import { idPrefixFor } from '../../../shared/templates';
import { cx } from '../../lib/format';
import { actions, useStore, type ConfirmSpec } from '../../store';
import { Avatar } from '../ui/Avatar';
import { ColorPalette } from '../ui/ColorPalette';
import { EditableText } from '../ui/EditableText';
import { MenuItem } from '../ui/Menu';
import { Modal } from '../ui/Modal';
import { PopoverPanel, usePopover } from '../ui/Popover';
import { RowMenu } from '../ui/RowMenu';
import { AccountModal } from './AccountModal';
import { ConnectClaudeModal } from './ConnectClaudeModal';
import { MembersModal } from './MembersModal';
import { ImportTodosModal } from './ImportTodosModal';
import { IdFormatFields, parseItemNumber, type IdFormatDraft } from './IdFormatFields';
import { ProjectModal } from './ProjectModal';
import { TemplatePicker } from './TemplatePicker';

function ConfirmModal({ spec, onClose }: { spec: ConfirmSpec; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await spec.onConfirm();
    } finally {
      setBusy(false);
      onClose();
    }
  };
  return (
    <Modal
      title={spec.title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--tertiary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            autoFocus
            className={cx('btn', spec.danger ? 'btn--danger' : 'btn--primary')}
            disabled={busy}
            onClick={() => void confirm()}
          >
            {spec.confirmLabel ?? 'Confirmar'}
          </button>
        </>
      }
    >
      <p className="modal__text">{spec.message}</p>
    </Modal>
  );
}

function NewBoardModal({ onClose }: { onClose: () => void }) {
  const projects = useStore((s) => s.projects);
  const currentProject = useStore((s) => s.projectId);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<BoardTemplate>('software');
  const [projectId, setProjectId] = useState<number | null>(currentProject);
  const [idFormat, setIdFormat] = useState<IdFormatDraft>({ prefix: '', pad: 3, start: '1' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const withIds = template === 'software';
  const submit = async () => {
    const idStart = parseItemNumber(idFormat.start);
    if (withIds && idStart == null) {
      setError('O primeiro número dos itens precisa ser um inteiro a partir de 1.');
      return;
    }
    setBusy(true);
    await actions.createBoard(
      name.trim() || 'Novo quadro',
      template,
      projectId,
      withIds ? { idPrefix: idFormat.prefix || null, idPad: idFormat.pad, idStart } : {},
    );
    setBusy(false);
    onClose();
  };
  return (
    <Modal
      title="Criar quadro"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn--tertiary" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void submit()}>
            Criar quadro
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="form-row">
          <div className="form-row__main">
            <label className="field-label" htmlFor="board-name">
              Nome do quadro
            </label>
            <input
              id="board-name"
              autoFocus
              className="input"
              placeholder="Ex.: Tarefas, Bugs, Roadmap"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="board-project">
              Projeto
            </label>
            <select
              id="board-project"
              className="input"
              value={projectId ?? ''}
              onChange={(e) => setProjectId(Number(e.target.value) || null)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field-label template-label">Modelo</div>
        <TemplatePicker value={template} onChange={setTemplate} />
        {withIds && (
          <>
            <div className="field-label template-label">Referência dos itens</div>
            <IdFormatFields value={idFormat} onChange={setIdFormat} autoPrefix={idPrefixFor(name.trim() || 'Novo quadro')} />
          </>
        )}
        {error && <div className="form-error">{error}</div>}
      </form>
    </Modal>
  );
}

function PersonRow({ person, isMe, isClaude, comContas }: { person: Person; isMe: boolean; isClaude: boolean; comContas: boolean }) {
  const palette = usePopover({ placement: 'bottom-start' });
  // O menu só aparece quando tem o que oferecer: você não se remove nem "vira" você mesmo.
  const podeSerEu = !isMe && !person.isAgent && !comContas;
  const podeRemover = !isMe && !isClaude;
  const remover = () =>
    actions.confirm({
      title: `Remover ${person.name}?`,
      message: 'A pessoa sai das colunas de pessoas. O que ela já fez continua no histórico dos quadros.',
      confirmLabel: 'Remover',
      danger: true,
      onConfirm: () => actions.deletePerson(person.id),
    });

  return (
    <div className="team-row">
      <button
        ref={palette.refs.setReference}
        {...palette.getReferenceProps({ onClick: () => palette.setOpen(!palette.open) })}
        type="button"
        className="person-row__avatar"
        aria-label={`Mudar a cor de ${person.name}`}
        title="Mudar cor"
      >
        <Avatar person={person} size={34} />
      </button>
      <div className="team-row__who">
        <span className="team-row__name">
          <EditableText value={person.name} onSave={(name) => void actions.updatePerson(person.id, { name })} maxLength={80} />
          {isMe && <span className="tag tag--me team-row__tag">Você</span>}
          {person.isAgent && <span className="tag tag--agent team-row__tag">Agente via MCP</span>}
        </span>
        {person.email && <span className="team-row__sub ellipsis">{person.email}</span>}
      </div>
      {(podeSerEu || podeRemover) && (
        <RowMenu label={`Opções de ${person.name}`}>
          {(close) => (
            <>
              {podeSerEu && (
                <MenuItem
                  icon={<UserCheck size={16} />}
                  label="Sou eu"
                  hint="Os itens atribuídos a esta pessoa viram o seu trabalho"
                  onClick={() => {
                    close();
                    void actions.setMe(person.id);
                  }}
                />
              )}
              {podeRemover && (
                <MenuItem
                  icon={<Trash size={16} />}
                  label="Remover pessoa"
                  danger
                  onClick={() => {
                    close();
                    remover();
                  }}
                />
              )}
            </>
          )}
        </RowMenu>
      )}
      <PopoverPanel popover={palette}>
        <ColorPalette
          value={person.color}
          onSelect={(color) => {
            palette.setOpen(false);
            void actions.updatePerson(person.id, { color });
          }}
        />
      </PopoverPanel>
    </div>
  );
}

function PeopleModal({ onClose }: { onClose: () => void }) {
  const people = useStore((s) => s.people);
  const meId = useStore((s) => s.meId);
  const claudeId = useStore((s) => s.claudeId);
  const comContas = useStore((s) => s.viewer) !== null;
  const [name, setName] = useState('');
  const add = async () => {
    if (!name.trim()) return;
    const person = await actions.createPerson(name.trim());
    if (person) setName('');
  };
  return (
    <Modal title="Pessoas" onClose={onClose}>
      <p className="modal__lead">
        {comContas
          ? 'Quem pode ser atribuído nas colunas de pessoas. Quem entra por um convite aparece aqui sozinho; quem participa de cada projeto se resolve em Quem participa.'
          : 'Quem pode ser atribuído nas colunas de pessoas. O tuesday roda na sua máquina — não há contas nem convites.'}
      </p>
      <div className="team-list">
        {people.map((p) => (
          <PersonRow key={p.id} person={p} isMe={p.id === meId} isClaude={p.id === claudeId} comContas={comContas} />
        ))}
      </div>
      <form
        className="person-add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          className="input input--sm"
          placeholder="Nome da pessoa"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn btn--primary btn--sm" disabled={!name.trim()}>
          <UserPlus size={16} /> Adicionar
        </button>
      </form>
    </Modal>
  );
}

export function ModalHost() {
  const modal = useStore((s) => s.modal);
  const close = useCallback(() => actions.closeModal(), []);
  if (!modal) return null;
  switch (modal.kind) {
    case 'confirm':
      return <ConfirmModal spec={modal} onClose={close} />;
    case 'new-board':
      return <NewBoardModal onClose={close} />;
    case 'people':
      return <PeopleModal onClose={close} />;
    case 'connect-claude':
      return <ConnectClaudeModal onClose={close} />;
    case 'project':
      return <ProjectModal key={modal.projectId ?? 'new'} projectId={modal.projectId} onClose={close} />;
    case 'import-todos':
      return <ImportTodosModal projectId={modal.projectId} boardId={modal.boardId} onClose={close} />;
    case 'members':
      return <MembersModal projectId={modal.projectId} onClose={close} />;
    case 'account':
    case 'users':
      return <AccountModal onClose={close} />;
  }
}
