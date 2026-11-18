import './primitives.css';
import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { copy } from '../copy/copy.ts';
import { Glyph } from './Glyph.tsx';
import { useOverlay } from './use-overlay.ts';

export interface ModalProps {
  open: boolean;
  title: string;
  /** Esc and a scrim click call this. Omit for a modal that must be answered with its buttons. */
  onClose?: (() => void) | undefined;
  /** Show the corner close button (default true when onClose is given). */
  closeButton?: boolean;
  /** Extra class on the panel, for example a centred card variant. */
  className?: string;
  children: ReactNode;
}

/** Centred modal dialog, max 560 wide, z 50 (04 section 7.5). Traps focus and restores it on close. */
export function Modal({ open, title, onClose, closeButton, className, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useOverlay(panelRef, { open, onClose, modal: true });
  if (!open) return null;
  const showClose = (closeButton ?? true) && onClose !== undefined;
  return createPortal(
    <div className="ui-modal-layer">
      <div className="ui-scrim" data-testid="modal-scrim" onClick={onClose} />
      <div
        ref={panelRef}
        className={className ? `ui-modal ${className}` : 'ui-modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="ui-modal-head">
          <h2 id={titleId} className="ui-modal-title">
            {title}
          </h2>
          {showClose ? (
            <button type="button" className="ui-icon-button" aria-label={copy('common.close')} onClick={onClose}>
              <Glyph id="x" />
            </button>
          ) : null}
        </div>
        <div className="ui-modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
