import './primitives.css';
import { useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { copy } from '../copy/copy.ts';
import { Button } from '../components/form/Button.tsx';
import { Glyph } from './Glyph.tsx';
import { useOverlay } from './use-overlay.ts';

/** A downward drag of at least this many CSS px on the grabber or header cancels the sheet. */
export const SHEET_SWIPE_DISTANCE = 80;

export interface SheetProps {
  open: boolean;
  /** Accessible name; also the visible heading unless `hideTitle`. */
  title: string;
  hideTitle?: boolean;
  side?: 'bottom' | 'right';
  /**
   * The cancel action: Escape, a tap on the scrim, a swipe down on the grabber (bottom sheets) and the
   * close button all call it. Same as `onClose`; `onCancel` wins when both are given.
   */
  onCancel?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  /** Shows a primary compact Done button in the header in place of the close button. */
  onDone?: (() => void) | undefined;
  doneLabel?: string;
  /**
   * Bottom sheets only. When set and `expanded` is false the sheet shows just this 56 px strip
   * (non-modal, the page behind stays usable). Activating the strip calls `onExpandedChange(true)`.
   */
  peek?: ReactNode;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  children: ReactNode;
}

/** Bottom or right sheet, z 40 (06 section 6.7). A bottom sheet has a grabber, a header and swipe-down to cancel. */
export function Sheet({
  open,
  title,
  hideTitle,
  side = 'bottom',
  onCancel,
  onClose,
  onDone,
  doneLabel,
  peek,
  expanded = true,
  onExpandedChange,
  children,
}: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const cancel = onCancel ?? onClose;
  const peeking = side === 'bottom' && peek !== undefined && !expanded;
  const drag = useRef<{ startY: number; id: number } | null>(null);
  const [offset, setOffset] = useState(0);
  useOverlay(ref, { open: open && !peeking, onClose: cancel, modal: true });
  if (!open) return null;

  if (peeking) {
    return createPortal(
      <div className="ui-sheet ui-sheet-bottom ui-sheet-peek" role="region" aria-label={title}>
        <button type="button" className="ui-sheet-peek-button" onClick={() => onExpandedChange?.(true)} aria-expanded="false">
          {peek}
        </button>
      </div>,
      document.body,
    );
  }

  const swipeable = side === 'bottom' && cancel !== undefined;
  const onDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!swipeable || (event.target as HTMLElement).closest('button')) return;
    drag.current = { startY: event.clientY, id: event.pointerId };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointers have no capture; the drag still works.
    }
  };
  const onMove = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!drag.current) return;
    setOffset(Math.max(0, event.clientY - drag.current.startY));
  };
  const onUp = (event: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dy = event.clientY - d.startY;
    setOffset(0);
    if (dy >= SHEET_SWIPE_DISTANCE) cancel?.();
  };
  const dragHandlers = swipeable
    ? { onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: () => { drag.current = null; setOffset(0); } }
    : {};
  const style: CSSProperties | undefined = offset > 0 ? { transform: `translateY(${offset}px)`, animation: 'none' } : undefined;

  return createPortal(
    <div className="ui-sheet-layer">
      <div className="ui-scrim" data-testid="sheet-scrim" onClick={cancel} />
      <div
        ref={ref}
        className={`ui-sheet ui-sheet-${side}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={style}
      >
        {side === 'bottom' ? <div className="ui-sheet-grabber" data-testid="sheet-grabber" aria-hidden="true" {...dragHandlers} /> : null}
        <div className={swipeable ? 'ui-sheet-head ui-sheet-head-swipe' : 'ui-sheet-head'} {...dragHandlers}>
          <h2 id={titleId} className={hideTitle ? 'ui-visually-hidden' : 'ui-sheet-title'}>
            {title}
          </h2>
          {onDone ? (
            <Button variant="primary" size="compact" label={doneLabel ?? copy('setup.done')} onClick={onDone} />
          ) : peek !== undefined && onExpandedChange ? (
            <button
              type="button"
              className="ui-icon-button"
              aria-label={copy('common.close')}
              onClick={() => onExpandedChange(false)}
            >
              <Glyph id="chevron-down" />
            </button>
          ) : cancel ? (
            <button type="button" className="ui-icon-button" aria-label={copy('common.close')} onClick={cancel}>
              <Glyph id="x" />
            </button>
          ) : null}
        </div>
        <div className="ui-sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
