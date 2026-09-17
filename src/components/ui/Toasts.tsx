import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../lib/format';
import { actions, useStore, type ToastSpec } from '../../store';

function ToastView({ toast }: { toast: ToastSpec }) {
  useEffect(() => {
    const timer = window.setTimeout(() => actions.dismissToast(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.duration]);

  const Icon = toast.kind === 'success' ? CircleCheck : toast.kind === 'error' ? CircleAlert : Info;
  return (
    <div className={cx('toast', `toast--${toast.kind}`)} role="status">
      <Icon size={20} />
      <span className="toast__message">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            toast.action!.run();
            actions.dismissToast(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="toast__close" onClick={() => actions.dismissToast(toast.id)} aria-label="Fechar">
        <X size={18} />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return createPortal(
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <ToastView key={t.id} toast={t} />
      ))}
    </div>,
    document.body,
  );
}
