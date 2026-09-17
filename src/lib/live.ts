import { useEffect } from 'react';
import type { ChangeEvent } from '../../shared/types';
import { CLIENT_ID } from '../api/client';
import { actions, useStore } from '../store';

/**
 * Tempo real: o servidor avisa (SSE) quando algo muda — inclusive mudanças feitas
 * pelo Claude via MCP — e a tela recarrega os dados em seguida.
 */
export function useLiveSync(): void {
  useEffect(() => {
    let timer: number | undefined;
    let retry: number | undefined;
    let source: EventSource | null = null;
    let lost = false;
    let disposed = false;

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void actions.refreshAll(), 120);
    };

    const connect = () => {
      const current = new EventSource('/api/events');
      source = current;
      current.onopen = () => {
        useStore.setState({ connected: true });
        if (lost) {
          lost = false;
          schedule();
        }
      };
      current.onerror = () => {
        lost = true;
        useStore.setState({ connected: false });
        // Respostas HTTP de erro (ex.: 502 enquanto o servidor sobe) fecham o EventSource
        // de vez, sem nova tentativa automática — então reconectamos manualmente.
        if (current.readyState === EventSource.CLOSED && !disposed) {
          window.clearTimeout(retry);
          retry = window.setTimeout(connect, 2000);
        }
      };
      current.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data as string) as ChangeEvent;
          if (event.clientId && event.clientId === CLIENT_ID) return;
          schedule();
        } catch {
          /* mensagem inválida */
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.clearTimeout(retry);
      source?.close();
    };
  }, []);
}
