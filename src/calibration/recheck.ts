/**
 * Per-take count-in recheck (01 §7.7, 05 "Per-take count-in recheck", R31). Speakers only. Pure.
 *
 * The worker measures RTL from the take's count-in clicks: Tick, Classic, Woodblock and Beep in the hi band (the
 * Tick layer, each with its own arrival envelope), Wood in the low band by template correlation. A new sound whose
 * hi band is not enough falls back to the low band with its stored template; after a sound change there is none yet
 * and the hi band alone decides. Accepted with at least `recheck.minClicks` found and MAD at most `recheck.maxMadMs`. Then:
 * - a fresh value more than `useFreshAboveMs` from the stored one is used for the take (`usedFresh`), which keeps
 *   the take ranked (R31);
 * - more than `staleAboveMs` marks the calibration stale and the results prompt recalibration;
 * - the first count-in click not found at all restarts the count-in once (01 §7.1);
 * - only a recheck that could not measure on speakers fails gate `recheck` (R31).
 */
import type { CaptureBlock } from '../core/platform.ts';
import type { AttemptRecheck, Calibration, ClickTimbre, RecheckResult } from '../core/types.ts';
import {
  clickShape,
  hiBandCandidates,
  hiNoiseFloorDb,
  lowBandCandidates,
  lowNoiseFloorDb,
  matchArrivals,
  refineHi,
  type ClickArrival,
} from './arrivals.ts';
import type { CalibrationBudget } from './loopback.ts';
import { CaptureRecording } from './recording.ts';
import { mad, median } from './stats.ts';

export interface CountInClick {
  /** Scheduled output time, clock seconds. */
  t: number;
  accent: boolean;
}

export interface RecheckOptions {
  timbre: ClickTimbre;
  /**
   * Low-band template of the timbre from the stored calibration (`templates[timbre]`); null without one (no
   * calibration, or the sound changed since). Wood is found by correlation with it; the new sounds use it as a
   * fallback when the hi band does not measure.
   */
  template: ArrayLike<number> | null;
  budget: CalibrationBudget;
  /** Quiet window before the count-in for the noise floor (01 §7.5: the 400 ms before the count-in). */
  silence?: { t0: number; t1: number };
}

export interface RecheckDetail extends RecheckResult {
  arrivals: ClickArrival[];
}

/** Whether arrivals meet the recheck's acceptance (count and spread). */
function measures(arrivals: readonly ClickArrival[], rc: CalibrationBudget['recheck']): boolean {
  const lagsMs = arrivals.filter((a) => a.lagSec !== null).map((a) => (a.lagSec as number) * 1000);
  return lagsMs.length >= rc.minClicks && mad(lagsMs) <= rc.maxMadMs;
}

/** Measures RTL from the count-in clicks in a recording (01 §7.7). */
export function analyzeRecheck(rec: CaptureRecording, countIn: readonly CountInClick[], o: RecheckOptions): RecheckDetail {
  const lb = o.budget.loopback;
  const rc = o.budget.recheck;
  const minLag = lb.minRtlMs / 1000;
  const maxLag = lb.maxRtlMs / 1000;
  const times = countIn.map((c) => c.t);
  if (times.length === 0) return { firstClickFound: false, clicksFound: 0, rtlMs: null, madMs: null, accepted: false, arrivals: [] };
  const range = { t0: Math.min(...times), t1: Math.max(...times) + maxLag + 0.03 };
  const hi = (): ClickArrival[] => {
    const floor = hiNoiseFloorDb(rec, o.silence);
    const cands = hiBandCandidates(rec, floor, clickShape(o.timbre, false), range);
    const found = matchArrivals(times, cands, minLag, maxLag).arrivals;
    found.forEach((a, i) => {
      if (a.arrival === null) return;
      a.arrival = refineHi(rec, Math.max(0, rec.hiIndexAt(a.arrival)), clickShape(o.timbre, (countIn[i] as CountInClick).accent));
      a.lagSec = a.arrival - a.scheduled;
    });
    return found;
  };
  const low = (): ClickArrival[] => {
    const floor = lowNoiseFloorDb(rec, o.silence);
    const cands = lowBandCandidates(rec, floor, o.template, range);
    return matchArrivals(times, cands, minLag, maxLag).arrivals;
  };
  let arrivals: ClickArrival[];
  if (o.timbre === 'wood') arrivals = low();
  else {
    arrivals = hi();
    if (o.timbre !== 'tick' && o.template && o.template.length > 0 && !measures(arrivals, rc)) {
      const viaTemplate = low();
      if (measures(viaTemplate, rc)) arrivals = viaTemplate;
    }
  }
  const lagsMs = arrivals.filter((a) => a.lagSec !== null).map((a) => (a.lagSec as number) * 1000);
  const n = lagsMs.length;
  const rtlMs = n ? median(lagsMs) : null;
  const madMs = n ? mad(lagsMs) : null;
  const accepted = n >= rc.minClicks && (madMs as number) <= rc.maxMadMs;
  return {
    firstClickFound: (arrivals[0] as ClickArrival).arrival !== null,
    clicksFound: n,
    rtlMs: accepted ? rtlMs : null,
    madMs: accepted ? madMs : null,
    accepted,
    arrivals,
  };
}

/**
 * Streaming form for the DSP worker: push the take's blocks; once the recording reaches the last count-in click
 * plus the largest RTL, `push` returns the result once (the worker posts it as `WorkerReply` 'recheck').
 */
export class CountInRecheck {
  private readonly rec: CaptureRecording;
  private readonly countIn: readonly CountInClick[];
  private readonly opts: RecheckOptions;
  private readonly readyAt: number;
  private done: RecheckDetail | null = null;

  constructor(inputRate: number, countIn: readonly CountInClick[], opts: RecheckOptions) {
    this.rec = new CaptureRecording(inputRate);
    this.countIn = countIn;
    this.opts = opts;
    const last = countIn.length ? Math.max(...countIn.map((c) => c.t)) : 0;
    // The last click's arrival at the largest RTL, plus the click length and the refinement margin.
    this.readyAt = last + opts.budget.loopback.maxRtlMs / 1000 + 0.05;
  }

  /** Returns the result the first time the count-in has been fully recorded, else null. */
  push(b: CaptureBlock): RecheckDetail | null {
    if (this.done) return null;
    this.rec.push(b);
    if (this.rec.endT < this.readyAt) return null;
    this.done = analyzeRecheck(this.rec, this.countIn, this.opts);
    return this.done;
  }

  /** Forces the analysis on what was recorded (take ended early). */
  finish(): RecheckDetail {
    if (!this.done) this.done = analyzeRecheck(this.rec, this.countIn, this.opts);
    return this.done;
  }

  get result(): RecheckDetail | null {
    return this.done;
  }
}

export interface RecheckDecision {
  /** For `AttemptRecord.calibration.recheck`. */
  recheck: AttemptRecheck;
  /** The latency the take uses (`FollowConfig.latencyCompensationSec` × 1000), ms. */
  latencyMs: number;
  /** Mark the stored calibration stale (results prompt recalibration). */
  markStale: boolean;
}

/**
 * Applies a recheck to the stored latency (01 §7.7, R31). `storedMs` is the latency the take started with (the
 * route's calibration, or the reported estimate).
 */
export function decideRecheck(r: RecheckResult, storedMs: number, budget: CalibrationBudget): RecheckDecision {
  const rc = budget.recheck;
  if (!r.accepted || r.rtlMs === null) {
    return {
      recheck: { status: 'unmeasured', measuredMs: null, clicks: r.clicksFound, madMs: null, usedFresh: false, promptRecalibrate: false },
      latencyMs: storedMs,
      markStale: false,
    };
  }
  const diff = Math.abs(r.rtlMs - storedMs);
  const usedFresh = diff > rc.useFreshAboveMs;
  const stale = diff > rc.staleAboveMs;
  return {
    recheck: { status: 'measured', measuredMs: r.rtlMs, clicks: r.clicksFound, madMs: r.madMs, usedFresh, promptRecalibrate: stale },
    latencyMs: usedFresh ? r.rtlMs : storedMs,
    markStale: stale,
  };
}

/** The calibration after a recheck decision (stale when the shift exceeded `staleAboveMs`). */
export function applyRecheckToCalibration(c: Calibration, d: RecheckDecision): Calibration {
  return d.markStale && !c.stale ? { ...c, stale: true } : c;
}

/**
 * What the DSP worker needs to run the count-in recheck itself in port mode (R55), where capture blocks never reach
 * the main thread. The frozen `WorkerMessage` 'config' has no field for it, so the session attaches it to the
 * `DspConfig` object it posts (structured clone keeps the extra property) under `RECHECK_SPEC_KEY`; the worker reads
 * it back with `recheckSpecOf`. A config without it (relay mode, headphones) runs no recheck in the worker.
 */
export interface WorkerRecheckSpec {
  /** Context (input) sample rate, Hz: the hi band's 1 ms sub-blocks are on this axis. */
  inputRate: number;
  /** The take's count-in clicks on the output timeline. */
  countIn: CountInClick[];
  timbre: ClickTimbre;
  /** Low-band template samples of the timbre, or null without a calibration. */
  template: number[] | null;
  silence?: { t0: number; t1: number };
}

export const RECHECK_SPEC_KEY = 'srRecheck';

/** `cfg` with the recheck spec attached (see `WorkerRecheckSpec`). */
export function withRecheckSpec<T extends object>(cfg: T, spec: WorkerRecheckSpec): T {
  return { ...cfg, [RECHECK_SPEC_KEY]: spec };
}

/** The recheck spec attached to a config, or null. */
export function recheckSpecOf(cfg: object): WorkerRecheckSpec | null {
  const s = (cfg as Record<string, unknown>)[RECHECK_SPEC_KEY];
  if (typeof s !== 'object' || s === null) return null;
  const spec = s as WorkerRecheckSpec;
  return Number.isFinite(spec.inputRate) && Array.isArray(spec.countIn) ? spec : null;
}

/** The `RecheckResult` part of a detail (the reply carries no arrivals). */
export function recheckResultOf(d: RecheckDetail): RecheckResult {
  return { firstClickFound: d.firstClickFound, clicksFound: d.clicksFound, rtlMs: d.rtlMs, madMs: d.madMs, accepted: d.accepted };
}
