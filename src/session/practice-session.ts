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
  EndReason,
  ExcerptDoc,
  FinalAlignment,
  FollowConfig,
  FollowerEvent,
  GateId,
  GradeInput,
  PlayerProfile,
  PracticeSettings,
  PreparedExcerpt,
  ProgressEvent,
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
import { createEmitter } from '../core/events.ts';
import { createRng } from '../core/rng.ts';
import { CorpusLoadError, loadExcerpt, selectAndPrepare } from '../corpus/index.ts';
import { DspPipeline } from '../dsp/pipeline.ts';
import { alignFinal, liveOutcomeOf } from '../follow/index.ts';
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
import { CountInRecheck, applyRecheckToCalibration, decideRecheck, reportedCalibration, staleOnRouteChange } from '../calibration/index.ts';
import { buildAudioEnv, calibrationForRoute, evaluateTakeGate } from './gates/index.ts';
import {
  creditOf,
  dspConfigFor,
  followConfigFor,
  planTake,
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
}

const EMPTY_ALIGNMENT: FinalAlignment = { judgments: [], extras: [], displaced: [] };
const SCAN_STRICT_SLACK_SEC = 0.25;
const VOICE_REFERENCE_LEAD_SEC = 0.1;
const AFTER_REFERENCE_SEC = 0.5;

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
  private readonly rng: Rng;
  private readonly docCache = new Map<string, ExcerptDoc>();
  private readonly unsubs: (() => void)[] = [];

  private _state: SessionState = 'idle';
  private profile: PlayerProfile | null = null;
  private current: Current | null = null;
  private take: Take | null = null;
  private gen = 0;
  private route: AudioRouteInfo | null = null;
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
  get pending(): { mode: 'ranked' | 'practice'; seenBefore: boolean; skipLimitHit: boolean; revealed: boolean; scanSec: number } | null {
    const c = this.current;
    return c ? { mode: c.mode, seenBefore: c.seenBefore, skipLimitHit: c.skipLimitHit, revealed: c.revealed, scanSec: c.scanSec } : null;
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
      };
      this.emit({ type: 'prepared', excerpt: r.prepared });
      this.setState('covered');
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
    return p.then(
      (route) => {
        this.route = route;
        return route;
      },
      (e: unknown) => {
        throw this.fail(new SessionError(micErrorCode(e), e instanceof Error ? e.message : String(e), { cause: e }));
      },
    );
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
    this.startScan(c);
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
    // The backend is unlocked only by `ensureAudio` inside a gesture (05 W1, W4); never resume it from here.
    const route = this.route;
    if (!route) throw new SessionError('audio-setup', 'ensureAudio() must run in a gesture before the take');
    const gen = ++this.gen;
    const listening = s.listening;
    const leadBase = this.opts.leadSec ?? 0.6;
    let leadSec = leadBase;

    // R7: the voice reference plays before every voice count-in, in every mode.
    if (plan.inst.family === 'voice') {
      const end = await this.playReference(c);
      leadSec = Math.max(leadBase, end - (audio.now() as number) + AFTER_REFERENCE_SEC);
    }

    const stored = (await this.platform.repos.calibrations.get(route.routeKey)) ?? null;
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
      const follow = followConfigFor(plan, c.prepared, this.cfg, { t0: take.t0, rtlSec, analysisRate, tuningCents: tuningCents ?? 0 });
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
      });
      const msg: WorkerMessage = { v: 1, type: 'config', cfg: dsp, follow };
      if (channel) take.worker.postMessage(msg, [channel.port2]);
      else take.worker.postMessage(msg);
      if (s.outputMode === 'speakers' && take.relay && take.countIn.length > 0) {
        const first = take.countIn[0] as ClickSpec;
        const template = stored?.templates[s.clickTimbre];
        take.recheck = new CountInRecheck(contextRate, take.countIn.map((k) => ({ t: k.t as number, accent: k.accent })), {
          timbre: s.clickTimbre,
          template: template ? template.samples : null,
          budget: this.cfg.budget.calibration,
          silence: { t0: (first.t as number) - 0.4, t1: first.t as number },
        });
      }
    }
    this.startPolling();
    this.poll();
  }

  /** Plays the voice reference now (R7); returns the clock time it ends. */
  private async playReference(c: Current): Promise<number> {
    const tones = voiceReferenceTones(c.prepared, (c.plan.expected[0] as { concertMidi: number }).concertMidi, c.settings.a4Hz);
    const at = (this.audio.now() as number) + VOICE_REFERENCE_LEAD_SEC;
    await Promise.all(tones.map((t) => this.audio.playTone(t.hz, t.durSec, (at + t.atSec) as ClockSeconds)));
    this.referenceEndsAt = at + referenceLengthSec(tones);
    return this.referenceEndsAt;
  }

  async playVoiceReference(): Promise<void> {
    const c = this.current;
    if (!c) throw new SessionError('unknown', 'no excerpt');
    if (c.plan.inst.family !== 'voice') throw new SessionError('unknown', 'the voice reference is for voice only (02 §4.5)');
    if (this.inTake()) throw new SessionError('unknown', 'voice reference during a take');
    await this.playReference(c);
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
    if (t.listening && speakers) {
      const result: RecheckResult = t.recheckResult ?? t.recheck?.finish() ?? { firstClickFound: false, clicksFound: 0, rtlMs: null, madMs: null, accepted: false };
      const d = decideRecheck(result, t.used.roundTripMs, cfg.budget.calibration);
      recheck = d.recheck;
      markStale = d.markStale && !!t.stored && t.stored.method !== 'reported';
      if (d.recheck.usedFresh && t.follow && !isVoid) {
        // The live overlay used the stored value; the final alignment uses the fresh one (R31).
        latencyMs = d.latencyMs;
        alignment = alignFinal({ ...t.follow, latencyCompensationSec: latencyMs / 1000 }, detected, liveOutcomeOf(t.liveEvents));
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
        voiceReference: plan.inst.family === 'voice' ? (done?.voiceReference ?? null) : null,
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
      score = { ...score, tipsShown: tips.map((x) => x.id) };
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
    const applied = applyAttemptOnDay(profile, record, cfg, today);
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

  /** Moves to `error`, emits the error event and returns the error to throw. */
  private fail(e: unknown): unknown {
    const err = e instanceof SessionError ? e : new SessionError('unknown', e instanceof Error ? e.message : String(e), { cause: e });
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
    this.disposed = true;
    for (const u of this.unsubs.splice(0)) u();
    void this.platform.keepAwake(false).catch(() => undefined);
  }
}

function withoutSeed(s: PracticeSettings): Omit<PracticeSettings, 'seed'> {
  const { seed: _seed, ...rest } = s;
  return rest;
}
