/**
 * `WebAudioBackend` (01 §5.2, §7.1, §7.2, §7.6, §7.8, §7.9; 05 W1 to W4, W7, W9, W10; P11).
 *
 * Unlock order (W1, 01 §7.1): inside the gesture, synchronously and with nothing awaited first, set
 * `navigator.audioSession.type = 'play-and-record'` if present, create the AudioContext and call `resume()`.
 * Only then await `getUserMedia` (all processing off, mono), add the worklet, build the graph, read
 * `getSettings()` and run the sample-rate guard (W3: a reported track rate that differs from the context rate
 * recreates the context once). One stream and one context live for the whole practice session (W2): a later
 * `unlock()` reuses them.
 *
 * Graph (01 §7.2): stream -> MediaStreamSource -> capture worklet -> GainNode(0) -> destination, so WebKit pulls
 * the worklet; metronome clicks -> click bus -> destination.
 *
 * Capture delivery: a MessagePort sink is transferred into the worklet, which posts blocks straight to the DSP
 * worker. If no buffer comes back on that port within `relayFallbackMs` (500 ms), the worklet hands the port back
 * and the main thread relays (`captureRelay`). A function sink is always relayed. The relay copies each block for
 * the sink and returns the pooled buffers to the worklet at once.
 *
 * Voids (01 §7.9): the backend reports interruptions (context `interrupted` or unrequested `suspended`/`closed`,
 * track `mute`, page hidden, `pagehide`, `freeze`), track `ended`, and `devicechange` during capture through
 * `onInterruption`; backlog above `backlogVoidMs` (R32: 120 ms of queued audio) and pool-empty drops through
 * `onCaptureFault`. The policy (which state voids) belongs to the session (IOS2).
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
  OutputMode,
  PlayNote,
  PlayNotesOptions,
  PlatformCapabilities,
  TakeSchedule,
  WorkerMessage,
} from '../../../core/platform.ts';
import budgetJson from '../../../../config/measurement-budget.json';
import { browserAudioDeps, type AudioContextLike, type GainNodeLike, type TrackLike, type WebAudioDeps, type WorkletNodeLike, type MediaStreamLike, type AudioNodeLike } from './deps.ts';
import type { ClickBuffer } from './metronome.ts';
import { ListenVoiceCache, LISTEN_BUS_GAIN } from './listen-voice.ts';
import { CALIBRATION_ACCENT_DB, Metronome } from './metronome.ts';
import { CAPTURE_PROCESSOR_NAME, FRAMES_PER_BLOCK, type FromWorklet, type ToWorklet } from './protocol.ts';
import { appliedProcessingOf, inputKindOf, routeKeyOf } from './route.ts';

export type InterruptionReason = 'interrupted' | 'hidden' | 'track-ended' | 'device-change';

/** Capture problems that void a take (01 §7.9): `backlog` (R32) and `capture-gap` (pool-empty drop or lost relay). */
export type CaptureFault = { kind: 'backlog'; queueMs: number } | { kind: 'capture-gap'; seq: number };

export interface CaptureBudget {
  poolSize: number;
  relayFallbackMs: number;
  backlogVoidMs: number;
  clockRateMaxError: number;
}

/** Defaults from config/measurement-budget.json (01 §7.2, §7.8; R32). */
export const DEFAULT_CAPTURE_BUDGET: CaptureBudget = {
  poolSize: budgetJson.capture.poolSize,
  relayFallbackMs: budgetJson.capture.relayFallbackMs,
  backlogVoidMs: budgetJson.capture.backlogVoidMs,
  clockRateMaxError: budgetJson.calibration.clockRateMaxError,
};

export interface WebAudioBackendOptions {
  capabilities: PlatformCapabilities;
  /** URL of the bundled `capture.worklet.ts` (see `worklet-url.ts` for the Vite default). */
  workletUrl: string;
  deps?: WebAudioDeps;
  budget?: Partial<CaptureBudget>;
  /** Always use the main-thread relay (01 §7.2 fallback; tests and diagnostics). */
  forceRelay?: boolean;
  /** Declared output mode, part of the route key (default speakers). */
  outputMode?: OutputMode;
  /** Linear gain of a normal click. */
  clickGain?: number;
  /**
   * Test clock (01 §13.4 `?testClock=1`): `scheduleTake` sets `t0` to the context time of the first captured
   * frame plus this many seconds. Capture must be running.
   */
  testClockT0AfterCaptureSec?: number;
  /** Stats cadence from the worklet, blocks (default 8, about 43 ms at 48 kHz). */
  statsEvery?: number;
  /** Give up waiting for a worklet `frames` reply after this, ms (default 2000). */
  framesTimeoutMs?: number;
}

export interface CaptureStats {
  postedBlocks: number;
  droppedBlocks: number;
  maxQueueMs: number;
  relay: boolean;
}

export type ClockRateCheck = { ok: boolean; error: number; recreated: boolean };

const GUM_CONSTRAINTS = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
} as const;

interface CaptureState {
  relay: boolean;
  /** Where relayed blocks go: the session's callback, or the port handed back by the worklet. */
  relaySink: ((m: WorkerMessage) => void) | MessagePortLike | null;
  awaitingPortBack: boolean;
  portOk: boolean;
  timer: unknown;
  originFrame: number | null;
  started: () => void;
  posted: number;
  dropped: number;
  maxQueueMs: number;
  backlogFired: boolean;
  gapFired: boolean;
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export class WebAudioBackend implements AudioBackend {
  readonly capabilities: PlatformCapabilities;
  private readonly deps: WebAudioDeps;
  private readonly workletUrl: string;
  private readonly budget: CaptureBudget;
  private readonly opts: WebAudioBackendOptions;

  private ctx: AudioContextLike | null = null;
  private node: WorkletNodeLike | null = null;
  private srcNode: AudioNodeLike | null = null;
  private zeroGain: GainNodeLike | null = null;
  private clickBus: GainNodeLike | null = null;
  /** Tone and note sources not yet ended, so `stopSounds` can cancel them. */
  private readonly liveTones = new Set<{ stop(): void; disconnect(): void; onended: (() => void) | null }>();
  /** Context time after which the running take has no more clicks; sounds are refused until then. */
  private takeEndsAt = 0;
  /** The take's clicks. `stopSounds` never touches it. */
  private metronome: Metronome | null = null;
  /** Previews, lead-ins and calibration clicks: their own scheduler, so `stopSounds` cannot cancel a take. */
  private soundMetronome: Metronome | null = null;
  /** The Listen voice's own gain, about -12 dBFS peak, feeding the click bus at unity (click volume is set per click, not on the bus). */
  private listenBus: GainNodeLike | null = null;
  private readonly listenVoice = new ListenVoiceCache();
  private stream: MediaStreamLike | null = null;
  private track: TrackLike | null = null;
  private route: AudioRouteInfo | null = null;
  private outputMode: OutputMode;
  private unlocking: Promise<AudioRouteInfo> | null = null;
  private closing = false;
  private seenRunning = false;

  private contextRecreated = false;
  private clockRateError: number | null = null;
  private audioSessionType: string | null = null;
  private trackSampleRate: number | null = null;

  private cap: CaptureState | null = null;
  private lastStats: CaptureStats = { postedBlocks: 0, droppedBlocks: 0, maxQueueMs: 0, relay: false };
  private relayUsed: boolean;
  private framesId = 0;
  private readonly framesWaiters = new Map<number, (r: { frames: number; wallMs: number }) => void>();

  private readonly routeCbs = new Set<(r: AudioRouteInfo) => void>();
  private readonly interruptCbs = new Set<(r: InterruptionReason) => void>();
  private readonly faultCbs = new Set<(f: CaptureFault) => void>();
  private readonly cleanups: (() => void)[] = [];
  private globalListeners = false;
  private inputEnabled = true;
  private readonly moduleLoaded = new WeakSet<AudioContextLike>();

  constructor(opts: WebAudioBackendOptions) {
    this.opts = opts;
    this.capabilities = opts.capabilities;
    this.workletUrl = opts.workletUrl;
    this.deps = opts.deps ?? browserAudioDeps();
    this.budget = { ...DEFAULT_CAPTURE_BUDGET, ...opts.budget };
    this.outputMode = opts.outputMode ?? 'speakers';
    this.relayUsed = opts.forceRelay ?? false;
  }

  /** True once a take's capture used the main-thread relay (AudioEnv.captureRelay). */
  get captureRelay(): boolean {
    return this.relayUsed;
  }

  // ---- unlock (W1, W2, W3) ------------------------------------------------------------------------

  unlock(): Promise<AudioRouteInfo> {
    if (this.unlocking) return this.unlocking;
    const ctxAlive = this.ctx !== null && this.ctx.state !== 'closed';
    if (ctxAlive && this.node && (this.trackLive() || !this.inputEnabled)) {
      // W2: reuse the session's context and stream; a resume here is still inside the gesture.
      const ctx = this.ctx as AudioContextLike;
      if (ctx.state !== 'running') ctx.resume().catch(() => undefined);
      return Promise.resolve(this.currentRoute());
    }
    // ---- synchronous part: nothing may be awaited before resume() (W1) ----
    this.closing = false;
    const session = this.deps.audioSession;
    if (session) {
      try {
        session.type = 'play-and-record';
      } catch {
        // Older WebKit throws on unknown types; the readback below records what stuck.
      }
      this.audioSessionType = typeof session.type === 'string' ? session.type : null;
    }
    let ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') {
      ctx = this.deps.createContext({ latencyHint: 'interactive' });
      this.adoptContext(ctx);
    }
    const resumed = ctx.resume();
    resumed.catch(() => undefined);
    // ---- asynchronous part ----
    const p = this.completeUnlock(ctx).finally(() => {
      this.unlocking = null;
    });
    this.unlocking = p;
    return p;
  }

  private async completeUnlock(ctx: AudioContextLike): Promise<AudioRouteInfo> {
    if (this.inputEnabled && !this.trackLive()) {
      const md = this.deps.mediaDevices;
      if (!md) throw new Error('getUserMedia is not available');
      const stream = await md.getUserMedia({ audio: { ...GUM_CONSTRAINTS.audio } });
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('getUserMedia returned no audio track');
      this.setStream(stream, track);
      // A new stream needs a new source node.
      this.teardownGraph();
    }
    this.installGlobalListeners();
    if (!this.node) await this.buildGraph(ctx);
    const settings = this.track?.getSettings() ?? {};
    this.trackSampleRate = finite(settings.sampleRate) ? settings.sampleRate : null;
    // W3 (1): a reported track rate that differs from the context rate recreates the context once.
    if (this.trackSampleRate !== null && this.trackSampleRate !== (this.ctx as AudioContextLike).sampleRate && !this.contextRecreated) {
      await this.recreateContext(this.trackSampleRate);
    }
    this.route = this.computeRoute();
    return this.route;
  }

  /**
   * Stops the current input track and opens a fresh one on the same context, rebuilding the capture graph (the
   * worklet module stays loaded). Test clock only (01 §13.4): Chromium's fake capture device plays its WAV from the
   * start of each opened stream, so reopening right before `startCapture` lines the file up with the capture origin.
   * Capture must not be running.
   */
  async reopenInput(): Promise<AudioRouteInfo> {
    const ctx = this.ctx;
    if (!ctx || !this.track) throw new Error('WebAudioBackend: call unlock() first');
    if (this.cap) this.stopCapture();
    const old = this.track;
    this.track = null;
    old.stop();
    for (const t of this.stream?.getAudioTracks() ?? []) if (t !== old) t.stop();
    this.stream = null;
    this.teardownGraph();
    return this.completeUnlock(ctx);
  }

  private setStream(stream: MediaStreamLike, track: TrackLike): void {
    this.stream = stream;
    this.track = track;
    const onEnded = (): void => {
      if (track === this.track) this.fireInterruption('track-ended');
    };
    const onMute = (): void => {
      if (track === this.track) this.fireInterruption('interrupted');
    };
    track.addEventListener('ended', onEnded);
    track.addEventListener('mute', onMute);
    this.cleanups.push(() => {
      track.removeEventListener('ended', onEnded);
      track.removeEventListener('mute', onMute);
    });
  }

  private trackLive(): boolean {
    return this.track !== null && this.track.readyState === 'live';
  }

  private adoptContext(ctx: AudioContextLike): void {
    this.ctx = ctx;
    this.seenRunning = ctx.state === 'running';
    const onState = (): void => {
      if (ctx !== this.ctx || this.closing) return;
      const st = ctx.state;
      if (st === 'running') this.seenRunning = true;
      else if (st === 'interrupted') this.fireInterruption('interrupted');
      else if ((st === 'suspended' || st === 'closed') && this.seenRunning) this.fireInterruption('interrupted');
    };
    ctx.addEventListener('statechange', onState);
    this.cleanups.push(() => ctx.removeEventListener('statechange', onState));
  }

  private async buildGraph(ctx: AudioContextLike): Promise<void> {
    // A context evaluates the module once; registering the processor twice would throw in the worklet.
    if (!this.moduleLoaded.has(ctx)) {
      await ctx.audioWorklet.addModule(this.workletUrl);
      this.moduleLoaded.add(ctx);
    }
    if (ctx !== this.ctx) return;
    const node = this.deps.createWorkletNode(ctx, CAPTURE_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    node.port.onmessage = (ev: MessageEvent) => this.onWorklet(node, ev.data as FromWorklet);
    // Output only (practise without listening, R13): no stream, so the worklet has no input and nothing is captured.
    const src = this.stream ? ctx.createMediaStreamSource(this.stream) : null;
    src?.connect(node);
    const zero = ctx.createGain();
    zero.gain.value = 0;
    node.connect(zero);
    zero.connect(ctx.destination);
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(ctx.destination);
    this.node = node;
    this.srcNode = src;
    this.zeroGain = zero;
    this.clickBus = bus;
    const mo = this.opts.clickGain !== undefined ? { clickGain: this.opts.clickGain } : {};
    this.metronome = new Metronome(ctx, bus, mo);
    this.soundMetronome = new Metronome(ctx, bus, mo);
    // The accent recipe of the new sounds follows the declared output (06 section 9.5): offbeat recipe on speakers.
    this.metronome.setOutputMode(this.outputMode);
    this.soundMetronome.setOutputMode(this.outputMode);
    const lb = ctx.createGain();
    lb.gain.value = LISTEN_BUS_GAIN;
    lb.connect(bus);
    this.listenBus = lb;
  }

  private teardownGraph(): void {
    this.metronome?.cancel();
    this.soundMetronome?.cancel();
    this.stopTones();
    for (const n of [this.srcNode, this.node, this.zeroGain, this.clickBus, this.listenBus]) {
      try {
        n?.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    if (this.node) this.node.port.onmessage = null;
    this.node = null;
    this.srcNode = null;
    this.zeroGain = null;
    this.clickBus = null;
    this.listenBus = null;
    this.metronome = null;
    this.soundMetronome = null;
  }

  /** Close the context and build a fresh one on the same stream (W3; at most once per backend). */
  private async recreateContext(sampleRate: number | null): Promise<void> {
    if (this.cap) this.stopCapture();
    const old = this.ctx;
    this.teardownGraph();
    this.contextRecreated = true;
    const ctx = this.deps.createContext(sampleRate !== null ? { latencyHint: 'interactive', sampleRate } : { latencyHint: 'interactive' });
    this.adoptContext(ctx);
    if (old) await old.close().catch(() => undefined);
    ctx.resume().catch(() => undefined);
    await this.buildGraph(ctx);
  }

  private installGlobalListeners(): void {
    if (this.globalListeners) return;
    this.globalListeners = true;
    const { document: doc, window: win, mediaDevices: md } = this.deps;
    const onVis = (): void => {
      if (doc && doc.visibilityState === 'hidden') this.fireInterruption('hidden');
    };
    const onHide = (): void => this.fireInterruption('hidden');
    const onDevice = (): void => this.onDeviceChange();
    doc?.addEventListener('visibilitychange', onVis);
    doc?.addEventListener('freeze', onHide);
    win?.addEventListener('pagehide', onHide);
    md?.addEventListener('devicechange', onDevice);
    this.cleanups.push(() => {
      doc?.removeEventListener('visibilitychange', onVis);
      doc?.removeEventListener('freeze', onHide);
      win?.removeEventListener('pagehide', onHide);
      md?.removeEventListener('devicechange', onDevice);
      this.globalListeners = false;
    });
  }

  private onDeviceChange(): void {
    if (!this.ctx) return;
    const before = this.route?.routeKey;
    this.route = this.computeRoute();
    if (this.route.routeKey !== before) this.routeCbs.forEach((cb) => cb(this.route as AudioRouteInfo));
    // W7: a device change while capturing voids the take, whatever the new key.
    if (this.cap) this.fireInterruption('device-change');
  }

  private computeRoute(): AudioRouteInfo {
    const ctx = this.ctx as AudioContextLike;
    const label = this.track?.label ?? '';
    const settings = this.track?.getSettings() ?? {};
    const r: AudioRouteInfo = {
      routeKey: routeKeyOf(label, this.outputMode, ctx.sampleRate, this.capabilities.osFamily),
      inputKind: inputKindOf(label),
      outputMode: this.outputMode,
      sampleRate: ctx.sampleRate,
      appliedProcessing: appliedProcessingOf(settings),
    };
    const out = ctx.outputLatency;
    if (this.capabilities.outputLatencyReported && finite(out) && out > 0) r.reportedLatencySec = (finite(ctx.baseLatency) ? ctx.baseLatency : 0) + out;
    return r;
  }

  private currentRoute(): AudioRouteInfo {
    this.route = this.computeRoute();
    return this.route;
  }

  /**
   * Practise without listening (R13): with input off, `unlock` builds the output path (context, metronome) without
   * asking for the microphone. Turning it back on makes the next `unlock` open the microphone. Takes effect at the
   * next `unlock`; a live track is kept.
   */
  setInputEnabled(on: boolean): void {
    this.inputEnabled = on;
  }

  /** The player's declared output mode changes the route key (W7). */
  setOutputMode(mode: OutputMode): void {
    this.outputMode = mode;
    this.metronome?.setOutputMode(mode);
    this.soundMetronome?.setOutputMode(mode);
    if (!this.ctx || !this.route) return;
    const before = this.route.routeKey;
    this.route = this.computeRoute();
    if (this.route.routeKey !== before) this.routeCbs.forEach((cb) => cb(this.route as AudioRouteInfo));
  }

  async permissionState(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
    if (this.trackLive()) return 'granted';
    const perms = this.deps.permissions;
    if (!perms) return 'unknown';
    try {
      const s = (await perms.query({ name: 'microphone' })).state;
      return s === 'granted' || s === 'denied' || s === 'prompt' ? s : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  // ---- clocks ------------------------------------------------------------------------------------

  now(): ClockSeconds {
    return (this.ctx?.currentTime ?? 0) as ClockSeconds;
  }

  audibleNow(): ClockSeconds {
    const ctx = this.ctx;
    if (!ctx) return 0 as ClockSeconds;
    const ts = ctx.getOutputTimestamp?.();
    if (ts && finite(ts.contextTime) && finite(ts.performanceTime) && ts.performanceTime > 0) {
      return (ts.contextTime + (this.deps.wallNowMs() - ts.performanceTime) / 1000) as ClockSeconds;
    }
    const base = finite(ctx.baseLatency) ? ctx.baseLatency : 0;
    const out = finite(ctx.outputLatency) ? ctx.outputLatency : 0;
    return (ctx.currentTime - base - out) as ClockSeconds;
  }

  /** Context time of the first captured frame of the current capture, or null. */
  captureOrigin(): ClockSeconds | null {
    const ctx = this.ctx;
    if (!ctx || !this.cap || this.cap.originFrame === null) return null;
    return (this.cap.originFrame / ctx.sampleRate) as ClockSeconds;
  }

  // ---- metronome (W9, W10) -----------------------------------------------------------------------

  async scheduleTake(p: TakeSchedule): Promise<{ t0: ClockSeconds; clicks: ClickSpec[] }> {
    const m = this.requireMetronome();
    let t0: number | undefined;
    const tc = this.opts.testClockT0AfterCaptureSec;
    const origin = this.captureOrigin();
    if (tc !== undefined && origin !== null) t0 = origin + tc;
    const r = m.scheduleTake(p, t0);
    this.takeEndsAt = Math.max(0, ...r.clicks.map((c) => c.t)) + 0.1;
    return r;
  }

  cancelTake(): void {
    this.takeEndsAt = 0;
    this.metronome?.cancel();
  }

  async playCalibrationClicks(times: ClockSeconds[], timbre: ClickTimbre): Promise<void> {
    this.requireSoundMetronome().scheduleClicks(times, timbre);
  }

  async playTone(hz: number, durSec: number, at: ClockSeconds): Promise<void> {
    this.requireIdle();
    this.startTone(hz, durSec, at, 0.5);
  }

  /** Listen (05 §9.2): the pre-rendered additive tone on the Listen bus. `opts.peak` scales the bus's -12 dBFS ceiling (0..1). */
  async playNotes(notes: readonly PlayNote[], opts: PlayNotesOptions): Promise<void> {
    const ctx = this.requireContext();
    this.requireIdle();
    const origin = opts.at ?? (ctx.currentTime as ClockSeconds);
    const peak = Math.min(1, Math.max(0, opts.peak));
    for (const n of notes) {
      const data = this.listenVoice.get(n.hz, n.durSec, ctx.sampleRate, peak);
      const real = ctx.createBuffer(1, data.length, ctx.sampleRate);
      real.getChannelData(0).set(data);
      this.startSource(real, this.listenBus as GainNodeLike, origin + n.startSec);
    }
  }

  /** Previews and lead-ins through the metronome's click recipes, on a scheduler a take never shares. */
  async playClicks(times: ClockSeconds[], sound: MetronomeSound, accents: boolean[]): Promise<void> {
    const m = this.requireSoundMetronome();
    this.requireIdle();
    m.playClicks(times, sound, accents, CALIBRATION_ACCENT_DB);
  }

  /** Stops every source from playNotes, playClicks, playTone and playCalibrationClicks at once; a running take is not touched. */
  stopSounds(): void {
    this.stopTones();
    this.soundMetronome?.cancel();
  }

  private stopTones(): void {
    for (const t of [...this.liveTones]) {
      t.onended = null;
      try {
        t.stop();
      } catch {
        // Already stopped.
      }
      t.disconnect();
    }
    this.liveTones.clear();
  }

  /** Sounds never overlap a take: the microphone would hear them (05 §9.1). */
  private requireIdle(): void {
    const ctx = this.requireContext();
    if (this.takeEndsAt > 0 && ctx.currentTime < this.takeEndsAt) throw new Error('WebAudioBackend: a take is scheduled; no sound may start');
  }

  private startSource(buf: ClickBuffer, out: GainNodeLike, at: number): void {
    const ctx = this.requireContext();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(out);
    const live = src as unknown as { stop(): void; disconnect(): void; onended: (() => void) | null };
    this.liveTones.add(live);
    src.onended = () => {
      this.liveTones.delete(live);
      src.disconnect();
    };
    src.start(at);
  }

  private startTone(hz: number, durSec: number, at: ClockSeconds, peak: number): void {
    const ctx = this.requireContext();
    const sr = ctx.sampleRate;
    const n = Math.max(1, Math.round(durSec * sr));
    const fade = Math.min(Math.round(0.01 * sr), Math.floor(n / 2));
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    const w = (2 * Math.PI * hz) / sr;
    for (let i = 0; i < n; i++) {
      let env = 1;
      if (i < fade) env = 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
      else if (i >= n - fade) env = 0.5 - 0.5 * Math.cos((Math.PI * (n - 1 - i)) / fade);
      d[i] = peak * env * Math.sin(w * i);
    }
    this.startSource(buf, this.clickBus as GainNodeLike, at);
  }

  /** Clicks scheduled since unlock (diagnostics and tests). */
  clickHistory(): readonly { t: number; accent: boolean; timbre: ClickTimbre }[] {
    return this.metronome?.history ?? [];
  }

  /** The node every click and tone passes through before the destination (tests tap it). */
  clickOutput(): GainNodeLike | null {
    return this.clickBus;
  }

  private requireContext(): AudioContextLike {
    if (!this.ctx || !this.node) throw new Error('WebAudioBackend: call unlock() first');
    return this.ctx;
  }

  private requireMetronome(): Metronome {
    this.requireContext();
    return this.metronome as Metronome;
  }

  private requireSoundMetronome(): Metronome {
    this.requireContext();
    return this.soundMetronome as Metronome;
  }

  // ---- capture (01 §7.2) -------------------------------------------------------------------------

  startCapture(sink: MessagePortLike | ((m: WorkerMessage) => void)): Promise<void> {
    const node = this.requireContext() && (this.node as WorkletNodeLike);
    if (this.cap) this.stopCapture();
    let relay = typeof sink === 'function' || (this.opts.forceRelay ?? false);
    let resolveStarted: () => void = () => undefined;
    const started = new Promise<void>((r) => {
      resolveStarted = r;
    });
    const cap: CaptureState = {
      relay,
      relaySink: relay ? sink : null,
      awaitingPortBack: false,
      portOk: false,
      timer: null,
      originFrame: null,
      started: resolveStarted,
      posted: 0,
      dropped: 0,
      maxQueueMs: 0,
      backlogFired: false,
      gapFired: false,
    };
    this.cap = cap;
    const base = { poolSize: this.budget.poolSize, statsEvery: this.opts.statsEvery ?? 8 };
    if (!relay) {
      const port = sink as MessagePortLike;
      try {
        const msg: ToWorklet = { type: 'start', port: port as unknown as MessagePort, relay: false, ...base };
        node.port.postMessage(msg, [port as unknown as Transferable]);
      } catch {
        // The port cannot be transferred into the worklet here: relay from the main thread.
        relay = true;
        cap.relay = true;
        cap.relaySink = port;
      }
      if (!relay) {
        cap.timer = this.deps.setTimeout(() => {
          cap.timer = null;
          if (this.cap !== cap || cap.portOk) return;
          cap.relay = true;
          cap.awaitingPortBack = true;
          this.relayUsed = true;
          const m: ToWorklet = { type: 'relay' };
          node.port.postMessage(m);
        }, this.budget.relayFallbackMs);
      }
    }
    if (relay) {
      this.relayUsed = true;
      const msg: ToWorklet = { type: 'start', port: null, relay: true, ...base };
      node.port.postMessage(msg);
    }
    return started;
  }

  stopCapture(): void {
    const cap = this.cap;
    if (!cap) return;
    if (cap.timer !== null) this.deps.clearTimeout(cap.timer);
    this.lastStats = { postedBlocks: cap.posted, droppedBlocks: cap.dropped, maxQueueMs: cap.maxQueueMs, relay: cap.relay };
    this.cap = null;
    if (this.node) {
      const m: ToWorklet = { type: 'stop' };
      this.node.port.postMessage(m);
    }
    cap.started();
  }

  /** Counters of the current capture, or of the last one after `stopCapture` (AudioEnv.droppedBlocks, maxQueueMs). */
  captureStats(): CaptureStats {
    const cap = this.cap;
    if (!cap) return { ...this.lastStats };
    return { postedBlocks: cap.posted, droppedBlocks: cap.dropped, maxQueueMs: cap.maxQueueMs, relay: cap.relay };
  }

  onCaptureFault(cb: (f: CaptureFault) => void): () => void {
    this.faultCbs.add(cb);
    return () => void this.faultCbs.delete(cb);
  }

  private fault(f: CaptureFault): void {
    this.faultCbs.forEach((cb) => cb(f));
  }

  private noteQueue(cap: CaptureState, queueMs: number): void {
    if (queueMs > cap.maxQueueMs) cap.maxQueueMs = queueMs;
    if (queueMs > this.budget.backlogVoidMs && !cap.backlogFired) {
      cap.backlogFired = true;
      this.fault({ kind: 'backlog', queueMs });
    }
  }

  private noteGap(cap: CaptureState, seq: number): void {
    if (cap.gapFired) return;
    cap.gapFired = true;
    this.fault({ kind: 'capture-gap', seq });
  }

  private onWorklet(node: WorkletNodeLike, m: FromWorklet): void {
    if (node !== this.node) return;
    if (m.type === 'frames') {
      const w = this.framesWaiters.get(m.id);
      if (w) {
        this.framesWaiters.delete(m.id);
        w({ frames: m.frames, wallMs: this.deps.wallNowMs() });
      }
      return;
    }
    const cap = this.cap;
    if (m.type === 'block') {
      // Relay: give the pooled buffers straight back, deliver a copy.
      const b = m.block;
      const back: ToWorklet = { type: 'return', lowband: b.lowband.buffer as ArrayBuffer, hiEnergy: b.hiEnergy.buffer as ArrayBuffer };
      const lowband = b.lowband.slice();
      const hiEnergy = b.hiEnergy.slice();
      node.port.postMessage(back, [back.lowband, back.hiEnergy]);
      if (!cap) return;
      cap.posted++;
      const ctx = this.ctx as AudioContextLike;
      const endT = b.startT + lowband.length / b.analysisRate;
      this.noteQueue(cap, Math.max(0, (ctx.currentTime - endT) * 1000));
      const block: CaptureBlock = { v: 1, startT: b.startT, lowband, hiEnergy, analysisRate: b.analysisRate, seq: b.seq };
      const msg: WorkerMessage = { v: 1, type: 'block', block };
      const sink = cap.relaySink;
      if (typeof sink === 'function') sink(msg);
      else if (sink) sink.postMessage(msg, [lowband.buffer, hiEnergy.buffer]);
      else this.noteGap(cap, b.seq);
      return;
    }
    if (!cap) return;
    switch (m.type) {
      case 'started':
        cap.originFrame = m.originFrame;
        cap.started();
        break;
      case 'port-ok':
        cap.portOk = true;
        if (cap.timer !== null) {
          this.deps.clearTimeout(cap.timer);
          cap.timer = null;
        }
        break;
      case 'port-back':
        cap.awaitingPortBack = false;
        if (m.port) {
          // Returns the worker posts in relay mode land here; the relay already recycled those buffers.
          m.port.onmessage = () => undefined;
          cap.relaySink = m.port as unknown as MessagePortLike;
        }
        break;
      case 'stats': {
        if (!cap.relay) {
          cap.posted = m.posted;
          const blockMs = (FRAMES_PER_BLOCK / (this.ctx as AudioContextLike).sampleRate) * 1000;
          this.noteQueue(cap, m.outstanding * blockMs);
        }
        if (m.dropped > cap.dropped) cap.dropped = m.dropped;
        break;
      }
      case 'drop':
        cap.dropped = Math.max(cap.dropped, m.dropped);
        this.noteGap(cap, m.seq);
        break;
    }
  }

  // ---- clock checks (01 §7.8, W3) ----------------------------------------------------------------

  private requestFrames(): Promise<{ frames: number; wallMs: number }> {
    const node = this.requireContext() && (this.node as WorkletNodeLike);
    const id = ++this.framesId;
    return new Promise((resolve, reject) => {
      const timer = this.deps.setTimeout(() => {
        if (this.framesWaiters.delete(id)) reject(new Error('capture worklet is not running'));
      }, this.opts.framesTimeoutMs ?? 2000);
      this.framesWaiters.set(id, (r) => {
        this.deps.clearTimeout(timer);
        resolve(r);
      });
      const m: ToWorklet = { type: 'frames', id };
      node.port.postMessage(m);
    });
  }

  /** Counts worklet input frames against wall time (01 §7.8). */
  async measureClockRate(durSec: number): Promise<{ framesPerSec: number; expected: number }> {
    const ctx = this.requireContext();
    const a = await this.requestFrames();
    await new Promise<void>((r) => this.deps.setTimeout(r, durSec * 1000));
    const b = await this.requestFrames();
    const wallSec = (b.wallMs - a.wallMs) / 1000;
    const framesPerSec = wallSec > 0 ? (b.frames - a.frames) / wallSec : 0;
    const expected = ctx.sampleRate;
    this.clockRateError = expected > 0 ? framesPerSec / expected - 1 : null;
    return { framesPerSec, expected };
  }

  /**
   * W3 (2): run the clock-rate check; an error above `clockRateMaxError` (2%) recreates the context once and
   * measures again. `ok: false` after that is the "Audio setup problem; please reload" state.
   */
  async checkClockRate(durSec = 1.5): Promise<ClockRateCheck> {
    const max = this.budget.clockRateMaxError;
    const measure = async (): Promise<number> => {
      const r = await this.measureClockRate(durSec);
      return r.framesPerSec / r.expected - 1;
    };
    let err = await measure();
    if (Math.abs(err) <= max) return { ok: true, error: err, recreated: false };
    if (!this.contextRecreated) {
      await this.recreateContext(null);
      err = await measure();
      if (Math.abs(err) <= max) return { ok: true, error: err, recreated: true };
    }
    return { ok: false, error: err, recreated: this.contextRecreated };
  }

  /** Track rate reported by `getSettings()` (null when absent) against the context rate (gate (a) input). */
  sampleRateCheck(): { trackSampleRate: number | null; contextSampleRate: number; matches: boolean } {
    const ctxRate = this.ctx?.sampleRate ?? 0;
    return { trackSampleRate: this.trackSampleRate, contextSampleRate: ctxRate, matches: this.trackSampleRate === null || this.trackSampleRate === ctxRate };
  }

  audioInfo(): { contextSampleRate: number; contextRecreated: boolean; audioSessionType: string | null; clockRateError: number | null } {
    return {
      contextSampleRate: this.ctx?.sampleRate ?? 0,
      contextRecreated: this.contextRecreated,
      audioSessionType: this.audioSessionType,
      clockRateError: this.clockRateError,
    };
  }

  // ---- events and teardown -----------------------------------------------------------------------

  onRouteChange(cb: (r: AudioRouteInfo) => void): () => void {
    this.routeCbs.add(cb);
    return () => void this.routeCbs.delete(cb);
  }

  onInterruption(cb: (reason: InterruptionReason) => void): () => void {
    this.interruptCbs.add(cb);
    return () => void this.interruptCbs.delete(cb);
  }

  private fireInterruption(reason: InterruptionReason): void {
    if (this.closing) return;
    this.interruptCbs.forEach((cb) => cb(reason));
  }

  /** Stops every track and closes the context (leaving practice, page hide, idle; W2). */
  async close(): Promise<void> {
    this.closing = true;
    this.stopCapture();
    this.teardownGraph();
    for (const c of this.cleanups.splice(0)) c();
    this.track?.stop();
    for (const t of this.stream?.getAudioTracks() ?? []) if (t !== this.track) t.stop();
    this.track = null;
    this.stream = null;
    this.framesWaiters.clear();
    const ctx = this.ctx;
    this.ctx = null;
    this.route = null;
    if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => undefined);
  }
}
