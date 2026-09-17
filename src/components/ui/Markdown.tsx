import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';
import { cx } from '../../lib/format';
import './Markdown.css';

marked.use({ gfm: true, breaks: true });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(source, { async: false }) as string), [source]);
  return <div className={cx('markdown', className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
