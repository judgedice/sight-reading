import './primitives.css';
import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { copy } from '../copy/copy.ts';
import { Glyph } from './Glyph.tsx';
import { useOverlay } from './use-overlay.ts';

/** `confirm` is 480 wide; `default` keeps the old 560; `picker` is 1280 wide and the window height less 48. */
export type ModalSize = 'confirm' | 'default' | 'picker';

export interface ModalProps {
  open: boolean;
  title: string;
  /** Esc and a scrim click call this. Omit for a modal that must be answered with its buttons. */
  onClose?: (() => void) | undefined;
  /** Show the corner close button (default true when onClose is given). */
  closeButton?: boolean;
  size?: ModalSize;
  /** Fixed foot with the actions, bottom right. Only the body scrolls, so these stay in view. */
  footer?: ReactNode;
  /** Extra class on the panel, for example a centred card variant. */
  className?: string;
  children: ReactNode;
}

/**
 * Centred dialog, z 50 (06 section 6.7). The head and the foot are fixed and only the body scrolls.
 * Traps focus and restores it on close.
 */
export function Modal({ open, title, onClose, closeButton, size = 'default', footer, className, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useOverlay(panelRef, { open, onClose, modal: true });
  if (!open) return null;
  const showClose = (closeButton ?? true) && onClose !== undefined;
  const classes = ['ui-modal', `ui-modal-${size}`, className].filter(Boolean).join(' ');
  return createPortal(
    <div className="ui-modal-layer">
      <div className="ui-scrim" data-testid="modal-scrim" onClick={onClose} />
      <div ref={panelRef} className={classes} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
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
        {footer ? (
          <div className="ui-modal-foot" data-testid="modal-foot">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
