import {
  Activity,
  ArrowRight,
  Clock,
  Copy,
  GitBranch,
  GitCommitHorizontal,
  ListChecks,
  ListPlus,
  MessageCircle,
  Plus,
  RotateCcw,
  Rows3,
  Sparkles,
  Square,
  SquareCheck,
  Trash,
  Type,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { ActivityEntry, ActivitySnapshot } from '../../../shared/types';
import { textColorOn } from '../../../shared/colors';
import { cx, formatDateTime, relativeTime } from '../../lib/format';
import { navigate } from '../../router';
import { useStore } from '../../store';
import { ColumnTypeIcon } from '../cells/columnMeta';
import { Avatar } from '../ui/Avatar';
import { Tooltip } from '../ui/Tooltip';

function Snap({ snap }: { snap: ActivitySnapshot | null | undefined }) {
  if (!snap) return <span className="snap snap--empty">vazio</span>;
  if (snap.color) {
    return (
      <span className="snap snap--chip" style={{ background: snap.color, color: textColorOn(snap.color) }} title={snap.text}>
        {snap.text || ' '}
      </span>
    );
  }
  return (
    <span className="snap ellipsis" title={snap.text}>
      {snap.text}
    </span>
  );
}

function fieldIcon(entry: ActivityEntry): ReactNode {
  const type = entry.data.columnType;
  if (type === 'name') return <Type size={14} />;
  if (type === 'group') return <Rows3 size={14} />;
  if (type) return <ColumnTypeIcon type={type} size={14} />;
  return null;
}

function Description({ entry }: { entry: ActivityEntry }) {
  const d = entry.data;
  switch (entry.action) {
    case 'item_created':
      return (
        <>
          <span className="activity-row__field">
            <Plus size={14} /> Criado
          </span>
          {d.text && <span className="activity-row__detail">em {d.text}</span>}
        </>
      );
    case 'value_changed':
    case 'item_renamed':
    case 'item_moved':
      return (
        <>
          <span className="activity-row__field">
            {fieldIcon(entry)} {d.columnTitle}
          </span>
          <Snap snap={d.from} />
          <ArrowRight size={14} className="activity-row__arrow" />
          <Snap snap={d.to} />
        </>
      );
    case 'item_deleted':
      return (
        <span className="activity-row__field">
          <Trash size={14} /> Excluído
        </span>
      );
    case 'item_restored':
      return (
        <span className="activity-row__field">
          <RotateCcw size={14} /> Restaurado
        </span>
      );
    case 'item_duplicated':
      return (
        <span className="activity-row__field">
          <Copy size={14} /> Duplicado
        </span>
      );
    case 'update_posted':
      return (
        <>
          <span className="activity-row__field">
            <MessageCircle size={14} /> Atualização
          </span>
          <span className="activity-row__detail ellipsis" title={d.text}>
            {d.text}
          </span>
        </>
      );
    case 'commit_linked':
      return (
        <>
          <span className="activity-row__field">
            <GitCommitHorizontal size={14} /> Commit
          </span>
          {d.hash && <code className="activity-row__hash">{d.hash}</code>}
          <span className="activity-row__detail ellipsis" title={d.text}>
            {d.text}
          </span>
        </>
      );
    case 'subitems_added':
      return (
        <>
          <span className="activity-row__field">
            <ListPlus size={14} /> {d.count && d.count > 1 ? `${d.count} subitens adicionados` : 'Subitem adicionado'}
          </span>
          <span className="activity-row__detail ellipsis" title={d.text}>
            {d.text}
          </span>
        </>
      );
    case 'subitem_checked':
    case 'subitem_unchecked':
      return (
        <>
          <span className={cx('activity-row__field', entry.action === 'subitem_checked' && 'activity-row__field--done')}>
            {entry.action === 'subitem_checked' ? <SquareCheck size={14} /> : <Square size={14} />}
            {entry.action === 'subitem_checked' ? 'Subitem feito' : 'Subitem reaberto'}
          </span>
          <span className="activity-row__detail ellipsis" title={d.text}>
            {d.text}
          </span>
        </>
      );
    case 'subitem_renamed':
      return (
        <>
          <span className="activity-row__field">
            <ListChecks size={14} /> Subitem
          </span>
          <Snap snap={d.from} />
          <ArrowRight size={14} className="activity-row__arrow" />
          <Snap snap={d.to} />
        </>
      );
    case 'subitem_deleted':
      return (
        <>
          <span className="activity-row__field">
            <Trash size={14} /> Subitem excluído
          </span>
          <span className="activity-row__detail activity-row__detail--removed ellipsis" title={d.text}>
            {d.text}
          </span>
        </>
      );
    default:
      return <span className="activity-row__field">{entry.action}</span>;
  }
}

function Actor({ entry }: { entry: ActivityEntry }) {
  const people = useStore((s) => s.people);
  if (entry.source === 'git' && entry.actorId == null) {
    return (
      <Tooltip content="Git — commit na pasta do projeto">
        <span className="avatar avatar--git" style={{ width: 26, height: 26 }}>
          <GitBranch size={14} strokeWidth={2.2} />
        </span>
      </Tooltip>
    );
  }
  const actor = people.find((p) => p.id === entry.actorId);
  return (
    <Tooltip content={`${actor?.name ?? 'Desconhecido'}${entry.source === 'claude' ? ' · via MCP' : ''}`}>
      <span className="activity-row__actor">
        <Avatar person={actor} size={26} />
      </span>
    </Tooltip>
  );
}

export function ActivityList({ entries, showItem = false }: { entries: ActivityEntry[] | undefined; showItem?: boolean }) {
  if (!entries) {
    return (
      <div className="panel-loading">
        <div className="spinner" />
      </div>
    );
  }
  if (!entries.length) {
    return (
      <div className="empty-state">
        <Activity size={40} strokeWidth={1.4} />
        <h3>Nenhuma atividade ainda</h3>
        <p>As alterações feitas por você, pelo Claude e pelos commits aparecem aqui.</p>
      </div>
    );
  }
  return (
    <ul className="activity-list">
      {entries.map((entry) => (
        <li key={entry.id} className={cx('activity-row', showItem && 'activity-row--with-item')}>
          <Tooltip content={formatDateTime(entry.createdAt)}>
            <span className="activity-row__time">
              <Clock size={13} /> {relativeTime(entry.createdAt)}
            </span>
          </Tooltip>
          <Actor entry={entry} />
          {showItem && (
            <button
              type="button"
              className="activity-row__item ellipsis"
              disabled={!entry.itemId || entry.action === 'item_deleted'}
              onClick={() => entry.itemId && navigate({ itemId: entry.itemId })}
              title={entry.itemName ?? ''}
            >
              {entry.itemName ?? '—'}
            </button>
          )}
          <div className="activity-row__what">
            <Description entry={entry} />
            {entry.source === 'claude' && !showItem && (
              <span className="via-claude">
                <Sparkles size={11} /> MCP
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
