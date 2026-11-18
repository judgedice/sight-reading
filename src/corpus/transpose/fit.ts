/**
 * Range fit in closed form (03 §7.3) and the choice of the concert shift (03 §7.4 step 1).
 *
 * Notation follows 03 §7.3: `I = {d_I, c_I}` is the instrument interval (written minus sounding), `[bMin, bMax]`
 * the written tier band for the level, `[lo, hi]` the excerpt's concert range. A concert shift `t` fits when
 * `tMin <= t <= tMax` with `tMin = bMin - c_I - lo` and `tMax = bMax - c_I - hi`. The build uses the same functions
 * for `stats.fit` (03 §11 item 9), so they take plain numbers and keys rather than manifest entries.
 */
import type { Instrument, Interval, KeySig } from '../../core/types.ts';
import { toMidi, tonicOf, transposeKey } from '../../theory/index.ts';

const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** The integer interval of concert shifts that keep every written note inside the band. */
export interface ShiftWindow {
  tMin: number;
  tMax: number;
}

/** 03 §7.3: the shift window. Empty (tMin > tMax) also covers 03 §7.5 rule 2 (span wider than the band). */
export function shiftWindow(rangeConcert: readonly [number, number], inst: Instrument, band: readonly [number, number]): ShiftWindow {
  const cI = inst.writtenMinusSounding.chromatic;
  return { tMin: band[0] - cI - rangeConcert[0], tMax: band[1] - cI - rangeConcert[1] };
}

export const windowFits = (w: ShiftWindow): boolean => w.tMin <= w.tMax;

export const negateInterval = (iv: Interval): Interval => ({ diatonic: -iv.diatonic || 0, chromatic: -iv.chromatic || 0 });

/** 03 §7.3 step 1: the concert key `Kc = transposeKey(Kw, -I)`. May lie outside -7..7 (see `isValidKey`). */
export function concertKeyFor(writtenKey: KeySig, inst: Instrument): KeySig {
  return transposeKey(writtenKey, negateInterval(inst.writtenMinusSounding));
}

const tonicPc = (k: KeySig): number => mod(toMidi(tonicOf(k)), 12);

/** 03 §7.3 step 2: `p = (pc(tonic(Kc)) - pc(tonic(Ks))) mod 12`. */
export function pitchClassShift(sourceKey: KeySig, writtenKey: KeySig, inst: Instrument): number {
  return mod(tonicPc(concertKeyFor(writtenKey, inst)) - tonicPc(sourceKey), 12);
}

/** A fitting concert shift and its minimum margin to the band edges, semitones. */
export interface ShiftChoice {
  t: number;
  margin: number;
}

/**
 * 03 §7.3 step 3 and §7.4 step 1: among `t = p + 12k` inside the window, the largest minimum margin to the band
 * edges, then the smallest |t|, then the lower t (a deterministic tie-break, the same as the fixture planner).
 * Null when no candidate fits (03 §7.5 rule 1).
 */
export function chooseShift(w: ShiftWindow, p: number, rangeConcert: readonly [number, number], inst: Instrument, band: readonly [number, number]): ShiftChoice | null {
  if (!windowFits(w)) return null;
  const cI = inst.writtenMinusSounding.chromatic;
  let best: ShiftChoice | null = null;
  for (let k = Math.ceil((w.tMin - p) / 12); p + 12 * k <= w.tMax; k++) {
    const t = p + 12 * k;
    const margin = Math.min(rangeConcert[0] + cI + t - band[0], band[1] - (rangeConcert[1] + cI + t));
    if (
      !best ||
      margin > best.margin ||
      (margin === best.margin && (Math.abs(t) < Math.abs(best.t) || (Math.abs(t) === Math.abs(best.t) && t < best.t)))
    ) {
      best = { t, margin };
    }
  }
  return best;
}

/** Whether an excerpt fits the band in a written key (the O(1) predicate behind `stats.fit`). */
export function fitsInKey(
  sourceKey: KeySig,
  rangeConcert: readonly [number, number],
  writtenKey: KeySig,
  inst: Instrument,
  band: readonly [number, number],
): ShiftChoice | null {
  if (sourceKey.mode !== writtenKey.mode) return null;
  return chooseShift(shiftWindow(rangeConcert, inst, band), pitchClassShift(sourceKey, writtenKey, inst), rangeConcert, inst, band);
}
