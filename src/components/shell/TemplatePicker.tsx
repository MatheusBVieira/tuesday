import type { BoardTemplate } from '../../../shared/types';
import { TEMPLATES } from '../../../shared/templates';
import { cx } from '../../lib/format';

export function TemplatePicker({ value, onChange }: { value: BoardTemplate; onChange: (template: BoardTemplate) => void }) {
  return (
    <div className="template-options">
      {(Object.keys(TEMPLATES) as BoardTemplate[]).map((id) => {
        const t = TEMPLATES[id];
        return (
          <button key={id} type="button" className={cx('template-option', value === id && 'is-selected')} onClick={() => onChange(id)}>
            <span className="template-option__preview">
              {t.colors.map((c) => (
                <span key={c} style={{ background: c }} />
              ))}
            </span>
            <span className="template-option__title">{t.title}</span>
            <span className="template-option__desc">{t.description}</span>
          </button>
        );
      })}
    </div>
  );
}
