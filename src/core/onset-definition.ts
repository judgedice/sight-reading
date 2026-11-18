/**
 * Reference onset definition (01 §7.4). One implementation shared by the synth (ground truth),
 * the DSP tests and the grader fixtures. Pure functions over plain arrays; times are seconds on
 * whatever single timeline the caller uses (clock seconds in the DSP, synth seconds in tests).
 *
 * 1. Pitch-change onset: cents-midpoint crossing of the pitch track, linearly interpolated.
 * 2. Repeated same-pitch onset: half-rise of the envelope after the dip, refined by a flux peak within +-10 ms.
 * 3. Onset from silence or a hard attack: flux peak or envelope half-rise, whichever is first.
 * 4. Re-articulation detectability: dip >= max(3 dB, 1.5 x AM depth over the previous 200 ms), or a flux peak over threshold.
 */

/** Envelope resolution of the separate low-band RMS (32-sample hops at 16 kHz). */
export const ENVELOPE_HOP_SEC = 0.002;
/** Minimum dip depth for a re-articulation, dB (01 §7.4 item 4). */
export const MIN_DIP_DB = 3;
/** Multiplier on the AM depth in the dip threshold (01 §7.4 item 4). */
export const AM_DEPTH_FACTOR = 1.5;
/** Look-back window for the AM depth, seconds (01 §7.4 item 4). */
export const AM_WINDOW_SEC = 0.2;
/** A flux peak within this many seconds refines a repeated onset (01 §7.4 item 2). */
export const FLUX_REFINE_SEC = 0.01;
/** A flux peak or half-rise must lie within this many seconds of the confirming frames (01 §7.4 item 3). */
export const SILENCE_ONSET_WINDOW_SEC = 0.02;

/** A pitch-track sample: fractional MIDI (null when unvoiced) and NSDF clarity. */
export interface OnsetPitchFrame {
  t: number;
  midi: number | null;
  clarity: number;
}

/** Evenly sampled envelope in dB. `values[i]` is at `startT + i * hopSec`. */
export interface EnvelopeSeries {
  startT: number;
  hopSec: number;
  values: ArrayLike<number>;
}

/** A flux sample (time and value). */
export interface FluxSample {
  t: number;
  value: number;
}

const envT = (env: EnvelopeSeries, i: number): number => env.startT + i * env.hopSec;

/**
 * 1. Pitch-change onset. Returns the time the pitch track crosses the midpoint (in cents, so in
 * MIDI) between `prevMidi` and `newMidi`, linearly interpolated between the two voiced frames
 * either side. Frames that are unvoiced or below `clarityThreshold` are skipped and the crossing
 * is interpolated across the gap. Returns null if the track never crosses.
 */
export function pitchChangeOnset(
  frames: readonly OnsetPitchFrame[],
  prevMidi: number,
  newMidi: number,
  clarityThreshold: number,
): number | null {
  if (prevMidi === newMidi) return null;
  const mid = (prevMidi + newMidi) / 2;
  const prevSide = Math.sign(prevMidi - mid);
  let last: { t: number; d: number } | null = null;
  for (const f of frames) {
    if (f.midi === null || !(f.clarity >= clarityThreshold)) continue;
    const d = f.midi - mid;
    // On the previous note's side or exactly on the midpoint-free side: track the last prev-side frame.
    if (Math.sign(d) === prevSide) {
      last = { t: f.t, d };
      continue;
    }
    if (last === null) {
      // The track starts on the new side (or exactly at the midpoint): no earlier frame to interpolate from.
      return d === 0 ? f.t : null;
    }
    // last.d and d have opposite signs (or d === 0): linear interpolation to the zero crossing.
    const frac = last.d / (last.d - d);
    return last.t + frac * (f.t - last.t);
  }
  return null;
}

/**
 * Peak-to-peak amplitude modulation of the envelope, dB, over the `windowSec` ending at `endT`
 * and not starting before `notStartT`.
 */
export function amDepthDb(env: EnvelopeSeries, endT: number, notStartT: number, windowSec = AM_WINDOW_SEC): number {
  const from = Math.max(notStartT, endT - windowSec);
  const i0 = Math.max(0, Math.ceil((from - env.startT) / env.hopSec - 1e-9));
  const i1 = Math.min(env.values.length - 1, Math.floor((endT - env.startT) / env.hopSec + 1e-9));
  if (i1 < i0) return 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = i0; i <= i1; i++) {
    const v = env.values[i] as number;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo;
}

/** Highest flux sample within `[centreT - halfWidthSec, centreT + halfWidthSec]`, or null. */
export function fluxPeakNear(flux: readonly FluxSample[], centreT: number, halfWidthSec: number): FluxSample | null {
  let best: FluxSample | null = null;
  for (const s of flux) {
    if (Math.abs(s.t - centreT) > halfWidthSec + 1e-12) continue;
    if (best === null || s.value > best.value) best = s;
  }
  return best;
}

/** First time at or after index `from` where the envelope reaches `level` (linear interpolation), or null. */
function firstReach(env: EnvelopeSeries, from: number, to: number, level: number): number | null {
  for (let i = from; i <= to; i++) {
    const v = env.values[i] as number;
    if (v >= level) {
      if (i === from) return envT(env, i);
      const p = env.values[i - 1] as number;
      return envT(env, i - 1) + ((level - p) / (v - p)) * env.hopSec;
    }
  }
  return null;
}

export interface RepeatOnsetOptions {
  /** The search window: the envelope minimum is looked for between these times. */
  searchStartT: number;
  searchEndT: number;
  /** Start of the previous note's steady part (after its attack); bounds the AM look-back. */
  noteStartT: number;
  /** Flux samples for the +-10 ms refinement and the flux route of the detectability test. */
  flux?: readonly FluxSample[];
  /** A flux peak at or above this value makes a shallow dip detectable (01 §7.4 item 4). */
  fluxThreshold?: number;
}

export interface RepeatOnset {
  /** Onset time after refinement, seconds. */
  t: number;
  /** Half-rise time before flux refinement. */
  halfRiseT: number;
  /** Time of the envelope minimum. */
  minT: number;
  dipDb: number;
  /** AM depth over the previous 200 ms of the same note. */
  amDepthDb: number;
  /** Detectable per 01 §7.4 item 4. False means indistinguishable from one held note. */
  detectable: boolean;
}

/** The detectability rule of 01 §7.4 item 4. */
export function isReArticulationDetectable(
  dipDb: number,
  amDepth: number,
  fluxPeak?: number,
  fluxThreshold?: number,
): boolean {
  if (dipDb >= Math.max(MIN_DIP_DB, AM_DEPTH_FACTOR * amDepth)) return true;
  return fluxPeak !== undefined && fluxThreshold !== undefined && fluxPeak >= fluxThreshold;
}

/**
 * 2 and 4. Repeated same-pitch onset. Finds the envelope minimum in the search window, the pre-dip
 * peak before it, and the first point after the minimum where the envelope has recovered half the
 * dip depth in dB (the half-rise). A flux peak within +-10 ms of the half-rise refines it. Returns
 * null if the window has no dip at all; otherwise `detectable` says whether the dip passes 7.4 item 4.
 */
export function repeatedOnset(env: EnvelopeSeries, opts: RepeatOnsetOptions): RepeatOnset | null {
  const n = env.values.length;
  const iA = Math.max(0, Math.ceil((opts.searchStartT - env.startT) / env.hopSec - 1e-9));
  const iB = Math.min(n - 1, Math.floor((opts.searchEndT - env.startT) / env.hopSec + 1e-9));
  if (iB - iA < 2) return null;

  // Envelope minimum strictly inside the window, with a higher sample before it.
  let iMin = -1;
  let minV = Infinity;
  for (let i = iA + 1; i < iB; i++) {
    const v = env.values[i] as number;
    if (v < minV) {
      minV = v;
      iMin = i;
    }
  }
  if (iMin < 0) return null;
  let iPre = iA;
  let preV = -Infinity;
  for (let i = iA; i < iMin; i++) {
    const v = env.values[i] as number;
    if (v > preV) {
      preV = v;
      iPre = i;
    }
  }
  const dip = preV - minV;
  if (!(dip > 0)) return null;

  const level = minV + dip / 2;
  const halfRiseT = firstReach(env, iMin, iB, level);
  if (halfRiseT === null) return null;

  const am = amDepthDb(env, envT(env, iPre), opts.noteStartT);
  const flux = opts.flux ?? [];
  const nearest = fluxPeakNear(flux, halfRiseT, FLUX_REFINE_SEC);
  const t = nearest ? nearest.t : halfRiseT;
  const peakAnywhere = fluxPeakNear(flux, (halfRiseT + envT(env, iMin)) / 2, (halfRiseT - envT(env, iMin)) / 2 + FLUX_REFINE_SEC);
  const detectable = isReArticulationDetectable(dip, am, peakAnywhere?.value, opts.fluxThreshold);
  return { t, halfRiseT, minT: envT(env, iMin), dipDb: dip, amDepthDb: am, detectable };
}

export interface SilenceOnsetOptions {
  /** Time of the confirming frames (the first stable pitched frame); candidates lie within 20 ms of it. */
  confirmT: number;
  flux?: readonly FluxSample[];
  /** A flux peak must reach this value to count. */
  fluxThreshold: number;
}

/**
 * 3. Onset from silence or a hard attack: the earlier of the flux peak and the envelope half-rise,
 * both within 20 ms of the confirming frames. The half-rise is the point where the envelope has
 * risen halfway (in dB) from its floor before the attack to its level at the confirming frame.
 * Returns null if neither candidate exists.
 */
export function onsetFromSilence(env: EnvelopeSeries, opts: SilenceOnsetOptions): number | null {
  const w = SILENCE_ONSET_WINDOW_SEC;
  const candidates: number[] = [];

  const peaks = (opts.flux ?? []).filter((s) => Math.abs(s.t - opts.confirmT) <= w + 1e-12 && s.value >= opts.fluxThreshold);
  if (peaks.length > 0) {
    let best = peaks[0] as FluxSample;
    for (const p of peaks) if (p.value > best.value) best = p;
    candidates.push(best.t);
  }

  const n = env.values.length;
  const iLo = Math.max(0, Math.ceil((opts.confirmT - w - env.startT) / env.hopSec - 1e-9));
  const iHi = Math.min(n - 1, Math.floor((opts.confirmT + w - env.startT) / env.hopSec + 1e-9));
  if (iHi - iLo >= 2) {
    let floor = Infinity;
    let peak = -Infinity;
    for (let i = iLo; i <= iHi; i++) {
      const v = env.values[i] as number;
      if (v < floor) floor = v;
      if (v > peak) peak = v;
    }
    if (peak - floor > 0) {
      const t = firstReach(env, iLo, iHi, floor + (peak - floor) / 2);
      if (t !== null) candidates.push(t);
    }
  }
  return candidates.length === 0 ? null : Math.min(...candidates);
}
