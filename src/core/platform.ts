/**
 * Platform seam (01 §5.2, 05 §5.1). Owner: 05 with 01. Frozen in P0b (01 §14 item 2).
 *
 * Pure packages reach audio, storage, clocks, ids and assets only through these interfaces.
 * `src/platform/web/` implements them; a later Capacitor target implements them again.
 * MIDI and haptic members are absent in v1; they arrive later as optional members (additive).
 *
 * The seam primitives are declared in `types.ts` (so that `types.ts` imports nothing and no
 * import cycle exists) and re-exported here.
 */
import type {
  AttemptQuery,
  AttemptRecord,
  AttemptSummary,
  AppSettings,
  Calibration,
  ClickTimbre,
  ClockSeconds,
  DetectedNote,
  DisplayMode,
  DspConfig,
  DspStats,
  EndReason,
  FollowConfig,
  FollowerEvent,
  JsonValue,
  LiveJudgment,
  MetronomeMode,
  OsFamily,
  PitchFrame,
  PlatformKind,
  PlayerProfile,
  RecheckResult,
  AudioRouteInfo,
} from './types.ts';

export type {
  AppliedProcessing,
  AudioRouteInfo,
  ClickTimbre,
  ClockSeconds,
  DisplayMode,
  MetronomeMode,
  OsFamily,
  OutputMode,
  PlatformKind,
} from './types.ts';

/**
 * What the platform can do. Grading and ranking branches read this, never the user agent (05 §1).
 * Filled once by `detectCapabilities` in `src/platform/web/` (IOS1).
 */
export interface PlatformCapabilities {
  platform: PlatformKind;
  /** false on iOS Safari and Safari macOS: the `reported` method is never a ranked basis (05 W6). */
  outputLatencyReported: boolean;
  wakeLock: boolean;
  serviceWorker: boolean;
  persistentStorage: 'granted' | 'best-effort';
  /** Labels, copy and diagnostics only; never a grading branch (05 §5.1). */
  osFamily: OsFamily;
  /** W13, diagnostics (05 §5.1). */
  displayMode: DisplayMode;
}

/** One capture post from the worklet: every 2 quanta, decimated (01 §5.2, §7.2). */
export interface CaptureBlock {
  v: 1;
  /** Time of the first decimated sample (carries the fractional phase). */
  startT: ClockSeconds;
  /** Decimated, low-passed at 3 kHz. */
  lowband: Float32Array;
  /** Energy above 5 kHz per 1 ms sub-block (48 input samples at 48 kHz). */
  hiEnergy: Float32Array;
  /** Exact decimated rate, Hz, for example 16000 or 14700. */
  analysisRate: number;
  /** Block counter, for gap detection (05 §4 gate (f)). */
  seq: number;
}

/** A scheduled metronome click (01 §5.2, §7.6). */
export interface ClickSpec {
  /** 0-based beat index from the first count-in beat. */
  beatIndex: number;
  accent: boolean;
  /** Scheduled output time. */
  t: ClockSeconds;
  countIn: boolean;
}

/** Main thread → DSP worker (01 §5.2). Versioned. */
export type WorkerMessage =
  | { v: 1; type: 'config'; cfg: DspConfig; follow: FollowConfig }
  | { v: 1; type: 'block'; block: CaptureBlock }
  | { v: 1; type: 'clicks'; clicks: ClickSpec[] }
  /** Ends the take at input time t. `reason` added in P0b so the worker can call `LiveFollower.end`. */
  | { v: 1; type: 'end'; t: ClockSeconds; reason: EndReason };

/**
 * DSP worker → capture worklet, on the capture port (P11; moved to core by the wave 2 review so dsp/ and the worker
 * need not import platform/web). Posted after the worker has copied a block's samples, with both buffers
 * transferred, so the worklet can reuse its pooled buffers. Without it the backend falls back to the main-thread
 * relay after `relayFallbackMs`.
 */
export interface CaptureReturn {
  v: 1;
  type: 'return';
  lowband: ArrayBuffer;
  hiEnergy: ArrayBuffer;
}

/** DSP worker → main thread (P0b addition; 01 §5.2 names only the inbound direction). */
export type WorkerReply =
  | { v: 1; type: 'ready' }
  /** Follower events in order; batched per processed block. */
  | { v: 1; type: 'events'; events: FollowerEvent[] }
  /** Per-take count-in recheck, speakers only (01 §7.7); sent once the count-in clicks are analysed. */
  | { v: 1; type: 'recheck'; result: RecheckResult }
  /** Sent after the `final` follower event: everything the attempt record needs. */
  | {
      v: 1;
      type: 'done';
      detected: DetectedNote[];
      live: LiveJudgment[];
      stats: DspStats;
      /** Only with the dev flag (01 §6.5 `debug`). */
      frames?: PitchFrame[];
      /** Signal quality for grading (02 §6.1). */
      signal: { medianClarity: number | null; clippingFrac: number };
      /** Voice drift reference values (02 §4.5), null for other families. */
      voiceReference: { finalOffsetCents: number; offsetAtThirdCents: number } | null;
    }
  | { v: 1; type: 'error'; message: string };

/** The parameters of one take's metronome schedule (01 §5.2, §7.1, §7.6). */
export interface TakeSchedule {
  /** Seconds from now to the first count-in click, ≥ 0.5. */
  leadSec: number;
  bpm: number;
  beatsPerBar: number;
  countInBeats: number;
  /** Beats from bar 1 beat 1 to the take end. */
  totalBeats: number;
  mode: MetronomeMode;
  timbre: ClickTimbre;
  /** Accent gain over normal clicks, dB. */
  accentDb: number;
}

/** Audio backend (01 §5.2). Web: `WebAudioBackend` in `src/platform/web/`. */
export interface AudioBackend {
  readonly capabilities: PlatformCapabilities;
  /** Call synchronously from a gesture handler (01 §7.1, 05 W1). */
  unlock(): Promise<AudioRouteInfo>;
  /** Never the only source of permission state on Safari (05 §2.1). */
  permissionState(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'>;
  now(): ClockSeconds;
  /** For playhead and beat dots only; never used for grading (01 §7.1). */
  audibleNow(): ClockSeconds;
  /** Every click of the take is scheduled now (01 §7.6, 05 W9). `t0` = bar 1 beat 1. */
  scheduleTake(p: TakeSchedule): Promise<{ t0: ClockSeconds; clicks: ClickSpec[] }>;
  cancelTake(): void;
  /** Delivers blocks to a transferred MessagePort or, in relay mode, to a callback (01 §7.2). */
  startCapture(sink: MessagePortLike | ((m: WorkerMessage) => void)): Promise<void>;
  stopCapture(): void;
  playCalibrationClicks(times: ClockSeconds[], timbre: ClickTimbre): Promise<void>;
  /** Sanity tone and voice reference (01 §7.8, 02 §4.5). Hz, seconds. */
  playTone(hz: number, durSec: number, at: ClockSeconds): Promise<void>;
  /** Counts worklet input frames against wall time (01 §7.8). */
  measureClockRate(durSec: number): Promise<{ framesPerSec: number; expected: number }>;
  onRouteChange(cb: (r: AudioRouteInfo) => void): () => void;
  onInterruption(cb: (reason: 'interrupted' | 'hidden' | 'track-ended' | 'device-change') => void): () => void;
  close(): Promise<void>;
  /** True when the main-thread relay is in use (AudioEnv.captureRelay). P0b addition. */
  readonly captureRelay: boolean;
  /** Settings of the last unlock, for AudioEnv (05 §5.2). P0b addition. */
  audioInfo(): { contextSampleRate: number; contextRecreated: boolean; audioSessionType: string | null; clockRateError: number | null };
}

/**
 * Structural stand-in for a DOM `MessagePort` (core has no DOM lib). A real MessagePort satisfies it.
 */
export interface MessagePortLike {
  postMessage(message: unknown, transfer?: unknown[]): void;
  close(): void;
}

/** A Worker-like object the session drives (01 §5.9 `workerFactory`). A real `Worker` satisfies it. */
export interface WorkerLike {
  postMessage(message: WorkerMessage, transfer?: unknown[]): void;
  onmessage: ((ev: { data: WorkerReply }) => void) | null;
  terminate(): void;
}

/** Async JSON key-value store (IndexedDB `kv` store on web) (01 §11). */
export interface KeyValue {
  get(key: string): Promise<JsonValue | undefined>;
  set(key: string, value: JsonValue): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** Repositories (01 §5.9, §11). Implemented in `src/platform/web/idb-repos.ts`. */
export interface StoreRepos {
  profile: { get(): Promise<PlayerProfile | undefined>; put(p: PlayerProfile): Promise<void> };
  attempts: {
    add(a: AttemptRecord): Promise<void>;
    /** Newest first. */
    recent(n: number): Promise<AttemptRecord[]>;
    byId(id: string): Promise<AttemptRecord | undefined>;
    list(q: AttemptQuery): Promise<AttemptSummary[]>;
    /** All attempts, oldest first (export). P0b addition. */
    all(): Promise<AttemptRecord[]>;
  };
  calibrations: {
    get(routeKey: string): Promise<Calibration | undefined>;
    put(c: Calibration): Promise<void>;
    /** All calibrations (export). P0b addition. */
    all(): Promise<Calibration[]>;
  };
  settings: { get(): Promise<AppSettings>; put(s: AppSettings): Promise<void> };
  /** Deletes every store (Settings > Data > Delete all). P0b addition. */
  clearAll(): Promise<void>;
}

/** Everything a pure package may ask of the platform (01 §5.2). */
export interface PlatformServices {
  audio: AudioBackend;
  repos: StoreRepos;
  kv: KeyValue;
  keepAwake(on: boolean): Promise<void>;
  /** ISO 8601 UTC. */
  clockWall(): string;
  /** Local calendar day in the device's time zone, YYYY-MM-DD (streaks and daily caps, 02 §5.4). P0b addition. */
  localDay(): string;
  /** UUID. */
  idGen(): string;
  /** Relative URLs only (05 §5.3 item 7). */
  assets: { getJson<T>(relPath: string): Promise<T> };
  lifecycle: { onVisibility(cb: (visible: boolean) => void): () => void };
}
