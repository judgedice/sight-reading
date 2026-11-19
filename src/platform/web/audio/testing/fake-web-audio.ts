/**
 * A scripted Web Audio world for Node tests of `WebAudioBackend`: fake AudioContext, worklet node (running the
 * real `CaptureCore` behind a real `MessageChannel`), MediaStream, devices, document and a manual wall clock.
 * Test-only; no browser globals are touched.
 */
import { CaptureCore, type CorePort } from '../capture-processor.ts';
import type {
  AudioContextLike,
  AudioNodeLike,
  BufferSourceLike,
  DocumentLike,
  EventTargetLike,
  GainNodeLike,
  MediaDevicesLike,
  MediaStreamLike,
  TrackLike,
  WebAudioDeps,
  WorkletNodeLike,
} from '../deps.ts';
import type { ClickBuffer } from '../metronome.ts';
import type { TrackSettingsLike } from '../route.ts';

type Listener = (ev: unknown) => void;

export class FakeTarget implements EventTargetLike {
  private readonly ls = new Map<string, Set<Listener>>();
  addEventListener(type: string, cb: Listener): void {
    let s = this.ls.get(type);
    if (!s) this.ls.set(type, (s = new Set()));
    s.add(cb);
  }
  removeEventListener(type: string, cb: Listener): void {
    this.ls.get(type)?.delete(cb);
  }
  dispatch(type: string): void {
    for (const cb of [...(this.ls.get(type) ?? [])]) cb({ type });
  }
  listenerCount(type: string): number {
    return this.ls.get(type)?.size ?? 0;
  }
}

export class FakeNode implements AudioNodeLike {
  readonly outs: AudioNodeLike[] = [];
  constructor(readonly kind: string) {}
  connect(dest: AudioNodeLike): unknown {
    this.outs.push(dest);
    return dest;
  }
  disconnect(): void {
    this.outs.length = 0;
  }
}

export class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = { value: 1 };
  constructor() {
    super('gain');
  }
}

export class FakeBufferSource extends FakeNode implements BufferSourceLike {
  buffer: ClickBuffer | null = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopped = false;
  /** Wall time (ms) at which start() was called. */
  startCallWallMs: number | null = null;
  constructor(private readonly world: FakeAudioWorld) {
    super('buffer-source');
  }
  start(when: number): void {
    this.startedAt = when;
    this.startCallWallMs = this.world.wallMs;
  }
  stop(): void {
    this.stopped = true;
  }
}

export class FakeWorkletNode extends FakeNode implements WorkletNodeLike {
  readonly port: MessagePort;
  readonly core: CaptureCore;
  private readonly inner: MessagePort;
  constructor(ctx: FakeContext, readonly options: AudioWorkletNodeOptions) {
    super('worklet');
    const ch = new MessageChannel();
    this.port = ch.port1;
    this.inner = ch.port2;
    this.core = new CaptureCore(ctx.sampleRate, this.inner as unknown as CorePort, () => ctx.frame);
  }
  closePorts(): void {
    this.port.close();
    this.inner.close();
  }
}

export class FakeSourceNode extends FakeNode {
  constructor(readonly stream: MediaStreamLike) {
    super('media-stream-source');
  }
}

export class FakeContext extends FakeTarget implements AudioContextLike {
  readonly sampleRate: number;
  frame = 0;
  state = 'suspended';
  baseLatency = 0.005;
  outputLatency = 0.02;
  readonly destination = new FakeNode('destination');
  readonly modules: string[] = [];
  readonly sources: FakeSourceNode[] = [];
  readonly gains: FakeGain[] = [];
  readonly bufferSources: FakeBufferSource[] = [];
  readonly workletNodes: FakeWorkletNode[] = [];
  outputTimestamp: { contextTime?: number; performanceTime?: number } | null = null;
  readonly audioWorklet = {
    addModule: async (url: string): Promise<void> => {
      this.world.calls.push('addModule');
      this.modules.push(url);
    },
  };

  constructor(private readonly world: FakeAudioWorld, readonly opts: { latencyHint: string; sampleRate?: number }) {
    super();
    this.sampleRate = opts.sampleRate ?? world.contextRate;
  }

  get currentTime(): number {
    return this.frame / this.sampleRate;
  }

  getOutputTimestamp(): { contextTime?: number; performanceTime?: number } {
    return this.outputTimestamp ?? {};
  }

  setState(s: string): void {
    this.state = s;
    this.dispatch('statechange');
  }

  resume(): Promise<void> {
    this.world.calls.push('resume');
    if (this.state !== 'closed' && this.state !== 'running') this.setState('running');
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.world.calls.push('close');
    if (this.state !== 'closed') this.setState('closed');
    for (const n of this.workletNodes) n.closePorts();
    return Promise.resolve();
  }

  createMediaStreamSource(stream: MediaStreamLike): AudioNodeLike {
    this.world.sourceRates.push(this.sampleRate);
    // Some browsers refuse a microphone whose rate differs from the context's (Firefox; Chrome on some devices).
    const trackRate = stream.getAudioTracks()[0]?.getSettings().sampleRate;
    if (this.world.strictSourceRate && typeof trackRate === 'number' && trackRate !== this.sampleRate) {
      throw Object.assign(new Error('Connecting AudioNodes from AudioContexts with different sample-rate is currently not supported.'), { name: 'NotSupportedError' });
    }
    const n = new FakeSourceNode(stream);
    this.sources.push(n);
    return n;
  }

  createGain(): GainNodeLike {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }

  createBuffer(_channels: number, length: number, _sampleRate: number): ClickBuffer {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }

  createBufferSource(): BufferSourceLike {
    const s = new FakeBufferSource(this.world);
    this.bufferSources.push(s);
    return s;
  }

  /** Render `quanta` 128-frame quanta through every worklet node fed by a live track. */
  render(quanta: number): void {
    for (let q = 0; q < quanta; q++) {
      if (this.state === 'running') {
        for (const node of this.workletNodes) {
          const fed = this.sources.some((s) => s.outs.includes(node) && s.stream.getAudioTracks().some((t) => t.readyState === 'live'));
          if (fed) {
            const chans = this.world.input(this.frame, 128, this.sampleRate);
            node.core.process(chans);
          } else node.core.process([]);
        }
        this.frame += 128;
      }
    }
  }
}

export class FakeTrack extends FakeTarget implements TrackLike {
  readyState = 'live';
  muted = false;
  constructor(public label: string, public settings: TrackSettingsLike) {
    super();
  }
  getSettings(): TrackSettingsLike {
    return { ...this.settings };
  }
  stop(): void {
    this.readyState = 'ended';
  }
  end(): void {
    this.readyState = 'ended';
    this.dispatch('ended');
  }
}

export interface WorldOptions {
  contextRate?: number;
  trackSettings?: TrackSettingsLike;
  label?: string;
  audioSession?: boolean;
  /** Frames per wall second relative to the context rate, minus 1, per context index (last value repeats). */
  clockRateErrors?: number[];
  /** Input generator: returns channel data for `n` frames starting at context frame `frame`. */
  input?: (frame: number, n: number, rate: number) => Float32Array[];
  permission?: string;
  /** `createMediaStreamSource` throws NotSupportedError when the track's rate differs from the context's. */
  strictSourceRate?: boolean;
}

/** The fake world: contexts, devices, timers and a manual wall clock. */
export class FakeAudioWorld {
  readonly calls: string[] = [];
  readonly contexts: FakeContext[] = [];
  readonly tracks: FakeTrack[] = [];
  readonly contextRate: number;
  readonly strictSourceRate: boolean;
  /** Context rate at each `createMediaStreamSource`. */
  readonly sourceRates: number[] = [];
  wallMs = 1000;
  gumCount = 0;
  readonly document = Object.assign(new FakeTarget(), { visibilityState: 'visible' }) as FakeTarget & { visibilityState: string };
  readonly window = new FakeTarget();
  readonly mediaDevices: FakeTarget & MediaDevicesLike;
  readonly audioSession: { type: string } | undefined;
  input: (frame: number, n: number, rate: number) => Float32Array[];
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private timerId = 0;
  private readonly opts: WorldOptions;

  constructor(opts: WorldOptions = {}) {
    this.opts = opts;
    this.contextRate = opts.contextRate ?? 48000;
    this.strictSourceRate = opts.strictSourceRate ?? false;
    this.input = opts.input ?? ((_f, n) => [new Float32Array(n)]);
    this.audioSession = opts.audioSession ? { type: 'auto' } : undefined;
    if (this.audioSession) {
      const s = this.audioSession;
      let v = s.type;
      Object.defineProperty(s, 'type', {
        get: () => v,
        set: (x: string) => {
          this.calls.push(`audioSession.type=${x}`);
          v = x;
        },
      });
    }
    const md = new FakeTarget() as FakeTarget & MediaDevicesLike;
    md.getUserMedia = async (): Promise<MediaStreamLike> => {
      this.calls.push('getUserMedia');
      this.gumCount++;
      const t = new FakeTrack(opts.label ?? 'Built-in Microphone', opts.trackSettings ?? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: this.contextRate, channelCount: 1 });
      this.tracks.push(t);
      return { getAudioTracks: () => [t] };
    };
    this.mediaDevices = md;
  }

  get ctx(): FakeContext {
    const c = this.contexts[this.contexts.length - 1];
    if (!c) throw new Error('no context');
    return c;
  }

  get deps(): WebAudioDeps {
    return {
      createContext: (o) => {
        this.calls.push(o.sampleRate ? `createContext@${o.sampleRate}` : 'createContext');
        const c = new FakeContext(this, o);
        this.contexts.push(c);
        return c;
      },
      createWorkletNode: (ctx, name, o) => {
        this.calls.push(`createWorkletNode:${name}`);
        const fc = ctx as FakeContext;
        const n = new FakeWorkletNode(fc, o);
        fc.workletNodes.push(n);
        return n as unknown as WorkletNodeLike;
      },
      mediaDevices: this.mediaDevices,
      audioSession: this.audioSession,
      permissions: { query: async () => ({ state: this.opts.permission ?? 'prompt' }) },
      document: this.document as unknown as DocumentLike,
      window: this.window,
      wallNowMs: () => this.wallMs,
      setTimeout: (fn, ms) => {
        const id = ++this.timerId;
        this.timers.push({ at: this.wallMs + ms, fn, id });
        return id;
      },
      clearTimeout: (h) => {
        this.timers = this.timers.filter((t) => t.id !== h);
      },
    };
  }

  pendingTimers(): number {
    return this.timers.length;
  }

  private clockRateError(): number {
    const errs = this.opts.clockRateErrors ?? [0];
    return errs[Math.min(this.contexts.length - 1, errs.length - 1)] ?? 0;
  }

  /**
   * Advance wall time by `ms`, rendering the current context's frames at its (possibly wrong) clock rate in
   * 2-quantum steps, firing due timers and letting MessagePort traffic through.
   */
  async advance(ms: number, opts: { flushEvery?: number } = {}): Promise<void> {
    const end = this.wallMs + ms;
    const flushEvery = opts.flushEvery ?? 1;
    let step = 0;
    while (this.wallMs < end - 1e-9) {
      const ctx = this.contexts[this.contexts.length - 1];
      const rate = (ctx?.sampleRate ?? this.contextRate) * (1 + this.clockRateError());
      const dt = Math.min((256 / rate) * 1000, end - this.wallMs);
      this.wallMs += dt;
      if (ctx && ctx.state === 'running' && dt >= (256 / rate) * 1000 - 1e-9) ctx.render(2);
      this.fireTimers();
      if (++step % flushEvery === 0) await flush();
    }
    this.fireTimers();
    await flush();
  }

  private fireTimers(): void {
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const t = this.timers[0];
      if (!t || t.at > this.wallMs + 1e-9) break;
      this.timers.shift();
      t.fn();
    }
  }
}

/** Let queued MessagePort deliveries and promise continuations run. */
export async function flush(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
}
