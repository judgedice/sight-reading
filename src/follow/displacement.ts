/**
 * Live displacement detector (01 §9.5, PLAN R34).
 *
 * On each new detected note, the last 4 detected notes (pitch and onset, so their pitch intervals and IOIs) are
 * compared with the expected notes at a constant offset δ. A candidate δ comes from pairing any window note with
 * any expected note of the same pitch (O(N) per note). δ is accepted when
 *  - |δ| ≥ max(matchWindow, 1 beat), and δ lies in the allowed range;
 *  - at least 3 of the 4 window notes land, at δ, on an expected note of the right pitch with an onset error
 *    within that note's tRed (their IOIs agree with the score within tolerance);
 *  - the window's cost at δ is at most half its cost at δ = 0, and lower by at least one wrong-pitch term, so a
 *    window the score already explains at δ = 0 (a perfect take of repeated material) never fires.
 * The cost is 01 §9.2's (`cost.ts`) summed over the window, with an unmatched note costing a skipped detected note.
 *
 * δ follows `DisplacedSegment.offsetBeats`: expected onset beat − played onset beat, negative when the player went
 * back. 01 §9.5 gives the range as "[−2 bars, +4 bars]" without fixing the sign; it is read here as the player's lag
 * (played − expected), so a restart may go back up to 4 bars and a skip may jump up to 2 bars ahead.
 */
import type { Configs, ExpectedNote, Instrument, ResolvedTolerance } from '../core/types.ts';
import { classifyAgainst, matchCost, PITCH_COST_WRONG, pitchCost, SKIP_DETECTED_COST, type PitchSample } from './cost.ts';

/** Window length, detected notes (01 §9.5). */
export const DISPLACEMENT_WINDOW_NOTES = 4;
/** Pitch matches needed in the window (01 §9.5: "at least 3 of the 4"). */
export const DISPLACEMENT_MIN_MATCHES = 3;
/** The offset must cost at least this many times less than δ = 0 (01 §9.5: "at least 2× less"). */
export const DISPLACEMENT_COST_RATIO = 2;
/** Furthest restart, bars back (see the module comment on the range's sign). */
export const DISPLACEMENT_MAX_BACK_BARS = 4;
/** Furthest skip, bars ahead. */
export const DISPLACEMENT_MAX_AHEAD_BARS = 2;
/** Smallest offset, beats (01 §9.5: |δ| ≥ max(matchWindow, 1 beat)). */
const MIN_OFFSET_BEATS = 1;
const CENTS_PER_SEMITONE = 100;
const SEMITONES_PER_OCTAVE = 12;
/** Candidate offsets closer than this are the same, beats. */
const SAME_OFFSET_BEATS = 1e-3;

/** A detected note as the detector sees it. */
export interface WindowNote extends PitchSample {
  /** Played onset, score seconds. */
  s: number;
}

export interface WindowFit {
  cost: number;
  /** Notes landing on the right pitch within tRed. */
  matches: number;
  /** Largest match window among the matched expected notes, seconds. */
  maxWindowSec: number;
}

export interface DisplacementHit {
  offsetBeats: number;
  cost: number;
  zeroCost: number;
  matches: number;
}

export class DisplacementDetector {
  private readonly beatSec: number;
  private readonly maxWindowSec: number;
  private readonly onsets: number[];

  constructor(
    private readonly expected: readonly ExpectedNote[],
    private readonly tol: readonly ResolvedTolerance[],
    bpm: number,
    private readonly beatsPerBar: number,
    private readonly inst: Instrument,
    private readonly cfg: Configs,
  ) {
    this.beatSec = 60 / bpm;
    this.maxWindowSec = tol.reduce((m, t) => Math.max(m, t.matchWindowSec), 0);
    this.onsets = expected.map((e) => e.onsetSec);
  }

  /** First expected index with onsetSec ≥ t. */
  private lowerBound(t: number): number {
    let lo = 0;
    let hi = this.onsets.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.onsets[mid] as number) < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Fit of the window at offset δ (beats): each note, in order, takes the cheapest admissible expected note after
   * the previous one's; a note with none costs a skipped detected note.
   */
  fit(window: readonly WindowNote[], offsetBeats: number, offsetCents: number): WindowFit {
    const shift = offsetBeats * this.beatSec;
    let cost = 0;
    let matches = 0;
    let maxW = 0;
    let lastIdx = -1;
    for (const n of window) {
      const target = n.s + shift;
      let best: { idx: number; cost: number; hit: boolean } | null = null;
      for (let i = Math.max(this.lowerBound(target - this.maxWindowSec), lastIdx + 1); i < this.expected.length; i++) {
        const e = this.expected[i] as ExpectedNote;
        if (e.onsetSec > target + this.maxWindowSec) break;
        const t = this.tol[i] as ResolvedTolerance;
        const dt = target - e.onsetSec;
        const { c } = classifyAgainst(e, n, offsetCents, this.inst, this.cfg);
        const k = matchCost(dt, t, pitchCost(c));
        if (k === null) continue;
        if (!best || k < best.cost) best = { idx: i, cost: k, hit: c.kind === 'correct' && Math.abs(dt) <= t.tRedSec };
      }
      if (!best) {
        cost += SKIP_DETECTED_COST;
        continue;
      }
      cost += best.cost;
      lastIdx = best.idx;
      if (best.hit) {
        matches++;
        maxW = Math.max(maxW, (this.tol[best.idx] as ResolvedTolerance).matchWindowSec);
      }
    }
    return { cost, matches, maxWindowSec: maxW };
  }

  /** Offsets that put some window note on an expected note of its pitch, inside the allowed range. */
  private candidates(window: readonly WindowNote[], offsetCents: number): number[] {
    const lo = -DISPLACEMENT_MAX_BACK_BARS * this.beatsPerBar;
    const hi = DISPLACEMENT_MAX_AHEAD_BARS * this.beatsPerBar;
    const out: number[] = [];
    for (const n of window) {
      const playedBeat = n.s / this.beatSec;
      const near = n.midi - offsetCents / CENTS_PER_SEMITONE;
      for (const e of this.expected) {
        const d = e.onsetBeat - playedBeat;
        if (d < lo || d > hi || Math.abs(d) < MIN_OFFSET_BEATS) continue;
        // Cheap reject before the full classification: more than a semitone from every octave of the target.
        const off = near - e.concertMidi;
        if (Math.abs(off - SEMITONES_PER_OCTAVE * Math.round(off / SEMITONES_PER_OCTAVE)) > 1) continue;
        if (classifyAgainst(e, n, offsetCents, this.inst, this.cfg).c.kind !== 'correct') continue;
        if (out.some((x) => Math.abs(x - d) < SAME_OFFSET_BEATS)) continue;
        out.push(d);
      }
    }
    return out;
  }

  /** The best accepted offset for this window, or null (01 §9.5). */
  detect(window: readonly WindowNote[], offsetCents: number): DisplacementHit | null {
    if (window.length < DISPLACEMENT_WINDOW_NOTES) return null;
    const zero = this.fit(window, 0, offsetCents).cost;
    let best: DisplacementHit | null = null;
    for (const d of this.candidates(window, offsetCents)) {
      const f = this.fit(window, d, offsetCents);
      if (f.matches < DISPLACEMENT_MIN_MATCHES) continue;
      if (Math.abs(d) * this.beatSec < f.maxWindowSec) continue;
      if (zero < DISPLACEMENT_COST_RATIO * f.cost || zero - f.cost < PITCH_COST_WRONG) continue;
      if (!best || f.cost < best.cost || (f.cost === best.cost && Math.abs(d) < Math.abs(best.offsetBeats))) {
        best = { offsetBeats: d, cost: f.cost, zeroCost: zero, matches: f.matches };
      }
    }
    return best;
  }
}
