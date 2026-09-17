import { Check, FolderOpen, GitBranch, RefreshCw, Trash } from 'lucide-react';
import { useState } from 'react';
import type { BoardTemplate } from '../../../shared/types';
import { GROUP_COLORS } from '../../../shared/colors';
import { idPrefixFor } from '../../../shared/templates';
import { errorText } from '../../api/client';
import { ago, cx, initials, plural } from '../../lib/format';
import { actions, useStore } from '../../store';
import { Modal } from '../ui/Modal';
import { IdFormatFields, parseItemNumber, type IdFormatDraft } from './IdFormatFields';
import { TemplatePicker } from './TemplatePicker';

export function ProjectBadge({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  return (
    <span className="project-badge" style={{ background: color, width: size, height: size, fontSize: Math.round(size * 0.45) }}>
      {initials(name || '?')}
    </span>
  );
}

/** Situação do repositório Git da pasta vinculada. */
function GitStatus({ projectId }: { projectId: number }) {
  const project = useStore((s) => s.projects.find((p) => p.id === projectId));
  const [syncing, setSyncing] = useState(false);
  if (!project?.folder) return null;
  const git = project.git;
  const repos = git?.repos ?? [];
  const sync = async () => {
    setSyncing(true);
    await actions.syncGit(project.id);
    setSyncing(false);
  };
  return (
    <div className="git-status">
      <div className="git-status__head">
        <GitBranch size={16} />
        <strong>Git</strong>
        {repos.length ? (
          <span className="setup-badge is-ok">
            <Check size={12} strokeWidth={3} /> {plural(repos.length, 'repositório', 'repositórios')}
          </span>
        ) : (
          <span className="setup-badge">{git?.error ?? 'Verificando…'}</span>
        )}
        <button type="button" className="btn btn--tertiary btn--xs git-status__sync" disabled={syncing} onClick={() => void sync()}>
          <RefreshCw size={13} className={syncing ? 'spin' : undefined} /> Sincronizar
        </button>
      </div>
      {repos.length > 0 && (
        <ul className="git-status__repos">
          {repos.map((repo) => (
            <li key={repo.path}>
              <GitBranch size={12} />
              <strong className="ellipsis">{repo.name}</strong>
              {repo.webUrl ? (
                <a className="ellipsis" href={repo.webUrl} target="_blank" rel="noopener noreferrer">
                  {repo.webUrl.replace(/^https:\/\/(www\.)?/, '')}
                </a>
              ) : (
                <span className="git-status__plain">sem remoto conhecido</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="field-hint">
        Cite a referência do item na mensagem do commit (ex.: <code>TUE-012</code>) para ligá-lo ao item; com <code>fixes TUE-012</code> o
        item também vai para concluído. A pasta pode ter vários repositórios — o tuesday lê todos.
        {repos.length > 0 && (
          <>
            {' '}
            {plural(git?.linkedCommits ?? 0, 'commit ligado', 'commits ligados')}
            {git?.lastSyncAt ? ` · verificado ${ago(git.lastSyncAt)}` : ''}.
          </>
        )}
        {git?.error && repos.length > 0 && <> {git.error}</>}
      </p>
    </div>
  );
}

export function ProjectModal({ projectId, onClose }: { projectId?: number; onClose: () => void }) {
  const projects = useStore((s) => s.projects);
  const app = useStore((s) => s.app);
  const project = projectId != null ? projects.find((p) => p.id === projectId) : undefined;
  const editing = !!project;
  const [name, setName] = useState(project?.name ?? '');
  const [color, setColor] = useState(project?.color ?? GROUP_COLORS[projects.length % GROUP_COLORS.length]);
  const [folder, setFolder] = useState(project?.folder ?? '');
  const [template, setTemplate] = useState<BoardTemplate>('software');
  const [idFormat, setIdFormat] = useState<IdFormatDraft>({ prefix: '', pad: 3, start: '1' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const withIds = !editing && template === 'software';

  const save = async () => {
    const idStart = parseItemNumber(idFormat.start);
    if (withIds && idStart == null) {
      setError('O primeiro número dos itens precisa ser um inteiro a partir de 1.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (project) await actions.updateProject(project.id, { name: name.trim() || project.name, color, folder: folder.trim() || null });
      else
        await actions.createProject({
          name: name.trim() || 'Novo projeto',
          color,
          folder: folder.trim() || null,
          template,
          ...(withIds ? { idPrefix: idFormat.prefix || null, idPad: idFormat.pad, idStart } : {}),
        });
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!project) return;
    setBusy(true);
    await actions.deleteProject(project.id);
    setBusy(false);
    onClose();
  };

  return (
    <Modal
      title={editing ? 'Configurações do projeto' : 'Novo projeto'}
      onClose={onClose}
      footer={
        <>
          {project && (
            <button
              type="button"
              className={cx('btn', confirmDelete ? 'btn--danger' : 'btn--tertiary', 'project-modal__delete')}
              disabled={busy || projects.length <= 1}
              title={projects.length <= 1 ? 'Mantenha pelo menos um projeto' : undefined}
              onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))}
            >
              <Trash size={16} />
              {confirmDelete ? `Excluir com ${plural(project.boardCount, 'quadro', 'quadros')}?` : 'Excluir projeto'}
            </button>
          )}
          <button type="button" className="btn btn--tertiary" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void save()}>
            {editing ? 'Salvar' : 'Criar projeto'}
          </button>
        </>
      }
    >
      <form
        className="project-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="field-label" htmlFor="project-name">
          Nome
        </label>
        <div className="project-form__name">
          <ProjectBadge name={name || 'Projeto'} color={color} size={40} />
          <input
            id="project-name"
            autoFocus
            className="input"
            placeholder="Ex.: Meu App"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="field-label">Cor</div>
        <div className="project-form__colors">
          {GROUP_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Cor ${c}`}
              className={cx('palette__swatch', c === color && 'is-selected')}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>

        <label className="field-label" htmlFor="project-folder">
          Pasta local <span className="field-optional">(opcional)</span>
        </label>
        <div className="search-field">
          <FolderOpen size={16} />
          <input
            id="project-folder"
            className="input"
            placeholder={app?.root ?? 'C:\\projetos\\meu-app'}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            spellCheck={false}
          />
        </div>
        <p className="field-hint">
          Com a pasta vinculada, o Claude Code aberto nela (ou em qualquer subpasta) trabalha neste projeto automaticamente. Cole o caminho
          completo — no Explorer, clique na barra de endereço e copie.
        </p>

        {project?.folder && project.folder === folder.trim() && <GitStatus projectId={project.id} />}

        {!editing && (
          <>
            <div className="field-label template-label">Primeiro quadro</div>
            <TemplatePicker value={template} onChange={setTemplate} />
          </>
        )}

        {withIds && (
          <>
            <div className="field-label template-label">Referência dos itens</div>
            <IdFormatFields value={idFormat} onChange={setIdFormat} autoPrefix={idPrefixFor(name.trim() || 'Novo projeto')} />
            <p className="field-hint">
              É o que você cita nos commits. Vindo de outra ferramenta? Use o mesmo prefixo e continue a numeração — ex.: TM, 2 dígitos,
              começando em 38.
            </p>
          </>
        )}

        {error && <div className="form-error">{error}</div>}
      </form>
    </Modal>
  );
}
