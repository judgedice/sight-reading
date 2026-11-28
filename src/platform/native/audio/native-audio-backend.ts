/**
 * `NativeAudioBackend` (docs/native/AUDIO-DESIGN.md section 4): the `AudioBackend` over the Rust engine. It mirrors
 * `WebAudioBackend` wherever the seam is concerned: the take schedule comes from the shared `Metronome` (on a
 * `NativeVoiceContext` in group `take`), previews, tones and Listen notes go to group `sounds` and are refused while a
 * take is scheduled, `stopSounds` never touches a take, capture is relayed through the main thread
 * (`captureRelay` is true) and faults, route changes and interruptions reach the same callbacks.
 *
 * Differences from the web backend, all deliberate:
 * - `unlock` needs no gesture. It opens the engine once (`audio_open`) and reuses it; a later `unlock` reopens it only
 *   when the input is wanted and was not opened (`setInputEnabled`, `releaseInput`). Reopening restarts engine time
 *   at 0 and drops every buffer and voice in the engine, as recreating an `AudioContext` does on the web.
 * - The clock is the engine's: `now()` follows the engine's anchors (`EngineClock`), `audibleNow()` subtracts the
 *   reported output latency.
 * - The clock-rate check is the engine's own (`audio_clock_check`); it never recreates anything.
 * - Permission: before opening the input the backend asks the engine (`audio_permission`); `denied` rejects `unlock`
 *   with an error named `NotAllowedError`, which the session reads as `mic-denied`.
 */
import type {
  AudioBackend,
  AudioRouteInfo,
  ClickSpec,
  ClickTimbre,
  ClockSeconds,
  MessagePortLike,
  MetronomeSound,
  OutputMode,
  PlatformCapabilities,
  PlayNote,
  PlayNotesOptions,
  SoundSetId,
  TakeSchedule,
  WorkerMessage,
} from '../../../core/platform.ts';
import budgetJson from '../../../../config/measurement-budget.json';
import { CALIBRATION_ACCENT_DB, Metronome } from '../../shared/audio/metronome.ts';
import { ListenVoiceCache, LISTEN_BUS_GAIN } from '../../shared/audio/listen-voice.ts';
import { renderTone } from '../../shared/audio/render-tone.ts';
import { CUT_FADE_SEC, midiOfHz, playSampledNotes, Sampler, SAMPLE_GAIN, type Decoder, type FetchLike } from '../../shared/audio/sampler.ts';
import { NativeCaptureFeed, type CaptureFault, type CaptureStats } from './capture-feed.ts';
import { EngineClock, syncHostClock, type PerfNow } from './engine-clock.ts';
import type { AudioEvent, LatencyReport, LoopbackEstimate, NativeIpc, OpenInfo } from './ipc.ts';
import { nativeAudioRoute } from './route.ts';
import { NativeVoiceContext, NativeVoiceHost, type NativeGain, type VoiceHostStats } from './voice-context.ts';

export type InterruptionReason = 'interrupted' | 'hidden' | 'track-ended' | 'device-change';

export type { CaptureFault, CaptureStats };

export interface CaptureBudget {
  backlogVoidMs: number;
  clockRateMaxError: number;
}

/** Defaults from config/measurement-budget.json (R32). */
export const DEFAULT_CAPTURE_BUDGET: CaptureBudget = {
  backlogVoidMs: budgetJson.capture.backlogVoidMs,
  clockRateMaxError: budgetJson.calibration.clockRateMaxError,
};

/** Packet size asked of the engine, frames (512 is 10.7 ms at 48 kHz; the design allows 256 to 2048). */
export const DEFAULT_PACKET_FRAMES = 512;
/** Fade of a take's click cancel, seconds. */
export const TAKE_CANCEL_FADE_SEC = 0.005;
/** Default `checkClockRate` window, seconds. */
export const CLOCK_CHECK_SEC = 2;

export interface NativeAudioBackendOptions {
  ipc: NativeIpc;
  capabilities: PlatformCapabilities;
  /** Declared output mode, part of the route key (default speakers). */
  outputMode?: OutputMode;
  /** Linear gain of a normal click. */
  clickGain?: number;
  budget?: Partial<CaptureBudget>;
  packetFrames?: number;
  /** `performance.now()` (tests drive it by hand). */
  perfNow?: PerfNow;
  /** `audio_clock_sync` round trips at open (the shortest wins). */
  syncRounds?: number;
  /** URL of the sounds folder, ending in '/' (default `sounds/`, relative to the page like every asset). */
  soundsBase?: string;
  /** Fetch for the sample sets (default the global `fetch`; tests inject one). */
  fetchSound?: FetchLike;
}

/** Result of `checkClockRate`: the shape `WebAudioBackend` returns, with the engine's single measurement. */
export interface NativeClockRateCheck {
  ok: boolean;
  error: number | null;
  recreated: boolean;
  measured: boolean;
  diagnostics: { error: number | null; source: 'engine' | null; outcome: 'ok' | 'inconsistent'; inputDropFraction: number | null };
}

const defaultSoundFetch: FetchLike = (url) => {
  if (typeof fetch !== 'function') return Promise.reject(new Error('no fetch'));
  return fetch(url);
};

interface CaptureState {
  feed: NativeCaptureFeed;
  /** From the engine's reply to `audio_capture_start`; the first packet's `firstFrame` replaces it if it differs. */
  originFrame: number | null;
}

export class NativeAudioBackend implements AudioBackend {
  readonly capabilities: PlatformCapabilities;
  /** The main thread relays every block (the engine's channel ends there). */
  readonly captureRelay = true;
  private readonly ipc: NativeIpc;
  private readonly opts: NativeAudioBackendOptions;
  private readonly budget: CaptureBudget;
  private readonly clock: EngineClock;
  private readonly perfNow: PerfNow;
  private readonly host: NativeVoiceHost;
  private readonly takeCtx: NativeVoiceContext;
  private readonly soundCtx: NativeVoiceContext;
  private readonly sampler: Sampler;
  private readonly listenVoice = new ListenVoiceCache();
  /** Take clicks, and previews, lead-ins and calibration clicks: separate schedulers, so `stopSounds` cannot cancel a take. */
  private metronome!: Metronome;
  private soundMetronome!: Metronome;
  /** The Listen voice's own gain (about -12 dBFS peak); click volume is set per click. */
  private readonly listenBus: NativeGain;

  private info: OpenInfo | null = null;
  private route: AudioRouteInfo | null = null;
  private outputMode: OutputMode;
  private opened = false;
  private inputEnabled = true;
  private inputOpen = false;
  private closing = false;
  private unlocking: Promise<AudioRouteInfo> | null = null;
  /** Bumped at every open and close: events of an older engine session are ignored. */
  private session = 0;
  private takeEndsAt = 0;
  private clockRateError: number | null = null;
  private xruns = 0;

  private cap: CaptureState | null = null;
  private lastStats: CaptureStats = { postedBlocks: 0, droppedBlocks: 0, maxQueueMs: 0, relay: true };

  private readonly routeCbs = new Set<(r: AudioRouteInfo) => void>();
  private readonly interruptCbs = new Set<(r: InterruptionReason) => void>();
  private readonly faultCbs = new Set<(f: CaptureFault) => void>();

  constructor(opts: NativeAudioBackendOptions) {
    this.opts = opts;
    this.ipc = opts.ipc;
    this.capabilities = opts.capabilities;
    this.budget = { ...DEFAULT_CAPTURE_BUDGET, ...opts.budget };
    this.outputMode = opts.outputMode ?? 'speakers';
    this.perfNow = opts.perfNow ?? (() => performance.now());
    this.clock = new EngineClock(this.perfNow);
    this.host = new NativeVoiceHost(this.ipc, () => this.clock.now());
    this.takeCtx = new NativeVoiceContext(this.host, 'take');
    this.soundCtx = new NativeVoiceContext(this.host, 'sounds');
    this.buildMetronomes();
    this.listenBus = this.soundCtx.createGain();
    this.listenBus.gain.value = LISTEN_BUS_GAIN;
    this.sampler = new Sampler({
      base: opts.soundsBase ?? 'sounds/',
      fetch: opts.fetchSound ?? defaultSoundFetch,
      decoder: (): Decoder | null => (this.opened ? this.soundCtx : null),
    });
  }

  // ---- unlock and session --------------------------------------------------------------------------

  unlock(): Promise<AudioRouteInfo> {
    if (this.unlocking) return this.unlocking;
    if (this.opened && (this.inputOpen || !this.inputEnabled)) return Promise.resolve(this.currentRoute());
    const p = this.openEngine().finally(() => {
      this.unlocking = null;
    });
    this.unlocking = p;
    return p;
  }

  private async openEngine(): Promise<AudioRouteInfo> {
    this.closing = false;
    const wantInput = this.inputEnabled;
    if (wantInput) {
      const perm = await this.ipc.permission({ request: true }).catch(() => 'unknown' as const);
      if (perm === 'denied') throw Object.assign(new Error('microphone permission denied'), { name: 'NotAllowedError' });
    }
    if (this.cap) this.stopCapture();
    // The engine drops its buffers and voices when it is reopened; so does every handle here.
    const session = ++this.session;
    this.host.newGeneration();
    this.clock.reset();
    this.takeEndsAt = 0;
    this.opened = false;
    const info = await this.ipc.open({ input: wantInput, outputMode: this.outputMode, onEvent: (e) => this.onEvent(session, e) });
    if (session !== this.session) throw new Error('NativeAudioBackend: closed while opening');
    this.host.newGeneration(info.engineRate);
    this.info = info;
    this.clock.setAnchor(info.clock);
    const sync = await syncHostClock(() => this.ipc.clockSync(), this.perfNow, this.opts.syncRounds ?? 5);
    this.clock.setHostOffset(sync.offsetMs);
    this.clock.setAnchor({ engineSec: sync.engineSec, hostMs: sync.hostMs, rate: info.clock.rate });
    this.buildMetronomes();
    this.opened = true;
    this.inputOpen = wantInput;
    this.capabilities.outputLatencyReported = info.latency.trust !== 'C';
    return this.currentRoute();
  }

  /** Fresh schedulers (and click buffers at the engine's rate) for each engine session, as the web builds them per graph. */
  private buildMetronomes(): void {
    const mo = this.opts.clickGain !== undefined ? { clickGain: this.opts.clickGain } : {};
    this.metronome = new Metronome(this.takeCtx, null, mo);
    this.soundMetronome = new Metronome(this.soundCtx, null, mo);
    // The accent recipe of the new sounds follows the declared output (06 section 9.5): offbeat recipe on speakers.
    this.metronome.setOutputMode(this.outputMode);
    this.soundMetronome.setOutputMode(this.outputMode);
  }

  private currentRoute(): AudioRouteInfo {
    const info = this.info as OpenInfo;
    this.route = nativeAudioRoute(info, this.outputMode, this.capabilities.osFamily);
    return this.route;
  }

  /** Practise without listening (R13): with input off, `unlock` opens the output only. Takes effect at the next `unlock`. */
  setInputEnabled(on: boolean): void {
    this.inputEnabled = on;
  }

  /** The player's declared output mode changes the route key (W7). */
  setOutputMode(mode: OutputMode): void {
    this.outputMode = mode;
    this.metronome.setOutputMode(mode);
    this.soundMetronome.setOutputMode(mode);
    if (!this.info || !this.route) return;
    const before = this.route.routeKey;
    const next = this.currentRoute();
    if (next.routeKey !== before) this.routeCbs.forEach((cb) => cb(next));
  }

  async permissionState(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
    try {
      return await this.ipc.permission({ request: false });
    } catch {
      return 'unknown';
    }
  }

  /**
   * Stops capture and releases the microphone, keeping the output (core/platform `releaseInput`). The next `unlock`
   * opens the input again.
   */
  releaseInput(): void {
    if (this.cap) this.stopCapture();
    this.inputOpen = false;
    void this.ipc.releaseInput().catch(() => undefined);
  }

  /** Stops capture and opens the engine again with the input (test clock and diagnostics; restarts engine time). */
  async reopenInput(): Promise<AudioRouteInfo> {
    if (this.cap) this.stopCapture();
    this.inputOpen = false;
    this.inputEnabled = true;
    return this.unlock();
  }

  /** Closes the engine: stops capture, forgets voices and buffers (leaving practice, page hide, idle; W2). */
  async close(): Promise<void> {
    this.closing = true;
    this.session++;
    this.stopCapture();
    this.takeEndsAt = 0;
    this.takeCtx.cancelGroupLocal();
    this.soundCtx.cancelGroupLocal();
    this.metronome.cancel();
    this.soundMetronome.cancel();
    this.host.newGeneration();
    this.clock.reset();
    this.opened = false;
    this.inputOpen = false;
    this.route = null;
    this.info = null;
    await this.ipc.close().catch(() => undefined);
  }

  // ---- events --------------------------------------------------------------------------------------

  private onEvent(session: number, e: AudioEvent): void {
    if (session !== this.session) return;
    switch (e.type) {
      case 'clock':
        this.clock.setAnchor(e.anchor);
        break;
      case 'route': {
        if (!this.info) break;
        this.info = { ...this.info, route: e.route, latency: e.latency, engineRate: e.engineRate };
        this.capabilities.outputLatencyReported = e.latency.trust !== 'C';
        const before = this.route?.routeKey;
        const next = this.currentRoute();
        if (next.routeKey !== before) this.routeCbs.forEach((cb) => cb(next));
        // W7: a device change while capturing voids the take, whatever the new key.
        if (this.cap) this.fireInterruption('device-change');
        break;
      }
      case 'interruption':
        this.fireInterruption(e.reason);
        break;
      case 'ended':
        this.host.voicesEnded(e.ids);
        break;
      case 'late':
        this.host.voicesLate(e.ids);
        break;
      case 'rejected':
        this.host.voicesRejected(e.ids);
        this.host.voicesEnded(e.ids);
        break;
      case 'xrun':
        this.xruns += e.count;
        break;
    }
  }

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

  onCaptureFault(cb: (f: CaptureFault) => void): () => void {
    this.faultCbs.add(cb);
    return () => void this.faultCbs.delete(cb);
  }

  // ---- clocks --------------------------------------------------------------------------------------

  now(): ClockSeconds {
    return this.clock.now() as ClockSeconds;
  }

  audibleNow(): ClockSeconds {
    return (this.clock.now() - (this.info?.latency.outputSec ?? 0)) as ClockSeconds;
  }

  /** Engine time of the first captured frame of the current capture, or null. */
  captureOrigin(): ClockSeconds | null {
    const cap = this.cap;
    const frame = cap?.feed.originFrame ?? cap?.originFrame ?? null;
    if (!this.info || frame === null) return null;
    return (frame / this.info.engineRate) as ClockSeconds;
  }

  /** Engine seconds per host second, the last anchor's (diagnostics). */
  clockRate(): number {
    return this.clock.rate;
  }

  // ---- metronome (W9, W10) -------------------------------------------------------------------------

  async scheduleTake(p: TakeSchedule): Promise<{ t0: ClockSeconds; clicks: ClickSpec[] }> {
    this.requireOpen();
    const r = this.metronome.scheduleTake(p);
    this.takeEndsAt = Math.max(0, ...r.clicks.map((c) => c.t)) + 0.1;
    try {
      await this.takeCtx.flush();
    } catch (e) {
      // A take whose clicks the engine did not take is not scheduled: leave nothing half-scheduled behind.
      this.cancelTake();
      throw e;
    }
    return r;
  }

  cancelTake(): void {
    this.takeEndsAt = 0;
    void this.takeCtx.cancelGroup(TAKE_CANCEL_FADE_SEC);
    this.metronome.cancel();
  }

  async playCalibrationClicks(times: ClockSeconds[], timbre: ClickTimbre): Promise<void> {
    this.requireOpen();
    this.soundMetronome.scheduleClicks(times, timbre);
    await this.soundCtx.flush();
  }

  async playTone(hz: number, durSec: number, at: ClockSeconds): Promise<void> {
    this.requireOpen();
    this.requireIdle();
    const rate = this.host.engineRate;
    const src = this.soundCtx.createBufferSource();
    src.buffer = this.soundCtx.bufferFor(renderTone(hz, durSec, rate, 0.5), rate, true);
    src.start(at);
    await this.soundCtx.flush();
  }

  /**
   * Listen and every other note the app plays, on the Listen bus: sampled when `opts.sound` is loaded, else the
   * pre-rendered additive tone (a set that is not loaded yet starts loading for the next call). Same branches as the web
   * backend.
   */
  async playNotes(notes: readonly PlayNote[], opts: PlayNotesOptions): Promise<void> {
    this.requireOpen();
    this.requireIdle();
    const origin = opts.at ?? (this.now() as ClockSeconds);
    const peak = Math.min(1, Math.max(0, opts.peak));
    const set = opts.sound !== undefined ? this.sampler.ready(opts.sound) : null;
    if (opts.sound !== undefined && !set) void this.sampler.prepare(opts.sound);
    if (set) {
      const run = notes.filter((n) => n.hz > 0 && n.durSec > 0).map((n) => ({ midi: midiOfHz(n.hz), when: origin + n.startSec, durSec: n.durSec }));
      playSampledNotes(this.soundCtx, this.listenBus, set, run, {
        gain: peak * SAMPLE_GAIN,
        ...(opts.attackSec !== undefined ? { attackSec: opts.attackSec } : {}),
      });
      await this.soundCtx.flush();
      return;
    }
    const rate = this.host.engineRate;
    for (const n of notes) {
      const src = this.soundCtx.createBufferSource();
      src.buffer = this.soundCtx.bufferFor(this.listenVoice.get(n.hz, n.durSec, rate, peak), rate);
      src.connect(this.listenBus);
      src.start(origin + n.startSec);
    }
    await this.soundCtx.flush();
  }

  /** Starts loading a sample set. Needs the engine open (it decodes there); before that the answer is `fallback`. */
  prepareSound(id: SoundSetId): Promise<'ready' | 'fallback'> {
    return this.sampler.prepare(id);
  }

  /** Where a set's load stands (diagnostics and tests). */
  soundState(id: SoundSetId): ReturnType<Sampler['state']> {
    return this.sampler.state(id);
  }

  /** Previews and lead-ins through the metronome's click recipes, on a scheduler a take never shares. */
  async playClicks(times: ClockSeconds[], sound: MetronomeSound, accents: boolean[]): Promise<void> {
    this.requireOpen();
    this.requireIdle();
    this.soundMetronome.playClicks(times, sound, accents, CALIBRATION_ACCENT_DB);
    await this.soundCtx.flush();
  }

  /** Cancels everything from playNotes, playClicks, playTone and playCalibrationClicks at once; a running take is not touched. */
  stopSounds(): void {
    void this.soundCtx.cancelGroup(CUT_FADE_SEC);
    this.soundMetronome.cancel();
  }

  /** Sounds never overlap a take: the microphone would hear them (05 §9.1). */
  private requireIdle(): void {
    if (this.takeEndsAt > 0 && this.clock.now() < this.takeEndsAt) throw new Error('NativeAudioBackend: a take is scheduled; no sound may start');
  }

  private requireOpen(): void {
    if (!this.opened) throw new Error('NativeAudioBackend: call unlock() first');
  }

  /** Clicks scheduled since unlock (diagnostics and tests). */
  clickHistory(): readonly { t: number; accent: boolean; timbre: ClickTimbre }[] {
    return this.metronome.history;
  }

  /** Voice counters of the engine session: late, rejected, uploads, schedule calls (diagnostics). */
  voiceStats(): Readonly<VoiceHostStats> & { xruns: number } {
    return { ...this.host.stats, xruns: this.xruns };
  }

  // ---- capture (01 §7.2, section 3) ----------------------------------------------------------------

  async startCapture(sink: MessagePortLike | ((m: WorkerMessage) => void)): Promise<void> {
    this.requireOpen();
    if (this.cap) this.stopCapture();
    const info = this.info as OpenInfo;
    const feed = new NativeCaptureFeed({
      engineRate: info.engineRate,
      sink,
      now: () => this.clock.now(),
      backlogVoidMs: this.budget.backlogVoidMs,
      onFault: (f) => this.faultCbs.forEach((cb) => cb(f)),
    });
    const cap: CaptureState = { feed, originFrame: null };
    this.cap = cap;
    try {
      const r = await this.ipc.captureStart({ packetFrames: this.opts.packetFrames ?? DEFAULT_PACKET_FRAMES, onPacket: (b) => feed.push(b) });
      cap.originFrame = r.originFrame;
    } catch (e) {
      if (this.cap === cap) this.cap = null;
      feed.stop();
      throw e;
    }
  }

  stopCapture(): void {
    const cap = this.cap;
    if (!cap) return;
    this.cap = null;
    this.lastStats = cap.feed.stop();
    const stats = this.lastStats;
    void this.ipc
      .captureStop()
      .then((r) => {
        // Frames the engine dropped before they reached the feed count as dropped blocks too.
        if (this.lastStats === stats) this.lastStats = { ...stats, droppedBlocks: Math.max(stats.droppedBlocks, Math.ceil(r.droppedFrames / 256)) };
      })
      .catch(() => undefined);
  }

  /** Counters of the current capture, or of the last one after `stopCapture` (AudioEnv.droppedBlocks, maxQueueMs). */
  captureStats(): CaptureStats {
    return this.cap ? this.cap.feed.stats() : { ...this.lastStats };
  }

  // ---- clock checks and latency (01 §7.8, section 5) -----------------------------------------------

  /** `AudioBackend.measureClockRate`: the engine's check as frames per wall second; NaN when it could not measure. */
  async measureClockRate(durSec: number): Promise<{ framesPerSec: number; expected: number }> {
    const r = await this.ipc.clockCheck({ durSec });
    this.clockRateError = r.error;
    return { framesPerSec: r.error === null ? NaN : r.expected * (1 + r.error), expected: r.expected };
  }

  /**
   * The clock-rate check: an error above `clockRateMaxError` fails (`ok: false`); a clock that could not be measured is
   * `ok` with `error: null`. Nothing is recreated on native.
   */
  async checkClockRate(durSec: number = CLOCK_CHECK_SEC): Promise<NativeClockRateCheck> {
    this.requireOpen();
    const r = await this.ipc.clockCheck({ durSec });
    this.clockRateError = r.error;
    return {
      ok: r.error === null || Math.abs(r.error) <= this.budget.clockRateMaxError,
      error: r.error,
      recreated: false,
      measured: r.error !== null,
      diagnostics: { error: r.error, source: r.error === null ? null : 'engine', outcome: r.consistent ? 'ok' : 'inconsistent', inputDropFraction: null },
    };
  }

  /** The engine's latency report of the open session (parts, trust), or null before `unlock`. */
  latencyReport(): LatencyReport | null {
    return this.info?.latency ?? null;
  }

  /** The engine's own loopback measurement (8 clicks, about 2 s). It is a cross-check and writes no calibration. */
  async measureLoopback(): Promise<LoopbackEstimate> {
    this.requireOpen();
    this.requireIdle();
    return this.ipc.measureLoopback({ clicks: 8, timbre: 'tick' });
  }

  audioInfo(): { contextSampleRate: number; contextRecreated: boolean; audioSessionType: string | null; clockRateError: number | null } {
    return {
      contextSampleRate: this.info?.engineRate ?? 0,
      contextRecreated: false,
      audioSessionType: this.info?.sessionType ?? null,
      clockRateError: this.clockRateError,
    };
  }
}
