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
  PitchSteadiness,
  EndReason,
  FollowConfig,
  FollowerEvent,
  JsonValue,
  LiveJudgment,
  MetronomeMode,
  MetronomeSound,
  OsFamily,
  PitchFrame,
  PlatformKind,
  PlayerProfile,
  RecheckResult,
  AudioRouteInfo,
  WindowSamples,
} from './types.ts';

export type {
  AppliedProcessing,
  AudioRouteInfo,
  ClickTimbre,
  ClockSeconds,
  DisplayMode,
  MetronomeMode,
  MetronomeSound,
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
  | { v: 1; type: 'end'; t: ClockSeconds; reason: EndReason }
  /**
   * Match a note (round 2, R2-07): instead of 'config', puts the worker in pitch mode. No pipeline and no follower run;
   * the worker posts 'pitch-frames' replies and never 'ready', 'events' or 'done'. Sent with the capture port like
   * 'config'. 'end' stops the analysis; the session terminates the worker.
   */
  | { v: 1; type: 'pitch'; cfg: PitchModeConfig };

/** The worker's pitch mode (Match a note, round 2): the existing `PitchAnalyzer` and nothing else. */
export interface PitchModeConfig {
  /** Decimated rate, Hz (exact, for example 16000 or 14700). */
  analysisRate: number;
  windowSamples: WindowSamples;
  hopSamples: 128;
  /** Search range, Hz (the instrument's sounding range; the worker widens it as the pipeline does). */
  minHz: number;
  maxHz: number;
  a4Hz: number;
  clarityThreshold: number;
  /** Input time before which nothing is posted: the target's release plus the listen delay. */
  fromT: ClockSeconds;
  /** Spacing of posted frames, seconds (0.02: about 50 Hz). */
  stepSec: number;
  /** The reported pitch is the mean of the voiced frames this far back, seconds. */
  smoothSec: number;
  /** A pitch held this long, ms, is steady. */
  steadyMs: number;
  /** ... while its frames over that time stay within this spread, cents (max minus min). */
  steadySpreadCents: number;
  /** Frames quieter than this, dBFS, are unvoiced. */
  gateDb: number;
  /**
   * The needle's display filter preset (round 3, `dsp/pitch-steadiness.ts` `STEADINESS_PRESETS`, 03-pitch-steadiness
   * §3). Pitch mode only: no take config carries it (T15).
   */
  steadiness: PitchSteadiness;
}

/**
 * Parameters of the needle's display filter and of the in-tune decision on Match a note (03-pitch-steadiness §3.2).
 * Times ms, pitches cents, levels dB. `centreMs`, `tauMs`, `judgeMs` and `detentC` differ by preset; the rest are the
 * same in every preset.
 */
export interface SteadinessParams {
  /** The running median window once the note is held. */
  centreMs: number;
  /** The exponential smoother's time constant once the note is held. */
  tauMs: number;
  /** The in-tune median window. */
  judgeMs: number;
  /** The drawn needle moves only by this much or more. */
  detentC: number;
  /** Frames quieter than this are unvoiced, dBFS. */
  gateDb: number;
  /** A frame this far below the loudest of the last `peakMs` is a dropout (a dying tail or a deep dip). */
  tailDb: number;
  peakMs: number;
  /** No needle until this much of a run is voiced. */
  showAfterMs: number;
  /** Unvoiced gaps up to this long are bridged: needle, state and hit timer kept. */
  holdMs: number;
  /** After this long unvoiced the needle is hidden (between `holdMs` and this it is dimmed). */
  hideMs: number;
  /** A frame this far from the recent median (unfolded) is held as a glitch ... */
  jumpC: number;
  /** ... for up to this long; still away after that, it is a new pitch. */
  jumpHoldMs: number;
  /** The centre this far from the smoothed value ... */
  snapC: number;
  /** ... for this long makes the smoothed value jump to it. */
  snapMs: number;
  /** Width of the hysteresis around the band (enter at band − hystC/2, leave at band + hystC/2). */
  hystC: number;
  enterDwellMs: number;
  exitDwellMs: number;
  /** In tune this long, with the median of that time within the band, is a hit. */
  hitMs: number;
  /** The shortest centre window. */
  minCentreMs: number;
  /** Leave at once when the short centre is beyond `fastExitFactor` × band for `fastExitMs`. */
  fastExitFactor: number;
  fastExitMs: number;
  /** The wobble width (10th to 90th percentile) is taken over this window. */
  spreadMs: number;
}

/** Whether the needle is fed: a voiced frame, a bridged gap or held glitch, a dimmed gap, or nothing to show. */
export type SteadinessGap = 'none' | 'bridged' | 'dim' | 'hidden';

/** What the display filter shows at a frame (fractional concert MIDI, unfolded: the screen folds to the target). */
export interface SteadinessReading {
  /** The drawn needle value (median, smoother, snap, detent), or null when there is nothing to show. */
  settledMidi: number | null;
  /** The short centre (the running median), for the fast exit; null until shown. */
  centreMidi: number | null;
  /** The in-tune median over `judgeMs`; null until the run has a full window. */
  judgeMidi: number | null;
  /** The median of the last `hitMs` (the hit's accuracy test); null with `judgeMidi`. */
  holdMidi: number | null;
  /** The wobble width: 10th and 90th percentile of the last `spreadMs`; null until shown. */
  spreadLoMidi: number | null;
  spreadHiMidi: number | null;
  /** Length of the current voiced run, ms (0 when none). */
  voicedMs: number;
  gap: SteadinessGap;
  /** Bumped when a new run starts (after a dimmed gap, or a jump confirmed as a new pitch). */
  runId: number;
}

/** One pitch-mode frame (input time, seconds). `MatchNoteService` turns it into a `MatchFrame` in milliseconds. */
export interface PitchModeFrame {
  t: ClockSeconds;
  /** Nearest concert MIDI note, or null when no pitch is heard. */
  midi: number | null;
  /** Deviation from `midi`, cents (-50 to 50), or null. */
  cents: number | null;
  /** Window level, dBFS. */
  levelDb: number;
  steady: boolean;
  /** The display filter's reading (round 3). */
  reading: SteadinessReading;
}

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
      /** The try's diagnostics trace (round 2 detection, src/session/diagnostics.ts). */
      trace?: WorkerTrace;
    }
  /** Pitch mode (Match a note): the frames of one capture block, about 50 per second. */
  | { v: 1; type: 'pitch-frames'; frames: PitchModeFrame[] }
  | { v: 1; type: 'error'; message: string };

/**
 * What the DSP worker keeps of a try for its diagnostics trace (round 2 detection): pitch frames decimated to about
 * 50 Hz (input times, fractional MIDI or null, clarity, dBFS), every detected note including those the follower
 * ignored, and, only when `DspConfig.traceAudio` is set (an explicit opt-in), the analysed low band.
 */
export interface WorkerTrace {
  frames: { t: number[]; midi: (number | null)[]; clarity: number[]; levelDb: number[] };
  detected: DetectedNote[];
  audio?: { rate: number; startT: number; samples: Float32Array };
}

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
  /** Accent the first beat of each bar; absent means true (until every caller sets it). */
  accent?: boolean;
}

/** One note for `AudioBackend.playNotes`. */
export interface PlayNote {
  /** Sounding frequency, Hz. */
  hz: number;
  /** Start, seconds after the start of the call's schedule origin (`opts.at`). */
  startSec: number;
  durSec: number;
}

/**
 * A sample set: a folder name under `public/sounds/` and a key of `sets` in `public/sounds/index.json` (round 2,
 * 02-sounds.md). `soundSetFor` in `src/instruments/sound-sets.ts` maps an instrument to its set.
 */
export type SoundSetId =
  | 'flute'
  | 'clarinet'
  | 'sax-alto'
  | 'trumpet'
  | 'violin'
  | 'cello'
  | 'piano'
  | 'voice-soprano'
  | 'voice-mezzo'
  | 'voice-alto'
  | 'voice-tenor'
  | 'voice-baritone'
  | 'voice-bass'
  | 'sax-tenor'
  | 'sax-bari'
  | 'oboe'
  | 'bassoon'
  | 'horn'
  | 'trombone'
  | 'tuba'
  | 'viola'
  | 'double-bass'
  | 'guitar'
  | 'choir-aah';

export interface PlayNotesOptions {
  /** Context time of the schedule origin; default now. */
  at?: ClockSeconds;
  /** Peak level, 0..1. */
  peak: number;
  /**
   * Play the notes with this sample set. Without it, or while the set loads, when a fetch fails or when the set is
   * missing, the notes play with the additive Listen voice (round 2 decision 3).
   */
  sound?: SoundSetId;
  /** Overrides the set's attack, seconds (Match a note: about 0.08 s). Ignored by the additive voice. */
  attackSec?: number;
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
  /** Plays notes at sounding pitch for reference playback (06 §9). Cancelled by `stopSounds`. */
  playNotes(notes: readonly PlayNote[], opts: PlayNotesOptions): Promise<void>;
  /**
   * Starts loading a sample set (hover or focus of an instrument row, before Listen). `ready` when the set will play,
   * `fallback` when `playNotes` would use the additive voice (missing set, failed fetch or decode). Never rejects.
   */
  prepareSound(id: SoundSetId): Promise<'ready' | 'fallback'>;
  /** Previews and lead-ins: one click per time; `accents[i]` true accents click i. Cancelled by `stopSounds`. */
  playClicks(times: ClockSeconds[], sound: MetronomeSound, accents: boolean[]): Promise<void>;
  /** Cancels everything scheduled by playNotes (samples too), playClicks, playTone and playCalibrationClicks; never a running take. */
  stopSounds(): void;
  /** Counts worklet input frames against wall time (01 §7.8). */
  measureClockRate(durSec: number): Promise<{ framesPerSec: number; expected: number }>;
  onRouteChange(cb: (r: AudioRouteInfo) => void): () => void;
  onInterruption(cb: (reason: 'interrupted' | 'hidden' | 'track-ended' | 'device-change') => void): () => void;
  close(): Promise<void>;
  /** True when the main-thread relay is in use (AudioEnv.captureRelay). P0b addition. */
  readonly captureRelay: boolean;
  /**
   * Stops the microphone track and its capture graph; output and the context stay (round 2, Match a note: leaving the
   * screen releases the microphone). The next `unlock` opens the microphone again. Optional until every backend has it.
   */
  releaseInput?(): void;
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
