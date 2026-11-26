/**
 * The DSP worker's logic (01 §5.2, §5.6, §5.7, §9.3, §9.6; S1), separated from `dsp.worker.ts` so Node tests can drive
 * it with plain objects. One instance serves one take.
 *
 * Protocol
 * - Capture blocks arrive on the capture port (`{ v: 1, type: 'block', block }` from the worklet, buffers transferred)
 *   or, in relay mode, as `WorkerMessage` 'block' on the worker port. A port block is copied at once and its buffers
 *   go straight back on the port as a `CaptureReturn` (both transferred), so the worklet's pool never drains and the
 *   backend sees the port path work within `relayFallbackMs`, even before 'config' arrives.
 * - The capture port reaches the worker as the first entry of `MessageEvent.ports` on any worker message (the session
 *   transfers it with 'config'); `WorkerMessage` itself has no port member.
 * - Blocks that arrive before 'config' are queued (copies) and analysed once the config is in.
 * - 'config' builds the `DspPipeline` and the `LiveFollower` (`analysisRate` from the config; `t0` is bar 1 beat 1 on
 *   the output timeline, `latencyCompensationSec` the RTL) and replies 'ready'.
 * - Per analysed block: DSP events go to `LiveFollower.onDsp`, then `onClock(blockEnd)`; the follower events of the
 *   block are posted as one 'events' reply (none when empty).
 * - 'clicks' replaces `DspConfig.clicks` (arrival = click.t + RTL) when no block has been analysed yet; later it is
 *   too late for the pipeline (its click windows are fixed at construction) and the message is ignored
 *   (`lateClickMessages`).
 * - 'end' at input time t: the take ends once every block up to t has been analysed (blocks and 'end' travel on
 *   different ports, so their order is not guaranteed), or after `endWaitMs` without one. Then `flush(t)`,
 *   `LiveFollower.end`, `alignFinal(config, detected, liveOutcomeOf(liveEvents))`, a last 'events' reply that ends with
 *   `{ type: 'final', alignment }`, and 'done'.
 * - Count-in recheck (01 §7.7, R31, R55): when the config carries a `WorkerRecheckSpec` (port mode on speakers; see
 *   calibration/recheck.ts), every analysed block also feeds a `CountInRecheck`; its result is posted once as
 *   `WorkerReply` 'recheck' as soon as the count-in has been recorded, or at the end of the take (before 'done') if
 *   the take ended first. The session applies `decideRecheck` to it.
 * - 'done'.voiceReference comes from the final alignment's drift replay (`alignFinalWithReference`; 02 §4.5, E23).
 * - Pitch mode (Match a note, round 2): 'pitch' instead of 'config'. Only the `PitchAnalyzer` runs (no pipeline, no
 *   follower); each analysed block posts one 'pitch-frames' reply with the frames that fell due (about 50 Hz), none
 *   before `PitchModeConfig.fromT`. 'end' stops the analysis. No 'ready', 'events' or 'done'.
 */
import type { CaptureBlock, CaptureReturn, ClickSpec, PitchModeConfig, PitchModeFrame, WorkerMessage, WorkerReply, WorkerTrace } from '../../../core/platform.ts';
import type { ClockSeconds, DetectedNote, DspConfig, DspEvent, DspStats, EndReason, FinalAlignment, FollowConfig, FollowerEvent, LiveJudgment } from '../../../core/types.ts';
import { DspPipeline } from '../../../dsp/pipeline.ts';
import { PitchAnalyzer, widenRange } from '../../../dsp/pitch.ts';
import { STEADINESS_PRESETS, SteadinessFilter } from '../../../dsp/pitch-steadiness.ts';
// The worker is a composition point of its own (01 §2: live matcher and final alignment run in the DSP worker), so it
// reaches follow/ although platform/web otherwise may not (needs an eslint composition-root entry, see the S1 report).
import { LiveFollower, alignFinalWithReference, liveOutcomeOf, playerNotes } from '../../../follow/index.ts';
import { CountInRecheck, recheckResultOf, recheckSpecOf, type RecheckDetail } from '../../../calibration/index.ts';

/** A port-like object the core posts `CaptureReturn`s on. */
export interface ReturnPort {
  postMessage(message: CaptureReturn, transfer: ArrayBuffer[]): void;
}

export interface DspWorkerCoreDeps {
  /** Posts a reply to the main thread; `transfer` lists buffers to move. */
  post(reply: WorkerReply, transfer?: ArrayBuffer[]): void;
  /** Wall clock, ms (performance.now in the worker), for the per-block cost telemetry. */
  nowMs(): number;
  /** Schedules the end timeout; returns a cancel function. */
  setTimer(ms: number, fn: () => void): () => void;
  /** Give up waiting for blocks up to the end time after this long (default 400 ms). */
  endWaitMs?: number;
}

interface QueuedBlock {
  block: CaptureBlock;
}

/** Diagnostics trace frame spacing, seconds (about 50 Hz). */
const TRACE_STEP_SEC = 0.02;
const round = (x: number, d: number): number => {
  const k = 10 ** d;
  return Math.round(x * k) / k;
};

const p95 = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] as number;
};

const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/** Copies a block so the pooled buffers can go back to the worklet. */
export function copyBlock(b: CaptureBlock): CaptureBlock {
  return { v: 1, startT: b.startT, lowband: b.lowband.slice(), hiEnergy: b.hiEnergy.slice(), analysisRate: b.analysisRate, seq: b.seq };
}

/**
 * Match a note's pitch mode: the `PitchAnalyzer` frames (hop 128, about 8 ms) turned into one `PitchModeFrame` per
 * `stepSec`. The pitch is the mean of the voiced frames of the last `smoothSec`; it is steady once frames have been
 * voiced without a break for `steadyMs` and stayed within `steadySpreadCents` over that time. Frames before `fromT`
 * are analysed (the octave hysteresis and the run need them) but never posted. Every analyser frame also feeds the
 * needle's display filter (round 3, `dsp/pitch-steadiness.ts`), and each posted frame carries its reading.
 */
export class PitchModeTracker {
  readonly cfg: PitchModeConfig;
  private readonly analyzer: PitchAnalyzer;
  /** Voiced frames of the current run: time and fractional MIDI, oldest first. */
  private run: { t: number; midi: number }[] = [];
  private runStart: number | null = null;
  /** Time the next frame is due; frames are posted on a `stepSec` grid, so the mean rate is 1 / stepSec. */
  private nextDue = -Infinity;
  /** The needle's display filter (pitch mode only: a take never builds one). */
  private readonly filter: SteadinessFilter;

  constructor(cfg: PitchModeConfig) {
    this.cfg = cfg;
    this.filter = new SteadinessFilter(STEADINESS_PRESETS[cfg.steadiness]);
    const { minHz, maxHz } = widenRange(cfg.minHz, cfg.maxHz);
    this.analyzer = new PitchAnalyzer({
      analysisRate: cfg.analysisRate,
      windowSamples: cfg.windowSamples,
      minHz,
      maxHz,
      a4Hz: cfg.a4Hz,
      clarityThreshold: cfg.clarityThreshold,
      hopSamples: cfg.hopSamples,
    });
  }

  /** Analyses one block and returns the frames that fell due. */
  push(b: CaptureBlock): PitchModeFrame[] {
    if (b.analysisRate !== this.cfg.analysisRate) {
      throw new RangeError(`pitch mode: block analysisRate ${b.analysisRate} differs from ${this.cfg.analysisRate}`);
    }
    const out: PitchModeFrame[] = [];
    for (const e of this.analyzer.push(b.lowband, b.startT)) {
      const t = e.t as number;
      const voiced = e.midi !== null && Number.isFinite(e.midi) && e.rmsDb >= this.cfg.gateDb;
      this.filter.push(t * 1000, e.midi, Number.isFinite(e.rmsDb) ? e.rmsDb : -120);
      if (voiced) {
        if (this.runStart === null) this.runStart = t;
        this.run.push({ t, midi: e.midi as number });
        const keep = t - Math.max(this.cfg.smoothSec, this.cfg.steadyMs / 1000) - 1e-9;
        let k = 0;
        while (k < this.run.length && (this.run[k] as { t: number }).t < keep) k++;
        if (k > 0) this.run.splice(0, k);
      } else {
        this.run = [];
        this.runStart = null;
        this.analyzer.resetNote();
      }
      if (t < (this.cfg.fromT as number) || t < this.nextDue - 1e-6) continue;
      // On the grid; after a gap (or the first frame) the grid restarts here.
      this.nextDue = this.nextDue + this.cfg.stepSec < t ? t + this.cfg.stepSec : this.nextDue + this.cfg.stepSec;
      out.push(this.frameAt(t, e.rmsDb, voiced));
    }
    return out;
  }

  private frameAt(t: number, rmsDb: number, voiced: boolean): PitchModeFrame {
    const levelDb = Math.round((Number.isFinite(rmsDb) ? rmsDb : -120) * 10) / 10;
    const reading = this.filter.reading;
    if (!voiced || this.runStart === null) return { t: t as ClockSeconds, midi: null, cents: null, levelDb, steady: false, reading };
    let sum = 0;
    let n = 0;
    let lo = Infinity;
    let hi = -Infinity;
    const steadyFrom = t - this.cfg.steadyMs / 1000 - 1e-9;
    for (const f of this.run) {
      if (f.t >= t - this.cfg.smoothSec - 1e-9) {
        sum += f.midi;
        n++;
      }
      if (f.t >= steadyFrom) {
        lo = Math.min(lo, f.midi);
        hi = Math.max(hi, f.midi);
      }
    }
    const mean = sum / n;
    const midi = Math.round(mean);
    const cents = Math.round((mean - midi) * 1000) / 10;
    const held = t - this.runStart >= this.cfg.steadyMs / 1000 - 1e-9;
    const steady = held && (hi - lo) * 100 <= this.cfg.steadySpreadCents;
    return { t: t as ClockSeconds, midi, cents, levelDb, steady, reading };
  }
}

export class DspWorkerCore {
  private readonly deps: DspWorkerCoreDeps;
  private returnPort: ReturnPort | null = null;
  private dspCfg: DspConfig | null = null;
  private follow: FollowConfig | null = null;
  private dsp: DspPipeline | null = null;
  private follower: LiveFollower | null = null;
  private readonly queue: QueuedBlock[] = [];
  private analysed = 0;
  private lastBlockEnd = -Infinity;
  private readonly latest = new Map<number, DetectedNote>();
  private readonly liveEvents: FollowerEvent[] = [];
  private readonly blockMs: number[] = [];
  private signals = 0;
  private clipped = 0;
  private missing = 0;
  private pendingEnd: { t: ClockSeconds; reason: EndReason } | null = null;
  private cancelEndTimer: (() => void) | null = null;
  private finished = false;
  private recheck: CountInRecheck | null = null;
  private recheckPosted = false;
  /** Pitch mode (Match a note): set by 'pitch' instead of 'config'. */
  private pitch: PitchModeTracker | null = null;
  /** Port blocks whose buffers went back to the worklet. */
  returned = 0;
  /** 'clicks' messages that came after analysis had started. */
  lateClickMessages = 0;
  /** Blocks dropped because they started at or after the end time. */
  blocksAfterEnd = 0;
  /** The analysed low band, kept only with `DspConfig.traceAudio` (diagnostics export, opt-in). */
  private audioChunks: Float32Array[] = [];
  private audioStartT: number | null = null;

  constructor(deps: DspWorkerCoreDeps) {
    this.deps = deps;
  }

  /** The final alignment, once the take has ended (tests). */
  alignment: FinalAlignment | null = null;

  /** Adopt the capture port (the first transferred port of a worker message). */
  setCapturePort(port: ReturnPort): void {
    this.returnPort = port;
  }

  /** A message on the capture port (from the worklet). */
  onCaptureMessage(data: unknown): void {
    if (typeof data !== 'object' || data === null) return;
    const m = data as Partial<WorkerMessage>;
    if (m.type !== 'block' || !('block' in m) || !m.block) return;
    const b = m.block;
    const copy = copyBlock(b);
    if (this.returnPort) {
      const ret: CaptureReturn = { v: 1, type: 'return', lowband: b.lowband.buffer as ArrayBuffer, hiEnergy: b.hiEnergy.buffer as ArrayBuffer };
      this.returnPort.postMessage(ret, [ret.lowband, ret.hiEnergy]);
      this.returned++;
    }
    this.accept(copy);
  }

  /** A message on the worker port (from the main thread). */
  onMessage(m: WorkerMessage): void {
    try {
      switch (m.type) {
        case 'config':
          if (this.pitch) throw new Error('DSP worker: config received in pitch mode');
          this.configure(m.cfg, m.follow);
          break;
        case 'pitch':
          this.configurePitch(m.cfg);
          break;
        case 'block':
          // Relay mode: the block is ours (the backend copied it for us).
          this.accept(m.block);
          break;
        case 'clicks':
          this.setClicks(m.clicks);
          break;
        case 'end':
          if (this.pitch) {
            this.finished = true;
            this.queue.length = 0;
            break;
          }
          this.requestEnd(m.t, m.reason);
          break;
      }
    } catch (e) {
      this.deps.post({ v: 1, type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  private configure(cfg: DspConfig, follow: FollowConfig): void {
    if (this.dsp) throw new Error('DSP worker: config received twice');
    this.dspCfg = cfg;
    this.follow = follow;
    this.dsp = new DspPipeline(cfg);
    this.follower = new LiveFollower(follow);
    const spec = recheckSpecOf(cfg);
    if (spec && cfg.outputMode === 'speakers' && spec.countIn.length > 0) {
      this.recheck = new CountInRecheck(spec.inputRate, spec.countIn, {
        timbre: spec.timbre,
        template: spec.template,
        budget: follow.cfg.budget.calibration,
        ...(spec.silence ? { silence: spec.silence } : {}),
      });
    }
    if (this.pendingClicks) this.rebuild(this.pendingClicks);
    this.pendingClicks = null;
    this.deps.post({ v: 1, type: 'ready' });
    const queued = this.queue.splice(0);
    for (const q of queued) this.analyse(q.block);
    this.maybeFinish();
  }

  private configurePitch(cfg: PitchModeConfig): void {
    if (this.dsp || this.pitch) throw new Error('DSP worker: pitch mode after a config');
    this.pitch = new PitchModeTracker(cfg);
    const queued = this.queue.splice(0);
    for (const q of queued) this.analysePitch(q.block);
  }

  private analysePitch(b: CaptureBlock): void {
    const frames = (this.pitch as PitchModeTracker).push(b);
    this.analysed++;
    if (frames.length > 0) this.deps.post({ v: 1, type: 'pitch-frames', frames });
  }

  private setClicks(clicks: ClickSpec[]): void {
    if (this.analysed > 0) {
      this.lateClickMessages++;
      return;
    }
    if (!this.dspCfg || !this.follow) {
      this.pendingClicks = clicks;
      return;
    }
    this.rebuild(clicks);
  }

  private pendingClicks: ClickSpec[] | null = null;

  private rebuild(clicks: ClickSpec[]): void {
    const cfg = this.dspCfg as DspConfig;
    const rtl = (this.follow as FollowConfig).latencyCompensationSec;
    this.dspCfg = { ...cfg, clicks: clicks.map((c) => ({ arrival: ((c.t as number) + rtl) as ClockSeconds, accent: c.accent })) };
    this.dsp = new DspPipeline(this.dspCfg);
  }

  private accept(b: CaptureBlock): void {
    if (this.finished) return;
    if (this.pitch) {
      this.analysePitch(b);
      return;
    }
    if (this.pendingEnd && (b.startT as number) >= (this.pendingEnd.t as number)) {
      this.blocksAfterEnd++;
      this.maybeFinish(true);
      return;
    }
    if (!this.dsp) {
      this.queue.push({ block: b });
      return;
    }
    this.analyse(b);
    this.maybeFinish();
  }

  private analyse(b: CaptureBlock): void {
    const dsp = this.dsp as DspPipeline;
    const follower = this.follower as LiveFollower;
    const t0 = this.deps.nowMs();
    const blockEnd = ((b.startT as number) + b.lowband.length / b.analysisRate) as ClockSeconds;
    if (this.dspCfg?.traceAudio) {
      if (this.audioStartT === null) this.audioStartT = b.startT as number;
      this.audioChunks.push(b.lowband.slice());
    }
    const out: FollowerEvent[] = [];
    for (const ev of dsp.push(b)) this.onDspEvent(ev, follower, out);
    for (const ev of follower.onClock(blockEnd)) out.push(ev);
    this.blockMs.push(this.deps.nowMs() - t0);
    this.analysed++;
    this.lastBlockEnd = Math.max(this.lastBlockEnd, blockEnd as number);
    this.emit(out);
    if (this.recheck && !this.recheckPosted) {
      const r = this.recheck.push(b);
      if (r) this.postRecheck(r);
    }
  }

  /**
   * The try's diagnostics trace (round 2 detection): pitch frames decimated to about 50 Hz (one frame per
   * TRACE_STEP_SEC), every detected note, and the low band when `traceAudio` is on.
   */
  private trace(dsp: DspPipeline, all: DetectedNote[]): WorkerTrace {
    const frames: WorkerTrace['frames'] = { t: [], midi: [], clarity: [], levelDb: [] };
    let last = -Infinity;
    for (const f of dsp.frames()) {
      const t = f.t as number;
      if (t < last + TRACE_STEP_SEC - 1e-6) continue;
      last = t;
      frames.t.push(round(t, 3));
      frames.midi.push(f.midi === null ? null : round(f.midi, 2));
      frames.clarity.push(round(f.clarity, 2));
      frames.levelDb.push(round(Number.isFinite(f.rmsDb) ? f.rmsDb : -120, 1));
    }
    const out: WorkerTrace = { frames, detected: all };
    if (this.dspCfg?.traceAudio && this.audioStartT !== null) {
      let n = 0;
      for (const c of this.audioChunks) n += c.length;
      const samples = new Float32Array(n);
      let k = 0;
      for (const c of this.audioChunks) {
        samples.set(c, k);
        k += c.length;
      }
      out.audio = { rate: this.dspCfg.analysisRate, startT: this.audioStartT, samples };
    }
    return out;
  }

  private postRecheck(r: RecheckDetail): void {
    this.recheckPosted = true;
    this.deps.post({ v: 1, type: 'recheck', result: recheckResultOf(r) });
  }

  private onDspEvent(ev: DspEvent, follower: LiveFollower, out: FollowerEvent[]): void {
    if (ev.type === 'note-on' || ev.type === 'note-update' || ev.type === 'note-off') this.latest.set(ev.note.id, ev.note);
    else if (ev.type === 'signal') {
      this.signals++;
      if (ev.clipping) this.clipped++;
    } else if (ev.type === 'gap') this.missing = Math.max(this.missing, ev.missingBlocks);
    for (const fe of follower.onDsp(ev)) out.push(fe);
  }

  private emit(events: FollowerEvent[]): void {
    if (events.length === 0) return;
    for (const e of events) this.liveEvents.push(e);
    this.deps.post({ v: 1, type: 'events', events });
  }

  private requestEnd(t: ClockSeconds, reason: EndReason): void {
    if (this.pendingEnd || this.finished) return;
    this.pendingEnd = { t, reason };
    this.cancelEndTimer = this.deps.setTimer(this.deps.endWaitMs ?? 400, () => this.maybeFinish(true));
    this.maybeFinish();
  }

  /** Ends the take when every block up to the end time is in, or when `force` (timeout, block past the end). */
  private maybeFinish(force = false): void {
    const end = this.pendingEnd;
    if (!end || this.finished || !this.dsp) return;
    if (!force && this.lastBlockEnd < (end.t as number)) return;
    this.finish(end.t, end.reason);
  }

  private finish(t: ClockSeconds, reason: EndReason): void {
    this.finished = true;
    this.cancelEndTimer?.();
    const dsp = this.dsp as DspPipeline;
    const follower = this.follower as LiveFollower;
    const follow = this.follow as FollowConfig;
    const out: FollowerEvent[] = [];
    for (const ev of dsp.flush(t)) this.onDspEvent(ev, follower, out);
    for (const ev of follower.end(t, reason)) out.push(ev);
    for (const e of out) this.liveEvents.push(e);
    // Notes before the music and the app's own tones are not the player's (follow/own-playback.ts).
    const detected = playerNotes(follow, [...this.latest.values()].sort((a, b) => a.id - b.id));
    const { alignment, voiceReference } = alignFinalWithReference(follow, detected, liveOutcomeOf(this.liveEvents));
    this.alignment = alignment;
    if (this.recheck && !this.recheckPosted) this.postRecheck(this.recheck.finish());
    out.push({ type: 'final', alignment });
    this.deps.post({ v: 1, type: 'events', events: out });

    const live = new Map<number, LiveJudgment>();
    for (const e of this.liveEvents) if (e.type === 'judgment') live.set(e.judgment.expectedIdx, e.judgment);
    const stats: DspStats = { droppedBlocks: dsp.missingBlocks, maxQueueMs: 0, hopP95Ms: p95(this.blockMs), missingBlocks: this.missing };
    this.deps.post({
      v: 1,
      type: 'done',
      detected,
      live: [...live.values()].sort((a, b) => a.expectedIdx - b.expectedIdx),
      stats,
      signal: { medianClarity: median(detected.map((d) => d.clarity)), clippingFrac: this.signals > 0 ? this.clipped / this.signals : 0 },
      // 02 §4.5: from the final alignment's drift replay; null for families without relative pitch.
      voiceReference,
      trace: this.trace(dsp, [...this.latest.values()].sort((a, b) => a.id - b.id)),
    });
  }
}
