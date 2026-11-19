/** The one-line summary of a take (05 section 8.12): "Baritone voice · Difficulty 2 · C major · 4/4 · ♩ = 71". */
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
        <span key={i} className="hist-meta-part">
          {i > 0 ? ' · ' : ''}
          <BeatUnitText text={p} />
        </span>
      ))}
    </span>
  );
}
