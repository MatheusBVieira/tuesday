import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
  type Placement,
} from '@floating-ui/react';
import { useCallback, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../../lib/format';

interface PopoverOptions {
  placement?: Placement;
  offset?: number;
  /** largura mínima = largura do elemento de referência */
  matchWidth?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function usePopover({ placement = 'bottom', offset: gap = 6, matchWidth = false, onOpenChange }: PopoverOptions = {}) {
  const [open, setOpenState] = useState(false);
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const floating = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    // posiciona com top/left: a animação de entrada do .popover usa transform
    transform: false,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(gap),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      ...(matchWidth
        ? [
            size({
              apply({ rects, elements }) {
                elements.floating.style.minWidth = `${rects.reference.width}px`;
              },
            }),
          ]
        : []),
    ],
  });
  const dismiss = useDismiss(floating.context);
  const role = useRole(floating.context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss, role]);
  return {
    open,
    setOpen,
    refs: floating.refs,
    floatingStyles: floating.floatingStyles,
    context: floating.context,
    getReferenceProps,
    getFloatingProps,
  };
}

export type PopoverState = ReturnType<typeof usePopover>;

export function PopoverPanel({
  popover,
  children,
  className,
  style,
}: {
  popover: PopoverState;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  if (!popover.open) return null;
  return (
    <FloatingPortal>
      <FloatingFocusManager context={popover.context} modal={false} returnFocus={false}>
        <div
          ref={popover.refs.setFloating}
          className={cx('popover', className)}
          style={{ ...popover.floatingStyles, ...style }}
          {...popover.getFloatingProps()}
        >
          {children}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
