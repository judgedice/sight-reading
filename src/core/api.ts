/**
 * Public interfaces of every module, as types (01 §5). Frozen in P0b.
 *
 * Each package's `index.ts` exports exactly the functions named here, with these signatures.
 * Implementers check conformance with `satisfies`, for example
 *
 *   export const resolveTolerances: RulesApi['resolveTolerances'] = (notes, ctx, cfg) => { ... };
 *   export class LiveFollower implements LiveFollowerInstance { constructor(c: FollowConfig) { ... } }
 *
 * Items marked "P0b addition" are not in 01 §5 but are needed by more than one later package.
 */
import type {
  AudioRouteInfo,
  CaptureBlock,
  ClockSeconds,
  KeyValue,
  PlatformServices,
  StoreRepos,
  WorkerLike,
} from './platform.ts';
import type {
  AttemptRecord,
  AttemptScore,
  Beats,
  Clef,
  Configs,
  CorpusManifest,
  DetectedNote,
  DspConfig,
  DspEvent,
  Emitter,
  EndReason,
  ExcerptDoc,
  ExpectedNote,
  ExportFileV1,
  FinalAlignment,
  FloorViolation,
  FollowConfig,
  FollowerEvent,
  GhostNote,
  GradeInput,
  Instrument,
  Interval,
  KeySig,
  MeasurementBudget,
  Meter,
  NoteVisualState,
  PatternResult,
  PitchFrame,
  PlayerProfile,
  PracticeSettings,
  PreparedExcerpt,
  ProgressEvent,
  Rank,
  RawConfigs,
  RenderOptions,
  ResolvedTolerance,
  Rng,
  ScoreLayout,
  ScoreSeconds,
  SelectionHistory,
  SelectionResult,
  SessionEvent,
  SessionState,
  SpelledPitch,
  TierId,
  Ticks,
  Tip,
  TipSelectionInput,
  ToleranceContext,
} from './types.ts';

// ---- core (P0c: time.ts, rng.ts, events.ts) ------------------------------------------

/** `core/time.ts` (01 §5.1). */
export interface CoreTimeApi {
  /** Ticks from excerpt start → beats from bar 1 beat 1 (negative in the pickup). */
  ticksToBeats(t: Ticks, meter: Meter, pickupTicks: Ticks): Beats;
  beatsToScoreSeconds(b: Beats, bpm: number): ScoreSeconds;
  /** Inverse of ticksToBeats (P0c addition, additive). */
  beatsToTicks(b: Beats, meter: Meter, pickupTicks: Ticks): Ticks;
  /** Inverse of beatsToScoreSeconds (P0c addition, additive). */
  scoreSecondsToBeats(s: ScoreSeconds, bpm: number): Beats;
  ticksToScoreSeconds(t: Ticks, meter: Meter, pickupTicks: Ticks, bpm: number): ScoreSeconds;
  ticksPerBar(meter: Meter): Ticks;
  /** Meter for a time signature; compound x/8 (6, 9, 12) counts dotted quarters (02 conventions). */
  makeMeter(beats: number, beatType: Meter['beatType']): Meter;
}

/** `core/rng.ts` and `core/events.ts` (01 §14 item 3). */
export interface CoreUtilApi {
  /** mulberry32. */
  createRng(seed: number): Rng;
  createEmitter<T>(): Emitter<T>;
}

// ---- theory (P1) ----------------------------------------------------------------------

/** `theory/` (01 §5.3). */
export interface TheoryApi {
  toMidi(p: SpelledPitch): number;
  transposePitch(p: SpelledPitch, iv: Interval): SpelledPitch;
  transposeKey(k: KeySig, iv: Interval): KeySig;
  /** 03 §7.4. */
  intervalBetweenKeys(from: KeySig, to: KeySig, chromaticShift: number): Interval;
  /** 02 §4.8 ghost spelling rule. */
  spellGhost(playedWrittenMidi: number, target: SpelledPitch, key: KeySig): SpelledPitch;
  /** Fractional MIDI at the given A4, Hz. */
  freqToMidi(hz: number, a4: number): number;
  midiToFreq(midi: number, a4: number): number;
}

// ---- instruments (P0d / P1) — P0b addition --------------------------------------------

/** `instruments/`: typed access to config/instruments.json (01 §4.1). P0b addition. */
export interface InstrumentsApi {
  getInstrument(cfg: Configs, id: string): Instrument;
  listInstruments(cfg: Configs, opts: { includeBeta: boolean }): Instrument[];
  /** Tier for a level (02 §1.4). */
  tierForLevel(level: number): TierId;
  /** Written MIDI band for the level, inclusive. */
  bandFor(inst: Instrument, level: number): [number, number];
  /** Clefs allowed at the level, primary first. */
  clefsAt(inst: Instrument, level: number): Clef[];
}

// ---- rules (P0d, P2) ------------------------------------------------------------------

/** Voice drift reference (02 §4.5), shared by follow and grade (01 §5.4). */
export interface VoiceDriftReferenceInstance {
  offsetCents(): number;
  observe(devCents: number, correct: boolean): void;
}

/** `rules/` (01 §5.4). */
export interface RulesApi {
  /** Schema-validated, frozen objects. Throws on invalid input. */
  loadConfigs(raw: RawConfigs): Configs;
  /** 02 §4.2 formula; contains no tolerance constants. */
  resolveTolerances(notes: ExpectedNote[], ctx: ToleranceContext, cfg: Configs): ResolvedTolerance[];
  VoiceDriftReference: new (cfg: Configs) => VoiceDriftReferenceInstance;
  /** Voice: equivalent (R7); others: wrong (R20). */
  pitchCreditPolicy(inst: Instrument): { octave: 'equivalent' | 'wrong' };
  /** CI floor check (01 §0). */
  checkFloors(cfg: Configs, budget: MeasurementBudget): FloorViolation[];
}

// ---- corpus (P9a, P9b, P9c) -----------------------------------------------------------

export type SelectExcerptResult = SelectionResult | { error: 'empty-pool'; suggestions: Partial<PracticeSettings>[] };

/** `corpus/` (01 §5.5). */
export interface CorpusApi {
  loadManifest(assets: PlatformServices['assets']): Promise<CorpusManifest>;
  loadExcerpt(m: CorpusManifest, id: string, assets: PlatformServices['assets']): Promise<ExcerptDoc>;
  selectExcerpt(m: CorpusManifest, s: PracticeSettings, h: SelectionHistory, cfg: Configs, rng: Rng): SelectExcerptResult;
  prepareExcerpt(doc: ExcerptDoc, sel: SelectionResult, inst: Instrument, cfg: Configs): PreparedExcerpt;
  buildExpectedNotes(p: PreparedExcerpt, bpm: number, cfg: Configs): ExpectedNote[];
  /** Eligible excerpt count for 04's setup screen (04 §5.2). P0b addition. */
  countEligible(m: CorpusManifest, instrumentId: string, level: number, meter: string | null, cfg: Configs): number;
}

// ---- dsp (P4a–P4d) --------------------------------------------------------------------

/** Pure, phase-carrying decimator (01 §5.6, §7.2). Zero allocation after construction. */
export interface Decimator {
  readonly inputRate: number;
  /** D = round(inputRate / 16000). */
  readonly factor: number;
  /** inputRate / factor, Hz. */
  readonly analysisRate: number;
  /**
   * Low-passes and decimates one input chunk into `out` from `outOffset`; returns the number of
   * samples written. Phase is carried across calls.
   */
  process(input: Float32Array, out: Float32Array, outOffset: number): number;
  /** Fractional input-sample position (since reset) of the next output sample. */
  readonly nextOutputInputPos: number;
  reset(): void;
}

/** `dsp/` DspPipeline instance (01 §5.6). */
export interface DspPipelineInstance {
  push(b: CaptureBlock): DspEvent[];
  flush(t: ClockSeconds): DspEvent[];
  frames(): PitchFrame[];
}

/** `dsp/` (01 §5.6). */
export interface DspApi {
  DspPipeline: new (cfg: DspConfig) => DspPipelineInstance;
  runOffline(samples: Float32Array, inputRate: number, cfg: DspConfig): { events: DspEvent[]; frames: PitchFrame[] };
  decimatorCreate(inputRate: number): Decimator;
}

// ---- follow (P10a, P10b) --------------------------------------------------------------

/** `follow/` LiveFollower instance (01 §5.7). */
export interface LiveFollowerInstance {
  onDsp(ev: DspEvent): FollowerEvent[];
  /** Every hop; fires missed deadlines and status. */
  onClock(inputT: ClockSeconds): FollowerEvent[];
  end(inputT: ClockSeconds, reason: EndReason): FollowerEvent[];
}

/** `follow/` (01 §5.7). */
export interface FollowApi {
  LiveFollower: new (c: FollowConfig) => LiveFollowerInstance;
  finalAlign(c: FollowConfig, detected: DetectedNote[]): FinalAlignment;
}

// ---- notation (P7, P15; DOM) ----------------------------------------------------------

/**
 * `notation/` ScoreView (01 §5.8). Generic over the container so core needs no DOM types;
 * notation implements `ScoreView<HTMLElement>`.
 */
export interface ScoreView<Container = unknown> {
  /** One <svg> per system. */
  render(p: PreparedExcerpt, container: Container, o: RenderOptions): ScoreLayout;
  /** Page turns without re-rendering VexFlow. */
  setSlotSystems(slotToSystem: number[]): void;
  /** Idempotent; written as data-* on the note <g>. */
  setNoteState(expectedIdx: number, s: NoteVisualState): void;
  /** Add or update by detectedId. */
  showGhost(g: GhostNote): void;
  removeGhost(detectedId: number): void;
  setPlayhead(scoreBeat: Beats | null): void;
  setMode(m: 'live' | 'review' | 'blind'): void;
  clearOverlay(): void;
}

// ---- grade (P12, P12b, G6/G7) ---------------------------------------------------------

/** `grade/` (01 §5.9). */
export interface GradeApi {
  /** 02 §4 and §6; reads Configs only. `tipsShown` is returned empty. */
  grade(input: GradeInput): AttemptScore;
  detectPatterns(input: GradeInput): PatternResult[];
  applyAttempt(p: PlayerProfile, a: AttemptRecord, cfg: Configs): { profile: PlayerProfile; events: ProgressEvent[] };
  rankFor(xp: number, maxLevelAnyInstrument: number, cfg: Configs): Rank;
  /** New profile with XP 0, rank 1 (02 §5). P0b addition. `now` is ISO 8601 UTC. */
  createProfile(id: string, displayName: string, now: string, activeInstrumentId: string, cfg: Configs): PlayerProfile;
  /** Accept or decline a pending level-up offer; declining suppresses it (02 §5.6). P0b addition. */
  respondToLevelOffer(p: PlayerProfile, instrumentId: string, accept: boolean, cfg: Configs): { profile: PlayerProfile; events: ProgressEvent[] };
  /** Manual level change, placement result or auto level-up undo; resets the window (02 §5.6). P0b addition. */
  setInstrumentLevel(p: PlayerProfile, instrumentId: string, level: number, cfg: Configs): PlayerProfile;
}

// ---- tips (P13) -----------------------------------------------------------------------

/** `tips/` (01 §5.9). */
export interface TipsApi {
  /** At most 2. */
  selectTips(i: TipSelectionInput): Tip[];
}

// ---- store (P6) -----------------------------------------------------------------------

/** `store/` (01 §5.9, §11). */
export interface StoreApi {
  exportAll(r: StoreRepos, kv: KeyValue): Promise<ExportFileV1>;
  /** Validates and migrates; throws on an invalid file (04 "That file isn't a Sightread backup."). */
  importAll(r: StoreRepos, f: unknown, kv: KeyValue): Promise<void>;
}

// ---- session (P16) --------------------------------------------------------------------

export interface PracticeSessionDeps {
  platform: PlatformServices;
  configs: Configs;
  manifest: CorpusManifest;
  workerFactory: () => WorkerLike;
}

/** `session/` PracticeSession instance (01 §5.9). */
export interface PracticeSessionInstance {
  readonly events: Emitter<SessionEvent>;
  readonly state: SessionState;
  prepare(s: PracticeSettings): Promise<PreparedExcerpt>;
  /** Call synchronously from the first gesture (Start scan). */
  ensureAudio(): Promise<AudioRouteInfo>;
  /** Marks the dedupeGroup seen (02 §5.3); starts the scan timer. */
  revealScan(): void;
  /** From a gesture, or automatically at strict scan expiry (R6). */
  startTake(): Promise<void>;
  stop(): Promise<AttemptRecord | null>;
  skip(): Promise<void>;
  /** Cents; winds, brass, strings. */
  captureTuningNote(): Promise<number>;
  /** Tonic triad plus first note (R7). */
  playVoiceReference(): Promise<void>;
}

/** `session/` (01 §5.9). */
export interface SessionApi {
  PracticeSession: new (deps: PracticeSessionDeps) => PracticeSessionInstance;
}
