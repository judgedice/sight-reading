/**
 * Time and units (01 §5.1). Pure, no imports beyond types.
 *
 * Ticks are integer positions from the excerpt start (the pickup, if any, starts at tick 0).
 * Beats are metronome beats counted from bar 1 beat 1, so the pickup is negative.
 * Score seconds are beats at a constant bpm, also from bar 1 beat 1.
 */
import { TPQ } from './types.ts';
import type { Beats, Meter, ScoreSeconds, Ticks } from './types.ts';

export { TPQ };
export type { Beats, ScoreSeconds, Ticks };

/** Ticks → beats from bar 1 beat 1 (negative inside the pickup). */
export function ticksToBeats(t: Ticks, meter: Meter, pickupTicks: Ticks): Beats {
  return (t - pickupTicks) / meter.countUnitTicks;
}

/** Inverse of `ticksToBeats` (not rounded; round at the call site if integer ticks are needed). */
export function beatsToTicks(b: Beats, meter: Meter, pickupTicks: Ticks): Ticks {
  return b * meter.countUnitTicks + pickupTicks;
}

/** Beats → seconds from bar 1 beat 1 at a constant tempo (bpm of the metronome beat). */
export function beatsToScoreSeconds(b: Beats, bpm: number): ScoreSeconds {
  return (b * 60) / bpm;
}

/** Inverse of `beatsToScoreSeconds`. */
export function scoreSecondsToBeats(s: ScoreSeconds, bpm: number): Beats {
  return (s * bpm) / 60;
}

/** Ticks → score seconds in one step. */
export function ticksToScoreSeconds(t: Ticks, meter: Meter, pickupTicks: Ticks, bpm: number): ScoreSeconds {
  return beatsToScoreSeconds(ticksToBeats(t, meter, pickupTicks), bpm);
}

/** Ticks in one full bar. */
export function ticksPerBar(meter: Meter): Ticks {
  return meter.countUnitTicks * meter.countsPerBar;
}

/**
 * Meter for a time signature under the 02 conventions: the metronome beat is the quarter in x/4,
 * the half in 2/2 and 3/2, the eighth in 3/8, 5/8, 7/8, and the dotted quarter in 6/8, 9/8, 12/8.
 */
export function makeMeter(beats: number, beatType: Meter['beatType']): Meter {
  const unitTicks = (TPQ * 4) / beatType;
  const compound = beatType === 8 && beats >= 6 && beats % 3 === 0;
  if (compound) return { beats, beatType, countUnitTicks: unitTicks * 3, countsPerBar: beats / 3 };
  return { beats, beatType, countUnitTicks: unitTicks, countsPerBar: beats };
}
