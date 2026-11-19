import './primitives.css';
import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEventHandler, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOverlay } from './use-overlay.ts';

export interface PopoverProps {
  open: boolean;
  /** The element the popover hangs from. */
  anchor: HTMLElement | null;
  /** Called on Escape and on a press outside the popover and its anchor. Focus returns to the anchor after Escape. */
  onClose?: (() => void) | undefined;
  /** Accessible name of the popover. */
  label: string;
  /** Bold first line naming the topic. */
  title?: string;
  /** Element id, so the anchor can point at it with aria-controls. */
  id?: string;
  onPointerEnter?: PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: PointerEventHandler<HTMLDivElement>;
  children: ReactNode;
}

interface Placement {
  top: number;
  left: number;
  below: boolean;
  /** Arrow centre, measured from the popover's left edge. */
  arrow: number;
}

/**
 * Margin kept between the popover and the viewport edge, in CSS px of layout (not styling). 16 keeps a popover near
 * the right edge (the reference info on the read-through) off the window frame, as the mockups draw it, and still
 * leaves a 358 px popover room on a 390 px phone.
 */
const EDGE = 16;
/** Gap between anchor and popover: room for the 12 px arrow. */
const GAP = 10;

/**
 * Anchored, non-modal popover (06 section 6.7): max 340 wide, z 45, a 12 px arrow, an optional bold
 * title line. Escape and a press outside close it; after Escape focus goes back to the anchor.
 */
export function Popover({ open, anchor, onClose, label, title, id, onPointerEnter, onPointerLeave, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const ownId = useId();
  const [placement, setPlacement] = useState<Placement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const handleClose = onClose
    ? () => {
        onClose();
        if (anchor && anchor.isConnected) anchor.focus();
      }
    : undefined;
  useOverlay(ref, { open, onClose: handleClose, modal: false });

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const p = ref.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let below = true;
    let top = a.bottom + GAP;
    if (top + p.height > vh - EDGE && a.top - GAP - p.height >= EDGE) {
      top = a.top - GAP - p.height;
      below = false;
    }
    const left = Math.max(EDGE, Math.min(a.left + a.width / 2 - p.width / 2, vw - p.width - EDGE));
    const arrow = Math.max(16, Math.min(p.width - 16, a.left + a.width / 2 - left));
    setPlacement({ top, left, below, arrow });
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (ref.current?.contains(target) || anchor?.contains(target)) return;
      closeRef.current?.();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      id={id ?? ownId}
      className="ui-popover"
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      data-placement={placement ? (placement.below ? 'below' : 'above') : undefined}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={
        placement
          ? { top: placement.top, left: placement.left, ['--popover-arrow-x' as string]: `${placement.arrow}px` }
          : { visibility: 'hidden' }
      }
    >
      <span className="ui-popover-arrow" aria-hidden="true" />
      {title ? <p className="ui-popover-title">{title}</p> : null}
      <div className="ui-popover-body">{children}</div>
    </div>,
    document.body,
  );
}
