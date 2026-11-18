/**
 * Note segmenter (01 sections 7.4, 7.5). Adapted from ear-to-staff `NoteSegmenter` (the state machine is kept:
 * onset after stable frames, offset after silent frames, split on a pitch change beyond `changeCents`, energy
 * retrigger), with the v1 changes:
 *
 * - Frames are the centre-stamped 125 fps pitch frames of `PitchAnalyzer`; every parameter is in seconds.
 * - Onset times follow `core/onset-definition.ts`:
 *   - from silence: the envelope half-rise around the confirming frames (`onsetFromSilence`), evaluated with
 *     `confirmT` 20 ms after the start of the rise, exactly as the synth's ground truth is;
 *   - pitch change: the cents-midpoint crossing of the pitch track (`pitchChangeOnset`, raw pitch, frames far from
 *     both notes skipped), unless an envelope dip coincides with it (a tongued, bowed or struck note change): then
 *     the dip's half-rise, or the attack-from-silence onset when the dip reaches the floor. The dip must be at least
 *     3 dB (5 dB for voice and bowed, whose slurs dip a few dB through formants) and pass the 7.4 item 4 AM rule;
 *   - re-articulation of the same pitch: the dip's half-rise (`repeatedOnset`); a dip that reaches the floor, and
 *     any split on a struck profile, is evaluated as an attack from silence.
 * - Re-articulations are found by a dip tracker on the envelope. Detectability follows 7.4 item 4: the dip must
 *   reach max(3 dB, 1.5 x AM depth over the previous 200 ms of the same note), or a flux peak must pass the
 *   adaptive threshold (times a per-profile factor). Inside a repeat-hint window the threshold is
 *   max(2 dB, 1.0 x AM depth). The fall and the rise must each happen within 35 ms of the minimum: vibrato AM
 *   (one cycle about 180 ms) is slower than any tongue, bow or glottal stop, so its troughs never qualify, even in
 *   the first cycle where the 200 ms AM look-back has not seen a trough yet. A struck tone's decay is not AM.
 * - Envelope for dips: the low-band power averaged over whole periods of the note's fundamental (at least 4 ms),
 *   evaluated at the 2 ms envelope points from a sample-resolution cumulative energy. A plain 2 ms RMS of a
 *   100 Hz tone ripples by about 9 dB, and of 440 Hz by about 3 dB, which would split held notes. Envelope series
 *   passed to the 7.4 functions are floored at max(noise floor, recent peak - 60 dB), the synth truth's floor.
 *   Attacks from silence use the 2 ms EnvelopeFollower values unsmoothed.
 * - Flux refines no onset time by default (`fluxTiming`): the synth's 7.4 truth is computed without flux, and on
 *   24 clean scenarios (3 per launch timbre) flux refinement raised the onset e90 against it from 0.4-3.5 ms to
 *   1.9-6.3 ms. Flux is used for detection only.
 * - Adaptive noise gate: floor = 20th percentile of the envelope over the last 400 ms with no note or candidate
 *   sounding, outside click windows; gate = floor + 12 dB, never below -70 dBFS. Frames below the gate are unvoiced.
 *
 * - Click windows (01 section 7.6, speakers only; the pipeline passes no arrivals in headphone modes), each
 *   `[arrival - 5 ms, arrival + 35 ms]`:
 *   - item 3, time gate: a re-articulation (dip or flux route) whose onset falls in a click window splits only once
 *     `onsetConfirm` consecutive voiced frames from its onset on support it; an unvoiced frame first drops it;
 *   - item 4: flux inside click windows takes no part in onset refinement or the flux route;
 *   - item 5, leak floor: inside a window, a frame starts a note from silence only at
 *     rmsDb >= max(gate, leakFrameDb + 6 dB), and an attack out of the floor must peak at leakEnvDb + 6 dB or more,
 *     with the click's leak levels from its template fit (`setClickLeak`; without a fit only the gate applies).
 *
 * - Room reverb (PLAN ruling 45; constants and measurements below the "Room reverb" marker). A room fills dips
 *   and rests, beats the previous note's tail against the next, turns vibrato into level swings and blends two
 *   pitches in one window. The segmenter answers with: early-note dips needing flux (`detectable`), vibrato-aware
 *   dip rejection (`vibratoTrough`, `vibratoAt`, and the previous note's AM for young notes, `previousNoteAm`),
 *   releases into a room tail measured whole (`dipStart`), re-pitching while a pitch change settles (`settling`),
 *   an early flux peak for filled tongued changes (`earlyFlux`), and a two-frame old side for reverberant
 *   pitch-change gaps (`crossing`). On clean capture these leave the scenario F1 unchanged.
 *
 * Splits can be retroactive: a dip is recognised a few frames after its half-rise, so the frames already given to
 * the old note from the split time on are moved to the new note. The old note's note-on was already sent; its
 * note-off carries offset = the new onset.
 */
import { AM_WINDOW_SEC, onsetFromSilence, pitchChangeOnset, repeatedOnset, type EnvelopeSeries, type FluxSample, type OnsetPitchFrame } from '../core/onset-definition.ts';
import type { ClockSeconds, DetectedNote, DspEvent } from '../core/types.ts';
import { medianInPlace } from './flux.ts';
import {
  CLICK_WINDOW_AFTER_SEC,
  CLICK_WINDOW_BEFORE_SEC,
  GATE_ABOVE_FLOOR_DB,
  GATE_MIN_DBFS,
  HINT_AM_FACTOR,
  HINT_MIN_DIP_DB,
  NOISE_WINDOW_SEC,
  type SegmenterOptions,
} from './segmenter-options.ts';

export { segmenterOptions, type SegmenterOptions } from './segmenter-options.ts';

/** A pitch frame as the segmenter sees it. */
export interface SegFrame {
  t: number;
  /** Fractional MIDI after octave hysteresis, null when unvoiced. */
  midi: number | null;
  /** Detector output before hysteresis. */
  raw: number | null;
  clarity: number;
  rmsDb: number;
  /** NSDF at the octave above this frame's pitch (most recent frame of a push only), for altOctaveClarity. */
  alt: number | null;
  inClick: boolean;
}

interface Fr extends SegFrame {
  voiced: boolean;
}

interface Dip {
  tOn: number;
  minT: number;
  halfRiseT: number;
  dipDb: number;
  prePeakT: number;
  nearFloor: boolean;
  fluxPeak: number | null;
  fluxThr: number;
  /** Smoothing length (decimated samples) used. */
  len: number;
  /**
   * For a fall longer than DIP_SIDE_SEC (`dipStart`, a release into a room tail): the depth of its last DIP_SIDE_SEC,
   * dB, the dip as the 35 ms rule alone sees it. NaN for ordinary dips.
   */
  shortDipDb: number;
}

interface Note {
  id: number;
  onset: number;
  cause: DetectedNote['onsetCause'];
  frames: Fr[];
  provisional: number;
  /** All `onsetConfirmFrames` confirming frames round to one semitone (01 section 9.3 item 3). */
  framesAgree: boolean;
  lastVoicedT: number;
  sinceUpdate: number;
  offset: number | null;
  /** Median of the previous note when this one was split from it (NaN otherwise). */
  prevMidi: number;
  /**
   * Lower bound of the AM look-back (7.4 item 4): after the attack of the last note that began from silence or a
   * pitch change. A same-pitch re-articulation inherits it, so the look-back can reach across the previous
   * re-articulation (whose dip is excluded) and a vibrato trough taken for a dip cannot reset the AM history.
   */
  amFrom: number;
  /**
   * AM depth of the previous note's last AM_WINDOW_SEC when this note was split from it at a pitch change (0
   * otherwise): the same voice's vibrato, standing in for this note's own until it has a full look-back.
   */
  prevAm: number;
}

const ENV_FLOOR_DB = -120;
/** The truth's envelope floor below the level (P3 TRUTH_FLOOR_REL_DB). */
const FLOOR_BELOW_PEAK_DB = 60;
/** Dip tracker: hysteresis that enters the falling and rising states, dB. */
const TRACK_HYST_DB = 0.75;
/** Smallest dip worth evaluating (below the 2 dB hint threshold, so the flux route can still act). */
const MIN_EVAL_DIP_DB = 1.5;
/** A re-articulation's fall and rise are each looked for within this time of the minimum. */
const DIP_SIDE_SEC = 0.035;
const DIP_RISE_MAX_SEC = 0.06;
/** Early dip evaluation: the envelope is this far past the half-rise level, dB. */
const EARLY_HALF_MARGIN_DB = 0.5;
/** Early evaluation of an attack from the floor: the 7.4 item 3 window reaches 40 ms past the rise start. */
const EARLY_FLOOR_EVAL_SEC = 0.044;
/** A dip within this many dB of the floor is an attack from (near) silence. */
const NEAR_FLOOR_DB = 8;
/** An attack out of the floor must rise at least this far. */
const FLOOR_ATTACK_RISE_DB = 15;
/** A pitch change's dip is looked for from this long before the crossing. */
const PITCH_CHANGE_DIP_SEC = 0.03;
/** Offset: the envelope falls this far below the note's level. */
const OFFSET_DROP_DB = 15;
const STEADY_TAIL_SEC = 0.03;
const HISTORY_SEC = 2;
/** A rise of at least STEEP_RISE_DB within STEEP_RISE_SEC at a pitch change is an attack. */
const STEEP_RISE_DB = 6;
const STEEP_RISE_SEC = 0.01;
/** Frames above the gate with at least this clarity, but below the threshold, are ambiguous rather than silent. */
const AMBIGUOUS_CLARITY = 0.5;
/**
 * A pitch change across a gap of unclear frames longer than the window plus this many hops (more than the window's
 * own overlap of two notes explains) takes the flux peak in the gap.
 */
const GAP_FLUX_MIN_HOPS = 2.5;
const GAP_FLUX_FACTOR = 1.2;
/** The gap is looked for over this long before the new pitch's first stable frame. */
const GAP_LOOKBACK_SEC = 0.2;
/** An accepted dip is skipped by later AM look-backs from its pre-peak to this long after its half-rise. */
const AM_EXCLUDE_AFTER_SEC = 0.02;
/** Envelope smoothing for dips: whole periods, at least this long (and at most SMOOTH_MAX_SEC). */
const SMOOTH_MIN_SEC = 0.004;
const SMOOTH_MAX_SEC = 0.02;
/** Cumulative-energy ring: about 4 s at 16 kHz. */
const CUM_RING = 1 << 16;

// ---- Room reverb (PLAN ruling 45). Tuned on the planned room conditions of the default scenario seed.
/**
 * Early-note dips: in a room the previous note's tail beats against a new note through its first windows, and the
 * 7.4 AM look-back has seen no trough yet. Within EARLY_DIP_SEC of the onset a dip shallower than EARLY_DIP_DB
 * needs a flux peak of EARLY_DIP_FLUX (EARLY_DIP_FLUX_SOFT for voice and bowed, whose flux is weaker) times the
 * adaptive threshold.
 */
const EARLY_DIP_SEC = 0.2;
const EARLY_DIP_FLUX = 1.5;
const EARLY_DIP_FLUX_SOFT = 1.2;
const EARLY_DIP_DB = 10;
/**
 * Vibrato-aware dip rejection (`vibratoTrough`): a dip with less flux than VIB_FLUX x threshold and shallower than
 * VIB_MAX_DB is a vibrato trough when it is under VIB_K x the envelope swing over the vibrato period ending
 * VIB_LAG periods before its minimum (that window must cover VIB_MIN_COVER of a period).
 */
const VIB_FLUX = 1.3;
const VIB_MAX_DB = 20;
const VIB_K = 1.5;
const VIB_LAG = 0.5;
const VIB_MIN_COVER = 0.6;
/** Earlier weak splits within this fraction of a period of this dip's vibrato phase stay in the swing measure. */
const VIB_PHASE_TOL = 0.2;
/** Vibrato estimate: raw pitch over this look-back; rate 3.5 to 8.5 Hz, depth (half peak-to-peak) 8 c or more. */
const VIB_LOOK_SEC = 0.4;
const VIB_MIN_PERIOD = 1 / 8.5;
const VIB_MAX_PERIOD = 1 / 3.5;
const VIB_MIN_CENTS = 8;
const VIB_HYST_CENTS = 3;
/**
 * Release into a room tail (`dipStart`): a fall of up to LONG_FALL_SEC, monotone within LONG_FALL_TOL_DB, longer
 * than DIP_SIDE_SEC by LONG_FALL_MIN_EXTRA_SEC and at least LONG_FALL_MIN_DB deep counts whole.
 */
const LONG_FALL_SEC = 0.3;
const LONG_FALL_TOL_DB = 1.5;
const LONG_FALL_MIN_EXTRA_SEC = 0.02;
const LONG_FALL_MIN_DB = 12;
/**
 * A long fall that the 35 ms rule alone would not pass needs a flux peak of LONG_FALL_FLUX x threshold at its rise
 * (an attack after a rest): in a room a vibrato swing can fall as long and as far.
 */
const LONG_FALL_FLUX = 1;
/**
 * Early flux at a tongued change (`earlyFlux`): a flux peak of EARLY_FLUX_FACTOR x threshold from EARLY_FLUX_BEFORE_SEC
 * before the dip minimum to EARLY_FLUX_GAP_SEC before the half-rise takes the onset.
 */
const EARLY_FLUX_BEFORE_SEC = 0.04;
const EARLY_FLUX_GAP_SEC = 0.012;
const EARLY_FLUX_FACTOR = 1;
const EARLY_FLUX_MAX_DIP_DB = 14;
/**
 * Previous-note AM (`Note.prevAm`): at a pitch change out of a vibrato note, the AM of that note's last
 * AM_WINDOW_SEC (ending PREV_AM_GUARD_SEC before the change, at least PREV_AM_MIN_SEC long, not across a fall of
 * PREV_AM_REST_DB or more) stands in for the new note's own until it has a full look-back.
 */
const PREV_AM_GUARD_SEC = 0.07;
const PREV_AM_MIN_SEC = 0.1;
const PREV_AM_REST_DB = 30;
/**
 * Room settling at a pitch change (`settling`): within SETTLE_SEC of the onset, a further change re-pitches the note
 * when it read a pitch SETTLE_MIX_ST outside both neighbours, or glided on from the previous note without holding
 * SETTLE_PLATEAU_FRAMES frames away from the new pitch.
 */
const SETTLE_SEC = 0.15;
const SETTLE_MIX_ST = 3;
const SETTLE_PLATEAU_FRAMES = 5;
/** Leak floor margin inside click windows (01 section 7.6 item 5). */
export const CLICK_LEAK_MARGIN_DB = 6;
/** An in-window re-articulation must gather its pitch evidence within this time of its onset (7.6 item 3). */
export const CLICK_EVIDENCE_SEC = 0.1;

const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return NaN;
  const a = Float64Array.from(xs);
  return medianInPlace(a, a.length);
};
const mean = (xs: readonly Fr[]): number => {
  let s = 0;
  for (const f of xs) s += f.midi as number;
  return s / xs.length;
};

export class Segmenter {
  readonly o: SegmenterOptions;
  private readonly hints: readonly { t: number; halfWidthSec: number }[];
  private readonly clickWins: Float64Array; // [start0, end0, start1, end1, ...] sorted
  private readonly clickArr: Float64Array; // arrivals, sorted (same order as clickWins)
  /** Per click: leak levels from the template fit (NaN until set). */
  private readonly leakEnv: Float64Array;
  private readonly leakFrame: Float64Array;
  private readonly tol: number;
  private readonly soft: boolean;

  // low-band cumulative energy (sample resolution) for smoothed envelopes
  private rate = 16000;
  private sampleT0 = 0;
  private readonly cum = new Float64Array(CUM_RING);
  private cumTotal = 0;
  private cumAcc = 0;
  // envelope store
  private envStartT = 0;
  private envHop = 0.002;
  private envDb = new Float64Array(4096);
  private envPow = new Float64Array(4096);
  private envLen = 0;
  // flux store
  private fluxT: number[] = [];
  private fluxV: number[] = [];
  private fluxThr: number[] = [];
  private fluxClick: boolean[] = [];

  // noise floor
  private readonly noiseRing: Float64Array;
  private noiseCount = 0;
  private noiseHead = 0;
  private noiseSince = 0;
  private noiseFloorDb = ENV_FLOOR_DB;

  // dip tracker
  private trkIdx = 0;
  private trkMode: 'up' | 'down' | 'rising' = 'up';
  private trkPeak = 0;
  private trkMin = 0;
  private trkLast = -Infinity;
  private trkLen = 0;
  private trkBoundaryIdx = 0;
  private trkDone = false;
  private trkRiseIdx = 0;
  private trkClamp = ENV_FLOOR_DB;
  private trkPreV = ENV_FLOOR_DB;
  private trkFloor = false;
  private dips: Dip[] = [];
  /** [from, to] pairs of accepted re-articulation dips, skipped by the AM look-back. */
  private amExclude: number[] = [];
  /** Accepted re-articulation dips; `strong` with onset evidence (flux, or a dip to the floor). For the vibrato check. */
  private splitDips: { from: number; to: number; minT: number; strong: boolean }[] = [];
  private dipCursor = 0;

  // frames and notes
  private recent: Fr[] = [];
  private cur: Note | null = null;
  private idleCand: Fr[] = [];
  private pitchCand: Fr[] = [];
  /** The split to make at a detectable dip; `support` counts the gate's evidence frames, `midi` their last pitch. */
  private pending: { dip: Dip; flux: boolean; support: number; midi: number } | null = null;
  private silence = 0;
  private nextId = 1;
  private boundary = false;
  private lastFrameT = -Infinity;

  constructor(o: SegmenterOptions, hints: readonly { t: number; halfWidthSec: number }[] = [], clickArrivals: readonly number[] = []) {
    this.o = o;
    this.hints = hints;
    const arr = [...clickArrivals].sort((a, b) => a - b);
    this.clickWins = new Float64Array(arr.length * 2);
    arr.forEach((a, i) => {
      this.clickWins[2 * i] = a - CLICK_WINDOW_BEFORE_SEC;
      this.clickWins[2 * i + 1] = a + CLICK_WINDOW_AFTER_SEC;
    });
    this.clickArr = Float64Array.from(arr);
    this.leakEnv = new Float64Array(arr.length).fill(NaN);
    this.leakFrame = new Float64Array(arr.length).fill(NaN);
    this.tol = o.changeCents / 100;
    this.soft = o.onsetProfile === 'voice' || o.onsetProfile === 'bowed';
    this.noiseRing = new Float64Array(256);
  }

  /** Sets the envelope timeline: value i is centred at `startT + i * hopSec`. Call before the first push. */
  startEnvelope(startT: number, hopSec: number, sampleT0: number, rate: number): void {
    this.sampleT0 = sampleT0;
    this.rate = rate;
    this.envStartT = startT;
    this.envHop = hopSec;
    this.noiseRing.fill(0);
    this.noiseCount = 0;
  }

  /** Current noise gate, dBFS. */
  get gateDb(): number {
    return Math.max(GATE_MIN_DBFS, this.noiseFloorDb + GATE_ABOVE_FLOOR_DB);
  }

  /** True once after a note boundary (the caller resets the pitch analyser's octave median). */
  consumeBoundary(): boolean {
    const b = this.boundary;
    this.boundary = false;
    return b;
  }

  inClickWindow(t: number): boolean {
    return this.clickWindowIndex(t) >= 0;
  }

  /** Index of the click window containing `t`, or -1. */
  private clickWindowIndex(t: number): number {
    const w = this.clickWins;
    let lo = 0;
    let hi = w.length / 2 - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if ((w[2 * m + 1] as number) < t) lo = m + 1;
      else if ((w[2 * m] as number) > t) hi = m - 1;
      else return m;
    }
    return -1;
  }

  /** Index of the click arriving at `arrival`, or -1. */
  private clickIndex(arrival: number): number {
    const a = this.clickArr;
    let lo = 0;
    let hi = a.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if ((a[m] as number) < arrival) lo = m + 1;
      else hi = m;
    }
    return a.length === 0 || Math.abs((a[lo] as number) - arrival) > 1e-6 ? -1 : lo;
  }

  /**
   * Leak levels of the click arriving at `arrival`, dBFS (01 section 7.6 item 5): the calibration's `clickLeakDb`,
   * or the click's own template fit.
   */
  setClickLeak(arrival: number, envDb: number, frameDb: number): void {
    const i = this.clickIndex(arrival);
    if (i < 0) return;
    this.leakEnv[i] = envDb;
    this.leakFrame[i] = frameDb;
  }

  /** The leak levels in force for the click arriving at `arrival`, or null when none is set (or no such click). */
  clickLeakAt(arrival: number): { envDb: number; frameDb: number } | null {
    const i = this.clickIndex(arrival);
    if (i < 0 || !Number.isFinite(this.leakFrame[i] as number)) return null;
    return { envDb: this.leakEnv[i] as number, frameDb: this.leakFrame[i] as number };
  }

  /** Leak floor for frame rmsDb at `t`: max(gate, leakFrameDb + 6 dB) inside a click window, else the gate. */
  private frameFloorDb(t: number): number {
    const i = this.clickWindowIndex(t);
    const leak = i >= 0 ? (this.leakFrame[i] as number) : NaN;
    return Number.isFinite(leak) ? Math.max(this.gateDb, leak + CLICK_LEAK_MARGIN_DB) : this.gateDb;
  }

  /** Leak floor for an envelope peak at `t` (attacks out of the floor), dBFS; -Infinity outside click windows. */
  private envFloorDb(t: number): number {
    const i = this.clickWindowIndex(t);
    const leak = i >= 0 ? (this.leakEnv[i] as number) : NaN;
    return Number.isFinite(leak) ? leak + CLICK_LEAK_MARGIN_DB : -Infinity;
  }

  // ------------------------------------------------------------------------------- inputs

  pushEnvelope(db: ArrayLike<number>, n: number): void {
    if (this.envLen + n > this.envDb.length) {
      const cap = Math.max(this.envDb.length * 2, this.envLen + n);
      const d = new Float64Array(cap);
      d.set(this.envDb.subarray(0, this.envLen));
      const p = new Float64Array(cap);
      p.set(this.envPow.subarray(0, this.envLen));
      this.envDb = d;
      this.envPow = p;
    }
    const idle = this.cur === null && this.idleCand.length === 0;
    for (let k = 0; k < n; k++) {
      const v = db[k] as number;
      const i = this.envLen++;
      this.envDb[i] = v;
      this.envPow[i] = Math.pow(10, v / 10);
      if (idle && !this.inClickWindow(this.envT(i))) this.noteNoise(v);
    }
  }

  /** Low-band samples (the same stream the envelope and pitch frames come from), for the smoothed envelope. */
  pushSamples(x: ArrayLike<number>, n: number): void {
    const mask = this.cum.length - 1;
    let acc = this.cumAcc;
    let j = this.cumTotal;
    for (let k = 0; k < n; k++) {
      const v = x[k] as number;
      acc += v * v;
      j++;
      this.cum[j & mask] = acc;
    }
    this.cumAcc = acc;
    this.cumTotal = j;
  }

  pushFlux(t: number, value: number, threshold: number): void {
    this.fluxT.push(t);
    this.fluxV.push(value);
    this.fluxThr.push(threshold);
    this.fluxClick.push(this.inClickWindow(t));
  }

  /** Flux value of the flux frame centred nearest `t` (0 before the first). */
  fluxAt(t: number): number {
    const i = this.fluxIndex(t);
    return i < 0 ? 0 : (this.fluxV[i] as number);
  }

  pushFrame(sf: SegFrame): DspEvent[] {
    const out: DspEvent[] = [];
    const voiced = sf.midi !== null && sf.clarity >= this.o.clarityThreshold && sf.rmsDb >= this.gateDb;
    const f: Fr = { ...sf, voiced };
    this.lastFrameT = f.t;
    this.recent.push(f);
    if (this.recent.length > 128) this.recent.splice(0, 64);
    this.scanEnvelope();
    if (this.cur) this.stepNote(f, out);
    else this.stepIdle(f, out);
    return out;
  }

  flush(t: number): DspEvent[] {
    const out: DspEvent[] = [];
    if (this.cur) this.finish(this.cur, Math.min(t, this.estimateOffset(this.cur)), out);
    this.idleCand = [];
    this.pitchCand = [];
    this.pending = null;
    return out;
  }

  // ------------------------------------------------------------------------------- state machine

  private stepIdle(f: Fr, out: DspEvent[]): void {
    this.dipCursor = this.dips.length;
    if (!f.voiced || (f.inClick && f.rmsDb < this.frameFloorDb(f.t))) {
      this.idleCand = [];
      return;
    }
    this.addStable(this.idleCand, f);
    if (this.idleCand.length < this.o.onsetConfirmFrames) return;
    const cand = this.idleCand;
    this.idleCand = [];
    const first = cand[0] as Fr;
    const onset = this.silenceOnset(first.t, f.midi as number);
    this.begin(onset, 'from-silence', cand, out);
  }

  private stepNote(f: Fr, out: DspEvent[]): void {
    const cur = this.cur as Note;
    this.considerDips(cur);
    cur.sinceUpdate++;
    if (!f.voiced) {
      this.pitchCand = [];
      // A frame with energy but an unclear pitch (two pitches in one window, a reverberant change) counts half
      // towards the offset: the note has not stopped sounding.
      this.silence += f.rmsDb >= this.gateDb && f.clarity >= AMBIGUOUS_CLARITY ? 0.5 : 1;
      if (this.silence >= this.o.offsetFrames) {
        this.finish(cur, this.estimateOffset(cur), out);
        this.pending = null;
        return;
      }
      this.maybeUpdate(cur, out);
      return;
    }
    this.silence = 0;
    // A detectable dip is its own evidence: split on the first voiced frame centred at or after its onset (the
    // frames of the new note so far move with it; a pitch that settles within the new note's first 60 ms re-pitches
    // it, see below).
    let p = this.pending;
    if (p && f.t > p.dip.tOn + CLICK_EVIDENCE_SEC && p.support > 0 && p.support < this.o.onsetConfirmFrames) {
      // 7.6 item 3: no pitch evidence for the in-window re-articulation in time; drop it.
      this.pending = null;
      p = null;
    }
    if (p && f.t >= p.dip.tOn && this.inClickWindow(p.dip.tOn) && ++p.support < this.o.onsetConfirmFrames) {
      // 7.6 item 3: inside a click window the split waits for pitch evidence (onsetConfirm voiced frames from the
      // onset on, unvoiced frames between them allowed); the frame stays with the note until then.
      p.midi = f.midi as number;
      cur.frames.push(f);
      cur.lastVoicedT = f.t;
      this.maybeUpdate(cur, out);
      return;
    }
    if (p && f.t >= p.dip.tOn) {
      const moved = [...cur.frames.filter((x) => x.t >= p.dip.tOn), ...this.pitchCand.filter((x) => x.t >= p.dip.tOn), f];
      this.pending = null;
      this.pitchCand = [];
      this.split(p.dip.tOn, p.flux ? 'flux' : null, moved, out, p.dip);
      return;
    }
    const med = this.noteMedian(cur);
    if (Math.abs((f.midi as number) - med) >= this.tol) {
      this.addStable(this.pitchCand, f);
      if (this.pitchCand.length >= this.o.changeConfirmFrames) {
        const cand = this.pitchCand;
        this.pitchCand = [];
        const newMed = median(cand.map((x) => x.midi as number));
        if ((cand[0] as Fr).t < cur.onset + this.o.minNoteSec || this.settling(cur, cand, med, newMed)) {
          // The pitch settled inside the note's first 60 ms (window overlap with the previous note after a dip
          // split, or a scoop), or is still settling in a room: re-pitch this note instead of splitting it.
          cur.frames = cand;
          cur.provisional = newMed;
          if (cur.cause === 'repeat' && Math.round(newMed) !== Math.round(cur.prevMidi)) cur.cause = 'pitch-change';
          cur.lastVoicedT = f.t;
          cur.sinceUpdate = 0;
          out.push({ type: 'note-update', note: this.snapshot(cur) });
          return;
        }
        const cross = this.crossing(cur, cand, med, newMed);
        const ref = cross ?? (cand[0] as Fr).t;
        const dip = this.localDip(ref, newMed, cur);
        const tOn = Math.max(cur.onset + 1e-3, dip ?? ref);
        this.pending = null;
        // Frames after the onset that still read the old pitch (window overlap; a room's tail) are not the new note's.
        const newSide = (x: Fr): boolean => Math.abs((x.midi as number) - newMed) < Math.abs((x.midi as number) - med);
        const moved = [...cur.frames.filter((x) => x.t >= tOn && newSide(x)), ...cand.filter((x) => x.t >= tOn)];
        if (moved.length === 0) moved.push(f);
        this.split(tOn, 'pitch-change', moved, out);
      }
      return;
    }
    this.pitchCand = [];
    cur.frames.push(f);
    cur.lastVoicedT = f.t;
    this.maybeUpdate(cur, out);
  }

  /**
   * Room settling: after a pitch change in a reverberant room the old note's tail and the new note share the first
   * windows, so the pitch reads a glide between them or a mixture pitch below both. A further pitch change soon after
   * re-pitches the note instead of splitting when the note never held a pitch of its own (no plateau of frames away
   * from the new pitch, while gliding on from the previous note) or read a pitch outside both notes.
   */
  private settling(cur: Note, cand: Fr[], med: number, next: number): boolean {
    if (cur.cause !== 'pitch-change' || !Number.isFinite(cur.prevMidi)) return false;
    if ((cand[0] as Fr).t >= cur.onset + SETTLE_SEC) return false;
    const prev = cur.prevMidi;
    if (this.mixtureNote(cur, med, next)) return true;
    if (!((med - prev) * (next - prev) > 0 && Math.abs(next - prev) > Math.abs(med - prev))) return false;
    let held = 0;
    for (const f of cur.frames) if (Math.abs((f.midi as number) - next) >= this.tol) held++;
    return held < SETTLE_PLATEAU_FRAMES;
  }

  /** The note (split at a pitch change, median `med`) reads a pitch more than SETTLE_MIX_ST outside both neighbours. */
  private mixtureNote(cur: Note, med: number, next: number): boolean {
    const prev = cur.prevMidi;
    return med < Math.min(prev, next) - SETTLE_MIX_ST || med > Math.max(prev, next) + SETTLE_MIX_ST;
  }

  /** Adds a voiced frame to a stability candidate: restarts on a jump, drops old frames while the spread is too wide. */
  private addStable(c: Fr[], f: Fr): void {
    if (c.length > 0 && Math.abs((f.midi as number) - mean(c)) >= this.tol) c.length = 0;
    c.push(f);
    for (;;) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const x of c) {
        const m = x.midi as number;
        if (m < lo) lo = m;
        if (m > hi) hi = m;
      }
      if (hi - lo <= this.tol || c.length <= 1) break;
      c.shift();
    }
  }

  /** Starts a note. With no frames yet (a dip split ahead of the new note's frames) the pitch is `prevMidi`'s. */
  private begin(onset: number, cause: DetectedNote['onsetCause'], frames: Fr[], out: DspEvent[], prevMidi = NaN): void {
    const confirm = frames.slice(0, this.o.onsetConfirmFrames).map((x) => x.midi as number);
    const last = frames[frames.length - 1];
    const n: Note = {
      id: this.nextId++,
      onset,
      cause,
      frames,
      provisional: confirm.length > 0 ? median(confirm) : prevMidi,
      framesAgree: confirm.length >= this.o.onsetConfirmFrames && confirm.every((m) => Math.round(m) === Math.round(confirm[0] as number)),
      lastVoicedT: last ? last.t : onset,
      sinceUpdate: 0,
      offset: null,
      prevMidi,
      amFrom: onset + this.o.attackExcludeSec,
      prevAm: 0,
    };
    this.cur = n;
    this.silence = 0;
    this.boundary = true;
    this.trkBoundaryIdx = Math.max(this.trkBoundaryIdx, this.envIndex(onset + this.o.minNoteSec / 2));
    this.dipCursor = this.dips.length;
    // Keep dips evaluated after this onset for the new note (a dip found late can still belong to it).
    for (let i = this.dips.length - 1; i >= 0; i--) {
      if ((this.dips[i] as Dip).tOn > onset + this.o.minNoteSec) this.dipCursor = i;
      else break;
    }
    out.push({ type: 'note-on', note: this.snapshot(n) });
  }

  private split(tOn: number, causeOverride: DetectedNote['onsetCause'] | null, moved: Fr[], out: DspEvent[], dip: Dip | null = null): void {
    const old = this.cur as Note;
    const oldMed = this.noteMedian(old);
    old.frames = old.frames.filter((x) => x.t < tOn);
    this.finish(old, tOn, out);
    const newMed = moved.length > 0 ? median(moved.map((x) => x.midi as number)) : oldMed;
    const cause = causeOverride ?? (Math.round(newMed) === Math.round(oldMed) ? 'repeat' : 'pitch-change');
    this.begin(tOn, cause, moved, out, oldMed);
    if (cause === 'pitch-change') (this.cur as Note).prevAm = this.previousNoteAm(old, oldMed, tOn);
    if (dip && cause !== 'pitch-change') {
      (this.cur as Note).amFrom = old.amFrom;
      this.amExclude.push(dip.prePeakT, dip.halfRiseT + AM_EXCLUDE_AFTER_SEC);
      if (this.amExclude.length > 64) this.amExclude.splice(0, this.amExclude.length - 32);
      this.splitDips.push({ from: dip.prePeakT, to: dip.halfRiseT + AM_EXCLUDE_AFTER_SEC, minT: dip.minT, strong: dip.nearFloor || (dip.fluxPeak ?? 0) >= dip.fluxThr * VIB_FLUX });
      if (this.splitDips.length > 32) this.splitDips.splice(0, 16);
    }
  }

  /**
   * The AM of the old note's last AM_WINDOW_SEC before a pitch change at `tOn` (see PREV_AM_GUARD_SEC): only out of a
   * vibrato note, and not across a rest (a fall of PREV_AM_REST_DB or more before the new onset). 0 otherwise.
   */
  private previousNoteAm(old: Note, oldMed: number, tOn: number): number {
    const end = tOn - PREV_AM_GUARD_SEC;
    if (end - old.amFrom < PREV_AM_MIN_SEC || this.vibratoAt(end, oldMed) === null) return 0;
    const len = this.smoothLen(oldMed);
    let pre = -Infinity;
    for (let i = this.envIndex(end - 0.05); i <= this.envIndex(end); i++) pre = Math.max(pre, this.smoothDb(i, len));
    let low = Infinity;
    for (let i = this.envIndex(end); i <= this.envIndex(tOn + 0.005); i++) low = Math.min(low, this.smoothDb(i, len));
    return pre - low >= PREV_AM_REST_DB ? 0 : this.amDepth(end, old.amFrom, len);
  }

  private finish(n: Note, offset: number, out: DspEvent[]): void {
    n.offset = Math.max(n.onset, offset);
    out.push({ type: 'note-off', note: this.snapshot(n) });
    this.cur = null;
    this.silence = 0;
    this.pitchCand = [];
    this.boundary = true;
  }

  private maybeUpdate(n: Note, out: DspEvent[]): void {
    if (n.sinceUpdate >= 4) {
      n.sinceUpdate = 0;
      out.push({ type: 'note-update', note: this.snapshot(n) });
    }
  }

  private noteMedian(n: Note): number {
    const steady = n.frames.filter((x) => x.t >= n.onset + this.o.attackExcludeSec);
    const use = steady.length >= 3 ? steady : n.frames;
    return use.length > 0 ? median(use.map((x) => x.midi as number)) : n.provisional;
  }

  private snapshot(n: Note): DetectedNote {
    const steadyFrom = n.onset + this.o.attackExcludeSec;
    const steady = n.frames.filter((x) => x.t >= steadyFrom);
    const use = steady.length > 0 ? steady : n.frames;
    const midis = use.map((x) => x.midi as number);
    const m = midis.length > 0 ? median(midis) : n.provisional;
    let sd = 0;
    if (midis.length > 1) {
      let s = 0;
      for (const v of midis) s += (v - m) * (v - m);
      sd = Math.sqrt(s / (midis.length - 1)) * 100;
    }
    const end = n.offset !== null ? Math.min(n.offset, n.lastVoicedT) : n.lastVoicedT;
    const steadyMs = Math.max(0, (end - steadyFrom - STEADY_TAIL_SEC) * 1000);
    const alts = n.frames.slice(0, Math.max(this.o.onsetConfirmFrames, 8)).map((x) => x.alt).filter((x): x is number => x !== null);
    return {
      id: n.id,
      onset: n.onset as ClockSeconds,
      offset: n.offset === null ? null : (n.offset as ClockSeconds),
      provisionalMidi: n.provisional,
      midi: m,
      stableMedianCents: (m - Math.round(m)) * 100,
      steadyMs,
      pitchSdCents: sd,
      clarity: n.frames.length > 0 ? median(n.frames.map((x) => x.clarity)) : 0,
      altOctaveClarity: alts.length > 0 ? median(alts) : null,
      onsetCause: n.cause,
      framesAgree: n.framesAgree,
    };
  }

  // ------------------------------------------------------------------------------- onset times

  /** 7.4 item 3 with confirmT 20 ms after the start of the envelope rise that led to the first stable frame. */
  private silenceOnset(firstT: number, midi: number): number {
    const iS = Math.max(0, this.envIndex(firstT - this.o.windowSec - 0.04));
    // The first stable frame can lead the attack by up to half a window (its window reaches ahead).
    const iE = Math.min(this.envLen - 1, this.envIndex(firstT + this.o.windowSec / 2 + 0.02));
    const fallback = firstT - this.o.windowSec / 4;
    if (iE - iS < 3) return fallback;
    const len = this.smoothLen(midi);
    let iPk = iS;
    let pk = -Infinity;
    for (let i = iS; i <= iE; i++) {
      const v = this.smoothDb(i, len);
      if (v > pk) {
        pk = v;
        iPk = i;
      }
    }
    const clamp = this.clampDb(iPk);
    let i = iPk;
    while (i > iS) {
      const v = Math.max(clamp, this.smoothDb(i, len));
      const pv = Math.max(clamp, this.smoothDb(i - 1, len));
      if (v <= clamp + 1e-9) break;
      if (pv > v + 0.5) break;
      i--;
    }
    return this.attackOnset(i, clamp) ?? fallback;
  }

  /** Last index of the trough that starts at `iMin` (a floor plateau ends where the rise begins). */
  private riseStart(iMin: number, len: number, clamp: number): number {
    const base = Math.max(clamp, this.smoothDb(iMin, len));
    let i = iMin;
    while (i + 1 < this.envLen && Math.max(clamp, this.smoothDb(i + 1, len)) <= base + 1) i++;
    return i;
  }

  /** onsetFromSilence with the rise starting at envelope index `start`. */
  private attackOnset(start: number, clamp: number): number | null {
    const confirmT = this.envT(start) + 0.02;
    const ser = this.series(start - 12, start + 24, 0, clamp);
    const flux = this.o.fluxTiming ? this.fluxSamples(confirmT - 0.02, confirmT + 0.02) : [];
    return onsetFromSilence(ser, { confirmT, flux, fluxThreshold: this.fluxThresholdNear(confirmT) });
  }

  /** Pitch-change onset over the recent frames (raw pitch; frames far from both notes are skipped). */
  private crossing(cur: Note, cand: Fr[], prev: number, next: number): number | null {
    const from = Math.max(cur.onset + 0.01, (cand[0] as Fr).t - 0.12);
    const lo = Math.min(prev, next) - 1;
    const hi = Math.max(prev, next) + 1;
    const frames: OnsetPitchFrame[] = [];
    for (const f of this.recent) {
      if (f.t < from) continue;
      const r = f.raw;
      const ok = f.voiced && r !== null && r >= lo && r <= hi;
      frames.push({ t: f.t, midi: ok ? r : null, clarity: f.clarity });
    }
    const cross = pitchChangeOnset(frames, prev, next, this.o.clarityThreshold);
    if (cross === null) return null;
    // Across a long gap of unclear frames (a reverberant change: the old note's tail and the new note in one
    // window), the interpolated crossing is only the gap's midpoint; the new note's flux peak marks it better. The
    // gap is looked for over GAP_LOOKBACK_SEC, and the old side ends at its last run of two clear frames (a lone
    // clear frame inside the gap is the room's tail of the old note).
    const mid = (prev + next) / 2;
    const side = Math.sign(prev - mid);
    const gapFrom = Math.max(cur.onset + 0.01, (cand[0] as Fr).t - GAP_LOOKBACK_SEC);
    let a = -Infinity;
    let b = Infinity;
    let prevClearOld = false;
    for (const f of this.recent) {
      if (f.t < gapFrom) continue;
      const r = f.raw;
      const clear = f.voiced && r !== null && r >= lo && r <= hi && f.clarity >= this.o.clarityThreshold;
      const old = clear && Math.sign((r as number) - mid) === side;
      if (old && prevClearOld && f.t <= cross) a = f.t;
      prevClearOld = old;
      if (clear && !old && f.t >= cross && f.t < b) b = f.t;
    }
    if (Number.isFinite(a) && Number.isFinite(b) && b - a > this.o.windowSec + GAP_FLUX_MIN_HOPS * this.o.hopSec) {
      const fp = this.fluxPeakIn(a, b);
      if (fp && fp.value >= this.fluxThresholdNear(fp.t) * GAP_FLUX_FACTOR) return fp.t;
    }
    return cross;
  }

  /**
   * A re-articulation dip at a pitch change: the envelope minimum between `ref - 30 ms` and the newest envelope
   * (the frames lead an attack by up to half a window), at least 3 dB deep with a half-rise after it. Returns the
   * onset (half-rise, or the attack-from-silence onset when the dip reaches the floor), or null.
   */
  private localDip(ref: number, newMidi: number, cur: Note): number | null {
    const len = this.smoothLen(newMidi);
    const lagHops = Math.ceil(len / 2 / (this.envHop * this.rate)) + 1;
    const iA = Math.max(0, this.envIndex(cur.onset + this.o.minNoteSec / 2), this.envIndex(ref - PITCH_CHANGE_DIP_SEC - DIP_SIDE_SEC));
    const iB = Math.min(this.envLen - 1 - lagHops, this.envIndex(ref + this.o.windowSec / 2 + PITCH_CHANGE_DIP_SEC));
    if (iB - iA < 3) return null;
    // Minimum in the core window (ref - 30 ms .. iB); the pre-peak may lie up to 50 ms before it.
    const iCore = Math.max(iA + 1, this.envIndex(ref - PITCH_CHANGE_DIP_SEC));
    let iMin = -1;
    let minV = Infinity;
    for (let i = iCore; i < iB; i++) {
      const v = this.smoothDb(i, len);
      if (v < minV) {
        minV = v;
        iMin = i;
      }
    }
    if (iMin < 0) return null;
    const clamp = this.clampDb(iMin);
    if (Math.max(clamp, minV) <= clamp + NEAR_FLOOR_DB) return this.floorAttack(iMin, iB, len, clamp)?.t ?? null;
    const i0 = Math.max(iA, iMin - Math.round(DIP_SIDE_SEC / this.envHop));
    const ser = this.series(i0, iB, len, clamp);
    const r = repeatedOnset(ser, { searchStartT: this.envT(i0), searchEndT: this.envT(iB), noteStartT: this.envT(i0) });
    let ok = r !== null;
    if (r) {
      // A slur moves partials across resonances, which can dip the envelope a few dB: the dip must pass the
      // 7.4 item 4 rule against the note's AM, and the profile's minimum.
      let iPre = i0;
      for (let k = i0; k < iMin; k++) if (this.smoothDb(k, len) > this.smoothDb(iPre, len)) iPre = k;
      const am = this.amDepth(this.envT(iPre), cur.amFrom, len);
      ok = r.dipDb >= Math.max(this.o.pitchChangeDipDb, 1.5 * am);
    }
    // Struck notes always begin with a hammer attack; a room can fill the damper dip but not hide the rise. (For
    // sustained profiles a steep rise at a pitch change is as likely a slur through a resonance.)
    if (!r || !ok) return this.o.struck ? this.steepRise(iCore, iB, len, clamp) : null;
    if (this.o.struck) {
      const s = this.attackOnset(this.riseStart(this.envIndex(r.minT), len, clamp), clamp);
      if (s !== null && s > r.minT - 0.004) return s;
    }
    return this.earlyFlux(r);
  }

  /**
   * In a room the dip of a tongued change fills and the new note's level climbs out of the old note's tail late: the
   * half-rise trails the attack. A clear flux peak well before the half-rise (and after the fall began) marks it.
   * Only for a filled dip (under EARLY_FLUX_MAX_DIP_DB): a deep dry dip's half-rise is the 7.4 onset.
   * (On same-pitch repeats this raised clean false splits on violin and trumpet, so it is used at pitch changes only.)
   */
  private earlyFlux(r: { t: number; minT: number; halfRiseT: number; dipDb: number }): number {
    if (r.dipDb >= EARLY_FLUX_MAX_DIP_DB) return r.t;
    const fp = this.fluxPeakIn(r.minT - EARLY_FLUX_BEFORE_SEC, r.halfRiseT - EARLY_FLUX_GAP_SEC);
    if (fp && fp.value >= this.fluxThresholdNear(fp.t) * EARLY_FLUX_FACTOR && fp.t < r.t - EARLY_FLUX_GAP_SEC) return fp.t;
    return r.t;
  }

  /**
   * A hard attack whose dip the room has filled: the steepest 10 ms envelope rise in [iA, iB], if it is at least
   * STEEP_RISE_DB. Returns the 7.4 item 3 onset from the trough before it, or null.
   */
  private steepRise(iA: number, iB: number, len: number, clamp: number): number | null {
    const k = Math.max(1, Math.round(STEEP_RISE_SEC / this.envHop));
    let best = -1;
    let bestRise = 0;
    for (let i = iA; i + k <= iB; i++) {
      const d = Math.max(clamp, this.smoothDb(i + k, len)) - Math.max(clamp, this.smoothDb(i, len));
      if (d > bestRise) {
        bestRise = d;
        best = i;
      }
    }
    if (best < 0 || bestRise < STEEP_RISE_DB) return null;
    let st = best;
    while (st > iA && this.smoothDb(st - 1, len) < this.smoothDb(st, len) - 0.1) st--;
    return this.attackOnset(st, clamp);
  }

  /** Decides on dips evaluated since the last call: the earliest detectable one becomes the pending split. */
  private considerDips(cur: Note): void {
    while (this.dipCursor < this.dips.length) {
      const d = this.dips[this.dipCursor] as Dip;
      if (this.pending) break;
      this.dipCursor++;
      if (d.tOn <= cur.onset + this.o.minNoteSec) continue;
      const v = this.detectable(d, cur);
      if (v) this.pending = { dip: d, flux: v === 'flux', support: 0, midi: NaN };
    }
  }

  /**
   * Vibrato-aware dip rejection (PLAN ruling 45). With vibrato in the pitch track, a room (or a body resonance)
   * turns the frequency swing into level swings at the vibrato rate: under reverb these troughs reach 8 to 12 dB and
   * pass the 7.4 item 4 rule, and once one is split its dip is skipped by the AM look-back, so the next trough passes
   * too (a split every vibrato period). A dip is a vibrato trough when it is under VIB_K x the envelope's swing over
   * the vibrato period that ends VIB_LAG periods before its minimum (and not after its pre-peak). That measure skips
   * earlier splits with onset evidence and those off this dip's vibrato phase, but keeps weak splits on its phase:
   * those were troughs of the same vibrato.
   */
  private vibratoTrough(d: Dip, cur: Note): boolean {
    const v = this.vibratoAt(d.prePeakT, this.noteMedian(cur));
    if (!v) return false;
    const end = Math.min(d.prePeakT, d.minT - VIB_LAG * v.period);
    const from = Math.max(cur.amFrom, end - v.period);
    if (end - from < VIB_MIN_COVER * v.period) return false;
    const ex: number[] = [];
    for (const x of this.splitDips) {
      const k = (d.minT - x.minT) / v.period;
      if (x.strong || Math.abs(k - Math.round(k)) > VIB_PHASE_TOL) ex.push(x.from, x.to);
    }
    return d.dipDb < VIB_K * this.amDepth(end, from, d.len, false, ex);
  }

  /**
   * Vibrato in the raw pitch over the VIB_LOOK_SEC before `t` (voiced frames within a semitone of `centre`, at least
   * 20): period from the zero crossings of the linearly detrended track, depth the median extreme between them
   * (cents). Null when there is no oscillation at a vibrato rate and depth.
   */
  private vibratoAt(t: number, centre: number): { period: number; depth: number } | null {
    const ts: number[] = [];
    const ps: number[] = [];
    for (const f of this.recent) {
      if (f.t < t - VIB_LOOK_SEC || f.t > t) continue;
      if (!f.voiced || f.raw === null || Math.abs(f.raw - centre) > 1) continue;
      ts.push(f.t);
      ps.push(f.raw);
    }
    const n = ps.length;
    if (n < 20) return null;
    // Linear detrend.
    let mt = 0;
    let mp = 0;
    for (let k = 0; k < n; k++) {
      mt += ts[k] as number;
      mp += ps[k] as number;
    }
    mt /= n;
    mp /= n;
    let sxy = 0;
    let sxx = 0;
    for (let k = 0; k < n; k++) {
      sxy += ((ts[k] as number) - mt) * ((ps[k] as number) - mp);
      sxx += ((ts[k] as number) - mt) ** 2;
    }
    const slope = sxx > 0 ? sxy / sxx : 0;
    const x = ps.map((p, k) => (p - mp - slope * ((ts[k] as number) - mt)) * 100);
    // Zero crossings with hysteresis; extremes between them.
    const hyst = VIB_HYST_CENTS;
    const cross: number[] = [];
    const ext: number[] = [];
    let sign = 0;
    let peak = 0;
    for (let k = 0; k < n; k++) {
      const v = x[k] as number;
      const sg = v > hyst ? 1 : v < -hyst ? -1 : 0;
      if (sg !== 0 && sg !== sign) {
        if (sign !== 0) {
          cross.push(ts[k] as number);
          ext.push(Math.abs(peak));
        }
        sign = sg;
        peak = v;
      } else if (sg === sign && Math.abs(v) > Math.abs(peak)) peak = v;
    }
    if (cross.length < 2) return null;
    const half = ((cross[cross.length - 1] as number) - (cross[0] as number)) / (cross.length - 1);
    const period = 2 * half;
    const depth = median(ext);
    if (period < VIB_MIN_PERIOD || period > VIB_MAX_PERIOD || depth < VIB_MIN_CENTS) return null;
    return { period, depth };
  }

  private detectable(d: Dip, cur: Note): false | 'dip' | 'flux' {
    if (d.nearFloor) return 'dip';
    let am = this.amDepth(d.prePeakT, cur.amFrom, d.len);
    // A young note's look-back has not seen its vibrato yet: the previous note's AM stands in (Note.prevAm).
    if (d.prePeakT - cur.amFrom < AM_WINDOW_SEC) am = Math.max(am, cur.prevAm);
    const hint = this.hints.some((h) => Math.abs(d.tOn - h.t) <= h.halfWidthSec);
    const thr = hint ? Math.max(HINT_MIN_DIP_DB, HINT_AM_FACTOR * am) : Math.max(3, 1.5 * am);
    const fluxRatio = d.fluxPeak === null ? 0 : d.fluxPeak / d.fluxThr;
    // Room reverb (ruling 45): early-note beating, vibrato troughs and long falls without onset evidence are not
    // re-articulations (a note after a rest begins with an attack; a vibrato swing in a room can fall as long).
    if (d.shortDipDb < thr && !hint && fluxRatio < LONG_FALL_FLUX) return false;
    if (!hint && d.tOn - cur.onset < EARLY_DIP_SEC && fluxRatio < (this.soft ? EARLY_DIP_FLUX_SOFT : EARLY_DIP_FLUX) && d.dipDb < EARLY_DIP_DB) return false;
    if (!hint && fluxRatio < VIB_FLUX && d.dipDb < VIB_MAX_DB && this.vibratoTrough(d, cur)) return false;
    if (d.dipDb >= thr) return 'dip';
    if (d.fluxPeak !== null && d.fluxPeak >= d.fluxThr * this.o.fluxRouteFactor) return 'flux';
    return false;
  }

  /**
   * 7.4 item 4 AM depth: peak-to-peak of the (smoothed, floored) envelope over the 200 ms ending at `endT`, not
   * before `fromT`, skipping the dips of earlier re-articulations of the same chain. Same as `amDepthDb` of
   * core/onset-definition.ts when nothing is skipped, except on struck profiles, where the level drop of the decay is
   * removed first (a decaying tone is not amplitude-modulated).
   */
  private amDepth(endT: number, fromT: number, len: number, detrend = this.o.struck, ex: readonly number[] = this.amExclude): number {
    const from = Math.max(fromT, endT - AM_WINDOW_SEC);
    if (!(endT > from)) return 0;
    const i0 = Math.max(0, Math.ceil((from - this.envStartT) / this.envHop - 1e-9));
    const i1 = Math.min(this.envLen - 1, Math.floor((endT - this.envStartT) / this.envHop + 1e-9));
    const clamp = this.clampDb(i1);
    const ts: number[] = [];
    const vs: number[] = [];
    for (let i = i0; i <= i1; i++) {
      const t = this.envT(i);
      let skip = false;
      for (let k = 0; k < ex.length; k += 2) {
        if (t >= (ex[k] as number) && t <= (ex[k + 1] as number)) {
          skip = true;
          break;
        }
      }
      if (skip) continue;
      ts.push(t);
      vs.push(Math.max(clamp, this.smoothDb(i, len)));
    }
    if (vs.length < 2) return 0;
    if (detrend) {
      // A struck tone decays: measure the modulation around the least-squares decay line.
      let mt = 0;
      let mv = 0;
      for (let k = 0; k < vs.length; k++) {
        mt += ts[k] as number;
        mv += vs[k] as number;
      }
      mt /= vs.length;
      mv /= vs.length;
      let sxy = 0;
      let sxx = 0;
      for (let k = 0; k < vs.length; k++) {
        const dt = (ts[k] as number) - mt;
        sxy += dt * ((vs[k] as number) - mv);
        sxx += dt * dt;
      }
      const slope = sxx > 0 ? sxy / sxx : 0;
      for (let k = 0; k < vs.length; k++) vs[k] = (vs[k] as number) - slope * ((ts[k] as number) - mt);
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of vs) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return hi - lo;
  }

  private estimateOffset(n: Note): number {
    const level = median(n.frames.map((x) => x.rmsDb));
    const half = this.o.windowSec / 2;
    const i0 = this.envIndex(n.lastVoicedT - half);
    const i1 = Math.min(this.envLen - 1, this.envIndex(n.lastVoicedT + half));
    const len = this.smoothLen(this.noteMedian(n));
    for (let i = Math.max(0, i0); i <= i1; i++) {
      if (this.smoothDb(i, len) < level - OFFSET_DROP_DB) return Math.max(n.onset, this.envT(i));
    }
    return Math.max(n.onset, n.lastVoicedT);
  }

  // ------------------------------------------------------------------------------- dip tracker

  private scanEnvelope(): void {
    const cur = this.cur;
    const held = this.pending && this.pending.support > 0 ? this.pending.midi : NaN;
    // While a gated split waits for its evidence, the envelope is already the new note's: smooth over its periods.
    const len = Number.isFinite(held)
      ? this.smoothLen(held)
      : cur
        ? this.smoothLen(this.noteMedian(cur))
        : this.smoothLen(this.idleCand.length > 0 ? ((this.idleCand[0] as Fr).midi as number) : NaN);
    this.trkLen = len;
    const lag = Math.ceil(len / 2 / (this.envHop * this.rate)) + 1;
    const end = this.envLen - lag;
    for (let i = this.trkIdx; i < end; i++) {
      const v = this.smoothDb(i, len);
      this.track(i, v);
    }
    this.trkIdx = Math.max(this.trkIdx, end);
    // Forget old dips.
    const keepFrom = this.lastFrameT - HISTORY_SEC;
    if (this.dips.length > 64 && (this.dips[0] as Dip).tOn < keepFrom) {
      let k = 0;
      while (k < this.dips.length && (this.dips[k] as Dip).tOn < keepFrom && k < this.dipCursor) k++;
      this.dips.splice(0, k);
      this.dipCursor -= k;
    }
  }

  private track(i: number, v: number): void {
    switch (this.trkMode) {
      case 'up':
        if (v >= this.valAt(this.trkPeak)) {
          this.trkPeak = i;
          this.trkMin = i;
        } else if (v < this.valAt(this.trkPeak) - TRACK_HYST_DB) {
          this.trkMode = 'down';
          this.trkMin = i;
        }
        break;
      case 'down':
        if (v < this.valAt(this.trkMin)) this.trkMin = i;
        else if (v > this.valAt(this.trkMin) + TRACK_HYST_DB) this.enterRising(i);
        break;
      case 'rising': {
        if (v < this.valAt(this.trkMin)) {
          this.trkMode = 'down';
          this.trkMin = i;
          break;
        }
        // Evaluate as early as the definition allows (latency): a dip once the envelope is past its half-rise, an
        // attack from the floor once the 40 ms the 7.4 item 3 window needs have arrived.
        if (!this.trkDone) {
          const early = this.trkFloor
            ? (i - this.trkRiseIdx) * this.envHop >= EARLY_FLOOR_EVAL_SEC
            : v >= (this.trkPreV + Math.max(this.trkClamp, this.valAt(this.trkMin))) / 2 + EARLY_HALF_MARGIN_DB;
          if (early) {
            this.evaluateDip(this.trkMin, i);
            this.trkDone = true;
          }
        }
        const stopped = v < this.trkLast - 0.2;
        const long = (i - this.trkMin) * this.envHop >= DIP_RISE_MAX_SEC;
        if (stopped || long) {
          if (!this.trkDone) this.evaluateDip(this.trkMin, stopped ? i - 1 : i);
          this.trkMode = 'up';
          this.trkPeak = stopped ? i - 1 : i;
          this.trkMin = this.trkPeak;
          if (v >= this.valAt(this.trkPeak)) this.trkPeak = i;
        }
        break;
      }
    }
    this.trkLast = v;
  }

  private enterRising(i: number): void {
    this.trkMode = 'rising';
    this.trkDone = false;
    this.trkRiseIdx = i - 1;
    const iMin = this.trkMin;
    this.trkClamp = this.clampDb(iMin);
    const i0 = this.dipStart(iMin, this.trkLen);
    let pre = -Infinity;
    for (let k = i0; k < iMin; k++) pre = Math.max(pre, this.valAt(k));
    this.trkPreV = Math.max(this.trkClamp, pre);
    this.trkFloor = Math.max(this.trkClamp, this.valAt(iMin)) <= this.trkClamp + NEAR_FLOOR_DB;
  }

  private valAt(i: number): number {
    return this.smoothDb(i, this.trkLen);
  }

  /**
   * Start of the fall into the dip at `iMin`: DIP_SIDE_SEC before the minimum, or earlier for a release into a room
   * tail. When a note stops and the next starts after a short rest, a room keeps the envelope up (the tail decays
   * until the next attack, without reaching the floor), so the fall is longer than DIP_SIDE_SEC and its last 35 ms
   * are only a few dB. Such a fall counts whole when it is monotone (LONG_FALL_TOL_DB), at most LONG_FALL_SEC long
   * and at least LONG_FALL_MIN_DB deep: a vibrato swing is neither that long nor that deep.
   */
  private dipStart(iMin: number, len: number): number {
    const side = Math.round(DIP_SIDE_SEC / this.envHop);
    const i0 = Math.max(0, this.trkBoundaryIdx, iMin - side);
    const lim = Math.max(0, this.trkBoundaryIdx, iMin - Math.round(LONG_FALL_SEC / this.envHop));
    let k = i0;
    // Going back in time the envelope may wiggle (period ripple) but not fall LONG_FALL_TOL_DB below its running max.
    let runMax = this.smoothDb(k, len);
    while (k > lim) {
      const v = this.smoothDb(k - 1, len);
      if (v < runMax - LONG_FALL_TOL_DB) break;
      runMax = Math.max(runMax, v);
      k--;
    }
    if (iMin - k < side + Math.round(LONG_FALL_MIN_EXTRA_SEC / this.envHop)) return i0;
    let pk = -Infinity;
    for (let j = k; j <= i0; j++) pk = Math.max(pk, this.smoothDb(j, len));
    return pk - this.smoothDb(iMin, len) >= LONG_FALL_MIN_DB ? k : i0;
  }

  private evaluateDip(iMin: number, iEnd: number): void {
    const len = this.trkLen;
    const i0 = this.dipStart(iMin, len);
    if (iMin - i0 < 1 || iEnd - iMin < 1) return;
    const side = Math.round(DIP_SIDE_SEC / this.envHop);
    const clamp = this.clampDb(iMin);
    let shortDipDb = NaN;
    if (iMin - i0 > side) {
      let p = -Infinity;
      for (let k = Math.max(0, this.trkBoundaryIdx, iMin - side); k < iMin; k++) p = Math.max(p, this.smoothDb(k, len));
      shortDipDb = Math.max(clamp, p) - Math.max(clamp, this.smoothDb(iMin, len));
    }
    let iPre = i0;
    let pre = -Infinity;
    for (let k = i0; k < iMin; k++) {
      const v = this.smoothDb(k, len);
      if (v > pre) {
        pre = v;
        iPre = k;
      }
    }
    const minV = Math.max(clamp, this.smoothDb(iMin, len));
    if (minV <= clamp + NEAR_FLOOR_DB) {
      // The envelope fell to (near) the floor: the next note is an attack from silence (7.4 item 3).
      const a = this.floorAttack(iMin, iEnd, len, clamp);
      if (a === null) return;
      this.dips.push({ tOn: a.t, minT: a.riseT, halfRiseT: a.t, dipDb: Math.max(Math.max(clamp, pre), a.peak) - minV, prePeakT: this.envT(iPre), nearFloor: true, fluxPeak: null, fluxThr: Infinity, len, shortDipDb });
      return;
    }
    const ser = this.series(i0, iEnd + 1, len, clamp);
    const r = repeatedOnset(ser, { searchStartT: this.envT(i0), searchEndT: this.envT(iEnd + 1), noteStartT: this.envT(i0) });
    if (!r || r.dipDb < MIN_EVAL_DIP_DB) return;
    let tOn = r.t;
    if (this.o.fluxTiming) {
      const fp = this.fluxPeakIn(r.halfRiseT - 0.01, r.halfRiseT + 0.01);
      if (fp) tOn = fp.t;
    }
    if (this.o.struck) {
      const s = this.attackOnset(this.riseStart(this.envIndex(r.minT), len, clamp), clamp);
      if (s !== null && s > r.minT - 0.004) tOn = s;
    }
    // Detection may use flux inside click windows (an on-beat repeat's flux coincides with the click); the 7.6
    // item 3 gate then asks for pitch evidence. Only timing refinement ignores it (item 4).
    const fp = this.fluxPeakIn(r.minT - 0.01, r.halfRiseT + 0.01, true);
    this.dips.push({
      tOn,
      minT: r.minT,
      halfRiseT: r.halfRiseT,
      dipDb: r.dipDb,
      prePeakT: this.envT(iPre),
      nearFloor: false,
      fluxPeak: fp ? fp.value : null,
      fluxThr: fp ? this.fluxThresholdNear(fp.t) : Infinity,
      len,
      shortDipDb,
    });
  }

  /**
   * An attack out of a floor trough at `iMin`: the rise must climb FLOOR_ATTACK_RISE_DB above the floor by `iEnd`
   * (wiggles in a release tail are not attacks). Returns the 7.4 item 3 onset, the rise start and the peak.
   */
  private floorAttack(iMin: number, iEnd: number, len: number, clamp: number): { t: number; riseT: number; peak: number } | null {
    const iR = this.riseStart(iMin, len, clamp);
    let peak = -Infinity;
    const to = Math.min(this.envLen - 1, Math.max(iEnd, iR + Math.round(0.04 / this.envHop)));
    for (let k = iR; k <= to; k++) peak = Math.max(peak, this.smoothDb(k, len));
    const base = Math.max(clamp, this.smoothDb(iR, len));
    if (peak - base < FLOOR_ATTACK_RISE_DB) return null;
    if (peak < this.envFloorDb(this.envT(iR))) return null;
    const t = this.attackOnset(iR, clamp);
    return t === null ? null : { t, riseT: this.envT(iR), peak };
  }

  // ------------------------------------------------------------------------------- envelope helpers

  private envT(i: number): number {
    return this.envStartT + i * this.envHop;
  }

  private envIndex(t: number): number {
    return Math.round((t - this.envStartT) / this.envHop);
  }

  /**
   * Smoothing length in decimated samples: whole periods of the fundamental, at least SMOOTH_MIN_SEC. Averaging the
   * power over whole periods removes the ripple a 2 ms RMS shows on low notes (about 9 dB at 100 Hz).
   */
  private smoothLen(midi: number): number {
    if (!Number.isFinite(midi)) return Math.round(SMOOTH_MIN_SEC * this.rate);
    const period = this.rate / (440 * Math.pow(2, (midi - 69) / 12));
    const k = Math.max(1, Math.ceil((SMOOTH_MIN_SEC * this.rate) / period - 1e-9));
    return Math.min(SMOOTH_MAX_SEC * this.rate, k * period);
  }

  /** Cumulative low-band energy at fractional absolute sample index s (clamped to the stored range). */
  private cumAt(s: number): number {
    const lo = Math.max(this.cumTotal - this.cum.length + 1, 0);
    const x = Math.min(this.cumTotal, Math.max(lo, s));
    const j = Math.floor(x);
    const f = x - j;
    const mask = this.cum.length - 1;
    const a = this.cum[j & mask] as number;
    if (f === 0 || j + 1 > this.cumTotal) return a;
    const b = this.cum[(j + 1) & mask] as number;
    return a + f * (b - a);
  }

  /**
   * dB of the low-band mean power over `len` samples centred on envelope point i. len <= 0 returns the 2 ms
   * EnvelopeFollower value itself.
   */
  private smoothDb(i: number, len: number): number {
    const n = this.envLen;
    if (n === 0) return ENV_FLOOR_DB;
    if (len <= 0) return this.envDb[Math.min(n - 1, Math.max(0, i))] as number;
    const c = (this.envT(i) - this.sampleT0) * this.rate;
    const a = c - len / 2;
    const b = c + len / 2;
    const p = (this.cumAt(b) - this.cumAt(a)) / len;
    return p > 0 ? Math.max(ENV_FLOOR_DB, 10 * Math.log10(p)) : ENV_FLOOR_DB;
  }

  /** The envelope floor at index i: max(noise floor, recent peak - 60 dB). */
  private clampDb(i: number): number {
    const back = Math.round(1 / this.envHop);
    let pk = ENV_FLOOR_DB;
    const to = Math.min(this.envLen - 1, i + Math.round(0.05 / this.envHop));
    for (let k = Math.max(0, i - back); k <= to; k++) {
      const v = this.envDb[k] as number;
      if (v > pk) pk = v;
    }
    return Math.max(this.noiseFloorDb, pk - FLOOR_BELOW_PEAK_DB);
  }

  private series(i0: number, i1: number, len: number, clamp: number): EnvelopeSeries {
    const a = Math.max(0, i0);
    const b = Math.max(a, Math.min(this.envLen - 1, i1));
    const values = new Float64Array(b - a + 1);
    for (let i = a; i <= b; i++) values[i - a] = Math.max(clamp, this.smoothDb(i, len));
    return { startT: this.envT(a), hopSec: this.envHop, values };
  }

  private noteNoise(v: number): void {
    const cap = Math.min(this.noiseRing.length, Math.max(8, Math.round(NOISE_WINDOW_SEC / this.envHop)));
    this.noiseRing[this.noiseHead] = v;
    this.noiseHead = (this.noiseHead + 1) % cap;
    if (this.noiseCount < cap) this.noiseCount++;
    if (++this.noiseSince >= 25 && this.noiseCount >= Math.min(cap, 50)) {
      this.noiseSince = 0;
      const s = Float64Array.from(this.noiseRing.subarray(0, this.noiseCount)).sort();
      this.noiseFloorDb = s[Math.floor(0.2 * (s.length - 1))] as number;
    }
  }

  // ------------------------------------------------------------------------------- flux helpers

  private fluxIndex(t: number): number {
    const T = this.fluxT;
    if (T.length === 0) return -1;
    let lo = 0;
    let hi = T.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if ((T[m] as number) < t) lo = m + 1;
      else hi = m;
    }
    if (lo > 0 && Math.abs((T[lo - 1] as number) - t) <= Math.abs((T[lo] as number) - t)) lo--;
    return lo;
  }

  /**
   * Flux samples in [a, b], with a parabolic peak-time refinement. Samples inside click windows are left out (7.6
   * item 4) unless `inClick` (detection only, never timing).
   */
  private fluxSamples(a: number, b: number, inClick = false): FluxSample[] {
    const out: FluxSample[] = [];
    let i = this.fluxIndex(a);
    if (i < 0) return out;
    while (i > 0 && (this.fluxT[i] as number) > a) i--;
    for (; i < this.fluxT.length && (this.fluxT[i] as number) <= b; i++) {
      const t = this.fluxT[i] as number;
      if (t < a || (this.fluxClick[i] && !inClick)) continue;
      out.push({ t: this.refinedFluxT(i), value: this.fluxV[i] as number });
    }
    return out;
  }

  private refinedFluxT(i: number): number {
    const v = this.fluxV;
    const t = this.fluxT[i] as number;
    if (i <= 0 || i >= v.length - 1) return t;
    const a = v[i - 1] as number;
    const b = v[i] as number;
    const c = v[i + 1] as number;
    if (!(b >= a && b >= c)) return t;
    const den = a - 2 * b + c;
    if (Math.abs(den) < 1e-12) return t;
    const d = (0.5 * (a - c)) / den;
    const hop = (this.fluxT[i + 1] as number) - t;
    return Math.abs(d) <= 1 ? t + d * hop : t;
  }

  private fluxPeakIn(a: number, b: number, inClick = false): FluxSample | null {
    let best: FluxSample | null = null;
    for (const s of this.fluxSamples(a, b, inClick)) if (!best || s.value > best.value) best = s;
    return best;
  }

  private fluxThresholdNear(t: number): number {
    const i = this.fluxIndex(t);
    return i < 0 ? Infinity : (this.fluxThr[i] as number);
  }
}
