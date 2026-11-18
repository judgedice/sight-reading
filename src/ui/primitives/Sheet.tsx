import './primitives.css';
import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { copy } from '../copy/copy.ts';
import { Glyph } from './Glyph.tsx';
import { useOverlay } from './use-overlay.ts';

export interface SheetProps {
  open: boolean;
  /** Accessible name; also the visible heading unless `hideTitle`. */
  title: string;
  hideTitle?: boolean;
  side?: 'bottom' | 'right';
  onClose?: (() => void) | undefined;
  /**
   * Bottom sheets only. When set and `expanded` is false the sheet shows just this 56 px strip
   * (non-modal, the page behind stays usable). Activating the strip calls `onExpandedChange(true)`.
   */
  peek?: ReactNode;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  children: ReactNode;
}

/** Bottom or right sheet, z 40 (04 section 7.5, 5.10). Modal when fully open; a peek strip is not. */
export function Sheet({
  open,
  title,
  hideTitle,
  side = 'bottom',
  onClose,
  peek,
  expanded = true,
  onExpandedChange,
  children,
}: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const peeking = side === 'bottom' && peek !== undefined && !expanded;
  useOverlay(ref, { open: open && !peeking, onClose, modal: true });
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

  return createPortal(
    <div className="ui-sheet-layer">
      <div className="ui-scrim" data-testid="sheet-scrim" onClick={onClose} />
      <div
        ref={ref}
        className={`ui-sheet ui-sheet-${side}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="ui-sheet-head">
          <h2 id={titleId} className={hideTitle ? 'ui-visually-hidden' : 'ui-sheet-title'}>
            {title}
          </h2>
          {peek !== undefined && onExpandedChange ? (
            <button
              type="button"
              className="ui-icon-button"
              aria-label={copy('common.close')}
              onClick={() => onExpandedChange(false)}
            >
              <Glyph id="chevron-down" />
            </button>
          ) : onClose ? (
            <button type="button" className="ui-icon-button" aria-label={copy('common.close')} onClick={onClose}>
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
