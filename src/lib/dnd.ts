import type { SyntheticEvent } from 'react';

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type Listeners = Record<string, Function> | undefined;

/**
 * Eventos de popovers (renderizados em portal) sobem pela árvore do React até a linha/cartão.
 * Este filtro só deixa o arrasto começar quando o evento nasceu dentro do próprio elemento no DOM.
 */
export function domOnly(listeners: Listeners): Record<string, (event: SyntheticEvent) => void> | undefined {
  if (!listeners) return undefined;
  const wrapped: Record<string, (event: SyntheticEvent) => void> = {};
  for (const [name, handler] of Object.entries(listeners)) {
    wrapped[name] = (event) => {
      const target = event.target as Element | null;
      if (!(event.currentTarget as Element).contains(target)) return;
      if (target?.closest('input, textarea, button, a, [contenteditable="true"], .no-drag')) return;
      (handler as (event: SyntheticEvent) => void)(event);
    };
  }
  return wrapped;
}
