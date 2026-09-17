import { CircleAlert, CircleCheck, CodeXml, FileCode, FolderOpen, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CodeTodo, CodeTodoScan, Group } from '../../../shared/types';
import { TODO_TAGS, type TodoTag } from '../../../shared/codetodos';
import { fold } from '../../../shared/values';
import { api, errorText } from '../../api/client';
import { cx, plural, shortPath } from '../../lib/format';
import { navigate } from '../../router';
import { actions, useStore } from '../../store';
import { Checkbox } from '../ui/Checkbox';
import { Modal } from '../ui/Modal';

function TagBadge({ tag }: { tag: TodoTag }) {
  return <span className={cx('todo-tag', `todo-tag--${tag.toLowerCase()}`)}>{tag}</span>;
}

function splitPath(file: string): [string, string] {
  const index = file.lastIndexOf('/');
  return index < 0 ? ['', file] : [file.slice(0, index + 1), file.slice(index + 1)];
}

function TodoRow({
  todo,
  checked,
  onToggle,
  onOpenItem,
}: {
  todo: CodeTodo;
  checked: boolean;
  onToggle: () => void;
  onOpenItem: () => void;
}) {
  const fresh = todo.status === 'new';
  return (
    <div className={cx('todo-row', !fresh && 'is-known', fresh && checked && 'is-selected')} onClick={fresh ? onToggle : undefined}>
      {fresh ? <Checkbox checked={checked} onChange={onToggle} label={`Importar "${todo.name}"`} /> : <span className="todo-row__spacer" />}
      <TagBadge tag={todo.tag} />
      <span className="todo-row__text" title={todo.text || todo.name}>
        {todo.name}
      </span>
      {todo.item && (
        <button
          type="button"
          className="todo-row__item"
          title={todo.item.name}
          onClick={(e) => {
            e.stopPropagation();
            onOpenItem();
          }}
        >
          {todo.status === 'cited' ? 'citado em ' : ''}
          {todo.item.ref ?? `#${todo.item.id}`}
          {todo.item.deleted ? ' (excluído)' : todo.item.done ? ' ✓' : ''}
        </button>
      )}
      <a className="todo-row__line" href={todo.url} title="Abrir no VS Code nesta linha" onClick={(e) => e.stopPropagation()}>
        <CodeXml size={13} /> {todo.line}
      </a>
    </div>
  );
}

export function ImportTodosModal({ projectId, boardId, onClose }: { projectId: number; boardId?: number | null; onClose: () => void }) {
  const project = useStore((s) => s.projects.find((p) => p.id === projectId));
  const allBoards = useStore((s) => s.boards);
  const boards = useMemo(() => allBoards.filter((b) => b.projectId === projectId), [allBoards, projectId]);
  const [scan, setScan] = useState<CodeTodoScan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<Set<TodoTag>>(new Set(TODO_TAGS));
  const [showKnown, setShowKnown] = useState(false);
  const [completing, setCompleting] = useState<Set<number>>(new Set());
  const [targetBoard, setTargetBoard] = useState<number | null>(boardId ?? null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boardChoice = targetBoard ?? boards[0]?.id ?? null;

  const load = useCallback(() => {
    setScan(null);
    setLoadError(null);
    api
      .codeTodos(projectId)
      .then((result) => {
        setScan(result);
        setSelected(new Set(result.todos.filter((t) => t.status === 'new').map((t) => t.id)));
        // Desmarcados: numa outra branch a marcação pode só não existir ainda.
        setCompleting(new Set());
      })
      .catch((e: unknown) => setLoadError(errorText(e)));
  }, [projectId]);

  useEffect(() => {
    if (project?.folder) load();
  }, [project?.folder, load]);

  useEffect(() => {
    if (boardChoice == null) return;
    let cancelled = false;
    api
      .getBoard(boardChoice)
      .then((board) => {
        if (cancelled) return;
        setGroups(board.groups);
        setGroupId((board.groups.find((g) => /backlog/.test(fold(g.name))) ?? board.groups[0])?.id ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [boardChoice]);

  const counts = useMemo(() => {
    const map = new Map<TodoTag, number>();
    for (const todo of scan?.todos ?? []) if (todo.status === 'new') map.set(todo.tag, (map.get(todo.tag) ?? 0) + 1);
    return map;
  }, [scan]);
  const known = scan?.todos.filter((t) => t.status !== 'new').length ?? 0;
  const visible = useMemo(
    () => (scan?.todos ?? []).filter((t) => tags.has(t.tag) && (showKnown || t.status === 'new')),
    [scan, tags, showKnown],
  );
  const visibleNew = visible.filter((t) => t.status === 'new');
  const chosen = visibleNew.filter((t) => selected.has(t.id));
  const byFile = useMemo(() => {
    const map = new Map<string, CodeTodo[]>();
    for (const todo of visible) map.set(todo.path, [...(map.get(todo.path) ?? []), todo]);
    return [...map.entries()];
  }, [visible]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allChecked = visibleNew.length > 0 && chosen.length === visibleNew.length;

  const openItem = (itemBoardId: number, itemId: number) => {
    onClose();
    navigate({ boardId: itemBoardId, view: 'table', itemId });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await actions.importCodeTodos(projectId, {
        ids: chosen.map((t) => t.id),
        boardId: boardChoice ?? undefined,
        groupId: groupId ?? undefined,
        completeItemIds: [...completing],
      });
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const actionLabel = [
    chosen.length ? `Importar ${plural(chosen.length, 'item', 'itens')}` : null,
    completing.size ? `concluir ${completing.size}` : null,
  ]
    .filter(Boolean)
    .join(' e ');

  return (
    <Modal
      title="Importar TODOs do código"
      onClose={onClose}
      wide
      footer={
        project?.folder && scan ? (
          <>
            <button type="button" className="btn btn--tertiary" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || (!chosen.length && !completing.size)}
              onClick={() => void submit()}
            >
              {busy ? 'Importando…' : actionLabel ? actionLabel.replace(/^./, (c) => c.toUpperCase()) : 'Importar'}
            </button>
          </>
        ) : undefined
      }
    >
      {!project?.folder ? (
        <div className="empty-state todo-import__empty">
          <FolderOpen size={44} strokeWidth={1.3} />
          <h3>Este projeto não tem pasta vinculada</h3>
          <p>Vincule a pasta do código para procurar TODO, FIXME, HACK e XXX nos comentários.</p>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => actions.openModal({ kind: 'project', projectId })}>
            Vincular pasta
          </button>
        </div>
      ) : loadError ? (
        <div className="empty-state todo-import__empty">
          <CircleAlert size={40} strokeWidth={1.4} />
          <h3>Não foi possível ler o código</h3>
          <p>{loadError}</p>
          <button type="button" className="btn btn--secondary btn--sm" onClick={load}>
            <RefreshCw size={14} /> Tentar de novo
          </button>
        </div>
      ) : !scan ? (
        <div className="todo-import__loading">
          <div className="spinner" />
          Procurando TODO, FIXME, HACK e XXX em <code>{shortPath(project.folder)}</code>…
        </div>
      ) : (
        <div className="todo-import">
          <p className="modal__lead">
            Marcações nos comentários de <code>{shortPath(scan.folder)}</code> ({plural(scan.files, 'arquivo lido', 'arquivos lidos')}).
            Cada uma vira um item com a coluna <strong>Código</strong>: o link abre o arquivo no VS Code na linha certa — e a linha
            acompanha as mudanças no código.
          </p>

          <div className="todo-import__bar">
            {TODO_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                className={cx('todo-filter', tags.has(tag) && 'is-active')}
                onClick={() =>
                  setTags((current) => {
                    const next = new Set(current);
                    if (next.has(tag)) next.delete(tag);
                    else next.add(tag);
                    return next;
                  })
                }
              >
                <TagBadge tag={tag} /> {counts.get(tag) ?? 0}
              </button>
            ))}
            {known > 0 && (
              <span className="todo-known" onClick={() => setShowKnown(!showKnown)}>
                <Checkbox checked={showKnown} onChange={() => setShowKnown(!showKnown)} label="Mostrar os já importados" />
                Mostrar {plural(known, 'já importado', 'já importados')}
              </span>
            )}
          </div>

          {visible.length === 0 ? (
            <div className="empty-state todo-import__empty">
              <CircleCheck size={40} strokeWidth={1.4} />
              <h3>{scan.todos.length ? 'Nada novo para importar' : 'Nenhum TODO no código'}</h3>
              <p>
                {scan.todos.length
                  ? 'Todas as marcações encontradas já viraram itens.'
                  : 'Comentários como "// TODO: validar o CPF" ou "# FIXME: tratar timeout" aparecem aqui.'}
              </p>
            </div>
          ) : (
            <div className="todo-list">
              {visibleNew.length > 0 && (
                <div className="todo-list__head">
                  <Checkbox
                    checked={allChecked}
                    indeterminate={chosen.length > 0 && !allChecked}
                    onChange={() => setSelected(allChecked ? new Set() : new Set(visibleNew.map((t) => t.id)))}
                    label="Selecionar todas"
                  />
                  <span>
                    {chosen.length} de {visibleNew.length} {visibleNew.length === 1 ? 'nova selecionada' : 'novas selecionadas'}
                  </span>
                </div>
              )}
              {byFile.map(([file, todos]) => {
                const [dir, base] = splitPath(file);
                return (
                  <div key={file} className="todo-file">
                    <div className="todo-file__head" title={file}>
                      <FileCode size={14} />
                      {/* rtl corta o começo do caminho longo; o <bdi> mantém as barras no lugar */}
                      <span className="todo-file__dir">
                        <bdi>{dir}</bdi>
                      </span>
                      <strong>{base}</strong>
                    </div>
                    {todos.map((todo) => (
                      <TodoRow
                        key={todo.id}
                        todo={todo}
                        checked={selected.has(todo.id)}
                        onToggle={() => toggle(todo.id)}
                        onOpenItem={() => todo.item && openItem(todo.item.boardId, todo.item.id)}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {scan.removed.length > 0 && (
            <div className="todo-removed">
              <div className="todo-removed__title">
                <CircleCheck size={16} /> Saíram do código
              </div>
              <p>
                Estes itens vieram de marcações que não estão mais no código (ou não existem nesta branch). Marque os que devem ir para
                concluído.
              </p>
              {scan.removed.map((removed) => (
                <div
                  key={removed.item.id}
                  className="todo-row"
                  onClick={() => setCompleting((current) => toggleNumber(current, removed.item.id))}
                >
                  <Checkbox
                    checked={completing.has(removed.item.id)}
                    onChange={() => setCompleting((current) => toggleNumber(current, removed.item.id))}
                    label={`Concluir "${removed.item.name}"`}
                  />
                  <TagBadge tag={removed.tag} />
                  <span className="todo-row__text">
                    <strong>{removed.item.ref ?? `#${removed.item.id}`}</strong> {removed.item.name}
                  </span>
                  <span className="todo-row__was" title={`${removed.path}:${removed.line}`}>
                    era {splitPath(removed.path)[1]}:{removed.line}
                  </span>
                </div>
              ))}
            </div>
          )}

          {(scan.truncated || scan.errors.length > 0) && (
            <div className="form-error">
              {scan.truncated && 'A pasta é grande demais — só parte dos arquivos foi lida. '}
              {scan.errors.join(' · ')}
            </div>
          )}

          {chosen.length > 0 && (
            <div className="todo-import__dest">
              <span className="field-label">Criar em</span>
              {boards.length > 1 && (
                <select className="input input--sm" value={boardChoice ?? ''} onChange={(e) => setTargetBoard(Number(e.target.value))}>
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
              <select className="input input--sm" value={groupId ?? ''} onChange={(e) => setGroupId(Number(e.target.value))}>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {error && <div className="form-error">{error}</div>}
        </div>
      )}
    </Modal>
  );
}

function toggleNumber(set: Set<number>, value: number): Set<number> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
