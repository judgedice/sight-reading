/**
 * The steady pitch needle (round 3, docs/redesign/round3/03-pitch-steadiness.md §3). Pure and deterministic.
 *
 * Two parts:
 *
 * - `SteadinessFilter`: the display filter, fed once per analyser frame (8 ms). Steps 1 to 10 and 12 of §3.1: gate,
 *   tail gate, dropout hold, show delay, glitch guard on the unfolded pitch (before any octave folding, so an
 *   11.6-semitone glitch can never read as +40 c), an age-growing running median, an exponential smoother computed
 *   from the real frame interval, snap, detent, and the medians the in-tune decision reads. It knows no target: its
 *   reading is unfolded concert MIDI, and the screen folds it.
 * - `inTuneStep`: the in-tune decision and the hit (§3.1 steps 13 and 14), fed once per posted frame with the reading
 *   folded against the target: symmetric hysteresis around the unchanged band, the dwells, the fast exit, and the hit
 *   (800 ms in tune and the median of those 800 ms within the band).
 *
 * Display only. Nothing here is an input to a try: the follower, the segmenter, the live marks and the grader never
 * see it (T15). The reference implementation is the round 3 Python simulation (`steadiness.py`, outside the repo).
 * Differences, all at the start of a run: the smoother starts afresh at a new run (after a dimmed gap or a confirmed
 * jump) instead of gliding from the old place, because the reading is unfolded and an octave jump would otherwise sweep
 * the folded needle; and a held glitch frame reads as a bridged gap.
 */
import type { PitchSteadiness } from '../core/types.ts';
import type { SteadinessGap, SteadinessParams, SteadinessReading } from '../core/platform.ts';

export type { SteadinessGap, SteadinessParams, SteadinessReading };

/** The in-tune decision's parameters, the same in every preset (§3.1 steps 13 and 14). */
export const IN_TUNE_PARAMS = { hystC: 10, enterDwellMs: 100, exitDwellMs: 150, hitMs: 800, fastExitFactor: 2, fastExitMs: 60 } as const;

/** What every preset shares (§3.2, last row). */
export const STEADINESS_COMMON = {
  ...IN_TUNE_PARAMS,
  gateDb: -65,
  tailDb: 12,
  peakMs: 500,
  showAfterMs: 60,
  holdMs: 120,
  hideMs: 600,
  jumpC: 300,
  jumpHoldMs: 220,
  snapC: 80,
  snapMs: 100,
  minCentreMs: 40,
  spreadMs: 400,
} as const satisfies Omit<SteadinessParams, 'centreMs' | 'tauMs' | 'judgeMs' | 'detentC'>;

/** The three presets (§3.2), most responsive last. */
export const STEADINESS_PRESETS: Readonly<Record<PitchSteadiness, SteadinessParams>> = {
  steady: { ...STEADINESS_COMMON, centreMs: 300, tauMs: 150, judgeMs: 400, detentC: 4 },
  balanced: { ...STEADINESS_COMMON, centreMs: 200, tauMs: 80, judgeMs: 300, detentC: 3 },
  quick: { ...STEADINESS_COMMON, centreMs: 60, tauMs: 30, judgeMs: 200, detentC: 1 },
};

export const PITCH_STEADINESS_VALUES: readonly PitchSteadiness[] = ['steady', 'balanced', 'quick'];

/** The default preset (§4): Steady for every voice, Balanced for every instrument. */
export function defaultPitchSteadiness(family: string): PitchSteadiness {
  return family === 'voice' ? 'steady' : 'balanced';
}

/** The player's setting, or the default by family when it is absent or not a preset. */
export function pitchSteadinessFor(stored: unknown, family: string): PitchSteadiness {
  return stored === 'steady' || stored === 'balanced' || stored === 'quick' ? stored : defaultPitchSteadiness(family);
}

// ---- small statistics ------------------------------------------------------------------------------------------

function sorted(xs: readonly number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}

function median(xs: readonly number[]): number {
  const s = sorted(xs);
  const n = s.length;
  const h = n >> 1;
  return n % 2 === 1 ? s[h]! : (s[h - 1]! + s[h]!) / 2;
}

/** Linear-interpolated percentile (as numpy's default), `q` in 0..1. */
function percentile(s: readonly number[], q: number): number {
  if (s.length === 1) return s[0]!;
  const x = q * (s.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return i + 1 < s.length ? s[i]! * (1 - f) + s[i + 1]! * f : s[i]!;
}

// ---- the display filter -------------------------------------------------------------------------------------------

const EMPTY: SteadinessReading = {
  settledMidi: null,
  centreMidi: null,
  judgeMidi: null,
  holdMidi: null,
  spreadLoMidi: null,
  spreadHiMidi: null,
  voicedMs: 0,
  gap: 'hidden',
  runId: 0,
};

/**
 * The needle's display filter (§3.1 steps 1 to 10 and 12). `push` once per analyser frame, in time order; `reading`
 * is what it shows after the last frame. Pitches are fractional MIDI (unfolded), times ms.
 */
export class SteadinessFilter {
  readonly p: SteadinessParams;
  /** Accepted frames of the current run: time and fractional MIDI, oldest first. */
  private hist: { t: number; m: number }[] = [];
  /** Levels of recent voiced frames, for the tail gate. */
  private levels: { t: number; db: number }[] = [];
  /** The smoothed value, cents above MIDI 0 (unfolded); null at the start of a run. */
  private y: number | null = null;
  /** The drawn value, cents above MIDI 0; null when nothing is shown. */
  private drawn: number | null = null;
  /** Time of the last voiced frame (accepted or held as a glitch). */
  private last: number | null = null;
  /** First frame of the current run. */
  private start: number | null = null;
  /** First frame of a jump being held as a glitch. */
  private away: number | null = null;
  /** First frame of the centre being beyond `snapC` from the smoothed value. */
  private snapSince: number | null = null;
  /** Time of the last smoother update. */
  private tl: number | null = null;
  private centre: number | null = null;
  private judge: number | null = null;
  private hold: number | null = null;
  private spread: [number, number] | null = null;
  private gap: SteadinessGap = 'hidden';
  private runId = 0;

  constructor(p: SteadinessParams) {
    this.p = p;
  }

  /** What the filter shows now. */
  get reading(): SteadinessReading {
    if (this.drawn === null && this.gap === 'hidden') return { ...EMPTY, runId: this.runId };
    const m = (c: number | null): number | null => (c === null ? null : c / 100);
    return {
      settledMidi: m(this.drawn),
      centreMidi: m(this.centre),
      judgeMidi: this.judge,
      holdMidi: this.hold,
      spreadLoMidi: this.spread ? this.spread[0] : null,
      spreadHiMidi: this.spread ? this.spread[1] : null,
      voicedMs: this.start !== null && this.last !== null ? this.last - this.start : 0,
      gap: this.gap,
      runId: this.runId,
    };
  }

  /** Forget everything: the needle is hidden. */
  reset(): void {
    this.hist = [];
    this.levels = [];
    this.y = null;
    this.drawn = null;
    this.last = null;
    this.start = null;
    this.away = null;
    this.snapSince = null;
    this.tl = null;
    this.clearRun();
    this.gap = 'hidden';
  }

  private clearRun(): void {
    this.centre = null;
    this.judge = null;
    this.hold = null;
    this.spread = null;
  }

  /** A new run: no history, the smoother starts afresh, and the in-tune decision resets (a new `runId`). */
  private newRun(t: number | null): void {
    this.hist = [];
    this.start = t;
    this.y = null;
    this.snapSince = null;
    this.away = null;
    this.clearRun();
    this.runId++;
  }

  /**
   * One analyser frame. `midi`: the analyser's fractional MIDI, or null when it hears no pitch (clarity below the
   * instrument's threshold). `levelDb`: the frame's level, dBFS.
   */
  push(t: number, midi: number | null, levelDb: number): void {
    const p = this.p;
    let voiced = midi !== null && Number.isFinite(midi) && levelDb >= p.gateDb;
    // 2. Tail gate: a frame far below the loudest of the last 500 ms is a dropout (held, not shown).
    if (voiced) {
      while (this.levels.length > 0 && this.levels[0]!.t < t - p.peakMs) this.levels.shift();
      this.levels.push({ t, db: levelDb });
      let peak = -Infinity;
      for (const l of this.levels) peak = Math.max(peak, l.db);
      if (levelDb < peak - p.tailDb) voiced = false;
    }
    if (!voiced) {
      // 3. Dropout hold: bridged up to `holdMs`, dimmed to `hideMs`, then hidden.
      if (this.last === null) return;
      const gap = t - this.last;
      if (gap > p.hideMs) {
        this.reset();
        return;
      }
      if (gap > p.holdMs) {
        if (this.gap !== 'dim') this.newRun(null);
        this.gap = 'dim';
        return;
      }
      this.gap = 'bridged';
      return;
    }
    const m = midi as number;
    if (this.last !== null && t - this.last > p.holdMs && this.start !== null) this.newRun(null);
    this.last = t;
    if (this.start === null) this.start = t;
    // 5. Glitch guard on the unfolded pitch, before any folding.
    if (this.hist.length > 0) {
      const tl = this.hist[this.hist.length - 1]!.t;
      const from = tl - Math.max(p.centreMs, 100);
      const ref = median(this.hist.filter((h) => h.t >= from).map((h) => h.m));
      if (Math.abs(m - ref) * 100 > p.jumpC) {
        this.away ??= t;
        if (t - this.away < p.jumpHoldMs) {
          this.gap = 'bridged';
          return;
        }
        // Still away: a real new pitch. The history restarts here.
        this.newRun(t);
      } else {
        this.away = null;
      }
    }
    this.gap = 'none';
    this.hist.push({ t, m });
    const keep = t - Math.max(p.centreMs, p.judgeMs, p.hitMs, p.spreadMs);
    while (this.hist.length > 0 && this.hist[0]!.t < keep) this.hist.shift();
    const age = t - (this.start as number);
    // 4. Show delay.
    if (age < p.showAfterMs) return;
    // 7. Centre: the running median over a window that grows with the note's age.
    const w = Math.min(p.centreMs, Math.max(p.minCentreMs, age / 2));
    const cen = median(this.hist.filter((h) => h.t >= t - w).map((h) => h.m)) * 100;
    this.centre = cen;
    // 8, 9. Smoother (frame-rate independent), and snap to the centre after a deliberate move.
    const tau = Math.min(p.tauMs, Math.max(10, age / 3));
    if (this.y === null || this.tl === null) {
      this.y = cen;
      this.snapSince = null;
    } else {
      if (Math.abs(cen - this.y) > p.snapC) {
        this.snapSince ??= t;
        if (t - this.snapSince >= p.snapMs) {
          this.y = cen;
          this.snapSince = null;
        }
      } else {
        this.snapSince = null;
      }
      const dt = Math.max(1, Math.min(50, t - this.tl));
      this.y += (1 - Math.exp(-dt / tau)) * (cen - this.y);
    }
    this.tl = t;
    // 10. Detent: the drawn needle moves only by `detentC` or more.
    if (this.drawn === null || Math.abs(this.y - this.drawn) >= p.detentC) this.drawn = this.y;
    // The wobble width, 10th to 90th percentile of the last `spreadMs`.
    const recent = sorted(this.hist.filter((h) => h.t >= t - p.spreadMs).map((h) => h.m));
    this.spread = [percentile(recent, 0.1), percentile(recent, 0.9)];
    // 12. Judge value: the median over a full `judgeMs` window of this run; and the hit's `hitMs` median.
    if (age >= p.judgeMs) {
      this.judge = median(this.hist.filter((h) => h.t >= t - p.judgeMs).map((h) => h.m));
      this.hold = median(this.hist.filter((h) => h.t >= t - p.hitMs).map((h) => h.m));
    } else {
      this.judge = null;
      this.hold = null;
    }
  }
}

// ---- the in-tune decision -------------------------------------------------------------------------------------------

/** The in-tune decision's state (plain data, so a reducer can hold it). */
export interface InTuneState {
  inTune: boolean;
  /** Since when the judge value has been past the entry (or exit) threshold. */
  candSince: number | null;
  /** Since when the short centre has been past the fast exit. */
  fastSince: number | null;
  /** When the current in-tune stretch began. */
  inSince: number | null;
  /** When the hit was earned; once set it stays. */
  hitAt: number | null;
  /** The filter run these values belong to. */
  runId: number | null;
}

export const IN_TUNE_INITIAL: InTuneState = { inTune: false, candSince: null, fastSince: null, inSince: null, hitAt: null, runId: null };

/** One posted frame for the decision, in cents against the target (folded for a voice). */
export interface InTuneInput {
  t: number;
  gap: SteadinessGap;
  runId: number;
  judgeCents: number | null;
  centreCents: number | null;
  holdCents: number | null;
}

export type InTuneParams = Pick<SteadinessParams, 'hystC' | 'enterDwellMs' | 'exitDwellMs' | 'hitMs' | 'fastExitFactor' | 'fastExitMs'>;

const notInTune = (s: InTuneState, runId: number | null): InTuneState => ({ ...s, inTune: false, candSince: null, fastSince: null, inSince: null, runId });

/**
 * The in-tune decision (§3.1 steps 13 and 14) for one posted frame. Enter when |judge| ≤ band − 5 for 100 ms; leave
 * when |judge| > band + 5 for 150 ms, or at once when the short centre is beyond 2 × band for 60 ms. Bridged gaps keep
 * everything (the hit timer runs on); a dimmed or hidden needle, or a new run, resets it. A hit: in tune for 800 ms
 * without a break and the median of those 800 ms within the band.
 */
export function inTuneStep(s: InTuneState, i: InTuneInput, bandCents: number, p: InTuneParams = IN_TUNE_PARAMS): InTuneState {
  if (s.hitAt !== null) return s;
  if (i.gap === 'dim' || i.gap === 'hidden') return s.inTune || s.candSince !== null || s.runId !== null ? notInTune(s, null) : s;
  if (i.gap === 'bridged') return s;
  let n: InTuneState = s.runId === i.runId ? s : notInTune(s, i.runId);
  if (i.judgeCents === null) return n;
  const t = i.t;
  const j = Math.abs(i.judgeCents);
  const lo = bandCents - p.hystC / 2;
  const hi = bandCents + p.hystC / 2;
  if (!n.inTune) {
    if (j <= lo) {
      const since = n.candSince ?? t;
      n = t - since >= p.enterDwellMs ? { ...n, inTune: true, candSince: null, fastSince: null, inSince: t } : { ...n, candSince: since };
    } else if (n.candSince !== null) {
      n = { ...n, candSince: null };
    }
  } else {
    if (i.centreCents !== null && Math.abs(i.centreCents) > bandCents * p.fastExitFactor) {
      const since = n.fastSince ?? t;
      n = t - since >= p.fastExitMs ? notInTune(n, n.runId) : { ...n, fastSince: since };
    } else if (n.fastSince !== null) {
      n = { ...n, fastSince: null };
    }
    if (n.inTune) {
      if (j > hi) {
        const since = n.candSince ?? t;
        n = t - since >= p.exitDwellMs ? notInTune(n, n.runId) : { ...n, candSince: since };
      } else if (n.candSince !== null) {
        n = { ...n, candSince: null };
      }
    }
  }
  if (n.inTune && n.inSince !== null && t - n.inSince >= p.hitMs && i.holdCents !== null && Math.abs(i.holdCents) <= bandCents) {
    n = { ...n, hitAt: t };
  }
  return n;
}

/** Cents of `midi` against `target`, folded to the nearest octave of the target when `fold` (a voice, R7). */
export function centsAgainst(midi: number, target: number, fold: boolean): number {
  const c = (midi - target) * 100;
  return fold ? c - 1200 * Math.round(c / 1200) : c;
}
