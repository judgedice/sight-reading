/**
 * The S1 take runner (01 §15 S1): WebAudioBackend -> capture worklet -> DSP worker (DspPipeline + LiveFollower) ->
 * follower events for the overlay -> final alignment in the worker -> grade -> AttemptRecord to IndexedDB and back.
 * No React; the dev screen drives it and paints the events.
 *
 * Clock: one AudioContext clock for the take (01 §7.1). With `testClock` the backend sets t0 to the first captured
 * frame plus `SLICE.testClockT0AfterCaptureSec` and the RTL is 0 (01 §13.4); otherwise t0 = now + lead + count-in and
 * the RTL is the typed dev value. Either way the take is practice: no measured calibration (R16).
 *
 * Composition root work (01 §4.2): this file reaches platform/web directly; see slice-take.ts.
 */
import type { AudioRouteInfo, WorkerLike, WorkerMessage, WorkerReply } from '../../core/platform.ts';
import type { AudioEnv, AttemptRecord, AttemptScore, ClockSeconds, Configs, FinalAlignment, FollowerEvent, OutputMode } from '../../core/types.ts';
// eslint-disable-next-line boundaries/dependencies -- S1 composition helper (01 §4.2 composition root)
import { WebAudioBackend } from '../../platform/web/audio/index.ts';
// eslint-disable-next-line boundaries/dependencies -- S1 composition helper (01 §4.2 composition root)
import { CAPTURE_WORKLET_URL } from '../../platform/web/audio/worklet-url.ts';
// eslint-disable-next-line boundaries/dependencies -- S1 composition helper (01 §4.2 composition root)
import { createDspWorker } from '../../platform/web/audio/dsp-worker-factory.ts';
// eslint-disable-next-line boundaries/dependencies -- S1 composition helper (01 §4.2 composition root)
import { readBrowserCapabilities } from '../../platform/web/capabilities.ts';
// eslint-disable-next-line boundaries/dependencies -- S1 composition helper (01 §4.2 composition root)
import { openStore } from '../../platform/web/store/index.ts';
import { SLICE, analysisRateFor, sliceAttemptRecord, sliceDspConfig, sliceFollowConfig, sliceGrade, type SliceTake } from './slice-take.ts';

export type SlicePhase = 'idle' | 'unlocking' | 'count-in' | 'listening' | 'finishing' | 'done' | 'error';

export interface SliceRunnerOptions {
  /** `?testClock=1`: t0 from the first captured frame, RTL 0. */
  testClock: boolean;
  /** Typed round-trip latency for a real mic (ignored with testClock), ms. */
  rtlMs: number;
  outputMode: OutputMode;
  /** Follower events in arrival order, one call per worker reply. */
  onEvents(events: FollowerEvent[]): void;
  onPhase(p: SlicePhase): void;
}

export interface SliceTiming {
  /** Context time of the first captured frame. */
  captureOrigin: number;
  t0: number;
  rtlSec: number;
  analysisRate: number;
  contextSampleRate: number;
  captureRelay: boolean;
}

export interface SliceResult {
  score: AttemptScore;
  alignment: FinalAlignment;
  record: AttemptRecord;
  /** The record as read back from IndexedDB. */
  reloaded: AttemptRecord | undefined;
  timing: SliceTiming;
  done: Extract<WorkerReply, { type: 'done' }>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class SliceRunner {
  readonly backend: WebAudioBackend;
  private readonly take: SliceTake;
  private readonly cfg: Configs;
  private readonly o: SliceRunnerOptions;
  private worker: WorkerLike | null = null;
  timing: SliceTiming | null = null;

  constructor(take: SliceTake, cfg: Configs, o: SliceRunnerOptions) {
    this.take = take;
    this.cfg = cfg;
    this.o = o;
    this.backend = new WebAudioBackend({
      capabilities: readBrowserCapabilities(),
      workletUrl: CAPTURE_WORKLET_URL,
      outputMode: o.outputMode,
      ...(o.testClock ? { testClockT0AfterCaptureSec: SLICE.testClockT0AfterCaptureSec } : {}),
    });
  }

  /** Call synchronously from the gesture handler: unlock runs its synchronous part first (05 W1). */
  start(): Promise<SliceResult> {
    this.o.onPhase('unlocking');
    const unlocked = this.backend.unlock();
    return this.run(unlocked).catch((e: unknown) => {
      this.o.onPhase('error');
      this.dispose();
      throw e;
    });
  }

  private async run(unlocked: Promise<AudioRouteInfo>): Promise<SliceResult> {
    const routeInfo = await unlocked;
    const be = this.backend;
    const take = this.take;
    const worker = createDspWorker();
    this.worker = worker;
    let resolveDone: (d: Extract<WorkerReply, { type: 'done' }>) => void = () => undefined;
    let rejectDone: (e: Error) => void = () => undefined;
    const doneP = new Promise<Extract<WorkerReply, { type: 'done' }>>((res, rej) => {
      resolveDone = res;
      rejectDone = rej;
    });
    let alignment: FinalAlignment | null = null;
    worker.onmessage = (ev: { data: WorkerReply }) => {
      const r = ev.data;
      if (r.type === 'events') {
        for (const e of r.events) if (e.type === 'final') alignment = e.alignment;
        this.o.onEvents(r.events);
      } else if (r.type === 'done') resolveDone(r);
      else if (r.type === 'error') rejectDone(new Error(r.message));
    };

    const ch = new MessageChannel();
    await be.startCapture(ch.port1);
    const info = be.audioInfo();
    const analysisRate = analysisRateFor(info.contextSampleRate);
    const rtlSec = this.o.testClock ? 0 : this.o.rtlMs / 1000;
    const sched = await be.scheduleTake({
      leadSec: SLICE.leadSec,
      bpm: take.bpm,
      beatsPerBar: take.beatsPerBar,
      countInBeats: take.countInBeats,
      totalBeats: take.totalBeats,
      mode: 'audible',
      timbre: SLICE.timbre,
      accentDb: SLICE.accentDb,
    });
    const t0 = sched.t0 as number;
    const config: WorkerMessage = {
      v: 1,
      type: 'config',
      cfg: sliceDspConfig(take, this.cfg, { analysisRate, outputMode: this.o.outputMode, clicks: sched.clicks, rtlSec }),
      follow: sliceFollowConfig(take, this.cfg, { t0: t0 as ClockSeconds, rtlSec, analysisRate }),
    };
    worker.postMessage(config, [ch.port2]);
    this.timing = {
      captureOrigin: (be.captureOrigin() ?? 0) as number,
      t0,
      rtlSec,
      analysisRate,
      contextSampleRate: info.contextSampleRate,
      captureRelay: be.captureRelay,
    };
    this.o.onPhase('count-in');

    // The take ends one beat after the last note's written end (R14), on the input timeline.
    const endT = t0 + rtlSec + take.endSec;
    while ((be.now() as number) < t0) await sleep(20);
    this.o.onPhase('listening');
    while ((be.now() as number) < endT + 0.1) await sleep(20);
    this.o.onPhase('finishing');
    worker.postMessage({ v: 1, type: 'end', t: endT as ClockSeconds, reason: { reason: 'complete' } });
    const done = await doneP;
    be.stopCapture();
    if (!alignment) throw new Error('slice: no final alignment');
    const fin: FinalAlignment = alignment;
    this.timing.captureRelay = be.captureRelay;

    const calibrationMeasured = false;
    const score = sliceGrade(take, this.cfg, { alignment: fin, detected: done.detected, signal: done.signal, calibrationMeasured });
    const stats = be.captureStats();
    const route = be.audioInfo();
    const audioEnv: AudioEnv = {
      platform: be.capabilities.platform,
      osFamily: be.capabilities.osFamily,
      displayMode: be.capabilities.displayMode,
      appBuild: 'dev-slice',
      coreVersion: 'dev',
      inputPath: 'mic',
      metronomeMode: 'audible',
      clickTimbre: SLICE.timbre,
      outputMode: this.o.outputMode,
      route: { inputKind: routeInfo.inputKind, sampleRate: routeInfo.sampleRate, appliedProcessing: routeInfo.appliedProcessing },
      contextSampleRate: route.contextSampleRate,
      contextRecreated: route.contextRecreated,
      clockRateError: route.clockRateError,
      audioSessionType: route.audioSessionType,
      latencyCompensationMs: rtlSec * 1000,
      calibrationMethod: 'none',
      captureRelay: be.captureRelay,
      droppedBlocks: stats.droppedBlocks,
      maxQueueMs: stats.maxQueueMs,
      dspHopP95Ms: done.stats.hopP95Ms,
      gateFailures: ['calibration-unmeasured'],
    };
    const record = sliceAttemptRecord(take, this.cfg, {
      id: `slice-${Math.round(t0 * 1e6)}-${Math.round(be.now() * 1e3)}`,
      createdAt: new Date().toISOString(),
      score,
      alignment: fin,
      detected: done.detected,
      signal: done.signal,
      calibrationMeasured,
      live: done.live,
      rtlSec,
      outputMode: this.o.outputMode,
      audioEnv,
    });
    const store = await openStore();
    let reloaded: AttemptRecord | undefined;
    try {
      await store.repos.attempts.add(record);
      reloaded = await store.repos.attempts.byId(record.id);
    } finally {
      store.close();
    }
    this.o.onPhase('done');
    this.dispose();
    return { score, alignment: fin, record, reloaded, timing: this.timing, done };
  }

  /** Context time for paint stamps (audio clock). */
  now(): number {
    return this.backend.now() as number;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
