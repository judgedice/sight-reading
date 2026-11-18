import './domain.css';
import { useId, useState, type ReactNode } from 'react';
import { copy } from '../../copy/copy.ts';

export interface TipContent {
  /** Instrument abbreviation, for the 40 px mark. */
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
  secondary?: Pick<TipContent, 'headline' | 'body' | 'evidence'>;
  /** Position text "(1 of 2)" is shown when total is given. */
  index?: number;
  total?: number;
  actions?: ReactNode;
}

/** Primary tip and at most one secondary behind an expander (04 5.6). Text comes from tips.json only. */
export function TipCard({ tip, secondary, index, total, actions }: TipCardProps) {
  const [open, setOpen] = useState(false);
  const secId = useId();
  return (
    <article className="dom-tip">
      <header className="dom-tip-header">
        <span className="dom-tip-caption">{copy('tips.header')}</span>
        {index !== undefined && total !== undefined ? <span className="dom-tip-caption">{copy('tips.count', { n: index, total })}</span> : null}
      </header>
      <p className="dom-tip-who">
        <span className="dom-tip-mark" aria-hidden="true">
          {tip.instrumentAbbr}
        </span>
        <span className="dom-tip-caption">{`${tip.instrumentName} · ${tip.dimension}`}</span>
      </p>
      <h2 className="dom-tip-headline">{tip.headline}</h2>
      <p className="dom-tip-body">{tip.body}</p>
      <p className="dom-tip-evidence">{tip.evidence}</p>
      {secondary ? (
        <div className="dom-tip-secondary">
          <button type="button" className="dom-tip-also" aria-expanded={open} aria-controls={secId} onClick={() => setOpen(!open)}>
            {copy('tips.also', { headline: secondary.headline })}
          </button>
          <div id={secId} hidden={!open}>
            <p className="dom-tip-body">{secondary.body}</p>
            <p className="dom-tip-evidence">{secondary.evidence}</p>
          </div>
        </div>
      ) : null}
      {actions ? <footer className="dom-tip-actions">{actions}</footer> : null}
    </article>
  );
}
