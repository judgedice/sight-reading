import './domain.css';
import type { ReactNode } from 'react';
import { Glyph } from '../../primitives/Glyph.tsx';

export interface ChecklistItemProps {
  checked: boolean;
  title: ReactNode;
  detail?: ReactNode;
  /** The item being worked on now: 3 px accent bar on the left. */
  active?: boolean;
  /** When given, the row is a checkbox button; otherwise it is static text in a list item. */
  onToggle?: (checked: boolean) => void;
}

/** One STARS-style row (04 7.5). */
export function ChecklistItem({ checked, title, detail, active = false, onToggle }: ChecklistItemProps) {
  const body = (
    <>
      <span className="dom-check-mark" data-checked={checked ? 'true' : 'false'} aria-hidden="true">
        {checked ? <Glyph id="check" size={14} /> : null}
      </span>
      <span className="dom-check-text">
        <span className="dom-check-title">{title}</span>
        {detail ? <span className="dom-check-detail">{detail}</span> : null}
      </span>
    </>
  );
  return (
    <li className="dom-check" data-active={active ? 'true' : undefined} data-checked={checked ? 'true' : 'false'} aria-current={active ? 'step' : undefined}>
      {onToggle ? (
        <button type="button" role="checkbox" aria-checked={checked} className="dom-check-row dom-check-button" onClick={() => onToggle(!checked)}>
          {body}
        </button>
      ) : (
        <span className="dom-check-row">{body}</span>
      )}
    </li>
  );
}
