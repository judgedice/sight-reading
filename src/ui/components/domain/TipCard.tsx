import './domain.css';
import { useId, useState, type ReactNode } from 'react';
import { copy } from '../../copy/copy.ts';
import { Glyph } from '../../primitives/Glyph.tsx';

export interface TipContent {
  /** Instrument abbreviation, kept for callers that still pass it. */
  instrumentAbbr: string;
  instrumentName: string;
  /** Dimension label from tips.json (Notes, In tune, Rhythm, Flow). */
  dimension: string;
  headline: string;
  body: string;
  /** The evidence line; the caller builds it from the pattern's evidenceTemplate or tips.evidence. */
  evidence: string;
}

export interface TipCardProps {
  tip: TipContent;
  secondary?: Pick<TipContent, 'headline' | 'body' | 'evidence'> & Partial<Pick<TipContent, 'dimension'>>;
  /** Primary actions, for example "Hear bar 2" buttons. */
  actions?: ReactNode;
  /** Actions inside the expanded secondary tip. */
  secondaryActions?: ReactNode;
}

/** "One thing to try" (06 6.15): brass-wash lightbulb tile, serif title, the tip, evidence, hear buttons, and at most one more tip behind a quiet disclosure. */
export function TipCard({ tip, secondary, actions, secondaryActions }: TipCardProps) {
  const [open, setOpen] = useState(false);
  const secId = useId();
  return (
    <article className="dom-tip">
      <header className="dom-tip-header">
        <span className="dom-tip-tile" aria-hidden="true">
          <Glyph id="lightbulb" size={20} />
        </span>
        <h2 className="dom-tip-title">{copy('results.tip.title')}</h2>
      </header>
      <p className="dom-tip-caption dom-tip-who">{`${tip.instrumentName} · ${tip.dimension}`}</p>
      <h3 className="dom-tip-headline">{tip.headline}</h3>
      <p className="dom-tip-body">{tip.body}</p>
      <p className="dom-tip-evidence">{tip.evidence}</p>
      {actions ? <div className="dom-tip-actions">{actions}</div> : null}
      {secondary ? (
        <div className="dom-tip-secondary">
          <button type="button" className="dom-tip-also" aria-expanded={open} aria-controls={secId} onClick={() => setOpen(!open)}>
            <Glyph id={open ? 'chevron-down' : 'chevron-right'} size={16} />
            {open ? copy('results.tip.less', { n: 1 }) : copy('results.tip.more', { n: 1 })}
          </button>
          <div id={secId} className="dom-tip-panel" hidden={!open}>
            {secondary.dimension ? <p className="dom-tip-dim">{secondary.dimension}</p> : null}
            <p className="dom-tip-body">{secondary.body}</p>
            <p className="dom-tip-evidence">{secondary.evidence}</p>
            {secondaryActions ? <div className="dom-tip-actions">{secondaryActions}</div> : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
