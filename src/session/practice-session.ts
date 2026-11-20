/**
 * `PracticeSession` (01 §5.9, P16): the practice loop's state machine.
 *
 *   idle -> loading -> covered --revealScan--> scanning --startTake (gesture, or strict expiry when ranked, R6)-->
 *   count-in -> performing -> finishing -> results;  any -> error
 *
 * What it owns (02 §4.5 to §5.4, 04 §3.3, §5.3, §5.10, 05 W4, W7):
 * - selection through `selectAndPrepare` with a loader built on `loadExcerpt`, and the selection history;
 * - reveal marks the dedupeGroup seen at once (02 §5.3), before any take;
 * - the strict scan timer on the audio clock (ranked auto-starts the count-in at 0; practice never does);
 * - the take: voice reference before every voice count-in (R7), the metronome schedule, the DSP worker (config,
 *   blocks in relay mode, end), the count-in recheck on speakers (01 §7.7, R31), the end of take one beat after the
 *   last note's written end (R14);
 * - Stop rules (02 §5.3): a ranked Stop before the first note re-runs the count-in once, a second one voids;
 * - voids: interruption, page hidden, track ended, device change, capture backlog and gaps, no signal (01 §7.9);
 * - grading (`gradeWithPatterns`), tips (`selectTips`, never for voids), progression (`applyAttemptOnDay` on the
 *   local day, `xpInputFor`), skip rules (`postRevealSkipAllowed`, R33), the measurement gate (session/gates), and
 *   persistence through the store repositories.
 *
 * Time: every deadline is on the backend's clock (`audio.now()`, the input timeline). `poll()` checks them; it runs on
 * an interval (`pollMs`, default 20 ms), on every relayed capture block, or by hand (`pollMs: 'manual'`, Node tests
 * on the fake backend whose clock moves only when the test advances it).
 *
 * Follower events go out on `events` as `{ type: 'follower' }` the moment the worker posts them; the overlay
 * subscribes there. `view` is the Zustand store screens read (no per-note state in it).
 *
 * "Hear it" (05 §9): `hearTempo`, `hearKey`, `playVoiceReference`, `listen`, `listenFirst`, `hearBar`, `playNote`,
 * `previewSound` and `stopSounds`, one sound at a time through `SoundPlayer` (its store is `sounds`). Nothing plays
 * from the start of the count-in to the end of the take except the metronome and the voice reference (R7): every
 * sound method refuses during a take, and `startTake` (also the ranked auto start) stops any sound first. Listening
 * first in a ranked read-through makes the take practice and records `listened-first` in place of `practice-mode`
 * (08 decision 7); `src/grade` is not involved.
 */
import type {
  AudioBackend,
  AudioRouteInfo,
  CaptureBlock,
  ClickSpec,
  MessagePortLike,
  PlatformServices,
  WorkerLike,
  WorkerMessage,
  WorkerReply,
} from '../core/platform.ts';
import type { PracticeSessionDeps, PracticeSessionInstance } from '../core/api.ts';
import type {
  AttemptRecheck,
  AttemptRecord,
  AttemptScore,
  Calibration,
  ClockSeconds,
  Configs,
  CorpusManifest,
  DetectedNote,
  DspConfig,
  EndReason,
  ExcerptDoc,
  ExpectedNote,
  FinalAlignment,
  FollowConfig,
  FollowerEvent,
  GateId,
  GradeInput,
  MetronomeSound,
  OwnSound,
  PlayerProfile,
  PracticeSettings,
  PreparedExcerpt,
  ProgressEvent,
  RankedReason,
  RecheckResult,
  Rng,
  SelectionHistory,
  SelectionResult,
  SessionErrorCode,
  SessionEvent,
  SessionState,
  Tip,
  VoidReason,
} from '../core/types.ts';
import { metronomeSoundOf } from '../core/click-sounds.ts';
import { createEmitter } from '../core/events.ts';
import { createRng } from '../core/rng.ts';
import { CorpusLoadError, loadExcerpt, prepareExcerpt, selectAndPrepare } from '../corpus/index.ts';
import { DspPipeline } from '../dsp/pipeline.ts';
import { alignFinalWithReference, ignoredNote, liveOutcomeOf, withOwnPlayback } from '../follow/index.ts';
import { DiagnosticsStore, buildTryTrace, diagnosticsFile, diagnosticsFileName, type DiagnosticsFile, type DiagnosticsSettings, type TryTrace } from './diagnostics.ts';
import {
  applyAttemptOnDay,
  createProfile,
  gradeWithPatterns,
  hasSeen,
  newInstrumentProgress,
  postRevealSkipAllowed,
  xpInputFor,
} from '../grade/index.ts';
import { selectTips } from '../tips/index.ts';
import { midiToFreq } from '../theory/index.ts';
import {
  CountInRecheck,
  applyRecheckToCalibration,
  decideRecheck,
  reportedCalibration,
  staleOnRouteChange,
  withRecheckSpec,
  type WorkerRecheckSpec,
} from '../calibration/index.ts';
import { buildAudioEnv, calibrationForRoute, evaluateTakeGate, rankedAvailability, type RankedAvailability } from './gates/index.ts';
import {
  LISTEN,
  chordLengthSec,
  keyChordTones,
  listenSourceOf,
  planBars,
  planClickBar,
  planListen,
  type ListenOptions,
  type ListenPlan,
} from './listen-plan.ts';
import { SoundPlayer, type SoundSegment, type SoundView } from './sounds.ts';
import {
  creditOf,
  dspConfigFor,
  followConfigFor,
  planTake,
  onsetHints,
  referenceLengthSec,
  repeatHints,
  takesTuningNote,
  tuningOffsetFrom,
  voiceReferenceTones,
  type TakePlan,
} from './take-plan.ts';
import { createSessionStore, type SessionView } from './view-store.ts';
import type { StoreApi } from 'zustand/vanilla';

/** Timers the session uses (core has no DOM or Node timer types; the browser's satisfy this). */
export interface SessionTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Options beyond the frozen deps (all optional; the frozen constructor signature is unchanged). */
export interface PracticeSessionOptions {
  appVersion?: string;
  coreVersion?: string;
  appBuild?: string;
  /**
   * Port mode (01 §7.2): a channel whose `port1` goes to `startCapture` and whose `port2` is transferred to the worker
   * with 'config'. Without it the session relays capture blocks to the worker itself (the 01 §7.2 fallback), which
   * also lets it run the count-in recheck (01 §7.7) on the main thread.
   */
  createCaptureChannel?: () => { port1: MessagePortLike; port2: unknown };
  timers?: SessionTimers;
  /** Clock poll interval, ms (default 20); 'manual' = the caller calls `poll()`. */
  pollMs?: number | 'manual';
  /** Selection RNG (default seeded from `idGen()`). */
  rng?: Rng;
  /** Seconds from scheduling to the first count-in click (01 §7.1: at least 0.5; default 0.6). */
  leadSec?: number;
  /** Longest wait for the worker's 'done' after 'end', ms (default 3000). */
  finishTimeoutMs?: number;
  /** Store `debug.live` on attempts (dev flag, 01 §6.5). */
  dev?: boolean;
  /** Accent gain of the metronome, dB (01 §7.6: +5). */
  accentDb?: number;
  /** Display name of a new profile. */
  displayName?: string;
  /**
   * Test clock (01 §13.4 `?testClock=1`): use this round-trip latency, ms, instead of the stored or reported
   * calibration. The test WAV is rendered with bar 1 beat 1 at the backend's test-clock t0, so RTL is 0.
   */
  rtlOverrideMs?: number;
  /**
   * The player's sound settings now (Settings can change them between takes): metronome sound, "Accent the first
   * beat", tuning pitch and the listening setting. Absent: the excerpt's settings, else Classic, accented, 440 Hz.
   */
  soundPrefs?: () => SoundPrefs;
}

/** What every "Hear it" sound reads from the player's settings. */
export interface SoundPrefs {
  sound: MetronomeSound;
  accent: boolean;
  a4Hz: number;
  /** The listening setting: restored on the backend after an output-only unlock. */
  listening: boolean;
}

/** Listen on results or history: the options plus, for history, the stored attempt to play. */
export interface ListenRequest extends ListenOptions {
  /** A stored attempt (attempt detail). Absent: the excerpt on screen. */
  record?: AttemptRecord;
}

/** A session error with one of 04's copy codes. */
export class SessionError extends Error {
  readonly code: SessionErrorCode;
  constructor(code: SessionErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SessionError';
    this.code = code;
  }
}

type DoneReply = Extract<WorkerReply, { type: 'done' }>;

/** Optional backend members (WebAudioBackend has them; the seam does not). */
interface BackendExtras {
  onCaptureFault?: (cb: (f: { kind: 'backlog' | 'capture-gap' }) => void) => () => void;
  setOutputMode?: (mode: PracticeSettings['outputMode']) => void;
  /** Practise without listening (R13): unlock without asking for the microphone. */
  setInputEnabled?: (on: boolean) => void;
  captureStats?: () => { droppedBlocks: number; maxQueueMs: number };
}

interface Current {
  /** As requested (random fields stay random). */
  settings: PracticeSettings;
  /** Effective mode: Try again is practice. */
  mode: 'ranked' | 'practice';
  selection: SelectionResult;
  prepared: PreparedExcerpt;
  doc: ExcerptDoc;
  plan: TakePlan;
  /** Revealed before this reveal (02 §5.3), fixed at reveal. */
  seenBefore: boolean;
  /** A replacement served after the post-reveal skip limit (02 §5.3). */
  skipLimitHit: boolean;
  placement: boolean;
  revealed: boolean;
  scanStart: number | null;
  scanSec: number;
  scanExpired: boolean;
  lastTick: number | null;
  /** Ranked Stops before the first note in this excerpt's take (02 §5.3). */
  stopsBeforeFirstNote: number;
  /** Count-in restarts for a missing first click (01 §7.1: once). */
  firstClickRestarts: number;
  /** Listened first in a ranked read-through: practice, recorded as `listened-first` (08 decision 7). */
  listenedFirst: boolean;
}

interface Take {
  gen: number;
  listening: boolean;
  worker: WorkerLike | null;
  relay: boolean;
  route: AudioRouteInfo;
  t0: number;
  /** Take end on the input timeline. */
  endT: number;
  clicks: ClickSpec[];
  countIn: ClickSpec[];
  countInEmitted: number;
  performing: boolean;
  rtlSec: number;
  /** Stored calibration for the route, any method, or null. */
  stored: Calibration | null;
  /** The calibration the latency came from (stored, or a reported estimate). */
  used: Calibration;
  follow: FollowConfig | null;
  recheck: CountInRecheck | null;
  recheckResult: RecheckResult | null;
  tuning: { used: boolean; offsetCents: number } | null;
  firstNoteHeard: boolean;
  liveEvents: FollowerEvent[];
  alignment: FinalAlignment | null;
  done: Promise<DoneReply | null>;
  resolveDone: (d: DoneReply | null) => void;
  lastSeq: number | null;
  seqGaps: number;
  ending: boolean;
  scanSeconds: number;
  analysisRate: number | null;
  /** End of the last relayed block on the input timeline (relay mode), or null. */
  lastBlockEnd: number | null;
  /** Diagnostics (round 2): the worker's configs, the reference tones, and follower events with their arrival time. */
  dspCfg: DspConfig | null;
  ownTones: OwnSound[];
  traceEvents: { at: number; event: FollowerEvent }[];
}

const EMPTY_ALIGNMENT: FinalAlignment = { judgments: [], extras: [], displaced: [] };
const SCAN_STRICT_SLACK_SEC = 0.25;
const VOICE_REFERENCE_LEAD_SEC = 0.1;
const AFTER_REFERENCE_SEC = 0.5;
/** A metronome click as an own sound (its burst and the first room reflections), seconds. */
const CLICK_SOUND_SEC = 0.04;

const defaultTimers = (): SessionTimers => {
  const g = globalThis as unknown as {
    setInterval(fn: () => void, ms: number): unknown;
    clearInterval(h: unknown): void;
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(h: unknown): void;
  };
  return {
    setInterval: (fn, ms) => g.setInterval(fn, ms),
    clearInterval: (h) => g.clearInterval(h),
    setTimeout: (fn, ms) => g.setTimeout(fn, ms),
    clearTimeout: (h) => g.clearTimeout(h),
  };
};

const seedOf = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** A drop of the audio clock larger than this between polls means a new context, not jitter, seconds. */
const CLOCK_RESET_SEC = 0.25;

function micErrorCode(e: unknown): SessionErrorCode {
  const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'mic-denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'mic-not-found';
  return 'audio-setup';
}

export class PracticeSession implements PracticeSessionInstance {
  readonly events = createEmitter<SessionEvent>();
  /** The Zustand store screens read. */
  readonly view: StoreApi<SessionView>;

  private readonly platform: PlatformServices;
  private readonly audio: AudioBackend & BackendExtras;
  private readonly cfg: Configs;
  private readonly manifest: CorpusManifest;
  private readonly workerFactory: () => WorkerLike;
  private readonly opts: PracticeSessionOptions;
  private readonly timers: SessionTimers;
  private readonly player: SoundPlayer;
  /** Per-try traces (round 2 detection), device-local. */
  private readonly diagnostics: DiagnosticsStore;
  /** The last failure to store a trace (diagnostics only), or null. */
  diagnosticsError: unknown = null;
  /** The "Hear it" store: what is sounding, its caption and bar (05 §8.8, §9.3). */
  readonly sounds: StoreApi<SoundView>;
  /** Prepared excerpts of stored attempts (history Listen), by attempt id. */
  private readonly recordPrepared = new Map<string, Promise<PreparedExcerpt | null>>();
  private readonly rng: Rng;
  private readonly docCache = new Map<string, ExcerptDoc>();
  private readonly unsubs: (() => void)[] = [];

  private _state: SessionState = 'idle';
  private profile: PlayerProfile | null = null;
  private current: Current | null = null;
  private take: Take | null = null;
  private gen = 0;
  private route: AudioRouteInfo | null = null;
  /** The unlock `ensureAudio` started and that has not settled yet; null on failure (the session already failed). */
  private pendingUnlock: Promise<AudioRouteInfo | null> | null = null;
  /** The settings of the last `prepare`, for `retry` after a failed prepare. */
  private lastSettings: PracticeSettings | null = null;
  private _lastError: SessionError | null = null;
  /** The audio clock at the last poll, to notice a context that was reopened (its clock starts at 0). */
  private lastPollClock: number | null = null;
  private pollHandle: unknown = null;
  private persistChain: Promise<void> = Promise.resolve();
  private finishing: Promise<AttemptRecord | null> | null = null;
  private startingTake: Promise<void> | null = null;
  /** Groups skipped before reveal this session: kept out of the next draws without marking them seen. */
  private readonly skippedGroups = new Map<string, string>();
  /** Tuning-note offsets captured this session, per instrument (02 §4.5). */
  private readonly tuning = new Map<string, number>();
  private referenceEndsAt: number | null = null;
  private lastRecord: AttemptRecord | null = null;
  private disposed = false;

  constructor(deps: PracticeSessionDeps, options: PracticeSessionOptions = {}) {
    this.platform = deps.platform;
    this.audio = deps.platform.audio as AudioBackend & BackendExtras;
    this.cfg = deps.configs;
    this.manifest = deps.manifest;
    this.workerFactory = deps.workerFactory;
    this.opts = options;
    this.timers = options.timers ?? defaultTimers();
    this.rng = options.rng ?? createRng(seedOf(deps.platform.idGen()));
    const { store, detach } = createSessionStore(this.events);
    this.view = store;
    this.player = new SoundPlayer(this.audio, this.timers);
    this.diagnostics = new DiagnosticsStore(deps.platform.kv);
    this.sounds = this.player.view;
    this.unsubs.push(detach);
    this.unsubs.push(this.audio.onInterruption((r) => this.voidTake(r === 'device-change' ? 'device-change' : 'interrupted')));
    this.unsubs.push(this.audio.onRouteChange((r) => this.onRouteChange(r)));
    this.unsubs.push(this.platform.lifecycle.onVisibility((visible) => !visible && this.voidTake('interrupted')));
    if (typeof this.audio.onCaptureFault === 'function') {
      this.unsubs.push(this.audio.onCaptureFault((f) => this.voidTake(f.kind === 'backlog' ? 'backlog' : 'capture-gap')));
    }
  }

  get state(): SessionState {
    return this._state;
  }

  /** The excerpt on screen, or null. */
  get prepared(): PreparedExcerpt | null {
    return this.current?.prepared ?? null;
  }

  /** Ranking facts of the current excerpt, for the scan chip and tests. */
  get pending(): { mode: 'ranked' | 'practice'; seenBefore: boolean; skipLimitHit: boolean; revealed: boolean; scanSec: number; listenedFirst: boolean } | null {
    const c = this.current;
    return c ? { mode: c.mode, seenBefore: c.seenBefore, skipLimitHit: c.skipLimitHit, revealed: c.revealed, scanSec: c.scanSec, listenedFirst: c.listenedFirst } : null;
  }

  /** The last attempt record produced, or null. */
  get record(): AttemptRecord | null {
    return this.lastRecord;
  }

  /** The profile as the session last saw or changed it, or null before the first `prepare`. */
  get currentProfile(): PlayerProfile | null {
    return this.profile;
  }

  /** The take plan of the excerpt on screen (expected notes, tempo, take length), or null. */
  get plan(): TakePlan | null {
    return this.current?.plan ?? null;
  }

  /**
   * Drops the cached profile so the next `prepare` reads it from the store again. The composition root calls this
   * after it saves a profile change the session did not make (level offers, placement, settings, import).
   */
  invalidateProfile(): void {
    if (!this.inTake()) this.profile = null;
  }

  // ---- prepare and reveal -------------------------------------------------------------------

  async prepare(s: PracticeSettings): Promise<PreparedExcerpt> {
    if (this.inTake()) throw new SessionError('unknown', 'prepare during a take');
    this.lastSettings = s;
    this.setState('loading');
    try {
      const profile = await this.loadProfile(s.instrumentId);
      const history = await this.history(profile, s);
      const r = await selectAndPrepare(this.manifest, s, history, this.cfg, this.rng, (id) => loadExcerpt(this.manifest, id, this.platform.assets), this.docCache);
      if ('error' in r) {
        this.emit({ type: 'empty-pool', suggestions: r.suggestions });
        throw new SessionError('empty-pool', 'no eligible excerpt for these settings');
      }
      const plan = planTake(r.prepared, this.cfg);
      const progress = profile.instruments[s.instrumentId];
      this.current = {
        settings: s,
        mode: s.mode,
        selection: r.selection,
        prepared: r.prepared,
        doc: r.doc,
        plan,
        seenBefore: hasSeen(profile, r.prepared.dedupeGroup),
        skipLimitHit: false,
        placement: s.mode === 'ranked' && !!progress?.placement,
        revealed: false,
        scanStart: null,
        scanSec: this.cfg.levelByNumber[r.prepared.levelServed]?.scanSec ?? 30,
        scanExpired: false,
        lastTick: null,
        stopsBeforeFirstNote: 0,
        firstClickRestarts: 0,
        listenedFirst: false,
      };
      this.emit({ type: 'prepared', excerpt: r.prepared });
      this.setState('covered');
      this.syncMode(this.current);
      return r.prepared;
    } catch (e) {
      throw this.fail(e instanceof CorpusLoadError ? new SessionError('corpus-load', e.message, { cause: e }) : e);
    }
  }

  ensureAudio(): Promise<AudioRouteInfo> {
    // 05 W1: the backend's synchronous part (audio session type, context, resume) must run inside the gesture.
    const mode = this.current?.settings.outputMode;
    if (mode && typeof this.audio.setOutputMode === 'function') this.audio.setOutputMode(mode);
    const listening = this.current?.settings.listening;
    if (listening !== undefined && typeof this.audio.setInputEnabled === 'function') this.audio.setInputEnabled(listening);
    let p: Promise<AudioRouteInfo>;
    try {
      p = this.audio.unlock();
    } catch (e) {
      p = Promise.reject(e);
    }
    void this.platform.keepAwake(true).catch(() => undefined);
    const done = p.then(
      (route) => {
        this.route = route;
        return route;
      },
      (e: unknown) => {
        throw this.fail(new SessionError(micErrorCode(e), e instanceof Error ? e.message : String(e), { cause: e }));
      },
    );
    // A take started before the unlock settles (a permission prompt, a reopened context) waits for it.
    const pending: Promise<AudioRouteInfo | null> = done.then(
      (r) => r,
      () => null,
    );
    this.pendingUnlock = pending;
    void pending.then(() => {
      if (this.pendingUnlock === pending) this.pendingUnlock = null;
    });
    return done;
  }

  /**
   * The audio was closed between takes (the page was hidden, the player left Practice, results sat idle; 05 W2).
   * The route is gone, so the next take needs `ensureAudio` from a gesture again (Start playing calls it).
   */
  audioClosed(): void {
    if (this.inTake()) return;
    this.route = null;
    this.pendingUnlock = null;
  }

  /**
   * Try again after an error: the step that failed runs again. A failed prepare prepares the same settings again; a
   * take that failed to start goes back to the read-through (a ranked take whose time ran out starts again at once,
   * so call `ensureAudio` from the same gesture first). Returns false when there is nothing to retry.
   */
  retry(): boolean {
    if (this._state !== 'error') return false;
    const c = this.current;
    if (c) {
      this.setState(c.revealed ? 'scanning' : 'covered');
      if (c.revealed) this.startPolling();
      return true;
    }
    const s = this.lastSettings;
    if (!s) return false;
    void this.prepare(s).catch(() => undefined);
    return true;
  }

  revealScan(): void {
    const c = this.current;
    if (!c || this._state !== 'covered') throw new SessionError('unknown', `revealScan in state ${this._state}`);
    this.reveal(c);
    this.startScan(c);
  }

  /** "Try again (practice)": the same excerpt, practice, cover skipped (04 §5.5.5). */
  tryAgain(): void {
    const c = this.current;
    if (!c || this._state !== 'results') throw new SessionError('unknown', `tryAgain in state ${this._state}`);
    c.mode = 'practice';
    c.skipLimitHit = false;
    c.placement = false;
    c.stopsBeforeFirstNote = 0;
    c.firstClickRestarts = 0;
    // Try again is practice by choice, so its reason is `practice-mode` again.
    c.listenedFirst = false;
    this.startScan(c);
    this.syncMode(c);
  }

  /** Mirrors the excerpt's mode into the view (the scan chip; 05 §4.3 step 4). */
  private syncMode(c: Current): void {
    const v = this.view.getState();
    if (v.mode !== c.mode || v.listenedFirst !== c.listenedFirst) this.view.setState({ mode: c.mode, listenedFirst: c.listenedFirst });
  }

  private reveal(c: Current): void {
    if (c.revealed) return;
    c.revealed = true;
    c.seenBefore = this.profile ? hasSeen(this.profile, c.prepared.dedupeGroup) : c.seenBefore;
    // 02 §5.3: seen at reveal, per player, by dedupeGroup, across instruments; persisted now, not at take end.
    const p = this.requireProfile();
    if (!(c.prepared.dedupeGroup in p.seenGroups)) {
      this.profile = { ...p, seenGroups: { ...p.seenGroups, [c.prepared.dedupeGroup]: this.platform.clockWall() } };
      this.persistProfile();
    }
  }

  private startScan(c: Current): void {
    c.scanStart = this.audio.now() as number;
    this.lastPollClock = null;
    c.scanExpired = false;
    c.lastTick = null;
    this.setState('scanning');
    this.startPolling();
    this.poll();
  }

  // ---- the take ---------------------------------------------------------------------------------

  startTake(): Promise<void> {
    if (this.startingTake) return this.startingTake;
    const c = this.current;
    if (!c || (this._state !== 'scanning' && this._state !== 'covered')) return Promise.reject(new SessionError('unknown', `startTake in state ${this._state}`));
    if (this._state === 'covered') this.reveal(c);
    // 05 §9.3: "Start playing" and the ranked auto start stop any sound at once; nothing but the metronome and the
    // voice reference plays from here to the end of the take (05 §16 item 11).
    this.player.stop();
    const scanSeconds = c.scanStart === null ? 0 : (this.audio.now() as number) - c.scanStart;
    this.setState('count-in');
    const p = this.beginTake(c, scanSeconds).catch((e: unknown) => {
      this.abandonTake();
      throw this.fail(e);
    });
    this.startingTake = p.finally(() => {
      this.startingTake = null;
    });
    return this.startingTake;
  }

  private async beginTake(c: Current, scanSeconds: number): Promise<void> {
    const s = c.settings;
    const plan = c.plan;
    const audio = this.audio;
    // The backend is unlocked only by `ensureAudio` inside a gesture (05 W1, W4); never resume it from here. An unlock
    // still in flight (Start playing calls ensureAudio first) is waited for.
    const route = this.route ?? (this.pendingUnlock ? await this.pendingUnlock : null);
    if (!route) throw new SessionError('audio-setup', 'audio is not open (the page was hidden, Practice was left, or it was never opened): ensureAudio() must run in a gesture before the take');
    const gen = ++this.gen;
    const listening = s.listening;
    const leadBase = this.opts.leadSec ?? 0.6;
    let leadSec = leadBase;

    // R7: the voice reference plays before every voice count-in, in every mode.
    let ownTones: OwnSound[] = [];
    if (plan.inst.family === 'voice') {
      const ref = await this.playReference(c);
      ownTones = ref.sounds;
      leadSec = Math.max(leadBase, ref.end - (audio.now() as number) + AFTER_REFERENCE_SEC);
    }

    const stored = (await this.platform.repos.calibrations.get(route.routeKey)) ?? null;
    const diagAudio = listening && (await this.diagnostics.settings().catch(() => ({ includeAudio: false }))).includeAudio;
    const used = stored ?? reportedCalibration(route, audio.capabilities.platform, this.cfg.budget.calibration, this.platform.clockWall(), audio.audioInfo().clockRateError);
    const rtlSec = listening ? (this.opts.rtlOverrideMs ?? used.roundTripMs) / 1000 : 0;
    const tuningCents = takesTuningNote(plan.inst) ? this.tuning.get(plan.inst.id) : undefined;
    let resolveDone: (d: DoneReply | null) => void = () => undefined;
    const done = new Promise<DoneReply | null>((r) => {
      resolveDone = r;
    });
    const channel = listening ? this.opts.createCaptureChannel?.() : undefined;
    const take: Take = {
      gen,
      listening,
      worker: null,
      relay: listening && !channel,
      route,
      t0: 0,
      endT: Infinity,
      clicks: [],
      countIn: [],
      countInEmitted: 0,
      performing: false,
      rtlSec,
      stored,
      used,
      follow: null,
      recheck: null,
      recheckResult: null,
      tuning: takesTuningNote(plan.inst) ? { used: tuningCents !== undefined, offsetCents: tuningCents ?? 0 } : null,
      firstNoteHeard: false,
      liveEvents: [],
      alignment: null,
      done,
      resolveDone,
      lastSeq: null,
      seqGaps: 0,
      ending: false,
      scanSeconds,
      analysisRate: null,
      lastBlockEnd: null,
      dspCfg: null,
      ownTones,
      traceEvents: [],
    };
    this.take = take;

    if (listening) {
      const worker = this.workerFactory();
      take.worker = worker;
      worker.onmessage = (ev) => this.onWorker(take, ev.data);
      if (channel) await audio.startCapture(channel.port1);
      else await audio.startCapture((m) => this.onBlock(take, m));
    }
    const sched = await audio.scheduleTake({
      leadSec,
      bpm: plan.bpm,
      beatsPerBar: plan.beatsPerBar,
      countInBeats: plan.countInBeats,
      totalBeats: plan.totalBeats,
      mode: s.metronome,
      timbre: s.clickTimbre,
      accentDb: this.opts.accentDb ?? 5,
      accent: s.accentFirstBeat ?? true,
    });
    if (this.take !== take) return; // voided or stopped while scheduling
    take.t0 = sched.t0 as number;
    take.clicks = sched.clicks;
    take.countIn = sched.clicks.filter((k) => k.countIn);
    take.endT = take.t0 + rtlSec + plan.endSec;

    if (listening && take.worker) {
      const contextRate = audio.audioInfo().contextSampleRate;
      const analysisRate = contextRate / Math.max(1, Math.round(contextRate / 16000));
      take.analysisRate = analysisRate;
      const follow = withOwnPlayback(
        followConfigFor(plan, c.prepared, this.cfg, { t0: take.t0, rtlSec, analysisRate, tuningCents: tuningCents ?? 0 }),
        [...ownTones, ...sched.clicks.map((k) => ({ t: k.t, durSec: CLICK_SOUND_SEC, hz: null }))],
      );
      take.follow = follow;
      const dsp = dspConfigFor(plan.inst, this.cfg, {
        analysisRate,
        outputMode: s.outputMode,
        a4Hz: s.a4Hz,
        clicks: sched.clicks,
        rtlSec,
        timbre: s.clickTimbre,
        calibration: stored,
        repeatHints: repeatHints(plan, take.t0, rtlSec),
        level: plan.level,
        onsetHints: onsetHints(plan, take.t0, rtlSec),
      });
      // Diagnostics (round 2): the try's low band is kept only with the opt-in setting.
      if (diagAudio) dsp.traceAudio = true;
      take.dspCfg = dsp;
      const recheckOn = s.outputMode === 'speakers' && take.countIn.length > 0;
      const first = take.countIn[0];
      const template = stored?.templates[s.clickTimbre];
      const spec: WorkerRecheckSpec | null =
        recheckOn && first
          ? {
              inputRate: contextRate,
              countIn: take.countIn.map((k) => ({ t: k.t as number, accent: k.accent })),
              timbre: s.clickTimbre,
              template: template ? [...template.samples] : null,
              silence: { t0: (first.t as number) - 0.4, t1: first.t as number },
            }
          : null;
      // Port mode (R55): blocks never reach this thread, so the worker runs the recheck and posts 'recheck'. The
      // frozen 'config' message has no field for it; the spec rides on the DspConfig object (calibration/recheck.ts).
      const msg: WorkerMessage = { v: 1, type: 'config', cfg: spec && channel ? withRecheckSpec(dsp, spec) : dsp, follow };
      if (channel) take.worker.postMessage(msg, [channel.port2]);
      else take.worker.postMessage(msg);
      if (spec && take.relay) {
        take.recheck = new CountInRecheck(spec.inputRate, spec.countIn, {
          timbre: spec.timbre,
          template: spec.template,
          budget: this.cfg.budget.calibration,
          ...(spec.silence ? { silence: spec.silence } : {}),
        });
      }
    }
    this.startPolling();
    this.poll();
  }

  /**
   * Plays the voice reference now (R7); returns the clock time it ends and its tones as own sounds (the follower
   * never takes them for the singer's notes). Its live caption follows it (05 §8.9).
   */
  private async playReference(c: Current): Promise<{ end: number; sounds: OwnSound[] }> {
    const { tones, request } = this.referenceSound(c);
    const at = (this.audio.now() as number) + VOICE_REFERENCE_LEAD_SEC;
    this.player.follow(request, at);
    await Promise.all(tones.map((t) => this.audio.playTone(t.hz, t.durSec, (at + t.atSec) as ClockSeconds)));
    this.referenceEndsAt = at + referenceLengthSec(tones);
    return { end: this.referenceEndsAt, sounds: tones.map((t) => ({ t: (at + t.atSec) as ClockSeconds, durSec: t.durSec, hz: t.hz })) };
  }

  /** The voice reference's tones (as today, at the excerpt's tuning pitch) and its captions. */
  private referenceSound(c: Current): { tones: ReturnType<typeof voiceReferenceTones>; request: { kind: 'reference'; durSec: number; segments: SoundSegment[] } } {
    const first = c.plan.expected[0] as ExpectedNote;
    const tones = voiceReferenceTones(c.prepared, first.concertMidi, c.settings.a4Hz);
    const firstTone = tones[tones.length - 1] as { atSec: number };
    return {
      tones,
      request: {
        kind: 'reference',
        durSec: referenceLengthSec(tones),
        segments: [
          { atSec: 0, caption: { kind: 'key-chord', writtenKey: c.prepared.writtenKey, concertKey: c.prepared.concertKey } },
          { atSec: firstTone.atSec, caption: { kind: 'first-note', written: first.writtenPitch, concertMidi: first.concertMidi } },
        ],
      },
    };
  }

  /** "Hear starting pitch" (voice, 05 §8.8, §10): the key chord, then the first note. Never changes the take. */
  playVoiceReference(): Promise<void> {
    const c = this.current;
    if (!c) return Promise.reject(new SessionError('unknown', 'no excerpt'));
    if (c.plan.inst.family !== 'voice') return Promise.reject(new SessionError('unknown', 'the voice reference is for voice only (02 §4.5)'));
    const refused = this.refuseSound('voice reference');
    if (refused) return refused;
    const unlocked = this.unlockForSound();
    const { tones, request } = this.referenceSound(c);
    return unlocked.then(() =>
      this.player.play({
        ...request,
        schedule: async (at) => {
          await Promise.all(tones.map((t) => this.audio.playTone(t.hz, t.durSec, (at + t.atSec) as ClockSeconds)));
          this.referenceEndsAt = at + referenceLengthSec(tones);
        },
      }),
    );
  }

  // ---- "Hear it" (05 §9) ----------------------------------------------------------------------------

  /** The player's sound settings now (Settings may have changed them), else the excerpt's. */
  private prefs(): SoundPrefs {
    const p = this.opts.soundPrefs?.();
    if (p) return p;
    const s = this.current?.settings;
    return { sound: metronomeSoundOf(s?.clickTimbre), accent: s?.accentFirstBeat ?? true, a4Hz: s?.a4Hz ?? 440, listening: s?.listening ?? true };
  }

  /** A sound method during a take (count-in to the end) is refused: the microphone would hear it (05 §9.1, R7). */
  private refuseSound(what: string): Promise<never> | null {
    return this.inTake() ? Promise.reject(new SessionError('unknown', `${what} during a take`)) : null;
  }

  /**
   * The first press of any sound control unlocks audio (05 §9.3): call synchronously from the gesture. Output only:
   * with the input off the backend builds the output path without asking for the microphone, then the listening
   * setting is restored for the next take's `ensureAudio`.
   */
  private unlockForSound(): Promise<unknown> {
    const audio = this.audio;
    const canToggle = typeof audio.setInputEnabled === 'function';
    if (canToggle) audio.setInputEnabled?.(false);
    let p: Promise<unknown>;
    try {
      p = audio.unlock();
    } catch (e) {
      p = Promise.reject(e);
    }
    if (canToggle) audio.setInputEnabled?.(this.current?.settings.listening ?? this.prefs().listening);
    return p.catch((e: unknown) => {
      throw new SessionError('audio-setup', e instanceof Error ? e.message : String(e), { cause: e });
    });
  }

  /** Clicks at plan times from `origin`, through the metronome's sounds (lead-ins, previews, Hear the tempo). */
  private playClicksAt(origin: number, clicks: readonly { atSec: number; accent: boolean }[], sound: MetronomeSound): Promise<void> {
    if (clicks.length === 0) return Promise.resolve();
    return this.audio.playClicks(
      clicks.map((k) => (origin + k.atSec) as ClockSeconds),
      sound,
      clicks.map((k) => k.accent),
    );
  }

  /**
   * "Hear the tempo" (05 §9.1, §9.5): one bar of the chosen metronome sound at `bpm`, the downbeat accented if on.
   * Works with no excerpt (Practice's tempo row); without arguments it uses the excerpt's tempo and meter.
   */
  hearTempo(bpm?: number, beatsPerBar?: number): Promise<void> {
    const refused = this.refuseSound('hear the tempo');
    if (refused) return refused;
    const plan = this.current?.plan;
    const tempo = bpm ?? plan?.bpm;
    const beats = beatsPerBar ?? plan?.beatsPerBar ?? 4;
    if (tempo === undefined || !(tempo > 0)) return Promise.reject(new SessionError('unknown', 'hear the tempo needs a tempo'));
    const unlocked = this.unlockForSound();
    const prefs = this.prefs();
    const bar = planClickBar(tempo, beats, prefs.accent);
    return unlocked.then(() =>
      this.player.play({
        kind: 'tempo',
        durSec: bar.endSec,
        segments: [{ atSec: 0, caption: { kind: 'tempo', bpm: tempo } }],
        schedule: (at) => this.playClicksAt(at, bar.clicks, prefs.sound),
      }),
    );
  }

  /**
   * "Hear the key" (instruments, 05 §9.1, §10): the concert key's home chord, root at or below the first note's
   * sounding pitch, on the Listen voice. Never changes the take.
   */
  hearKey(): Promise<void> {
    const c = this.current;
    if (!c) return Promise.reject(new SessionError('unknown', 'no excerpt'));
    const refused = this.refuseSound('hear the key');
    if (refused) return refused;
    const unlocked = this.unlockForSound();
    const tones = keyChordTones(c.prepared.concertKey, (c.plan.expected[0] as { concertMidi: number }).concertMidi, this.prefs().a4Hz);
    return unlocked.then(() =>
      this.player.play({
        kind: 'key',
        durSec: chordLengthSec(tones),
        segments: [{ atSec: 0, caption: { kind: 'key-chord', writtenKey: c.prepared.writtenKey, concertKey: c.prepared.concertKey } }],
        schedule: (at) =>
          this.audio.playNotes(
            tones.map((t) => ({ hz: t.hz, startSec: t.atSec, durSec: t.durSec })),
            { at: at as ClockSeconds, peak: LISTEN.peak },
          ),
      }),
    );
  }

  /**
   * Listen (05 §9.2, §9.3): one bar of clicks, then the excerpt on screen, or a stored attempt's excerpt (history),
   * from `fromBar`, at the take's tempo or 75% of it. Never changes the take: in a ranked read-through use
   * `listenFirst`.
   */
  listen(o: ListenRequest = {}): Promise<void> {
    const refused = this.refuseSound('listen');
    if (refused) return refused;
    const record = o.record;
    const c = this.current;
    if (!record && !c) return Promise.reject(new SessionError('unknown', 'no excerpt'));
    const unlocked = this.unlockForSound();
    const prefs = this.prefs();
    const source = record ? this.preparedForRecord(record) : Promise.resolve((c as Current).prepared);
    return Promise.all([unlocked, source]).then(([, prepared]) => {
      if (!prepared) throw new SessionError('corpus-load', `the excerpt of attempt ${record?.id ?? ''} is not available`);
      const bpm = record ? record.bpm : (c as Current).plan.bpm;
      const plan = planListen(listenSourceOf(prepared, this.cfg), { bpm, a4Hz: prefs.a4Hz, accent: prefs.accent }, o);
      return this.playPlan('listen', plan, prefs.sound, { fromBar: plan.startBar, slower: !!o.slower, attemptId: record?.id ?? null });
    });
  }

  /**
   * "Listen first" on the read-through (05 §4.3, §9.4): practice plays at once; ranked becomes practice now (the chip
   * changes, the countdown runs on and never auto-starts) and the attempt records `listened-first`.
   */
  listenFirst(): Promise<void> {
    const c = this.current;
    if (!c || (this._state !== 'scanning' && this._state !== 'covered')) return Promise.reject(new SessionError('unknown', `listenFirst in state ${this._state}`));
    if (c.mode === 'ranked') {
      c.mode = 'practice';
      c.listenedFirst = true;
      c.placement = false;
      this.syncMode(c);
    }
    return this.listen({});
  }

  /** "Hear bar n" or "Hear bars n to m" (05 §8.11): one bar of clicks, then the bars twice. */
  hearBar(from: number, to: number = from, o: { record?: AttemptRecord; slower?: boolean } = {}): Promise<void> {
    const refused = this.refuseSound('hear bar');
    if (refused) return refused;
    const record = o.record;
    const c = this.current;
    if (!record && !c) return Promise.reject(new SessionError('unknown', 'no excerpt'));
    const unlocked = this.unlockForSound();
    const prefs = this.prefs();
    const source = record ? this.preparedForRecord(record) : Promise.resolve((c as Current).prepared);
    return Promise.all([unlocked, source]).then(([, prepared]) => {
      if (!prepared) throw new SessionError('corpus-load', `the excerpt of attempt ${record?.id ?? ''} is not available`);
      const bpm = record ? record.bpm : (c as Current).plan.bpm;
      const plan = planBars(listenSourceOf(prepared, this.cfg), { bpm, a4Hz: prefs.a4Hz, accent: prefs.accent }, from, to, o);
      return this.playPlan('bar', plan, prefs.sound, { fromBar: plan.startBar, slower: !!o.slower, attemptId: record?.id ?? null });
    });
  }

  /** A range-picture note (05 §9.1): that concert MIDI note for one second on the Listen voice. */
  playNote(concertMidi: number): Promise<void> {
    const refused = this.refuseSound('play a note');
    if (refused) return refused;
    const unlocked = this.unlockForSound();
    const hz = midiToFreq(concertMidi, this.prefs().a4Hz);
    return unlocked.then(() =>
      this.player.play({
        kind: 'note',
        durSec: LISTEN.noteSec,
        segments: [{ atSec: 0, caption: { kind: 'note', midi: concertMidi } }],
        schedule: (at) => this.audio.playNotes([{ hz, startSec: 0, durSec: LISTEN.noteSec }], { at: at as ClockSeconds, peak: LISTEN.peak }),
      }),
    );
  }

  /** "Play a bar of Classic" (05 §11.2) and calibration's "Hear the click": one bar at ♩ = 90, accented if on. */
  previewSound(sound: MetronomeSound): Promise<void> {
    const refused = this.refuseSound('preview a sound');
    if (refused) return refused;
    const unlocked = this.unlockForSound();
    const bar = planClickBar(LISTEN.previewBpm, LISTEN.previewBeats, this.prefs().accent);
    return unlocked.then(() =>
      this.player.play({
        kind: 'preview',
        durSec: bar.endSec,
        segments: [{ atSec: 0, caption: { kind: 'preview', sound } }],
        schedule: (at) => this.playClicksAt(at, bar.clicks, sound),
      }),
    );
  }

  /** "Click volume" released (designer's note 14): one click of the sound at the current level, not accented. */
  playClick(sound: MetronomeSound): Promise<void> {
    const refused = this.refuseSound('play a click');
    if (refused) return refused;
    const unlocked = this.unlockForSound();
    return unlocked.then(() =>
      this.player.play({
        kind: 'preview',
        durSec: 0.1,
        segments: [{ atSec: 0, caption: { kind: 'preview', sound } }],
        schedule: (at) => this.playClicksAt(at, [{ atSec: 0, accent: false }], sound),
      }),
    );
  }

  /** Stops every sound at once (Stop, leaving a screen). A running take is never touched. */
  stopSounds(): void {
    if (this.inTake()) return;
    this.player.stop();
  }

  /**
   * Ranked availability for Practice (05 §4.5, §5.8): the `calibration-unmeasured` predicate for the route (the last
   * opened one when `routeKey` is absent) plus the microphone.
   */
  async rankedAvailability(f: { routeKey?: string | null; listening: boolean; outputMode: PracticeSettings['outputMode'] }): Promise<RankedAvailability> {
    const [calibrations, permission] = await Promise.all([
      this.platform.repos.calibrations.all(),
      this.audio.permissionState().catch(() => 'unknown' as const),
    ]);
    const routeKey = f.routeKey !== undefined ? f.routeKey : (this.route?.routeKey ?? null);
    return rankedAvailability({ routeKey, outputMode: f.outputMode, calibrations, listening: f.listening, permission });
  }

  private playPlan(kind: 'listen' | 'bar', plan: ListenPlan, sound: MetronomeSound, extra: { fromBar: number; slower: boolean; attemptId: string | null }): Promise<void> {
    const segments: SoundSegment[] = [{ atSec: 0, caption: { kind: 'lead-in', bpm: plan.bpm } }];
    for (const b of plan.bars) segments.push({ atSec: b.startSec, caption: { kind: 'bar', bar: b.bar, of: plan.totalBars }, bar: b.bar });
    return this.player.play({
      kind,
      durSec: plan.endSec,
      segments,
      ...extra,
      schedule: async (at) => {
        await Promise.all([
          this.playClicksAt(at, plan.clicks, sound),
          plan.notes.length > 0
            ? this.audio.playNotes(
                plan.notes.map((n) => ({ hz: n.hz, startSec: n.startSec, durSec: n.durSec })),
                { at: at as ClockSeconds, peak: LISTEN.peak },
              )
            : Promise.resolve(),
        ]);
      },
    });
  }

  /**
   * The prepared excerpt of a stored attempt (history's Listen), rebuilt from its excerpt and transposition. Null
   * when the excerpt is withdrawn or no longer prepares the same way (the screen hides Listen then).
   */
  preparedForRecord(record: AttemptRecord): Promise<PreparedExcerpt | null> {
    if (this.current && this.lastRecord?.id === record.id) return Promise.resolve(this.current.prepared);
    const hit = this.recordPrepared.get(record.id);
    if (hit) return hit;
    const p = this.prepareRecord(record).catch(() => null);
    this.recordPrepared.set(record.id, p);
    return p;
  }

  private async prepareRecord(record: AttemptRecord): Promise<PreparedExcerpt | null> {
    const entry = this.manifest.entries.find((e) => e.id === record.excerptId);
    const inst = this.cfg.instrumentById[record.instrumentId];
    if (!entry || !inst) return null;
    const doc = this.docCache.get(record.excerptId) ?? (await loadExcerpt(this.manifest, record.excerptId, this.platform.assets));
    this.docCache.set(record.excerptId, doc);
    const s = record.settingsResolved;
    const selection: SelectionResult = {
      entry,
      settings: {
        instrumentId: record.instrumentId,
        level: record.levelServed,
        writtenKey: record.writtenKey,
        meter: typeof s.meter === 'string' && s.meter !== 'random' ? s.meter : `${doc.meter.beats}/${doc.meter.beatType}`,
        bpm: record.bpm,
        bars: s.bars === 'random' ? 8 : s.bars,
        randomized: [],
        seed: s.seed,
      },
      levelServed: record.levelServed,
      stretch: record.stretch,
      fromLevelBelow: false,
      transposition: record.transposition,
      writtenKey: record.writtenKey,
      concertKey: record.concertKey,
      clef: record.clef,
      bpmRange: { minBpm: record.bpm, maxBpm: record.bpm },
      octaveDisplaced: false,
      enharmonicRetry: false,
    };
    return prepareExcerpt(doc, selection, inst, this.cfg);
  }

  async captureTuningNote(): Promise<number> {
    const c = this.current;
    if (!c) throw new SessionError('unknown', 'no excerpt');
    const inst = c.plan.inst;
    if (!takesTuningNote(inst)) throw new SessionError('unknown', 'the tuning note is for winds, brass and strings (02 §4.5)');
    if (this.inTake()) throw new SessionError('unknown', 'tuning note during a take');
    const audio = this.audio;
    const captureSec = this.cfg.grading.tuning.captureSec;
    const start = audio.now() as number;
    const notes = new Map<number, DetectedNote>();
    let dsp: DspPipeline | null = null;
    let lastEnd = start;
    // Listening for the tuning note: nothing may sound while the microphone reads it.
    this.player.stop();
    const offset = await new Promise<number | null>((resolve, reject) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.timers.clearTimeout(timer);
        audio.stopCapture();
        if (dsp) for (const ev of dsp.flush(lastEnd as ClockSeconds)) if (ev.type === 'note-on' || ev.type === 'note-update' || ev.type === 'note-off') notes.set(ev.note.id, ev.note);
        resolve(tuningOffsetFrom([...notes.values()], this.cfg, this.cfg.grading.intonation.minSteadyMs[inst.detection.vibratoClass]));
      };
      const timer = this.timers.setTimeout(() => {
        if (dsp) finish();
        else {
          settled = true;
          audio.stopCapture();
          reject(new SessionError('audio-setup', 'no capture during the tuning note'));
        }
      }, captureSec * 1000 + 2000);
      audio
        .startCapture((m) => {
          if (settled || m.type !== 'block') return;
          const b = m.block;
          dsp ??= new DspPipeline(
            dspConfigFor(inst, this.cfg, { analysisRate: b.analysisRate, outputMode: 'wired', a4Hz: c.settings.a4Hz, clicks: [], rtlSec: 0, timbre: c.settings.clickTimbre, calibration: null, repeatHints: [] }),
          );
          for (const ev of dsp.push(b)) if (ev.type === 'note-on' || ev.type === 'note-update' || ev.type === 'note-off') notes.set(ev.note.id, ev.note);
          lastEnd = (b.startT as number) + b.lowband.length / b.analysisRate;
          if (lastEnd >= start + captureSec) finish();
        })
        .catch((e: unknown) => {
          if (settled) return;
          settled = true;
          this.timers.clearTimeout(timer);
          reject(e);
        });
    });
    if (offset === null) throw new SessionError('unknown', 'no steady note in the tuning capture');
    this.tuning.set(inst.id, offset);
    const p = this.requireProfile();
    const prog = p.instruments[inst.id] ?? newInstrumentProgress(typeof c.settings.level === 'number' ? c.settings.level : c.prepared.levelServed);
    this.profile = { ...p, instruments: { ...p.instruments, [inst.id]: { ...prog, tuningOffsetCents: offset } } };
    this.persistProfile();
    return offset;
  }

  // ---- clock ---------------------------------------------------------------------------------------

  /** Checks every clock deadline (scan, count-in, take end). Idempotent; safe to call at any rate. */
  poll(): void {
    if (this.disposed) return;
    const now = this.audio.now() as number;
    const c = this.current;
    // The audio clock starts again from 0 when the context is closed and reopened between takes (05 W2: the page was
    // hidden during the read-through). Keep the reading time already spent, so the countdown neither jumps up nor
    // freezes and a ranked take still starts by itself.
    // Only clocks read during this read-through count (startScan forgets the last one).
    if (this._state === 'scanning' && c && c.scanStart !== null) {
      const last = this.lastPollClock;
      if (last !== null && now < last - CLOCK_RESET_SEC) c.scanStart -= last - now;
      this.lastPollClock = now;
    } else this.lastPollClock = null;
    if (this._state === 'scanning' && c && c.scanStart !== null) {
      const remaining = c.scanSec - (now - c.scanStart);
      const tick = Math.max(0, Math.ceil(remaining - 1e-9));
      if (tick !== c.lastTick) {
        c.lastTick = tick;
        this.emit({ type: 'scan-tick', remainingSec: tick });
      }
      if (remaining <= 0 && !c.scanExpired) {
        c.scanExpired = true;
        // R6: ranked auto-starts the count-in at 0 with the music still visible; practice never does.
        if (c.mode === 'ranked') void this.startTake().catch(() => undefined);
      }
      return;
    }
    const t = this.take;
    if (!t || t.ending || t.t0 === 0) return;
    if (this._state === 'count-in' || this._state === 'performing') {
      while (t.countInEmitted < t.countIn.length && ((t.countIn[t.countInEmitted] as ClickSpec).t as number) <= now) {
        const k = t.countIn[t.countInEmitted] as ClickSpec;
        t.countInEmitted++;
        this.emit({ type: 'count-in', beat: t.countInEmitted, of: t.countIn.length, t: k.t });
      }
      const plan = c?.plan;
      if (!t.performing && plan && now >= t.t0 + Math.min(0, plan.firstNoteSec)) {
        t.performing = true;
        this.setState('performing');
      }
      if (now >= t.endT) void this.endTake(t, { reason: 'complete' }, t.endT);
    }
  }

  private startPolling(): void {
    const ms = this.opts.pollMs ?? 20;
    if (ms === 'manual' || this.pollHandle !== null) return;
    this.pollHandle = this.timers.setInterval(() => this.poll(), ms);
  }

  private stopPolling(): void {
    if (this.pollHandle === null) return;
    this.timers.clearInterval(this.pollHandle);
    this.pollHandle = null;
  }

  // ---- capture and worker --------------------------------------------------------------------------

  private onBlock(take: Take, m: WorkerMessage): void {
    if (m.type !== 'block' || this.take !== take || take.ending) return;
    const b: CaptureBlock = m.block;
    if (take.lastSeq !== null && b.seq !== take.lastSeq + 1) {
      take.seqGaps += Math.max(0, b.seq - take.lastSeq - 1);
      if (b.seq > take.lastSeq + 1) {
        this.voidTake('capture-gap');
        return;
      }
    }
    take.lastSeq = b.seq;
    take.lastBlockEnd = (b.startT as number) + b.lowband.length / b.analysisRate;
    if (take.recheck && !take.recheckResult) {
      const r = take.recheck.push(b);
      if (r) this.onRecheck(take, r);
      if (this.take !== take) return;
    }
    take.worker?.postMessage(m, [b.lowband.buffer, b.hiEnergy.buffer]);
    this.poll();
  }

  private onWorker(take: Take, r: WorkerReply): void {
    if (take.gen !== this.take?.gen && !take.ending) return;
    switch (r.type) {
      case 'events':
        for (const e of r.events) {
          take.liveEvents.push(e);
          take.traceEvents.push({ at: this.audio.now() as number, event: e });
          if (e.type === 'final') take.alignment = e.alignment;
          if (e.type === 'note-start') take.firstNoteHeard = true;
          this.emit({ type: 'follower', event: e });
          if (e.type === 'status' && e.kind === 'no-signal' && !take.ending) this.voidTake('no-signal');
        }
        break;
      case 'recheck':
        if (!take.recheckResult) this.onRecheck(take, r.result);
        break;
      case 'done':
        take.resolveDone(r);
        break;
      case 'error':
        if (!take.ending) {
          this.abandonTake();
          this.fail(new SessionError('audio-setup', `DSP worker: ${r.message}`));
        } else take.resolveDone(null);
        break;
      case 'ready':
        break;
    }
  }

  private onRecheck(take: Take, r: RecheckResult): void {
    take.recheckResult = r;
    const c = this.current;
    // 01 §7.1, §7.7: the first count-in click never arrived: restart the count-in once.
    if (!r.firstClickFound && c && c.firstClickRestarts === 0 && !take.firstNoteHeard && !take.ending) {
      c.firstClickRestarts++;
      this.restartTakeCountIn('first-click-missing');
    }
  }

  /** 04 §4.4: a rotation during the count-in cancels and restarts it. Ignored outside the count-in. */
  restartCountIn(reason: 'rotation'): void {
    if (this._state === 'count-in' && this.take && !this.take.performing) this.restartTakeCountIn(reason);
  }

  private restartTakeCountIn(reason: 'first-click-missing' | 'stop-before-first-note' | 'rotation'): void {
    const c = this.current;
    const t = this.take;
    if (!c || !t) return;
    this.teardownTake(t);
    this.take = null;
    this.emit({ type: 'count-in-restart', reason });
    this.setState('count-in');
    void this.beginTake(c, t.scanSeconds).catch((e: unknown) => {
      this.abandonTake();
      this.fail(e);
    });
  }

  private teardownTake(t: Take): void {
    this.audio.cancelTake();
    if (t.listening) this.audio.stopCapture();
    if (t.worker) {
      t.worker.onmessage = null;
      t.worker.terminate();
    }
    t.resolveDone(null);
  }

  private abandonTake(): void {
    const t = this.take;
    if (!t) return;
    this.take = null;
    this.teardownTake(t);
  }

  private inTake(): boolean {
    return this._state === 'count-in' || this._state === 'performing' || this._state === 'finishing';
  }

  // ---- stop, skip, void -------------------------------------------------------------------------

  stop(): Promise<AttemptRecord | null> {
    if (this.finishing) return this.finishing;
    const c = this.current;
    const t = this.take;
    if (!c || !t || (this._state !== 'count-in' && this._state !== 'performing')) return Promise.resolve(null);
    // 02 §5.3: a ranked Stop before the first note re-runs the count-in once; a second one voids the take.
    if (c.mode === 'ranked' && t.listening && !t.firstNoteHeard) {
      c.stopsBeforeFirstNote++;
      if (c.stopsBeforeFirstNote === 1) {
        this.restartTakeCountIn('stop-before-first-note');
        return Promise.resolve(null);
      }
      return this.voidTake('stopped-before-first-note') ?? Promise.resolve(null);
    }
    return this.endTake(t, { reason: 'stopped' }, this.audio.now() as number);
  }

  async skip(): Promise<void> {
    const c = this.current;
    if (!c) throw new SessionError('unknown', 'no excerpt to skip');
    if (this.inTake()) throw new SessionError('unknown', 'skip during a take');
    let skipLimitHit = false;
    if (this._state === 'covered') {
      // Free before reveal (02 §5.3): keep it out of the next draws without marking it seen.
      this.skippedGroups.set(c.prepared.dedupeGroup, this.platform.clockWall());
    } else if (this._state === 'scanning') {
      // After reveal: burned (already seen). One post-reveal skip per 5 ranked attempts; beyond that the
      // replacement is practice (`skip-limit`). The check runs before the skip is recorded.
      if (c.mode === 'ranked') {
        const p = this.requireProfile();
        skipLimitHit = !postRevealSkipAllowed(p, this.cfg);
        this.profile = { ...p, lastSkipRankedIndex: p.rankedIndex };
        this.persistProfile();
      }
    }
    this.stopPolling();
    await this.prepare(c.settings);
    if (this.current) this.current.skipLimitHit = skipLimitHit;
  }

  /** Voids the running take (01 §7.9, 05 W4, W7). Returns the record promise, or null when no take runs. */
  private voidTake(reason: VoidReason): Promise<AttemptRecord | null> | null {
    const t = this.take;
    if (!t || t.ending || (this._state !== 'count-in' && this._state !== 'performing')) return null;
    this.emit({ type: 'void', reason });
    // 05 W4: after an interruption the next take needs a gesture (ensureAudio) again.
    if (reason === 'interrupted' || reason === 'device-change') this.route = null;
    return this.endTake(t, { reason: 'void', voidReason: reason }, this.audio.now() as number);
  }

  private onRouteChange(r: AudioRouteInfo): void {
    const old = this.route;
    this.route = r;
    if (old && old.routeKey !== r.routeKey) {
      // 05 W7: a device change marks the old route's calibration stale and voids a running take.
      void this.platform.repos.calibrations
        .get(old.routeKey)
        .then((c) => {
          const stale = staleOnRouteChange(c, old.routeKey, r.routeKey);
          return stale ? this.platform.repos.calibrations.put(stale) : undefined;
        })
        .catch(() => undefined);
      this.voidTake('device-change');
    }
  }

  // ---- end of take -------------------------------------------------------------------------------

  private endTake(t: Take, reason: EndReason, inputT: number): Promise<AttemptRecord | null> {
    if (t.ending && this.finishing) return this.finishing;
    t.ending = true;
    this.setState('finishing');
    const p = this.finish(t, reason, inputT).then(
      (rec) => {
        this.finishing = null;
        return rec;
      },
      (e: unknown) => {
        this.finishing = null;
        throw this.fail(e instanceof SessionError ? e : new SessionError('storage', e instanceof Error ? e.message : String(e), { cause: e }));
      },
    );
    this.finishing = p;
    return p;
  }

  private async finish(t: Take, reason: EndReason, inputT: number): Promise<AttemptRecord> {
    const c = this.current as Current;
    const audio = this.audio;
    if (reason.reason !== 'complete') audio.cancelTake();
    let done: DoneReply | null = null;
    if (t.listening && t.worker) {
      // A Stop or void ends at the last relayed block, so the worker need not wait for audio that never comes.
      const endT = reason.reason !== 'complete' && t.lastBlockEnd !== null ? Math.min(inputT, t.lastBlockEnd) : inputT;
      t.worker.postMessage({ v: 1, type: 'end', t: endT as ClockSeconds, reason });
      const timeout = new Promise<null>((res) => {
        const h = this.timers.setTimeout(() => res(null), this.opts.finishTimeoutMs ?? 3000);
        void t.done.then(() => this.timers.clearTimeout(h));
      });
      done = await Promise.race([t.done, timeout]);
      audio.stopCapture();
      t.worker.onmessage = null;
      t.worker.terminate();
    }
    this.take = null;
    this.stopPolling();
    const record = await this.buildAndStore(c, t, reason, done);
    await this.storeTrace(t, record, done);
    this.lastRecord = record;
    this.setState('results');
    return record;
  }

  private async buildAndStore(c: Current, t: Take, reason: EndReason, done: DoneReply | null): Promise<AttemptRecord> {
    const cfg = this.cfg;
    const s = c.settings;
    const plan = c.plan;
    const audio = this.audio;
    const isVoid = reason.reason === 'void';
    const speakers = s.outputMode === 'speakers';

    // ---- recheck (01 §7.7, R31) --------------------------------------------------------------
    let recheck: AttemptRecheck | null = null;
    let latencyMs = t.used.roundTripMs;
    let alignment = t.alignment ?? EMPTY_ALIGNMENT;
    const detected = done?.detected ?? [];
    let markStale = false;
    let freshVoiceReference: GradeInput['voiceReference'] | undefined;
    if (t.listening && speakers) {
      const result: RecheckResult = t.recheckResult ?? t.recheck?.finish() ?? { firstClickFound: false, clicksFound: 0, rtlMs: null, madMs: null, accepted: false };
      const d = decideRecheck(result, t.used.roundTripMs, cfg.budget.calibration);
      recheck = d.recheck;
      markStale = d.markStale && !!t.stored && t.stored.method !== 'reported';
      if (d.recheck.usedFresh && t.follow && !isVoid) {
        // The live overlay used the stored value; the final alignment uses the fresh one (R31).
        latencyMs = d.latencyMs;
        const fresh = alignFinalWithReference({ ...t.follow, latencyCompensationSec: latencyMs / 1000 }, detected, liveOutcomeOf(t.liveEvents));
        alignment = fresh.alignment;
        freshVoiceReference = fresh.voiceReference;
      }
    }
    if (!t.listening) latencyMs = 0;

    // ---- gate and audio environment (05 §4, W5) ----------------------------------------------------
    const info = audio.audioInfo();
    const stats = typeof audio.captureStats === 'function' ? audio.captureStats() : { droppedBlocks: 0, maxQueueMs: 0 };
    const dspStats = done?.stats ?? { droppedBlocks: 0, maxQueueMs: 0, hopP95Ms: null, missingBlocks: 0 };
    let gateFailures: GateId[] = [];
    if (t.listening) {
      gateFailures = evaluateTakeGate(
        {
          route: t.route,
          calibration: t.stored,
          contextSampleRate: info.contextSampleRate,
          trackSampleRate: t.route.sampleRate,
          clockRateError: info.clockRateError,
          recheck,
          dsp: { droppedBlocks: Math.max(dspStats.droppedBlocks, stats.droppedBlocks), missingBlocks: Math.max(dspStats.missingBlocks, t.seqGaps) },
          latencyCompensationMs: latencyMs,
        },
        cfg,
      ).gateFailures;
    }
    const audioEnv = buildAudioEnv({
      capabilities: audio.capabilities,
      appBuild: this.opts.appBuild ?? 'dev',
      coreVersion: this.opts.coreVersion ?? 'dev',
      metronomeMode: s.metronome,
      clickTimbre: s.clickTimbre,
      route: { ...t.route, outputMode: s.outputMode },
      audio: info,
      captureRelay: t.listening && (audio.captureRelay || t.relay),
      calibration: t.listening ? t.used : null,
      latencyCompensationMs: latencyMs,
      dsp: { droppedBlocks: Math.max(dspStats.droppedBlocks, stats.droppedBlocks), maxQueueMs: Math.max(dspStats.maxQueueMs, stats.maxQueueMs), hopP95Ms: dspStats.hopP95Ms },
      gateFailures,
    });

    // ---- grade (02 §4, §5.2) --------------------------------------------------------------------
    const profile = this.requireProfile();
    const today = this.platform.localDay();
    const randomized = c.selection.settings.randomized;
    let score: AttemptScore | null = null;
    let tips: Tip[] = [];
    const graded = t.listening && !isVoid && !(reason.reason === 'stopped' && c.mode === 'practice');
    if (graded) {
      const input: GradeInput = {
        expected: plan.expected,
        tolerances: plan.tolerances,
        alignment,
        detected,
        instrument: plan.inst,
        level: plan.level,
        bpm: plan.bpm,
        meter: c.prepared.meter,
        cfg,
        tuning: t.tuning,
        voiceReference: plan.inst.family === 'voice' ? (freshVoiceReference !== undefined ? freshVoiceReference : (done?.voiceReference ?? null)) : null,
        writtenKey: c.prepared.writtenKey,
        signal: done?.signal ?? { medianClarity: null, clippingFrac: 0 },
        calibrationMeasured: calibrationForRoute(t.stored, t.route.routeKey) !== null,
        ranking: {
          mode: c.mode,
          seenBefore: c.seenBefore,
          scanStrict: t.scanSeconds <= c.scanSec + SCAN_STRICT_SLACK_SEC,
          familiarity: c.selection.entry.familiarity,
          skipLimitHit: c.skipLimitHit,
          metronome: s.metronome,
          gateFailures,
        },
        xp: xpInputFor(profile, { instrumentId: plan.inst.id, excerptId: c.prepared.excerptId, randomized: { key: randomized.includes('key'), meter: randomized.includes('meter'), tempo: randomized.includes('tempo') }, placement: c.placement }, today),
      };
      score = gradeWithPatterns(input);
      // 02 §6.1; P13: never for voids. Primary pattern history excludes the current attempt.
      tips = selectTips({
        patterns: score.patterns,
        instrument: plan.inst,
        level: plan.level,
        recentTipIds: profile.recentTips,
        recentPrimaries: profile.instruments[plan.inst.id]?.recentPrimaryPatterns ?? [],
        catalog: cfg.tips,
      });
      score = { ...score, tipsShown: tips.map((x) => x.id), ...(c.listenedFirst ? { rankedReasons: listenedFirstReasons(score.rankedReasons) } : {}) };
    }

    const interruption = isVoid && (reason.voidReason === 'interrupted' || reason.voidReason === 'device-change');
    const record: AttemptRecord = {
      schemaVersion: 1,
      id: this.platform.idGen(),
      profileId: profile.id,
      createdAt: this.platform.clockWall(),
      appVersion: this.opts.appVersion ?? '0.0.0',
      configVersion: cfg.configVersion,
      corpusVersion: this.manifest.corpusVersion,
      coreVersion: this.opts.coreVersion ?? 'dev',
      excerptId: c.prepared.excerptId,
      dedupeGroup: c.prepared.dedupeGroup,
      instrumentId: plan.inst.id,
      beta: plan.inst.status !== 'launch',
      levelServed: plan.level,
      stretch: c.prepared.stretch,
      placement: c.placement,
      settingsResolved: { ...withoutSeed(s), mode: c.mode, seed: c.selection.settings.seed },
      transposition: c.prepared.transposition,
      writtenKey: c.prepared.writtenKey,
      concertKey: c.prepared.concertKey,
      clef: c.prepared.clef,
      bpm: plan.bpm,
      scanSeconds: Math.round(t.scanSeconds * 1000) / 1000,
      listening: t.listening,
      calibration: {
        method: t.listening ? t.used.method : 'none',
        latencyCompensationMs: latencyMs,
        outputMode: s.outputMode,
        recheck: t.listening && speakers ? recheck : null,
      },
      tuning: t.tuning,
      audioEnv,
      detected,
      judgments: alignment.judgments,
      extras: alignment.extras,
      displaced: alignment.displaced,
      score,
      endReason: reason.reason,
      ...(reason.reason === 'void' ? { voidReason: reason.voidReason } : {}),
      // Revealed means seen (02 §5.3), so every take burns the excerpt for ranked play.
      excerptBurned: c.revealed,
      // R33: an interruption void after the first note counts against the post-reveal skip limit (ranked only).
      countsAsSkip: interruption && t.firstNoteHeard && c.mode === 'ranked',
      credit: creditOf(c.doc),
      ...(this.opts.dev && done ? { debug: { live: done.live } } : {}),
    };

    // ---- progression (02 §5) and persistence (01 §11) -----------------------------------------------
    const applied = applyAttemptOnDay(profile, record, cfg, today, c.prepared.meter);
    this.profile = applied.profile;
    const events: ProgressEvent[] = applied.events;
    await this.persistChain;
    await this.platform.repos.attempts.add(record);
    await this.platform.repos.profile.put(this.profile);
    if (markStale && t.stored) {
      await this.platform.repos.calibrations.put(applyRecheckToCalibration(t.stored, { recheck: recheck as AttemptRecheck, latencyMs, markStale }));
    }
    this.emit({ type: 'record', record });
    if (!isVoid && score) {
      this.emit({ type: 'progress', events });
      this.emit({ type: 'tips', tips });
    }
    if (recheck?.promptRecalibrate) this.emit({ type: 'recalibrate-prompt', routeKey: t.route.routeKey });
    return record;
  }

  // ---- diagnostics per try (round 2 detection, diagnostics.ts) -------------------------------------

  /** Keeps the try's trace (the last DIAG_KEEP tries). A failure here never touches the try or its record. */
  private async storeTrace(t: Take, record: AttemptRecord, done: DoneReply | null): Promise<void> {
    try {
      const follow = t.follow;
      const trace = buildTryTrace({
        record,
        route: t.route,
        used: t.listening ? t.used : null,
        dsp: t.dspCfg,
        follow,
        t0: t.t0,
        reference: t.ownTones,
        clicks: t.clicks,
        worker: done?.trace ?? null,
        events: t.traceEvents,
        ignored: (d) => (follow ? ignoredNote(follow, d) : false),
      });
      await this.diagnostics.put(trace);
    } catch (e) {
      // Storage full or unavailable: the try and its record stand; only its trace is lost.
      this.diagnosticsError = e;
    }
  }

  /** The device-local diagnostics setting (include the microphone audio in the export: off by default). */
  diagnosticsSettings(): Promise<DiagnosticsSettings> {
    return this.diagnostics.settings();
  }

  /** Turns the opt-in "include microphone audio" on or off; it applies from the next try. */
  setDiagnosticsSettings(s: DiagnosticsSettings): Promise<void> {
    return this.diagnostics.setSettings(s);
  }

  /** Attempt ids that have a stored trace, oldest first (at most DIAG_KEEP). */
  diagnosticsAttemptIds(): Promise<string[]> {
    return this.diagnostics.ids();
  }

  /** The last try's diagnostics as one JSON file, or null when no try has been traced yet. */
  async exportLastTry(): Promise<{ fileName: string; text: string; file: DiagnosticsFile } | null> {
    const t = await this.diagnostics.last();
    return t ? this.exportOf(t) : null;
  }

  /** A given attempt's diagnostics as one JSON file, or null when its trace is no longer kept. */
  async exportAttempt(attemptId: string): Promise<{ fileName: string; text: string; file: DiagnosticsFile } | null> {
    const t = await this.diagnostics.get(attemptId);
    return t ? this.exportOf(t) : null;
  }

  private exportOf(t: TryTrace): { fileName: string; text: string; file: DiagnosticsFile } {
    const file = diagnosticsFile([t], this.platform.clockWall());
    return { fileName: diagnosticsFileName(t), text: JSON.stringify(file), file };
  }

  // ---- profile and history -------------------------------------------------------------------------

  private async loadProfile(instrumentId: string): Promise<PlayerProfile> {
    if (this.profile) return this.profile;
    let p = await this.platform.repos.profile.get();
    if (!p) {
      p = createProfile(this.platform.idGen(), this.opts.displayName ?? 'Player', this.platform.clockWall(), instrumentId, this.cfg);
      await this.platform.repos.profile.put(p);
    }
    this.profile = p;
    return p;
  }

  private requireProfile(): PlayerProfile {
    if (!this.profile) throw new SessionError('unknown', 'no profile loaded');
    return this.profile;
  }

  private persistProfile(): void {
    const p = this.profile;
    if (!p) return;
    this.persistChain = this.persistChain
      .then(() => this.platform.repos.profile.put(p))
      .catch((e: unknown) => {
        this.emit({ type: 'error', code: 'storage', detail: e instanceof Error ? e.message : String(e) });
      });
  }

  private async history(p: PlayerProfile, s: PracticeSettings): Promise<SelectionHistory> {
    const recent = await this.platform.repos.attempts.recent(20);
    const seenGroups = { ...p.seenGroups };
    for (const [g, at] of this.skippedGroups) if (!(g in seenGroups)) seenGroups[g] = at;
    return {
      seenGroups,
      recentExcerptIds: recent.map((a) => a.excerptId),
      recentWorks: recent.map((a) => a.credit.work),
      recentWrittenKeys: recent.filter((a) => a.instrumentId === s.instrumentId).map((a) => a.writtenKey),
      playerLevel: p.instruments[s.instrumentId]?.level ?? (typeof s.level === 'number' ? s.level : 1),
    };
  }

  // ---- plumbing ----------------------------------------------------------------------------------

  private emit(e: SessionEvent): void {
    this.events.emit(e);
  }

  private setState(next: SessionState): void {
    const prev = this._state;
    if (prev === next) return;
    this._state = next;
    this.emit({ type: 'state', state: next, prev });
  }

  /** The error behind the last `error` event, with its cause (the composition root logs it). */
  get lastError(): SessionError | null {
    return this._lastError;
  }

  /** Moves to `error`, emits the error event and returns the error to throw. */
  private fail(e: unknown): unknown {
    const err = e instanceof SessionError ? e : new SessionError('unknown', e instanceof Error ? e.message : String(e), { cause: e });
    this._lastError = err;
    this.stopPolling();
    this.emit({ type: 'error', code: err.code, detail: err.message });
    this.setState('error');
    return err;
  }

  /** Releases the wake lock, the worker and every subscription. The audio backend stays open (its owner closes it). */
  dispose(): void {
    if (this.disposed) return;
    this.abandonTake();
    this.stopPolling();
    this.player.dispose();
    this.disposed = true;
    for (const u of this.unsubs.splice(0)) u();
    void this.platform.keepAwake(false).catch(() => undefined);
  }
}

/**
 * 08 decision 7: a ranked take the player listened to first went through the grader as practice, which records
 * `practice-mode`; the attempt records `listened-first` in its place (same position, no duplicate).
 */
export function listenedFirstReasons(reasons: readonly RankedReason[]): RankedReason[] {
  const out: RankedReason[] = [];
  for (const r of reasons) {
    const next = r === 'practice-mode' ? 'listened-first' : r;
    if (!out.includes(next)) out.push(next);
  }
  if (!out.includes('listened-first')) out.unshift('listened-first');
  return out;
}

function withoutSeed(s: PracticeSettings): Omit<PracticeSettings, 'seed'> {
  const { seed: _seed, ...rest } = s;
  return rest;
}
