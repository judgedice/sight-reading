import './domain.css';
import type { ReactNode } from 'react';

export interface ChecklistItemProps {
  /** The short label ("Key and time"), in the quiet ink. */
  title: ReactNode;
  /** This piece's fact, in full ink. */
  detail?: ReactNode;
  /** One short line of advice. Omit it when there is nothing to do ("None in the music"): no empty line is drawn. */
  advice?: ReactNode;
}

/**
 * One row of "Look before you play" (round 2, 04 section 6): label, fact and an optional advice line. There is no
 * box and nothing to tick; it is static text in a list item.
 */
export function ChecklistItem({ title, detail, advice }: ChecklistItemProps) {
  return (
    <li className="dom-check" data-advice={advice ? 'true' : 'false'}>
      <span className="dom-check-row">
        <span className="dom-check-text">
          <span className="dom-check-title">{title}</span>
          {detail ? <span className="dom-check-detail">{detail}</span> : null}
          {advice ? <span className="dom-check-advice">{advice}</span> : null}
        </span>
      </span>
    </li>
  );
}
