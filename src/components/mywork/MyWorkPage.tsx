import { CalendarCheck, ChevronDown, ChevronRight, GitCommitHorizontal, Maximize2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Item, MyWorkBoard, Project } from '../../../shared/types';
import { WORK_BUCKETS, workBucket, type WorkBucket, type WorkBucketInfo } from '../../../shared/mywork';
import { fold, formatItemRef, isItemDone, statusLabelOf, todayIso } from '../../../shared/values';
import { cx, plural } from '../../lib/format';
import { navigate } from '../../router';
import { actions, useStore } from '../../store';
import { Cell } from '../cells/Cell';
import { ProjectBadge } from '../shell/ProjectModal';
import { SubitemsChip } from '../item/SubitemsChip';
import { UpdatesButton } from '../table/ItemRow';
import { Avatar } from '../ui/Avatar';
import { Checkbox } from '../ui/Checkbox';
import { EditableText } from '../ui/EditableText';
import { Menu, MenuItem, MenuTitle } from '../ui/Menu';
import { PopoverPanel, usePopover } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';
import '../table/table.css';
import './mywork.css';

const DONE_KEY = 'tuesday:my-work:done';
const COLLAPSED_KEY = 'tuesday:my-work:collapsed';

const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* armazenamento indisponível */
    }
  },
};

function readCollapsed(): WorkBucket[] {
  try {
    const parsed = JSON.parse(storage.get(COLLAPSED_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as WorkBucket[]) : [];
  } catch {
    return [];
  }
}

/** Data de hoje (AAAA-MM-DD), atualizada quando o dia vira com a tela aberta. */
function useToday(): string {
  const [today, setToday] = useState(todayIso);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(todayIso()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return today;
}

interface WorkRow {
  item: Item;
  board: MyWorkBoard;
  date: string | null;
  done: boolean;
  ref: string | null;
}

function PersonPicker() {
  const people = useStore((s) => s.people);
  const meId = useStore((s) => s.meId);
  const personId = useStore((s) => s.myWorkPersonId);
  const popover = usePopover({ placement: 'bottom-start' });
  const shownId = personId ?? meId;
  const current = people.find((p) => p.id === shownId);
  return (
    <>
      <button
        ref={popover.refs.setReference}
        {...popover.getReferenceProps({ onClick: () => popover.setOpen(!popover.open) })}
        type="button"
        className={cx('btn btn--tertiary btn--sm', popover.open && 'is-active')}
      >
        <Avatar person={current} size={20} />
        {shownId === meId ? 'Você' : (current?.name ?? 'Pessoa')}
        <ChevronDown size={14} />
      </button>
      <PopoverPanel popover={popover}>
        <Menu>
          <MenuTitle>Ver o trabalho de</MenuTitle>
          {people.map((p) => (
            <MenuItem
              key={p.id}
              icon={<Avatar person={p} size={22} />}
              label={p.id === meId ? `${p.name} (você)` : p.name}
              selected={p.id === shownId}
              onClick={() => {
                popover.setOpen(false);
                actions.setMyWorkPerson(p.id === meId ? null : p.id);
              }}
            />
          ))}
        </Menu>
      </PopoverPanel>
    </>
  );
}

function Stat({ color, count, label }: { color: string; count: number; label: string }) {
  return (
    <span className="my-work__stat">
      <span className="my-work__stat-dot" style={{ background: color }} />
      <strong>{count}</strong> {label}
    </span>
  );
}

function WorkItemRow({ row, project }: { row: WorkRow; project: Project | undefined }) {
  const { item, board, ref } = row;
  const status = board.columns.find((c) => c.id === board.statusColumnId);
  const date = board.columns.find((c) => c.id === board.dateColumnId);
  const group = board.groups.find((g) => g.id === item.groupId);
  const open = () => navigate({ itemId: item.id });
  const place = [project?.name, board.name, group?.name].filter(Boolean).join(' / ');

  return (
    <div className="row">
      <div className="row-sticky">
        <div className="row-gutter" />
        <div className="cell cell--bar" />
        <div className="cell cell--name">
          <div className="name-cell">
            {ref && <span className="my-work__ref">{ref}</span>}
            <EditableText
              value={item.name}
              onSave={(name) => void actions.renameItem(item.id, name)}
              className="name-cell__text"
              inputClassName="name-cell__input"
            />
            <SubitemsChip item={item} />
            {item.commitsCount > 0 && (
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
      <div className="cell my-work__board-cell" style={{ width: 'var(--mw-board)' }}>
        <Tooltip content={`Abrir o quadro · ${place}`}>
          <button type="button" className="my-work__board" onClick={() => navigate({ boardId: board.id, view: 'table', itemId: null })}>
            <ProjectBadge name={project?.name ?? '?'} color={project?.color ?? '#c4c4c4'} size={20} />
            <span className="my-work__board-name ellipsis">{board.name}</span>
            {group && (
              <span className="my-work__group-chip">
                <span className="menu__swatch" style={{ background: group.color }} />
                <span className="ellipsis">{group.name}</span>
              </span>
            )}
          </button>
        </Tooltip>
      </div>
      <div className={cx('cell', status && 'cell--status')} style={{ width: 'var(--mw-status)' }}>
        {status ? <Cell item={item} column={status} columns={board.columns} /> : <span className="my-work__none">—</span>}
      </div>
      <div className="cell" style={{ width: 'var(--mw-date)' }}>
        {date ? <Cell item={item} column={date} columns={board.columns} /> : <span className="my-work__none">—</span>}
      </div>
    </div>
  );
}

function WorkGroup({
  bucket,
  rows,
  collapsed,
  onToggle,
  projects,
}: {
  bucket: WorkBucketInfo;
  rows: WorkRow[];
  collapsed: boolean;
  onToggle: () => void;
  projects: Map<number, Project>;
}) {
  return (
    <section className={cx('group', collapsed && 'is-collapsed')} style={{ '--group-color': bucket.color } as CSSProperties}>
      <div className="group__head">
        <div className="group-title">
          <div className="group-title__sticky">
            <div className="row-gutter" />
            <button type="button" className="group-title__chevron" onClick={onToggle} aria-expanded={!collapsed} aria-label={bucket.title}>
              {collapsed ? <ChevronRight size={20} /> : <ChevronDown size={20} />}
            </button>
            <button type="button" className="group-title__name my-work__group-name" onClick={onToggle}>
              {bucket.title}
            </button>
            <span className="group-title__count">{plural(rows.length, 'item', 'itens')}</span>
          </div>
        </div>
        {!collapsed && (
          <div className="hrow">
            <div className="row-sticky">
              <div className="row-gutter" />
              <div className="cell cell--bar" />
              <div className="hcell hcell--name">Item</div>
            </div>
            <div className="hcell" style={{ width: 'var(--mw-board)' }}>
              Quadro
            </div>
            <div className="hcell" style={{ width: 'var(--mw-status)' }}>
              Status
            </div>
            <div className="hcell" style={{ width: 'var(--mw-date)' }}>
              Prazo
            </div>
          </div>
        )}
      </div>
      {!collapsed &&
        (rows.length ? (
          rows.map((row) => <WorkItemRow key={row.item.id} row={row} project={projects.get(row.board.projectId)} />)
        ) : (
          <div className="row my-work__empty-row">
            <div className="row-sticky">
              <div className="row-gutter" />
              <div className="cell cell--bar" />
              <div className="cell cell--name my-work__empty-text">{bucket.empty ?? 'Nada por aqui.'}</div>
            </div>
            <div className="cell my-work__empty-rest" />
          </div>
        ))}
    </section>
  );
}

/** "Meu trabalho": tudo o que está atribuído a você em todos os projetos, separado pelo prazo. */
export function MyWorkPage() {
  const work = useStore((s) => s.myWork);
  const people = useStore((s) => s.people);
  const projects = useStore((s) => s.projects);
  const meId = useStore((s) => s.meId);
  const personId = useStore((s) => s.myWorkPersonId);
  const [query, setQuery] = useState('');
  const [showDone, setShowDone] = useState(() => storage.get(DONE_KEY) === '1');
  const [collapsed, setCollapsed] = useState<WorkBucket[]>(readCollapsed);
  const today = useToday();

  useEffect(() => {
    void actions.loadMyWork({ silent: useStore.getState().myWork != null });
  }, []);

  const isMe = personId == null || personId === meId;
  const person = people.find((p) => p.id === (personId ?? meId));
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const rows = useMemo(() => {
    if (!work) return [];
    const boards = new Map(work.boards.map((b) => [b.id, b]));
    const out: WorkRow[] = [];
    for (const item of work.items) {
      const board = boards.get(item.boardId);
      if (!board) continue;
      const refColumn = board.columns.find((c) => c.type === 'auto_number');
      out.push({
        item,
        board,
        date: board.dateColumnId != null ? ((item.values[String(board.dateColumnId)] as string | undefined) ?? null) : null,
        done: isItemDone(board.columns, item),
        ref: refColumn ? formatItemRef(refColumn.settings, item.number) : null,
      });
    }
    return out;
  }, [work]);

  const grouped = useMemo(() => {
    const key = fold(query);
    const map = new Map<WorkBucket, WorkRow[]>(WORK_BUCKETS.map((b) => [b.key, []]));
    for (const row of rows) {
      if (key) {
        const status = row.board.columns.find((c) => c.id === row.board.statusColumnId);
        const text = [
          row.item.name,
          row.ref ?? '',
          row.board.name,
          projectById.get(row.board.projectId)?.name ?? '',
          status ? (statusLabelOf(status, row.item.values[String(status.id)])?.name ?? '') : '',
        ].join(' ');
        if (!fold(text).includes(key)) continue;
      }
      map.get(workBucket(row.date, today, row.done))!.push(row);
    }
    for (const list of map.values())
      list.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.board.id - b.board.id || a.item.position - b.item.position);
    return map;
  }, [rows, query, today, projectById]);

  const counts = useMemo(() => {
    const result: Partial<Record<WorkBucket, number>> = {};
    for (const row of rows) {
      const bucket = workBucket(row.date, today, row.done);
      result[bucket] = (result[bucket] ?? 0) + 1;
    }
    return result;
  }, [rows, today]);

  const visible = WORK_BUCKETS.filter((b) => {
    const size = grouped.get(b.key)!.length;
    if (b.key === 'done') return showDone && size > 0;
    return size > 0 || (b.empty != null && !query);
  });

  const toggleDone = (next: boolean) => {
    setShowDone(next);
    storage.set(DONE_KEY, next ? '1' : '0');
  };

  const toggleBucket = (key: WorkBucket) => {
    setCollapsed((list) => {
      const next = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
      storage.set(COLLAPSED_KEY, JSON.stringify(next));
      return next;
    });
  };

  const who = isMe ? 'você' : (person?.name ?? 'esta pessoa');

  return (
    <div className="my-work">
      <header className="board-header">
        <div className="board-header__top">
          <div className="board-header__title-wrap">
            <h1 className="board-header__title my-work__title">{isMe ? 'Meu trabalho' : `Trabalho de ${person?.name ?? '…'}`}</h1>
          </div>
          {work && rows.length > 0 && (
            <div className="my-work__stats">
              <Stat color="#df2f4a" count={counts.overdue ?? 0} label={(counts.overdue ?? 0) === 1 ? 'atrasado' : 'atrasados'} />
              <Stat color="#00c875" count={counts.today ?? 0} label="para hoje" />
              <Stat color="#579bfc" count={counts.this_week ?? 0} label="nesta semana" />
            </div>
          )}
        </div>
        <p className="board-header__desc">Tudo o que está com {who}, em todos os projetos, organizado pelo prazo.</p>
      </header>

      <div className="toolbar my-work__toolbar">
        <div className="toolbar-search my-work__search">
          <Search size={16} />
          <input
            value={query}
            placeholder="Pesquisar"
            aria-label="Pesquisar em meu trabalho"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
          />
          {query && (
            <button type="button" className="icon-btn icon-btn--sm" onClick={() => setQuery('')} aria-label="Limpar busca">
              <X size={14} />
            </button>
          )}
        </div>
        <PersonPicker />
        <label className="my-work__toggle">
          <Checkbox checked={showDone} onChange={toggleDone} />
          <span>Mostrar concluídos</span>
        </label>
      </div>

      {!work ? (
        <div className="app-loading">
          <div className="spinner" />
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state my-work__empty">
          <CalendarCheck size={48} strokeWidth={1.3} />
          <h3>{isMe ? 'Nada atribuído a você ainda' : `Nada atribuído a ${person?.name ?? 'esta pessoa'}`}</h3>
          <p>
            Os itens em que {isMe ? 'você está' : `${person?.name ?? 'a pessoa'} está`} numa coluna de pessoas (como Responsável) aparecem
            aqui, de todos os projetos, separados pelo prazo.
          </p>
        </div>
      ) : (
        <div className="table-scroll my-work__scroll">
          <div className="table">
            {visible.map((bucket) => (
              <WorkGroup
                key={bucket.key}
                bucket={bucket}
                rows={grouped.get(bucket.key)!}
                collapsed={collapsed.includes(bucket.key)}
                onToggle={() => toggleBucket(bucket.key)}
                projects={projectById}
              />
            ))}
            {query && visible.length === 0 && (
              <div className="empty-state table-empty">
                <Search size={40} strokeWidth={1.4} />
                <h3>Nenhum item encontrado</h3>
                <p>Nada do seu trabalho corresponde a "{query}".</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
