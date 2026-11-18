import './primitives.css';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOverlay } from './use-overlay.ts';

export interface PopoverProps {
  open: boolean;
  /** The element the popover hangs from. */
  anchor: HTMLElement | null;
  onClose?: (() => void) | undefined;
  /** Accessible name of the popover. */
  label: string;
  children: ReactNode;
}

interface Placement {
  top: number;
  left: number;
}

/** Margin kept between the popover and the viewport edge, in CSS px of layout (not styling). */
const EDGE = 8;

/** Anchored popover, max 320 wide, z 45. Esc closes it; it stays while hovered or focused (1.4.13). */
export function Popover({ open, anchor, onClose, label, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [placement, setPlacement] = useState<Placement | null>(null);
  useOverlay(ref, { open, onClose, modal: false });

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const p = ref.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let top = a.bottom + EDGE;
    if (top + p.height > vh - EDGE && a.top - EDGE - p.height >= EDGE) top = a.top - EDGE - p.height;
    const left = Math.max(EDGE, Math.min(a.left, vw - p.width - EDGE));
    setPlacement({ top, left });
  }, [open, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      id={id}
      className="ui-popover"
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      style={placement ? { top: placement.top, left: placement.left } : { visibility: 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  );
}
