import { GitBranch, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ActivityEntry } from '../../../shared/types';
import { api } from '../../api/client';
import { cx } from '../../lib/format';
import { actions, useStore } from '../../store';
import { Tooltip } from '../ui/Tooltip';
import { ActivityList } from './ActivityList';
import './item.css';

const PAGE = 100;

export function ActivityDrawer() {
  const board = useStore((s) => s.board)!;
  const revision = useStore((s) => s.revision);
  const [entries, setEntries] = useState<ActivityEntry[] | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState<'all' | 'claude' | 'user' | 'git'>('all');
  const close = () => actions.setActivityOpen(false);

  useEffect(() => {
    let cancelled = false;
    api
      .boardActivity(board.id)
      .then((list) => {
        if (cancelled) return;
        setEntries(list);
        setHasMore(list.length >= PAGE);
      })
      .catch(() => !cancelled && setEntries([]));
    return () => {
      cancelled = true;
    };
  }, [board.id, revision]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.popover, .modal-overlay, .item-panel:not(.item-panel--activity)')) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const loadMore = async () => {
    const last = entries?.at(-1);
    if (!last) return;
    const next = await api.boardActivity(board.id, last.id);
    setEntries((current) => [...(current ?? []), ...next]);
    setHasMore(next.length >= PAGE);
  };

  const shown = entries?.filter((e) => filter === 'all' || e.source === filter);

  return createPortal(
    <>
      <div className="panel-backdrop" onMouseDown={close} />
      <aside className="item-panel item-panel--activity" role="dialog" aria-label="Registro de atividades">
        <div className="item-panel__header">
          <Tooltip content="Fechar (Esc)">
            <button type="button" className="icon-btn" onClick={close} aria-label="Fechar">
              <X size={20} />
            </button>
          </Tooltip>
          <div className="item-panel__crumbs">{board.name}</div>
        </div>
        <div className="item-panel__title-row">
          <h2 className="item-panel__title">Registro de atividades</h2>
        </div>
        <div className="activity-filters">
          <div className="segmented">
            <button type="button" className={cx(filter === 'all' && 'is-active')} onClick={() => setFilter('all')}>
              Tudo
            </button>
            <button type="button" className={cx(filter === 'claude' && 'is-active')} onClick={() => setFilter('claude')}>
              <Sparkles size={13} /> Claude
            </button>
            <button type="button" className={cx(filter === 'user' && 'is-active')} onClick={() => setFilter('user')}>
              Pessoas
            </button>
            <button type="button" className={cx(filter === 'git' && 'is-active')} onClick={() => setFilter('git')}>
              <GitBranch size={13} /> Git
            </button>
          </div>
        </div>
        <div className="item-panel__content">
          <ActivityList entries={shown} showItem />
          {hasMore && filter === 'all' && (
            <div className="activity-more">
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => void loadMore()}>
                Carregar mais
              </button>
            </div>
          )}
        </div>
      </aside>
    </>,
    document.body,
  );
}
