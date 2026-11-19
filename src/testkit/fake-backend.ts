/**
 * `FakeAudioBackend` (01 section 14 item 13): an `AudioBackend` that streams a Float32Array or WAV as
 * `CaptureBlock`s at real time or faster, on a virtual clock, with scripted clicks, `t0`, interruptions and
 * route changes. No Web Audio, no timers unless `run({ realtime: true })` is used.
 *
 * Time model: the backend owns a virtual clock (`now()`), moved only by `advance(sec)` / `run()`. Source sample
 * `i` is heard at clock time `sourceStartClock + i / sampleRate` (default: the clock time of `startCapture`).
 * Capture blocks follow the real worklet shape (01 section 7.2): every 2 render quanta (256 input frames),
 * 3 kHz 8th-order low-pass, decimation by `round(rate / 16000)` with phase carried across blocks, and `hiEnergy`
 * as energy per 1 ms sub-block of a 5 kHz 4th-order high-pass, using the production primitives in src/dsp/
 * (PhaseDecimator, HiBandEnergy). Blocks are contiguous: `startT[n+1] = startT[n] +
 * lowband[n].length / analysisRate` exactly, and `seq` counts up by one (except for scripted drops).
 */
import type {
  AudioBackend,
  AudioRouteInfo,
  CaptureBlock,
  ClickSpec,
  ClickTimbre,
  ClockSeconds,
  MessagePortLike,
  MetronomeSound,
  PlatformCapabilities,
  PlayNote,
  PlayNotesOptions,
  TakeSchedule,
  WorkerMessage,
} from '../core/platform.ts';
import { PhaseDecimator } from '../dsp/decimator.ts';
import { HiBandEnergy } from '../dsp/hiband.ts';
import { clickBurst } from './synth-min.ts';
import { decodeWav, toMono, type WavData } from './wav.ts';

export type InterruptionReason = 'interrupted' | 'hidden' | 'track-ended' | 'device-change';

export interface FakeBackendOptions {
  /** Capture source. A WAV is downmixed to mono. */
  source?: Float32Array | WavData | Uint8Array;
  /** Context sample rate, Hz. Required with a Float32Array source (default 48000); a WAV supplies its own. */
  sampleRate?: number;
  /** Initial clock value, seconds (default 10). */
  startClockSec?: number;
  /** Clock time of source sample 0. Default: the clock when `startCapture` is called. */
  sourceStartClock?: number;
  /**
   * Test-clock mode (01 section 13.4 `?testClock=1`): `scheduleTake` returns `t0 = captureOrigin + t0AfterCaptureSec`,
   * where captureOrigin is `sourceStartClock` if set, else the clock at the call.
   */
  t0AfterCaptureSec?: number;
  capabilities?: Partial<PlatformCapabilities>;
  route?: Partial<AudioRouteInfo>;
  /** Mix scheduled and calibration clicks into the capture, arriving `rtlSec` after their scheduled time. */
  loopback?: { rtlSec: number; gainDb: number; timbre?: ClickTimbre };
  /** Reported by `measureClockRate`; default exact. */
  clockRateError?: number;
  /** Report the main-thread relay as in use. */
  captureRelay?: boolean;
  /** Seqs to skip posting (the seq counter still advances), to test gap detection. */
  dropSeqs?: readonly number[];
  permission?: 'granted' | 'denied' | 'prompt' | 'unknown';
}

const QUANTUM = 128;
const FRAMES_PER_BLOCK = 2 * QUANTUM;

/** The legacy synth knows two timbres; the new sounds map onto them until `metronome` lands. */
const synthTimbre = (t: ClickTimbre): 'tick' | 'wood' => (t === 'wood' || t === 'woodblock' ? 'wood' : 'tick');

const clock = (s: number): ClockSeconds => s as ClockSeconds;

interface ScriptedEvent { at: number; fire: () => void }

export class FakeAudioBackend implements AudioBackend {
  readonly capabilities: PlatformCapabilities;
  captureRelay: boolean;
  /** Everything the session asked of the backend, for assertions. */
  readonly log = {
    unlocks: 0,
    scheduledTakes: [] as { params: TakeSchedule; t0: ClockSeconds; clicks: ClickSpec[] }[],
    cancelledTakes: 0,
    calibrationClicks: [] as { times: ClockSeconds[]; timbre: ClickTimbre }[],
    tones: [] as { hz: number; durSec: number; at: ClockSeconds }[],
    notePlays: [] as { notes: PlayNote[]; opts: PlayNotesOptions }[],
    clickPlays: [] as { times: ClockSeconds[]; sound: MetronomeSound; accents: boolean[] }[],
    stopSounds: 0,
    captureStarts: 0,
    captureStops: 0,
    closed: false,
    postedBlocks: 0,
  };

  readonly sampleRate: number;
  readonly analysisRate: number;
  private readonly decim: number;
  private readonly opts: FakeBackendOptions;
  private source: Float32Array;
  private clockSec: number;
  private route: AudioRouteInfo;
  private sink: ((m: WorkerMessage) => void) | MessagePortLike | null = null;
  private events: ScriptedEvent[] = [];
  private routeCbs = new Set<(r: AudioRouteInfo) => void>();
  private interruptCbs = new Set<(r: InterruptionReason) => void>();
  private clickBuffers: { startFrame: number; samples: Float32Array }[] = [];
  private pendingClicks: { t: number; accent: boolean; timbre: ClickTimbre }[] = [];
  private dropSeqs: Set<number>;

  // capture state
  private capturing = false;
  private captureOrigin = 0;
  private sourceOrigin = 0;
  private inFrame = 0; // next input frame index (from capture start)
  private seq = 0;
  // The real worklet primitives (01 section 7.2, P4a): same filters, phase carry and sub-block edges as production.
  private readonly decimator: PhaseDecimator;
  private readonly hiBand: HiBandEnergy;
  private readonly inBuf = new Float32Array(FRAMES_PER_BLOCK);
  private readonly lowBuf: Float32Array;
  private readonly hiBuf: Float32Array;

  constructor(opts: FakeBackendOptions = {}) {
    this.opts = opts;
    let rate = opts.sampleRate ?? 48000;
    const src = opts.source;
    if (src instanceof Float32Array) this.source = src;
    else if (src instanceof Uint8Array) {
      const w = decodeWav(src);
      rate = w.sampleRate;
      this.source = toMono(w);
    } else if (src) {
      rate = src.sampleRate;
      this.source = toMono(src);
    } else this.source = new Float32Array(0);
    if (opts.sampleRate !== undefined && opts.sampleRate !== rate && !(src instanceof Float32Array)) {
      throw new RangeError(`FakeAudioBackend: source is ${rate} Hz but sampleRate option is ${opts.sampleRate}`);
    }
    this.sampleRate = rate;
    this.decimator = new PhaseDecimator(rate);
    this.hiBand = new HiBandEnergy(rate);
    this.decim = this.decimator.factor;
    this.analysisRate = this.decimator.analysisRate;
    this.lowBuf = new Float32Array(Math.ceil(FRAMES_PER_BLOCK / this.decim) + 1);
    this.hiBuf = new Float32Array(this.hiBand.maxSubBlocks(FRAMES_PER_BLOCK));
    this.clockSec = opts.startClockSec ?? 10;
    this.captureRelay = opts.captureRelay ?? false;
    this.dropSeqs = new Set(opts.dropSeqs ?? []);
    this.capabilities = {
      platform: 'web', outputLatencyReported: true, wakeLock: true, serviceWorker: true,
      persistentStorage: 'best-effort', osFamily: 'linux', displayMode: 'browser', ...opts.capabilities,
    };
    this.route = {
      routeKey: 'fake-route', inputKind: 'built-in', outputMode: 'speakers', sampleRate: rate,
      appliedProcessing: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      reportedLatencySec: 0.02, ...opts.route,
    };
  }

  // ---- control surface for tests -------------------------------------------------------------

  /** Replace the source (for example between calibration and a take). Takes effect at the next `startCapture`. */
  setSource(samples: Float32Array): void {
    this.source = samples;
  }

  /** Script an interruption at a clock time. */
  scriptInterruption(atClock: number, reason: InterruptionReason): void {
    this.addEvent(atClock, () => this.interruptCbs.forEach((cb) => cb(reason)));
  }

  /** Script a route change at a clock time. */
  scriptRouteChange(atClock: number, patch: Partial<AudioRouteInfo>): void {
    this.addEvent(atClock, () => {
      this.route = { ...this.route, ...patch };
      this.routeCbs.forEach((cb) => cb(this.route));
    });
  }

  /** Move the clock forward, emitting capture blocks and firing scripted events in time order. */
  advance(sec: number): void {
    const target = this.clockSec + sec;
    for (;;) {
      const nextEv = this.events[0]?.at ?? Infinity;
      const nextBlock = this.capturing ? this.blockEndClock() : Infinity;
      const t = Math.min(nextEv, nextBlock);
      if (!(t <= target + 1e-12)) break;
      this.clockSec = Math.max(this.clockSec, t);
      if (nextEv <= nextBlock) (this.events.shift() as ScriptedEvent).fire();
      else this.emitBlock();
    }
    this.clockSec = Math.max(this.clockSec, target);
  }

  /** Advance the clock to an absolute time. */
  advanceTo(clockSec: number): void {
    if (clockSec > this.clockSec) this.advance(clockSec - this.clockSec);
  }

  /**
   * Stream until `untilClock` (default: the end of the source plus `tailSec`). `realtime: true` paces one block
   * per 5.33 ms of wall time with `setTimeout`; otherwise it runs as fast as possible.
   */
  async run(o: { realtime?: boolean; untilClock?: number; tailSec?: number } = {}): Promise<void> {
    const end = o.untilClock ?? (this.capturing ? this.sourceOrigin : this.clockSec) + this.source.length / this.sampleRate + (o.tailSec ?? 0);
    const step = FRAMES_PER_BLOCK / this.sampleRate;
    while (this.clockSec < end - 1e-12) {
      this.advance(Math.min(step, end - this.clockSec));
      if (o.realtime) await new Promise<void>((r) => setTimeout(r, step * 1000));
    }
  }

  // ---- AudioBackend ----------------------------------------------------------------------------

  async unlock(): Promise<AudioRouteInfo> {
    this.log.unlocks++;
    return this.route;
  }

  async permissionState(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
    return this.opts.permission ?? 'granted';
  }

  now(): ClockSeconds {
    return clock(this.clockSec);
  }

  audibleNow(): ClockSeconds {
    return clock(this.clockSec - (this.route.reportedLatencySec ?? 0));
  }

  async scheduleTake(p: TakeSchedule): Promise<{ t0: ClockSeconds; clicks: ClickSpec[] }> {
    const beatSec = 60 / p.bpm;
    const first = this.clockSec + p.leadSec;
    let t0 = first + p.countInBeats * beatSec;
    if (this.opts.t0AfterCaptureSec !== undefined) {
      t0 = (this.opts.sourceStartClock ?? this.clockSec) + this.opts.t0AfterCaptureSec;
    }
    const firstClick = t0 - p.countInBeats * beatSec;
    const clicks: ClickSpec[] = [];
    const total = p.countInBeats + Math.ceil(p.totalBeats);
    for (let i = 0; i < total; i++) {
      const countIn = i < p.countInBeats;
      if (p.mode === 'countInOnly' && !countIn) break;
      clicks.push({ beatIndex: i, accent: (p.accent ?? true) && i % p.beatsPerBar === 0, t: clock(firstClick + i * beatSec), countIn });
    }
    this.log.scheduledTakes.push({ params: p, t0: clock(t0), clicks });
    for (const c of clicks) this.pendingClicks.push({ t: c.t, accent: c.accent, timbre: p.timbre });
    this.mixClicks();
    return { t0: clock(t0), clicks };
  }

  cancelTake(): void {
    this.log.cancelledTakes++;
    this.pendingClicks = [];
    this.clickBuffers = [];
  }

  async startCapture(sink: MessagePortLike | ((m: WorkerMessage) => void)): Promise<void> {
    this.log.captureStarts++;
    this.sink = sink;
    this.capturing = true;
    this.captureOrigin = this.clockSec;
    this.sourceOrigin = this.opts.sourceStartClock ?? this.clockSec;
    this.inFrame = 0;
    this.seq = 0;
    this.decimator.reset();
    this.hiBand.reset();
    this.clickBuffers = [];
    this.mixClicks();
  }

  stopCapture(): void {
    if (this.capturing) this.log.captureStops++;
    this.capturing = false;
    this.sink = null;
  }

  async playCalibrationClicks(times: ClockSeconds[], timbre: ClickTimbre): Promise<void> {
    this.log.calibrationClicks.push({ times: [...times], timbre });
    for (const t of times) this.pendingClicks.push({ t, accent: true, timbre });
    this.mixClicks();
  }

  async playTone(hz: number, durSec: number, at: ClockSeconds): Promise<void> {
    this.log.tones.push({ hz, durSec, at });
  }

  async playNotes(notes: readonly PlayNote[], opts: PlayNotesOptions): Promise<void> {
    this.log.notePlays.push({ notes: notes.map((n) => ({ ...n })), opts: { ...opts } });
  }

  async playClicks(times: ClockSeconds[], sound: MetronomeSound, accents: boolean[]): Promise<void> {
    this.log.clickPlays.push({ times: [...times], sound, accents: [...accents] });
  }

  /** Cancels everything scheduled by the play methods; a running take is untouched. */
  stopSounds(): void {
    this.log.stopSounds++;
  }

  async measureClockRate(durSec: number): Promise<{ framesPerSec: number; expected: number }> {
    this.advance(durSec);
    return { framesPerSec: this.sampleRate * (1 + (this.opts.clockRateError ?? 0)), expected: this.sampleRate };
  }

  onRouteChange(cb: (r: AudioRouteInfo) => void): () => void {
    this.routeCbs.add(cb);
    return () => void this.routeCbs.delete(cb);
  }

  onInterruption(cb: (reason: InterruptionReason) => void): () => void {
    this.interruptCbs.add(cb);
    return () => void this.interruptCbs.delete(cb);
  }

  async close(): Promise<void> {
    this.log.closed = true;
    this.stopCapture();
  }

  audioInfo(): { contextSampleRate: number; contextRecreated: boolean; audioSessionType: string | null; clockRateError: number | null } {
    return { contextSampleRate: this.sampleRate, contextRecreated: false, audioSessionType: null, clockRateError: this.opts.clockRateError ?? null };
  }

  // ---- internals --------------------------------------------------------------------------------

  private addEvent(at: number, fire: () => void): void {
    this.events.push({ at, fire });
    this.events.sort((a, b) => a.at - b.at);
  }

  /** Clock time at which the next block's last frame has been heard. */
  private blockEndClock(): number {
    return this.captureOrigin + (this.inFrame + FRAMES_PER_BLOCK) / this.sampleRate;
  }

  /** Render pending loopback clicks into buffers positioned on the input frame axis. */
  private mixClicks(): void {
    const lb = this.opts.loopback;
    if (!lb || !this.capturing) {
      if (!lb) this.pendingClicks = [];
      return;
    }
    for (const c of this.pendingClicks) {
      const burst = clickBurst(synthTimbre(c.timbre ?? lb.timbre ?? 'tick'), c.accent, this.sampleRate);
      const g = 10 ** (lb.gainDb / 20) * (c.accent ? 10 ** (5 / 20) : 1);
      const samples = new Float32Array(burst.length);
      for (let i = 0; i < burst.length; i++) samples[i] = (burst[i] as number) * g;
      this.clickBuffers.push({ startFrame: Math.round((c.t + lb.rtlSec - this.captureOrigin) * this.sampleRate), samples });
    }
    this.pendingClicks = [];
  }

  private inputSample(frame: number): number {
    const si = frame - Math.round((this.sourceOrigin - this.captureOrigin) * this.sampleRate);
    let x = si >= 0 && si < this.source.length ? (this.source[si] as number) : 0;
    for (const b of this.clickBuffers) {
      const k = frame - b.startFrame;
      if (k >= 0 && k < b.samples.length) x += b.samples[k] as number;
    }
    return x;
  }

  private emitBlock(): void {
    for (let k = 0; k < FRAMES_PER_BLOCK; k++) this.inBuf[k] = this.inputSample(this.inFrame + k);
    // startT is the input position of the block's first decimated sample (an exact integer frame index).
    const startT = this.captureOrigin + this.decimator.nextOutputInputPos / this.sampleRate;
    const nLow = this.decimator.process(this.inBuf, this.lowBuf, 0);
    const nHi = this.hiBand.process(this.inBuf, this.hiBuf, 0);
    const low = this.lowBuf.subarray(0, nLow);
    const hi = this.hiBuf.subarray(0, nHi);
    this.inFrame += FRAMES_PER_BLOCK;
    const block: CaptureBlock = {
      v: 1, startT: clock(startT), lowband: Float32Array.from(low), hiEnergy: Float32Array.from(hi),
      analysisRate: this.analysisRate, seq: this.seq,
    };
    const drop = this.dropSeqs.has(this.seq);
    this.seq++;
    if (drop || !this.sink) return;
    this.log.postedBlocks++;
    const msg: WorkerMessage = { v: 1, type: 'block', block };
    if (typeof this.sink === 'function') this.sink(msg);
    else this.sink.postMessage(msg);
  }
}
