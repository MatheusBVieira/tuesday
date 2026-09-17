import { ListChecks } from 'lucide-react';
import type { Item } from '../../../shared/types';
import { subitemProgress } from '../../../shared/subitems';
import { cx } from '../../lib/format';
import { actions } from '../../store';
import { Tooltip } from '../ui/Tooltip';
import './item.css';

/** Progresso dos subitens (ex.: 2/5) — abre o item na aba de subitens. */
export function SubitemsChip({ item }: { item: Item }) {
  const { done, total, complete } = subitemProgress(item.subitems);
  if (!total) return null;
  const label = complete ? `Todos os ${total} subitens feitos` : `${done} de ${total} subitens feitos`;
  return (
    <Tooltip content={label}>
      <button
        type="button"
        className={cx('subitems-chip', complete && 'is-complete')}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          actions.openItem(item.id, 'subitems');
        }}
      >
        <ListChecks size={14} />
        {done}/{total}
      </button>
    </Tooltip>
  );
}
