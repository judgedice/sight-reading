/**
 * `FakeNativeIpc`: a TypeScript model of the Rust engine behind `NativeIpc`, driven by a manual clock. It keeps the
 * parts of the engine the backend depends on and nothing else:
 *
 * - Clock: engine time is a frame counter moved only by `advance()`; the host clock and `performance.now()` move with
 *   it (at `hostPerEngineSec` host seconds per engine second, so a drifting device is one number). `clockSync` answers
 *   at the midpoint of a simulated round trip.
 * - Scheduler (design section 3): a voice starts at frame `round(t * engineRate)`; a voice behind the render head at
 *   call time starts at once and its id is returned in `late`; a step is two envelope points at the same time; at
 *   most 8 envelope points per voice and 64 sounding voices (a refused voice is reported as `rejected`); `stopVoices`
 *   and `cancel` end voices, `ended` is reported once per voice.
 * - Buffers: `putBuffer` and `decode` register mono buffers; the model refuses voices on unknown buffers.
 * - Input: `open({ input })` opens it or not; `setInput` and `releaseInput` switch it with the output running (engine
 *   time, buffers and voices continue) and are refused while a capture runs, as the engine refuses them; capture needs
 *   it open.
 * - Capture: while started, input frames come from `inputSignal` (or `queueInput`), are cut into packets of the
 *   requested size on the engine frame grid and delivered as `ArrayBuffer`s. `dropInput(n)` loses frames: the next
 *   packet carries the jump and `droppedBefore`.
 * - Everything the backend sent is recorded in `calls`, `voices` and `stopRequests`.
 */
import type { OutputMode } from '../../../../core/platform.ts';
import type {
  AudioEvent,
  CaptureStartInfo,
  CaptureStopInfo,
  ClockAnchor,
  ClockCheckReply,
  DebugHooks,
  LatencyReport,
  LoopbackEstimate,
  NativeIpc,
  OpenInfo,
  PermissionState,
  RouteFacts,
  VoiceGroup,
  VoiceSpec,
} from '../ipc.ts';
import { encodeCapturePacket } from '../wire.ts';

export interface RecordedVoice {
  group: VoiceGroup;
  spec: VoiceSpec;
  /** Engine session (count of `open` calls) the voice was scheduled in. */
  session: number;
  /** `round(t * engineRate)`: the frame the first sample is written to. */
  startFrame: number;
  /** The render head when the voice was scheduled. */
  scheduledAtFrame: number;
  /** The frame it actually started at: `startFrame`, or the head when it was late. */
  startedAtFrame: number | null;
  late: boolean;
  rejected: boolean;
  /** Frame at which the voice ended (ran out, stopped, cancelled), or null while it has not. */
  endedAtFrame: number | null;
  endReason: 'ran-out' | 'stopped' | 'cancelled' | 'stop-at' | 'closed' | null;
  /** Fade of the stop or cancel that ended it, seconds. */
  fadeSec: number | null;
}

export interface FakeNativeIpcOptions {
  engineRate?: number;
  outFrames?: number;
  /** Input buffer, frames; null opens no input. */
  inFrames?: number | null;
  route?: Partial<RouteFacts>;
  latency?: Partial<LatencyReport>;
  /** Engine host clock minus `performance.now()`, ms (default -7000: the two clocks differ). */
  hostMinusPerfMs?: number;
  /** Host seconds per engine second (1 = exact; 1.01 is a device that runs 1% slow). */
  hostPerEngineSec?: number;
  /** Simulated round trip of `clockSync`, ms. */
  syncRttMs?: number | ((call: number) => number);
  permission?: PermissionState;
  /** The error of `clockCheck` (null: could not measure). */
  clockError?: number | null;
  /** Decodes a file for `decode` (default: 0.4 s of 0.5 at 44.1 kHz). */
  decoder?: (file: Uint8Array) => { sampleRate: number; samples: Float32Array };
  loopback?: LoopbackEstimate;
}

const DEFAULT_ROUTE: RouteFacts = {
  inputUid: 'fake-in',
  outputUid: 'fake-out',
  inputTransport: 'built-in',
  outputTransport: 'built-in',
  processing: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
};

const DEFAULT_LATENCY: LatencyReport = {
  outputSec: 0.025,
  inputSec: 0.01,
  trust: 'A',
  parts: { outBuffer: 0.003, outDevice: 0.01, outSafety: 0.002, outStream: 0.01, inBuffer: 0.003, inDevice: 0.004, inSafety: 0.001, inStream: 0.002 },
};

const MAX_ENV_POINTS = 8;
const MAX_SOUNDING = 64;
const CLOCK_EVENT_SEC = 0.25;

interface Buf {
  sampleRate: number;
  samples: Float32Array;
}

interface Live extends RecordedVoice {
  endFrame: number;
}

export class FakeNativeIpc implements NativeIpc {
  readonly engineRate: number;
  /** Every command in call order, as `name` (or `name:group` where a group applies). */
  readonly calls: string[] = [];
  readonly voices: RecordedVoice[] = [];
  readonly stopRequests: { ids: number[]; fadeSec: number }[] = [];
  readonly buffers = new Map<number, Buf>();
  readonly droppedBufferIds: number[] = [];
  /** The `request` flag of every `permission` call. */
  readonly permissionCalls: boolean[] = [];
  /** What `open` was asked for, per call. */
  readonly openCalls: { input: boolean; outputMode: OutputMode }[] = [];
  /** The `enabled` flag of every `setInput` call. */
  readonly setInputCalls: boolean[] = [];
  readonly loopbackCalls: { clicks: number; timbre: string }[] = [];
  /** What `debugHooks` answers (off by default). */
  debug: DebugHooks = { enabled: false, seed: null };
  readonly debugSignals: { path: string | null; engineSec: number }[] = [];
  permissionState: PermissionState;
  clockError: number | null;
  loopback: LoopbackEstimate;
  /** Input of the open capture, engine frame to sample; zeros when absent. */
  inputSignal: ((frame: number) => number) | null = null;
  /** While true, packets wait in `held` instead of being delivered (a main thread that is busy). */
  holdPackets = false;
  readonly held: ArrayBuffer[] = [];
  /** Host seconds per engine second (1 = exact). */
  hostPerEngineSec: number;
  /** Rejects the next call of a command with this message. */
  private readonly failures = new Map<string, string>();

  private readonly o: FakeNativeIpcOptions;
  private perfMs = 1_000;
  private hostMs: number;
  private head = 0;
  private session = 0;
  private opened = false;
  private inputOn = false;
  private sink: ((e: AudioEvent) => void) | null = null;
  private live: Live[] = [];
  private syncCalls = 0;
  private nextClockEventAt = CLOCK_EVENT_SEC;
  private latency: LatencyReport;
  private route: RouteFacts;

  private capture: { onPacket: (b: ArrayBuffer) => void; packetFrames: number; originFrame: number; seq: number; first: number; droppedBefore: number; lost: number; pending: number[]; packets: number; frames: number; dropped: number } | null = null;
  private skip = 0;
  private queued: number[] = [];

  constructor(o: FakeNativeIpcOptions = {}) {
    this.o = o;
    this.engineRate = o.engineRate ?? 48000;
    this.hostPerEngineSec = o.hostPerEngineSec ?? 1;
    this.hostMs = this.perfMs + (o.hostMinusPerfMs ?? -7000);
    this.permissionState = o.permission ?? 'granted';
    this.clockError = o.clockError === undefined ? 0 : o.clockError;
    this.loopback = o.loopback ?? { found: 8, scheduled: 8, roundTripMs: 23.4, madMs: 0.1, snrDb: 20, predictedMs: 24 };
    this.latency = { ...DEFAULT_LATENCY, ...o.latency };
    this.route = { ...DEFAULT_ROUTE, ...o.route };
  }

  // ---- the manual clock ------------------------------------------------------------------------

  /** `performance.now()` for the backend under test. */
  perfNow = (): number => this.perfMs;

  /** The render head, engine seconds. */
  get engineNow(): number {
    return this.head / this.engineRate;
  }

  get headFrame(): number {
    return this.head;
  }

  /** Moves the engine, host and `performance.now()` clocks by `sec` engine seconds, quantum by quantum. */
  advance(sec: number): void {
    const quantum = this.o.outFrames ?? 128;
    let left = Math.round(sec * this.engineRate);
    while (left > 0) {
      const n = Math.min(quantum, left);
      left -= n;
      const from = this.head;
      this.head += n;
      const dMs = ((n / this.engineRate) * 1000) * this.hostPerEngineSec;
      this.hostMs += dMs;
      this.perfMs += dMs;
      this.stepCapture(from, n);
      this.stepVoices();
      if (this.opened && this.engineNow >= this.nextClockEventAt) {
        this.nextClockEventAt += CLOCK_EVENT_SEC;
        this.emit({ type: 'clock', anchor: this.anchor() });
      }
    }
  }

  private anchor(): ClockAnchor {
    return { engineSec: this.engineNow, hostMs: this.hostMs, rate: 1 / this.hostPerEngineSec };
  }

  // ---- test controls ---------------------------------------------------------------------------

  emit(e: AudioEvent): void {
    this.sink?.(e);
  }

  interrupt(reason: 'interrupted' | 'hidden' | 'track-ended' | 'device-change'): void {
    this.emit({ type: 'interruption', reason });
  }

  changeRoute(route: Partial<RouteFacts>, latency?: Partial<LatencyReport>): void {
    this.route = { ...this.route, ...route };
    if (latency) this.latency = { ...this.latency, ...latency };
    this.emit({ type: 'route', route: this.route, latency: this.latency, engineRate: this.engineRate });
  }

  failNext(command: string, message: string): void {
    this.failures.set(command, message);
  }

  /** Input frames to hand out on top of `inputSignal`, in order, before any signal frames. */
  queueInput(samples: ArrayLike<number>): void {
    for (let i = 0; i < samples.length; i++) this.queued.push(samples[i] as number);
  }

  /** The next `frames` input frames are lost: the following packet carries the jump and `droppedBefore`. */
  dropInput(frames: number): void {
    this.skip += frames;
  }

  /** Delivers the packets held while `holdPackets` was true. */
  releasePackets(): void {
    this.holdPackets = false;
    for (const p of this.held.splice(0)) this.capture?.onPacket(p);
  }

  /** Delivers a hand-made packet on the capture channel. */
  emitRawPacket(buf: ArrayBuffer): void {
    this.capture?.onPacket(buf);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  get captureRunning(): boolean {
    return this.capture !== null;
  }

  /** The voices of the current engine session that are still scheduled or sounding. */
  get liveVoices(): RecordedVoice[] {
    return this.live;
  }

  bufferData(id: number): Float32Array {
    const b = this.buffers.get(id);
    if (!b) throw new Error(`FakeNativeIpc: no buffer ${id}`);
    return b.samples;
  }

  // ---- the commands ----------------------------------------------------------------------------

  private async call<T>(name: string, run: () => T, needsOpen = true): Promise<T> {
    this.calls.push(name);
    const failure = this.failures.get(name);
    if (failure !== undefined) {
      this.failures.delete(name);
      throw new Error(failure);
    }
    if (needsOpen && !this.opened) throw new Error('audio is not open: call audio_open first');
    return run();
  }

  open(a: { input: boolean; outputMode: OutputMode; onEvent: (e: AudioEvent) => void }): Promise<OpenInfo> {
    return this.call(
      'open',
      () => {
        if (this.opened) this.endAll('closed');
        this.session++;
        this.opened = true;
        this.openCalls.push({ input: a.input, outputMode: a.outputMode });
        this.sink = a.onEvent;
        this.buffers.clear();
        this.head = 0;
        this.nextClockEventAt = CLOCK_EVENT_SEC;
        this.capture = null;
        this.inputOn = a.input && this.o.inFrames !== null;
        return this.openInfo();
      },
      false,
    );
  }

  /** The reply of `open` and `setInput`: the input fields follow the input switch. */
  private openInfo(): OpenInfo {
    const inFrames = this.inputOn ? (this.o.inFrames ?? 128) : null;
    return {
      engineRate: this.engineRate,
      outFrames: this.o.outFrames ?? 128,
      inFrames,
      inputRate: inFrames === null ? null : this.engineRate,
      route: this.route,
      latency: this.latency,
      clock: this.anchor(),
      sessionType: null,
    };
  }

  close(): Promise<void> {
    return this.call(
      'close',
      () => {
        this.endAll('closed');
        this.opened = false;
        this.capture = null;
        this.sink = null;
        this.buffers.clear();
      },
      false,
    );
  }

  releaseInput(): Promise<void> {
    return this.call('releaseInput', () => {
      this.switchInput(false);
    });
  }

  setInput(a: { enabled: boolean }): Promise<OpenInfo> {
    return this.call('setInput', () => {
      this.setInputCalls.push(a.enabled);
      this.switchInput(a.enabled);
      return this.openInfo();
    });
  }

  private switchInput(enabled: boolean): void {
    if (this.capture) throw new Error('a capture or loopback measurement is running: stop it before changing the input');
    this.inputOn = enabled && this.o.inFrames !== null;
  }

  permission(a: { request: boolean }): Promise<PermissionState> {
    return this.call(
      'permission',
      () => {
        this.permissionCalls.push(a.request);
        return this.permissionState;
      },
      false,
    );
  }

  clockSync(): Promise<{ engineSec: number; hostMs: number }> {
    return this.call('clockSync', () => {
      const rtt = typeof this.o.syncRttMs === 'function' ? this.o.syncRttMs(this.syncCalls) : (this.o.syncRttMs ?? 2);
      this.syncCalls++;
      // The engine reads its clocks at the midpoint of the round trip; time passes during the call.
      this.advance(rtt / 2000);
      const r = { engineSec: this.engineNow, hostMs: this.hostMs };
      this.advance(rtt / 2000);
      return r;
    });
  }

  clockCheck(a: { durSec: number }): Promise<ClockCheckReply> {
    return this.call('clockCheck', () => {
      void a.durSec;
      const e = this.clockError;
      return { error: e, consistent: e !== null, framesPerSec: e === null ? null : this.engineRate * (1 + e), expected: this.engineRate, inputDriftPpm: null };
    });
  }

  putBuffer(a: { id: number; sampleRate: number; samples: Float32Array }): Promise<void> {
    return this.call('putBuffer', () => {
      this.buffers.set(a.id, { sampleRate: a.sampleRate, samples: a.samples.slice() });
    });
  }

  decode(a: { id: number; file: ArrayBuffer }): Promise<{ sampleRate: number; samples: Float32Array }> {
    return this.call('decode', () => {
      const d = this.o.decoder ? this.o.decoder(new Uint8Array(a.file)) : { sampleRate: 44100, samples: new Float32Array(17640).fill(0.5) };
      this.buffers.set(a.id, { sampleRate: d.sampleRate, samples: d.samples.slice() });
      return d;
    });
  }

  dropBuffers(a: { ids: number[] }): Promise<void> {
    return this.call('dropBuffers', () => {
      for (const id of a.ids) {
        this.buffers.delete(id);
        this.droppedBufferIds.push(id);
      }
    });
  }

  schedule(a: { group: VoiceGroup; voices: VoiceSpec[] }): Promise<{ late: number[] }> {
    return this.call(`schedule:${a.group}`, () => {
      const late: number[] = [];
      for (const spec of a.voices) {
        const buf = this.buffers.get(spec.buffer);
        if (!buf) throw new Error(`audio_schedule: unknown buffer ${spec.buffer}`);
        if (spec.env && spec.env.length > MAX_ENV_POINTS) throw new Error(`audio_schedule: voice ${spec.id} has ${spec.env.length} envelope points (at most ${MAX_ENV_POINTS})`);
        if (spec.env) for (let i = 1; i < spec.env.length; i++) if ((spec.env[i] as [number, number])[0] < (spec.env[i - 1] as [number, number])[0]) throw new Error(`audio_schedule: voice ${spec.id} has a decreasing envelope`);
        if (this.live.some((v) => v.spec.id === spec.id)) throw new Error(`audio_schedule: voice id ${spec.id} is in use`);
        const startFrame = Math.round(spec.t * this.engineRate);
        const isLate = startFrame < this.head;
        const v: Live = {
          group: a.group,
          spec,
          session: this.session,
          startFrame,
          scheduledAtFrame: this.head,
          startedAtFrame: null,
          late: isLate,
          rejected: false,
          endedAtFrame: null,
          endReason: null,
          fadeSec: null,
          endFrame: this.endFrameOf(spec, buf, isLate ? this.head : startFrame),
        };
        this.voices.push(v);
        this.live.push(v);
        if (isLate) late.push(spec.id);
      }
      this.stepVoices();
      return { late };
    });
  }

  stopVoices(a: { ids: number[]; fadeSec: number }): Promise<void> {
    return this.call('stopVoices', () => {
      this.stopRequests.push({ ids: [...a.ids], fadeSec: a.fadeSec });
      const ended: number[] = [];
      for (const v of [...this.live]) {
        if (!a.ids.includes(v.spec.id)) continue;
        this.finish(v, 'stopped', a.fadeSec);
        ended.push(v.spec.id);
      }
      if (ended.length > 0) this.emit({ type: 'ended', ids: ended });
    });
  }

  cancel(a: { group: VoiceGroup; fadeSec: number }): Promise<void> {
    return this.call(`cancel:${a.group}`, () => {
      const ended: number[] = [];
      for (const v of [...this.live]) {
        if (v.group !== a.group) continue;
        this.finish(v, 'cancelled', a.fadeSec);
        ended.push(v.spec.id);
      }
      if (ended.length > 0) this.emit({ type: 'ended', ids: ended });
    });
  }

  captureStart(a: { packetFrames: number; onPacket: (packet: ArrayBuffer) => void }): Promise<CaptureStartInfo> {
    return this.call('captureStart', () => {
      if (!this.inputOn) throw new Error('audio_capture_start: no input is open (open with input: true, or audio_set_input)');
      if (this.capture) throw new Error('audio_capture_start: a capture is already running');
      this.capture = { onPacket: a.onPacket, packetFrames: a.packetFrames, originFrame: this.head, seq: 0, first: this.head, droppedBefore: 0, lost: 0, pending: [], packets: 0, frames: 0, dropped: 0 };
      return { originFrame: this.head, engineRate: this.engineRate, path: 'locked' as const };
    });
  }

  captureStop(): Promise<CaptureStopInfo> {
    return this.call('captureStop', () => {
      const c = this.capture;
      if (!c) throw new Error('audio_capture_stop: no capture is running');
      this.capture = null;
      return { packets: c.packets, frames: c.frames, droppedFrames: c.dropped, maxRingMs: 0 };
    });
  }

  debugHooks(): Promise<DebugHooks> {
    return this.call('debugHooks', () => this.debug, false);
  }

  debugSignal(a: { path: string | null; engineSec: number }): Promise<void> {
    return this.call('debugSignal', () => {
      if (!this.debug.enabled) throw new Error('audio_debug_signal: the test hooks are off (they need SR_AUDIO_DEVICE=fake and SR_E2E_HOOKS=1)');
      this.debugSignals.push(a);
    });
  }

  measureLoopback(a: { clicks: number; timbre: 'tick' }): Promise<LoopbackEstimate> {
    return this.call('measureLoopback', () => {
      this.loopbackCalls.push({ clicks: a.clicks, timbre: a.timbre });
      return this.loopback;
    });
  }

  // ---- the model -------------------------------------------------------------------------------

  private endFrameOf(spec: VoiceSpec, buf: Buf, start: number): number {
    const stopAt = spec.stopAt === undefined ? Infinity : Math.round(spec.stopAt * this.engineRate);
    if (spec.loop) return stopAt;
    const step = ((spec.rate ?? 1) * buf.sampleRate) / this.engineRate;
    const frames = Math.ceil(Math.max(0, buf.samples.length - (spec.offsetSec ?? 0) * buf.sampleRate) / step);
    return Math.min(stopAt, start + frames);
  }

  private finish(v: Live, reason: NonNullable<RecordedVoice['endReason']>, fadeSec: number | null): void {
    v.endedAtFrame = this.head;
    v.endReason = reason;
    v.fadeSec = fadeSec;
    this.live = this.live.filter((x) => x !== v);
  }

  private endAll(reason: 'closed'): void {
    for (const v of [...this.live]) this.finish(v, reason, null);
  }

  /** Starts voices whose frame has come, ends voices that ran out, reports `ended`, `rejected`. */
  private stepVoices(): void {
    const ended: number[] = [];
    const rejected: number[] = [];
    for (const v of [...this.live]) {
      if (v.startedAtFrame === null && v.startFrame <= this.head) {
        const sounding = this.live.filter((x) => x.startedAtFrame !== null).length;
        if (sounding >= MAX_SOUNDING) {
          v.rejected = true;
          this.finish(v, 'cancelled', null);
          rejected.push(v.spec.id);
          continue;
        }
        v.startedAtFrame = Math.max(v.startFrame, v.scheduledAtFrame);
      }
      if (v.startedAtFrame !== null && v.endFrame <= this.head) {
        this.finish(v, v.spec.stopAt !== undefined && Math.round(v.spec.stopAt * this.engineRate) <= v.endFrame ? 'stop-at' : 'ran-out', null);
        v.endedAtFrame = v.endFrame;
        ended.push(v.spec.id);
      }
    }
    if (rejected.length > 0) this.emit({ type: 'rejected', ids: rejected });
    if (ended.length > 0) this.emit({ type: 'ended', ids: ended });
  }

  private stepCapture(from: number, n: number): void {
    const c = this.capture;
    if (!c) return;
    for (let i = 0; i < n; i++) {
      const frame = from + i;
      if (frame < c.originFrame) continue;
      if (this.skip > 0) {
        // A lost frame: what was collected so far goes out, the loss is reported by the next packet.
        this.skip--;
        c.dropped++;
        c.lost++;
        if (c.pending.length > 0) this.flushPacket(c);
        continue;
      }
      const v = this.queued.length > 0 ? (this.queued.shift() as number) : this.inputSignal ? this.inputSignal(frame) : 0;
      if (c.pending.length === 0) {
        c.first = frame;
        c.droppedBefore = c.lost;
        c.lost = 0;
      }
      c.pending.push(v);
      if (c.pending.length >= c.packetFrames) this.flushPacket(c);
    }
  }

  private flushPacket(c: NonNullable<FakeNativeIpc['capture']>): void {
    const samples = Float32Array.from(c.pending);
    c.pending = [];
    const packet = encodeCapturePacket({ seq: c.seq++, firstFrame: c.first, droppedBefore: c.droppedBefore }, samples);
    if (this.holdPackets) this.held.push(packet);
    else c.onPacket(packet);
    c.packets++;
    c.frames += samples.length;
  }
}
