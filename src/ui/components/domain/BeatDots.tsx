import './domain.css';

export interface BeatDotsProps {
  beatsPerBar: number;
  /** Beats per group, e.g. [3, 2] for 5/8 beamed 3+2. Defaults to one group. */
  grouping?: readonly number[];
  /** 1-based beat that is sounding now; null before the first click. */
  currentBeat: number | null;
  /** Count-in shows large numbers instead of dots (04 5.4.2). */
  countIn?: boolean;
  /** Above 180 bpm only every second beat pulses (WCAG 2.3.1). Beat 1 always pulses. */
  bpm?: number;
  /** The dots are aria-hidden during takes (8.4); turn on for static displays. */
  announce?: boolean;
}

/** Above this tempo only every second beat pulses (04 5.4.3). */
export const BEAT_PULSE_HALVING_BPM = 180;

export function beatPulses(beat: number, bpm: number | undefined): boolean {
  if (bpm === undefined || bpm <= BEAT_PULSE_HALVING_BPM) return true;
  return beat % 2 === 1;
}

/** Splits beats into groups; a grouping that does not sum to beatsPerBar is ignored. */
export function groupBeats(beatsPerBar: number, grouping?: readonly number[]): number[][] {
  const sizes = grouping && grouping.reduce((a, b) => a + b, 0) === beatsPerBar && grouping.every((g) => g > 0) ? grouping : [beatsPerBar];
  const out: number[][] = [];
  let beat = 1;
  for (const size of sizes) {
    out.push(Array.from({ length: size }, () => beat++));
  }
  return out;
}

/** One dot per beat (04 5.4.3); during the count-in the numbers show instead (5.4.2). */
export function BeatDots({ beatsPerBar, grouping, currentBeat, countIn = false, bpm, announce = false }: BeatDotsProps) {
  const groups = groupBeats(beatsPerBar, grouping);
  return (
    <div className="dom-beats" data-count-in={countIn ? 'true' : undefined} aria-hidden={announce ? undefined : 'true'}>
      {groups.map((beats) => (
        <span className="dom-beats-group" key={beats[0]}>
          {beats.map((beat) => {
            const active = currentBeat === beat;
            const pulses = active && beatPulses(beat, bpm);
            const past = currentBeat !== null && beat < currentBeat;
            const state = pulses ? 'pulse' : active ? 'steady' : past ? 'past' : 'idle';
            return countIn ? (
              <span key={beat} className="dom-beat-number" data-state={state} data-beat={beat}>
                {beat}
              </span>
            ) : (
              <span key={beat} className="dom-beat-dot" data-state={state} data-beat={beat} data-downbeat={beat === 1 ? 'true' : undefined} />
            );
          })}
        </span>
      ))}
    </div>
  );
}
