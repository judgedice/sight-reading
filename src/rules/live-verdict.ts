/**
 * Verdict rules shared by the live follower, the overlay and the grader (02 §4.3, §4.8; 01 §8.4, §9.3).
 *
 * - Timing verdict and onset credit against tGood / tRed / tBad.
 * - Intonation verdict and credit against good / red cents (final: full steady median).
 * - The live provisional sharp/flat rule: only notes whose expected steady duration reaches
 *   `intonationMinSteadyMs`, only after `liveProvisionalMs` of steady pitch, entered at |dev| > red + hysteresis,
 *   left again at |dev| ≤ red (the player may correct within the note).
 * - Wrong pitch at confirmation: confirming frames agree and sit at least `wrongAtConfirmMinCents` off target.
 * - The 02 §4.8 state table: pending, correct, correct-marginal, early, late, sharp, flat, wrong-pitch, missed.
 *
 * Every threshold comes from a `ResolvedTolerance` or `cfg.grading`; no tolerance constants live here.
 */
import type { Configs, ExpectedNote, GhostNote, PitchVerdict, ResolvedTolerance, TimingVerdict } from '../core/types.ts';
import type { PitchClassification } from './pitch-policy.ts';
import { expectedSteadyMs } from './resolve-tolerances.ts';

const MS_PER_SEC = 1000;

/** Linear credit: 1 at or below `full`, 0 at or beyond `zero`, linear between. */
function linearCredit(x: number, full: number, zero: number): number {
  if (x <= full) return 1;
  if (x >= zero) return 0;
  return (zero - x) / (zero - full);
}

// ---- timing --------------------------------------------------------------------------

/** 02 §4.8: on time within tRed; beyond it early or late. `deltaMs` = played − expected onset (+ = late). */
export function timingVerdict(deltaMs: number, tol: ResolvedTolerance): TimingVerdict {
  if (Math.abs(deltaMs) <= tol.tRedSec * MS_PER_SEC) return 'on-time';
  return deltaMs < 0 ? 'early' : 'late';
}

/** Onset credit o_i (02 §4.3): 1 within tGood, linear to 0 at tBad. */
export function onsetCredit(deltaMs: number, tol: ResolvedTolerance): number {
  return linearCredit(Math.abs(deltaMs), tol.tGoodSec * MS_PER_SEC, tol.tBadSec * MS_PER_SEC);
}

/** Beyond tGood but within tRed: the timing half of `correct-marginal` (02 §4.8). */
export function timingMarginal(deltaMs: number, tol: ResolvedTolerance): boolean {
  const a = Math.abs(deltaMs);
  return a > tol.tGoodSec * MS_PER_SEC && a <= tol.tRedSec * MS_PER_SEC;
}

// ---- intonation ----------------------------------------------------------------------

export type IntonationVerdict = 'in-tune' | 'sharp' | 'flat' | 'not-graded';

/**
 * Final intonation verdict from the full steady median (02 §4.3, §4.8): `not-graded` when the note has no band
 * or did not reach `intonationMinSteadyMs`; in tune within red; sharp or flat beyond it.
 */
export function intonationVerdict(devCents: number, playedSteadyMs: number, tol: ResolvedTolerance): IntonationVerdict {
  if (tol.goodCents === null || tol.redCents === null || playedSteadyMs < tol.minSteadyMs) return 'not-graded';
  if (Math.abs(devCents) <= tol.redCents) return 'in-tune';
  return devCents > 0 ? 'sharp' : 'flat';
}

/** Intonation credit n_i (02 §4.3): 1 within good, linear to 0 at red; null when not graded. */
export function intonationCredit(devCents: number, playedSteadyMs: number, tol: ResolvedTolerance): number | null {
  if (tol.goodCents === null || tol.redCents === null || playedSteadyMs < tol.minSteadyMs) return null;
  return linearCredit(Math.abs(devCents), tol.goodCents, tol.redCents);
}

// ---- live provisional sharp / flat (02 §4.8, 01 §8.4, R19) ----------------------------

export type LiveIntonation = 'none' | 'sharp' | 'flat';

/**
 * A note may show a live sharp or flat only if it is intonation-graded and its expected steady duration (written
 * duration minus the attack exclusion) reaches `intonationMinSteadyMs` (02 §4.8).
 */
export function liveIntonationEligible(note: ExpectedNote, tol: ResolvedTolerance): boolean {
  return tol.goodCents !== null && tol.redCents !== null && expectedSteadyMs(note, tol) >= tol.minSteadyMs;
}

/**
 * One step of the live provisional rule, called on each note update with the steady median so far.
 * - Not eligible, wrong semitone, or less than `liveProvisionalMs` of steady pitch: `none`.
 * - Entering sharp or flat needs |dev| > red + hysteresis.
 * - Once shown, the mark stays while |dev| > red on the same side and reverts to `none` at |dev| ≤ red; a jump
 *   past red + hysteresis on the other side switches sides directly.
 * `devCents` is `PitchClassification.devCents` for a correct-semitone note (after the tuning or reference offset).
 */
export function liveIntonationStep(prev: LiveIntonation, devCents: number, steadyMs: number, eligible: boolean, tol: ResolvedTolerance): LiveIntonation {
  if (!eligible || tol.redCents === null || !Number.isFinite(devCents)) return 'none';
  if (steadyMs < tol.liveProvisionalMs) return 'none';
  const red = tol.redCents;
  const enter = red + tol.liveHysteresisCents;
  if (devCents > enter) return 'sharp';
  if (devCents < -enter) return 'flat';
  if (prev === 'sharp' && devCents > red) return 'sharp';
  if (prev === 'flat' && devCents < -red) return 'flat';
  return 'none';
}

/**
 * Wrong pitch at confirmation (02 §4.8, 01 §9.3): emitted early only when the confirming frames agree and sit at
 * least `live.wrongAtConfirmMinCents` from the (voice: nearest-octave) target; otherwise the follower waits for the
 * steady window.
 */
export function wrongPitchAtConfirm(c: PitchClassification, framesAgree: boolean, cfg: Configs): boolean {
  return framesAgree && c.p === 0 && Math.abs(c.devCents) >= cfg.grading.live.wrongAtConfirmMinCents;
}

// ---- 02 §4.8 state table ---------------------------------------------------------------

export type LiveNoteState = 'pending' | 'correct' | 'correct-marginal' | 'early' | 'late' | 'sharp' | 'flat' | 'wrong-pitch' | 'missed';

/** Facts about one matched note, as the follower or grader knows them at that moment. */
export interface MatchedFacts {
  /** Played − expected onset, ms (+ = late). */
  deltaMs: number;
  pitch: PitchClassification;
  /**
   * Intonation state: the final `intonationVerdict`, or live, the `liveIntonationStep` result mapped to
   * 'sharp' | 'flat' | 'in-tune' (or 'not-graded' while not yet judged or not eligible).
   */
  intonation: IntonationVerdict;
}

export interface NoteVerdict {
  /** Primary state: a pitch error before a timing error (states combine, see `states`). */
  state: LiveNoteState;
  /** Every state that applies, timing first (late + wrong pitch: one ghost, both flags). */
  states: LiveNoteState[];
  timing: TimingVerdict | null;
  pitch: PitchVerdict | null;
  /** `correct-marginal`: p = 1, within tRed and red, beyond good on one of them. Never red. */
  marginal: boolean;
  /** The written note turns red (02 §4.8). */
  red: boolean;
  /** Ghost drawn for this note, or null (missed notes, correct notes and voice octave displacements have none). */
  ghost: GhostNote['kind'] | null;
}

const PENDING: NoteVerdict = { state: 'pending', states: ['pending'], timing: null, pitch: null, marginal: false, red: false, ghost: null };
const MISSED: NoteVerdict = { state: 'missed', states: ['missed'], timing: null, pitch: null, marginal: false, red: true, ghost: null };

/** Map a note's facts to its 02 §4.8 state, flags and ghost kind. */
export function noteVerdict(facts: MatchedFacts | 'pending' | 'missed', tol: ResolvedTolerance): NoteVerdict {
  if (facts === 'pending') return { ...PENDING, states: [...PENDING.states] };
  if (facts === 'missed') return { ...MISSED, states: [...MISSED.states] };

  const timing = timingVerdict(facts.deltaMs, tol);
  const c = facts.pitch;
  let pitch: PitchVerdict;
  if (c.kind === 'wrong') pitch = 'wrong-pitch';
  else if (c.kind === 'octave') pitch = 'octave';
  else pitch = facts.intonation;

  const states: LiveNoteState[] = [];
  if (timing !== 'on-time') states.push(timing);
  if (pitch === 'wrong-pitch' || pitch === 'octave') states.push('wrong-pitch');
  else if (pitch === 'sharp' || pitch === 'flat') states.push(pitch);

  let marginal = false;
  if (states.length === 0) {
    const intoMarginal = pitch === 'in-tune' && tol.goodCents !== null && Math.abs(c.devCents) > tol.goodCents;
    marginal = timingMarginal(facts.deltaMs, tol) || intoMarginal;
    states.push(marginal ? 'correct-marginal' : 'correct');
  }

  const red = states.some((s) => s !== 'correct' && s !== 'correct-marginal');
  let ghost: GhostNote['kind'] | null = null;
  if (pitch === 'wrong-pitch' || pitch === 'octave' || pitch === 'sharp' || pitch === 'flat') ghost = pitch;
  else if (timing !== 'on-time') ghost = timing;

  const pitchErr = states.find((s) => s === 'wrong-pitch' || s === 'sharp' || s === 'flat');
  return { state: pitchErr ?? (states[0] as LiveNoteState), states, timing, pitch, marginal, red, ghost };
}

/** `LiveIntonation` as the intonation fact for `noteVerdict` during a note. */
export function liveIntonationAsVerdict(li: LiveIntonation, eligible: boolean): IntonationVerdict {
  if (li !== 'none') return li;
  return eligible ? 'in-tune' : 'not-graded';
}
