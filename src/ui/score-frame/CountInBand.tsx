// The count-in band's content (06 section 6.12): the beat number in the paper's top margin, the beat dots beside it
// (the downbeat larger, the current one brass with a halo) and a caption such as "Bar 1 · ♩ = 72" (a copy() string
// from the caller). ScoreFrame places it above the first system; this component only draws it. Visual only: the
// screen's one live region announces the count-in.
import './count-in-band.css';

export interface CountInBandProps {
  /** Current beat, 1-based; 0 before the first click. */
  beat: number;
  /** Beats in the count-in bar. */
  beats: number;
  /** Line under the dots, from copy(). */
  caption: string;
}

export function CountInBand({ beat, beats, caption }: CountInBandProps) {
  const dots = Array.from({ length: Math.max(0, beats) }, (_, i) => i + 1);
  return (
    <div className="sf-count" aria-hidden="true" data-beat={beat}>
      <span key={beat} className="sf-count-num" data-downbeat={beat === 1 ? 'true' : undefined}>
        {beat > 0 ? beat : ''}
      </span>
      <span className="sf-count-side">
        <span className="sf-count-dots">
          {dots.map((d) => (
            <span
              key={d}
              className="sf-count-dot"
              data-downbeat={d === 1 ? 'true' : undefined}
              data-state={d < beat ? 'past' : d === beat ? 'current' : 'pending'}
            />
          ))}
        </span>
        <span className="sf-count-caption">{caption}</span>
      </span>
    </div>
  );
}
