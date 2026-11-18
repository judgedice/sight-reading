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
 */
import type { CaptureBlock, CaptureReturn, ClickSpec, WorkerMessage, WorkerReply } from '../../../core/platform.ts';
import type { ClockSeconds, DetectedNote, DspConfig, DspEvent, DspStats, EndReason, FinalAlignment, FollowConfig, FollowerEvent, LiveJudgment } from '../../../core/types.ts';
import { DspPipeline } from '../../../dsp/pipeline.ts';
// The worker is a composition point of its own (01 §2: live matcher and final alignment run in the DSP worker), so it
// reaches follow/ although platform/web otherwise may not (needs an eslint composition-root entry, see the S1 report).
// eslint-disable-next-line boundaries/dependencies -- DSP worker composition (01 §2, §9.3)
import { LiveFollower, alignFinal, liveOutcomeOf } from '../../../follow/index.ts';

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
  /** Port blocks whose buffers went back to the worklet. */
  returned = 0;
  /** 'clicks' messages that came after analysis had started. */
  lateClickMessages = 0;
  /** Blocks dropped because they started at or after the end time. */
  blocksAfterEnd = 0;

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
          this.configure(m.cfg, m.follow);
          break;
        case 'block':
          // Relay mode: the block is ours (the backend copied it for us).
          this.accept(m.block);
          break;
        case 'clicks':
          this.setClicks(m.clicks);
          break;
        case 'end':
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
    if (this.pendingClicks) this.rebuild(this.pendingClicks);
    this.pendingClicks = null;
    this.deps.post({ v: 1, type: 'ready' });
    const queued = this.queue.splice(0);
    for (const q of queued) this.analyse(q.block);
    this.maybeFinish();
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
    const out: FollowerEvent[] = [];
    for (const ev of dsp.push(b)) this.onDspEvent(ev, follower, out);
    for (const ev of follower.onClock(blockEnd)) out.push(ev);
    this.blockMs.push(this.deps.nowMs() - t0);
    this.analysed++;
    this.lastBlockEnd = Math.max(this.lastBlockEnd, blockEnd as number);
    this.emit(out);
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
    const detected = [...this.latest.values()].sort((a, b) => a.id - b.id);
    const alignment = alignFinal(follow, detected, liveOutcomeOf(this.liveEvents));
    this.alignment = alignment;
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
      // 02 §4.5: the voice drift reference values come from the final alignment's replay, which FinalAlignment does
      // not expose; null until it does (non-voice families are null by definition).
      voiceReference: null,
    });
  }
}
