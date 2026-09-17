import { CircleUserRound, Plus, Search, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import type { Person } from '../../../shared/types';
import { fold } from '../../../shared/values';
import { cx } from '../../lib/format';
import { actions, useStore } from '../../store';
import { Avatar, AvatarStack } from '../ui/Avatar';
import { PopoverPanel, usePopover } from '../ui/Popover';
import type { CellProps } from './Cell';

export function PeoplePicker({ selected, onChange }: { selected: number[]; onChange: (ids: number[]) => void }) {
  const people = useStore((s) => s.people);
  const [query, setQuery] = useState('');
  const key = fold(query);
  const chosen = selected.map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p);
  const suggestions = people.filter((p) => !selected.includes(p.id) && (!key || fold(p.name).includes(key)));
  const exists = people.some((p) => fold(p.name) === key);

  const add = (id: number) => {
    onChange([...selected, id]);
    setQuery('');
  };

  const invite = async () => {
    const person = await actions.createPerson(query.trim());
    if (person) add(person.id);
  };

  return (
    <div className="people-picker">
      {chosen.length > 0 && (
        <div className="people-picker__chips">
          {chosen.map((p) => (
            <span key={p.id} className="person-chip">
              <Avatar person={p} size={22} />
              <span className="ellipsis">{p.name}</span>
              <button type="button" onClick={() => onChange(selected.filter((id) => id !== p.id))} aria-label={`Remover ${p.name}`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="search-field">
        <Search size={16} />
        <input
          autoFocus
          className="input input--sm"
          placeholder="Buscar pessoas"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (suggestions[0]) add(suggestions[0].id);
              else if (query.trim() && !exists) void invite();
            }
          }}
        />
      </div>
      <div className="menu__title people-picker__label">Sugestões</div>
      <div className="people-picker__list">
        {suggestions.map((p) => (
          <button key={p.id} type="button" className="menu__item" onClick={() => add(p.id)}>
            <Avatar person={p} size={26} />
            <span className="ellipsis">{p.name}</span>
            {p.isAgent && <span className="tag tag--agent">IA</span>}
          </button>
        ))}
        {suggestions.length === 0 && !query && <div className="people-picker__empty">Todas as pessoas já estão atribuídas.</div>}
      </div>
      {query.trim() && !exists && (
        <button type="button" className="menu__item people-picker__invite" onClick={() => void invite()}>
          <UserPlus size={18} />
          <span className="ellipsis">Adicionar "{query.trim()}"</span>
        </button>
      )}
    </div>
  );
}

export function PeopleCell({ item, column, variant = 'table' }: CellProps) {
  const people = useStore((s) => s.people);
  const ids = (item.values[String(column.id)] as number[] | undefined) ?? [];
  const assigned = ids.map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p);
  const popover = usePopover({ placement: 'bottom' });
  return (
    <>
      <div
        ref={popover.refs.setReference}
        {...popover.getReferenceProps({ onClick: () => popover.setOpen(!popover.open) })}
        role="button"
        tabIndex={0}
        aria-label={`${column.title}: ${assigned.map((p) => p.name).join(', ') || 'ninguém'}`}
        className={cx('cell-btn people-cell', variant === 'panel' && 'people-cell--panel', popover.open && 'is-open')}
      >
        <span className="people-cell__plus">
          <Plus size={10} strokeWidth={3} />
        </span>
        {assigned.length ? (
          <AvatarStack people={assigned} size={variant === 'panel' ? 28 : 26} max={variant === 'panel' ? 6 : 3} />
        ) : (
          <CircleUserRound size={26} strokeWidth={1.25} className="people-cell__empty" />
        )}
        {variant === 'panel' && assigned.length > 0 && (
          <span className="people-cell__names ellipsis">{assigned.map((p) => p.name).join(', ')}</span>
        )}
      </div>
      <PopoverPanel popover={popover} className="people-popover">
        <PeoplePicker selected={ids} onChange={(next) => void actions.setValue(item.id, column.id, next.length ? next : null)} />
      </PopoverPanel>
    </>
  );
}
