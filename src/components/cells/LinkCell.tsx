import { CodeXml, ExternalLink, Link as LinkIcon } from 'lucide-react';
import { useState } from 'react';
import { isEditorUrl } from '../../../shared/codetodos';
import type { LinkValue } from '../../../shared/types';
import { cx } from '../../lib/format';
import { actions } from '../../store';
import { PopoverPanel, usePopover } from '../ui/Popover';
import type { CellProps } from './Cell';

/** "vscode://file/F:/app/src/x.ts:42:5" → "F:/app/src/x.ts:42:5" */
function editorPath(url: string): string {
  const rest = url.replace(/^[a-z-]+:\/\/file\//i, '');
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

const normalizeUrl = (url: string) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);

function LinkForm({ value, onSave, onRemove }: { value: LinkValue | null; onSave: (v: LinkValue) => void; onRemove: () => void }) {
  const [url, setUrl] = useState(value?.url ?? '');
  const [text, setText] = useState(value?.text ?? '');
  const submit = () => {
    if (!url.trim()) return onRemove();
    onSave({ url: normalizeUrl(url.trim()), text: text.trim() || undefined });
  };
  return (
    <form
      className="link-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="field-label" htmlFor="link-url">
        Endereço web
      </label>
      <input
        id="link-url"
        autoFocus
        className="input input--sm"
        placeholder="https://"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <label className="field-label" htmlFor="link-text">
        Texto para exibir
      </label>
      <input id="link-text" className="input input--sm" placeholder="Opcional" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="link-form__actions">
        {value && (
          <button type="button" className="btn btn--tertiary btn--sm" onClick={onRemove}>
            Remover
          </button>
        )}
        <button type="submit" className="btn btn--primary btn--sm">
          Salvar
        </button>
      </div>
    </form>
  );
}

export function LinkCell({ item, column }: CellProps) {
  const value = (item.values[String(column.id)] as LinkValue | undefined) ?? null;
  const popover = usePopover({ placement: 'bottom' });
  // vscode://file/…:linha abre o editor — sem abrir uma aba em branco.
  const editor = !!value && isEditorUrl(value.url);
  return (
    <>
      <div
        ref={popover.refs.setReference}
        {...popover.getReferenceProps({ onClick: () => popover.setOpen(!popover.open) })}
        role="button"
        tabIndex={0}
        className={cx('cell-btn link-cell', popover.open && 'is-open')}
      >
        {value ? (
          <>
            <a
              href={value.url}
              target={editor ? undefined : '_blank'}
              rel="noopener noreferrer"
              className={cx('link-cell__anchor ellipsis', editor && 'link-cell__anchor--code')}
              onClick={(e) => e.stopPropagation()}
              title={editor ? `Abrir no editor: ${editorPath(value.url)}` : value.url}
            >
              {editor && <CodeXml size={13} />}
              {value.text || value.url.replace(/^https?:\/\//, '')}
            </a>
            {!editor && <ExternalLink size={13} className="cell-hint" />}
          </>
        ) : (
          <LinkIcon size={15} className="cell-hint" />
        )}
      </div>
      <PopoverPanel popover={popover}>
        <LinkForm
          value={value}
          onSave={(next) => {
            popover.setOpen(false);
            void actions.setValue(item.id, column.id, next);
          }}
          onRemove={() => {
            popover.setOpen(false);
            void actions.setValue(item.id, column.id, null);
          }}
        />
      </PopoverPanel>
    </>
  );
}
