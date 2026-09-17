import { useState } from 'react';
import type { Group } from '../../../shared/types';
import { actions } from '../../store';
import { Checkbox } from '../ui/Checkbox';

export function AddItemRow({ group }: { group: Group }) {
  const [value, setValue] = useState('');

  const submit = async () => {
    const name = value.trim();
    if (!name) return;
    setValue('');
    await actions.createItem(group.id, name, { position: 'bottom' });
  };

  return (
    <div className="add-row">
      <div className="row-sticky">
        <div className="row-gutter" />
        <div className="cell cell--bar" />
        <div className="cell cell--check">
          <Checkbox checked={false} disabled label="Novo item" />
        </div>
        <div className="cell cell--name">
          <input
            className="add-item-input"
            placeholder="+ Adicionar item"
            value={value}
            aria-label={`Adicionar item em ${group.name}`}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => void submit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              } else if (e.key === 'Escape') {
                setValue('');
                e.currentTarget.blur();
              }
            }}
          />
        </div>
      </div>
      <div className="add-row__rest" />
    </div>
  );
}
