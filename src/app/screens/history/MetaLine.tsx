/** The one-line summary of a take (05 section 8.12): "Baritone voice · Difficulty 2 · C major · 4/4 · ♩ = 71". */
import { Fragment } from 'react';
import { BeatUnitText } from '../../../ui/components/domain/index.ts';
import { metaParts, type RowDetail } from './model.ts';

export interface MetaLineProps {
  instrument: string;
  levelServed: number;
  detail: RowDetail;
  className?: string;
}

/** The parts are joined with " · " in the text itself, so copying the line gives the same words the player reads. */
export function MetaLine({ instrument, levelServed, detail, className }: MetaLineProps) {
  const parts = metaParts(instrument, levelServed, detail);
  return (
    <span className={className} data-testid="meta-line">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 ? ' · ' : ''}
          <span className="hist-meta-part">
            <BeatUnitText text={p} />
          </span>
        </Fragment>
      ))}
    </span>
  );
}
