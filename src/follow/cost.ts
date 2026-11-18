/**
 * Shared match cost (01 §9.2), used by the live matcher (P10a) and the final alignment (P10b).
 *
 * For detected note d and expected note e with resolved tolerance T_e:
 *   Δt = s − e.onsetSec, s = d.onset − t0 − latencyCompensationSec;
 *   admissible only if |Δt| ≤ T_e.matchWindowSec (02's W_i);
 *   cost = 4 × (Δt / W)² + P, P = 0 for the target semitone (voice: any octave, R7), 2 for an octave (non-voice),
 *   5 otherwise. The live matcher adds K = 2 per pending note it would skip.
 *
 * Pitch classes come from `rules/classifyPitch`, after the score-informed octave correction of 01 §9.3 step 5: a
 * non-voice note detected exactly one octave from the target is read in the expected octave when the NSDF value at
 * the expected octave's lag is at least 0.8 × the chosen peak's clarity.
 *
 * The weights here are 01's structural constants of the cost function, not grading tolerances (those come from
 * `ResolvedTolerance` and `cfg.grading`).
 */
import type { Configs, DetectedNote, ExpectedNote, Instrument, ResolvedTolerance } from '../core/types.ts';
import { classifyPitch, type PitchClassification } from '../rules/index.ts';

/** Weight of the squared normalised onset error (01 §9.2). */
export const TIMING_WEIGHT = 4;
/** Pitch term: target semitone (voice: any octave). */
export const PITCH_COST_CORRECT = 0;
/** Pitch term: octave error on a non-voice instrument. */
export const PITCH_COST_OCTAVE = 2;
/** Pitch term: any other semitone. */
export const PITCH_COST_WRONG = 5;
/** Live only: added per pending note the match would skip (01 §9.3 step 1). */
export const LIVE_SKIP_COST = 2;
/** Final alignment: skipping an expected note (missed), 01 §9.6. */
export const SKIP_EXPECTED_COST = 6;
/** Final alignment: skipping a detected note (extra), 01 §9.6. */
export const SKIP_DETECTED_COST = 5;
/** Score-informed octave correction: altOctaveClarity ≥ this × clarity reads the expected octave (01 §9.3 step 5). */
export const ALT_OCTAVE_CLARITY_RATIO = 0.8;

const SEMITONES_PER_OCTAVE = 12;

/** The pitch facts the cost and the octave correction need from a detected note. */
export type PitchSample = Pick<DetectedNote, 'clarity' | 'altOctaveClarity'> & { midi: number };

/** Played onset in score seconds: s = onset − t0 − latencyCompensationSec (01 §9.2). */
export function scoreSecondsOf(onset: number, t0: number, latencyCompensationSec: number): number {
  return onset - t0 - latencyCompensationSec;
}

/**
 * Score-informed octave correction (01 §9.3 step 5). Returns the measured pitch, or the pitch moved into the
 * expected octave when a non-voice note sits exactly one octave from the target and the alternate-octave clarity
 * supports the expected octave. Voice is octave-equivalent already (R7) and is never corrected.
 */
export function correctedMidi(e: ExpectedNote, d: PitchSample, offsetCents: number, inst: Instrument, cfg: Configs): number {
  if (inst.relativePitch || d.altOctaveClarity === null) return d.midi;
  const c = classifyPitch(e.concertMidi, d.midi, offsetCents, inst, cfg);
  if (c.kind !== 'octave' || Math.abs(c.octaves) !== 1) return d.midi;
  if (d.altOctaveClarity < ALT_OCTAVE_CLARITY_RATIO * d.clarity) return d.midi;
  return d.midi - c.octaves * SEMITONES_PER_OCTAVE;
}

/** Classify a detected pitch against an expected note after the octave correction. */
export function classifyAgainst(e: ExpectedNote, d: PitchSample, offsetCents: number, inst: Instrument, cfg: Configs): { midi: number; c: PitchClassification } {
  const midi = correctedMidi(e, d, offsetCents, inst, cfg);
  return { midi, c: classifyPitch(e.concertMidi, midi, offsetCents, inst, cfg) };
}

/** The 01 §9.2 pitch term for a classification. */
export function pitchCost(c: PitchClassification): number {
  if (c.kind === 'correct') return PITCH_COST_CORRECT;
  if (c.kind === 'octave') return PITCH_COST_OCTAVE;
  return PITCH_COST_WRONG;
}

/** True when |Δt| ≤ W (01 §9.2). */
export function admissible(dtSec: number, tol: ResolvedTolerance): boolean {
  return Math.abs(dtSec) <= tol.matchWindowSec;
}

/** 4 × (Δt / W)² + P, or null when not admissible (01 §9.2). */
export function matchCost(dtSec: number, tol: ResolvedTolerance, pitchTerm: number): number | null {
  if (!admissible(dtSec, tol)) return null;
  const x = dtSec / tol.matchWindowSec;
  return TIMING_WEIGHT * x * x + pitchTerm;
}
