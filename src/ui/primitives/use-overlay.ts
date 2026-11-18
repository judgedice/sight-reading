import { useEffect, useRef, type RefObject } from 'react';
import { focusInitial, isTopOverlay, pushOverlay, removeOverlay, trapTab } from './overlay-stack.ts';

export interface OverlayBehaviour {
  open: boolean;
  /** Called on Esc (and by callers on scrim click). Omit for an overlay that cannot be dismissed. */
  onClose?: (() => void) | undefined;
  /** true: move focus in on open, trap Tab, restore focus on close. false (popover): Esc only. */
  modal: boolean;
}

/** Wires focus, Tab trapping and Esc for one overlay element. */
export function useOverlay(containerRef: RefObject<HTMLElement | null>, { open, onClose, modal }: OverlayBehaviour): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;
    const id = Symbol('overlay');
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pushOverlay(id);
    if (modal) focusInitial(container);

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isTopOverlay(id)) return;
      if (event.key === 'Escape') {
        const close = closeRef.current;
        if (close) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        return;
      }
      if (modal) trapTab(event, container);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      removeOverlay(id);
      if (modal && previous && previous.isConnected) previous.focus();
    };
  }, [open, modal, containerRef]);
}
