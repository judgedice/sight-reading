// The count-in track (round 2, 01-ux §11; 04-design §5; PLAN R70): a line over one cell per count-in beat, a plain
// 1 2 3 4, then the entry word ("Sing" or "Play") only on the music's first beat (`go`), never before it. With more
// than one bar (not shipped since R70) the last bar is brass.
// The current cell fills and shows its number large; counted cells stay filled. ScoreFrame places it in the cue zone
// above the first system, so nothing in the music moves. Visual only and never a control: the whole track is
// aria-hidden, holds no button and nothing focusable; the screen's one live region says the count-in.
import type { ReactNode } from 'react';
import './count-in-band.css';

export interface CountInBandProps {
  /** Count-in clicks heard so far (1-based); 0 before the first click. */
  click: number;
  /** Beats (clicks) in one count-in bar. */
  beatsPerBar: number;
  /** Count-in bars (1 everywhere since PLAN R70). */
  bars: number;
  /** The line's lead, from copy(): "Count-in: listen to the beat" or "Come in after 4". */
  title: string;
  /** The line's detail, from the caller: "Count-in bar 1 of 2 · ♩ = 60". */
  detail: ReactNode;
  /** The entry word at the end of the track, from copy(): "Sing" or "Play". */
  entry: string;
  /** The count of the last bar after which the player comes in (a pickup comes in earlier); default its last count. */
  entryAfter?: number;
  /** The music's first beat is heard: the entry word shows now, and only now. */
  go?: boolean;
}

type CellState = 'pending' | 'current' | 'past';

export function CountInBand({ click, beatsPerBar, bars, title, detail, entry, entryAfter, go = false }: CountInBandProps) {
  const bpb = Math.max(1, beatsPerBar);
  const n = Math.max(1, bars);
  const total = n * bpb;
  const k = Math.max(0, Math.min(click, total));
  const bar = k === 0 ? 1 : Math.ceil(k / bpb);
  const last = n > 1 && bar === n;
  const entryCount = Math.max(1, Math.min(bpb, entryAfter ?? bpb));
  const groups = Array.from({ length: n }, (_, b) => b + 1);
  const state = (i: number): CellState => (i < k ? 'past' : i === k ? 'current' : 'pending');
  return (
    <div className="sf-count" aria-hidden="true" data-click={k} data-bar={bar} data-last={last ? 'true' : undefined} data-go={go ? 'true' : undefined}>
      <p className="sf-count-line">
        <span className="sf-count-title">{title}</span>
        <span className="sf-count-detail">{detail}</span>
      </p>
      <div className="sf-count-track">
        {groups.map((b) => (
          <span key={b} className="sf-count-group" data-tone={n > 1 && b === n ? 'last' : 'listen'}>
            {b > 1 ? <span className="sf-count-sep" /> : null}
            {/* A pickup comes in before the bar ends: the last bar shows only the counts before the entry, so the
                entry word sits right after the count the title names ("Come in after 3": 1 2 3, then "Sing"). */}
            {Array.from({ length: b === n ? entryCount : bpb }, (_, j) => {
              const i = (b - 1) * bpb + j + 1;
              const s = state(i);
              return (
                <span key={`${i}-${s}`} className="sf-count-cell" data-state={s}>
                  {j + 1}
                </span>
              );
            })}
          </span>
        ))}
        {/* Only on the go beat, beside the cells and out of the flow, so the count stays centred and nothing moves. */}
        {go ? (
          <span className="sf-count-entry" data-on="true">
            <span className="sf-count-dash" />
            <span className="sf-count-word">{entry}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
