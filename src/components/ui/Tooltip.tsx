import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
  type Placement,
} from '@floating-ui/react';
import { cloneElement, useState, type ReactElement, type ReactNode, type Ref } from 'react';

type AnyProps = Record<string, unknown> & { ref?: Ref<Element> };

/** Tooltip escuro no estilo monday. Envolve um único elemento que aceite ref. */
export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = 350,
}: {
  content: ReactNode;
  children: ReactElement;
  placement?: Placement;
  delay?: number;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const hover = useHover(context, { delay: { open: delay, close: 0 }, move: false });
  const focus = useFocus(context);
  const dismiss = useDismiss(context, { referencePress: true });
  const role = useRole(context, { role: 'tooltip' });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);
  const childProps = children.props as AnyProps;
  const ref = useMergeRefs([refs.setReference, childProps.ref]);

  if (content == null || content === '') return children;
  return (
    <>
      {cloneElement(children, getReferenceProps({ ...childProps, ref }) as AnyProps)}
      {open && (
        <FloatingPortal>
          <div ref={refs.setFloating} className="tooltip" style={floatingStyles} {...getFloatingProps()}>
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
