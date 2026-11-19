/**
 * Composition helpers for the S1 thin slice (01 §15 S1): the excerpt, the take parameters, the DSP and follow
 * configs, the grade input and the attempt record. Pure (no DOM, no globals): the dev route and the Node tests use the
 * same functions, which is how "the grade is identical in Node and the browser" is checked.
 *
 * The slice: flute, concert pitch, treble clef, 512 window, the fixture excerpt `jaell-lc6157272-voice-m20-27`
 * (8 bars 4/4, one sharp: E minor, the G major signature), 80 bpm, a 1-bar count-in, Tick clicks.
 *
 * - The excerpt's own tempo range (108 to 140) misses level 3's (66 to 92), so `prepareExcerpt` would refuse 80 bpm
 *   (P9b known gap). The slice prepares a copy whose tempo range is the level's; nothing else changes.
 * - These helpers are a composition root's work (01 §4.2), so they reach corpus/, rules/ and grade/ directly. The
 *   eslint boundary table has no entry for src/app/compose yet (reported in the S1 notes).
 */
import type {
  AttemptRecord,
  AttemptScore,
  AudioEnv,
  ClockSeconds,
  Configs,
  DetectedNote,
  DspConfig,
  ExcerptDoc,
  ExpectedNote,
  FinalAlignment,
  FollowConfig,
  GradeInput,
  Instrument,
  KeySig,
  LiveJudgment,
  ManifestEntry,
  OutputMode,
  PreparedExcerpt,
  RawConfigs,
  ResolvedTolerance,
  SelectionResult,
} from '../../core/types.ts';
import type { ClickSpec } from '../../core/platform.ts';
import { buildExpectedNotes, prepareExcerpt } from '../../corpus/index.ts';
import { decodeManifestEntries } from '../../corpus/load/decode.ts';
import { grade } from '../../grade/index.ts';
import { loadConfigs, resolveTolerances } from '../../rules/index.ts';
import gradingJson from '../../../config/grading-config.json';
import instrumentsJson from '../../../config/instruments.json';
import levelsJson from '../../../config/levels.json';
import budgetJson from '../../../config/measurement-budget.json';
import progressionJson from '../../../config/progression.json';
import tipsJson from '../../../config/tips.json';
import valvesJson from '../../../data/trumpet-valves.json';
import manifestJson from '../../../fixtures/corpus/manifest.a10406fa54.json';
import shardL03 from '../../../fixtures/corpus/shard-L03-01.a5c80d091c.json';

export const SLICE = {
  excerptId: 'jaell-lc6157272-voice-m20-27',
  instrumentId: 'flute',
  bpm: 80,
  countInBars: 1,
  timbre: 'tick',
  accentDb: 5,
  /**
   * `?testClock=1`: t0 = first captured frame + this (01 §13.4 says 2.0 s; a 1-bar count-in at 80 bpm is 3 s and
   * must start at least 0.5 s after capture, so the slice uses 4 s). Test WAVs are rendered with this offset.
   */
  testClockT0AfterCaptureSec: 4,
  /** Scheduled lead before the first count-in click on a real clock (01 §7.1, at least 0.5 s). */
  leadSec: 0.6,
} as const;

/** Exact decimated rate of the capture worklet for a context rate (01 §7.2: D = round(rate / 16000)). */
export const analysisRateFor = (contextRate: number): number => contextRate / Math.max(1, Math.round(contextRate / 16000));

let configsCache: Configs | null = null;

/** The five config files plus the budget and valve table, validated (01 §5.4). */
export function sliceConfigs(): Configs {
  configsCache ??= loadConfigs({
    grading: gradingJson,
    levels: levelsJson,
    instruments: instrumentsJson,
    progression: progressionJson,
    tips: tipsJson,
    budget: budgetJson,
    trumpetValves: valvesJson,
  } as unknown as RawConfigs);
  return configsCache;
}

/** The fixture excerpt and its manifest entry. */
export function sliceSource(id: string = SLICE.excerptId): { doc: ExcerptDoc; entry: ManifestEntry } {
  const doc = (shardL03 as unknown as { excerpts: ExcerptDoc[] }).excerpts.find((d) => d.id === id);
  const entry = decodeManifestEntries(manifestJson as never).find((e) => e.id === id);
  if (!doc || !entry) throw new Error(`slice: fixture excerpt ${id} not found`);
  return { doc, entry };
}

export interface SliceTake {
  prepared: PreparedExcerpt;
  expected: ExpectedNote[];
  tolerances: ResolvedTolerance[];
  inst: Instrument;
  level: number;
  bpm: number;
  beatsPerBar: number;
  writtenKey: KeySig;
  countInBeats: number;
  /** Beats from bar 1 beat 1 to the take end (R14: one beat after the last note's written end). */
  totalBeats: number;
  /** Score seconds of the take end. */
  endSec: number;
  selection: SelectionResult;
  doc: ExcerptDoc;
}

/** Prepares the slice excerpt for the instrument at concert pitch and builds its expected notes and tolerances. */
export function sliceTake(cfg: Configs, o: { bpm?: number; instrumentId?: string; excerptId?: string } = {}): SliceTake {
  const bpm = o.bpm ?? SLICE.bpm;
  const instrumentId = o.instrumentId ?? SLICE.instrumentId;
  const { doc: src, entry } = sliceSource(o.excerptId);
  const inst = cfg.instrumentById[instrumentId];
  if (!inst) throw new Error(`slice: no instrument ${instrumentId}`);
  const level = src.level;
  const lv = cfg.levelByNumber[level];
  if (!lv) throw new Error(`slice: no level ${level}`);
  const doc: ExcerptDoc = { ...src, tempo: { ...src.tempo, minBpm: lv.tempo.minBpm, maxBpm: lv.tempo.maxBpm } };
  const selection: SelectionResult = {
    entry,
    settings: { instrumentId, level, writtenKey: doc.keyConcert, meter: `${doc.meter.beats}/${doc.meter.beatType}`, bpm, bars: 8, randomized: [], seed: 1 },
    levelServed: level,
    stretch: false,
    fromLevelBelow: false,
    transposition: { diatonic: 0, chromatic: 0 },
    writtenKey: doc.keyConcert,
    concertKey: doc.keyConcert,
    clef: 'treble',
    bpmRange: { minBpm: lv.tempo.minBpm, maxBpm: lv.tempo.maxBpm },
    octaveDisplaced: false,
    enharmonicRetry: false,
  };
  const prepared = prepareExcerpt(doc, selection, inst, cfg);
  const expected = buildExpectedNotes(prepared, bpm, cfg);
  const tolerances = resolveTolerances(expected, { instrument: inst, level, bpm, meter: doc.meter }, cfg);
  const last = expected[expected.length - 1] as ExpectedNote;
  const afterBeats = cfg.grading.endOfTake.afterLastNoteEndBeats;
  const endSec = (last.onsetSec as number) + last.durSec + (afterBeats * 60) / bpm;
  return {
    prepared,
    expected,
    tolerances,
    inst,
    level,
    bpm,
    beatsPerBar: doc.meter.countsPerBar,
    writtenKey: prepared.writtenKey,
    countInBeats: SLICE.countInBars * doc.meter.countsPerBar,
    totalBeats: (last.onsetBeat as number) + (last.durBeats as number) + afterBeats,
    endSec,
    selection,
    doc,
  };
}

/** DspConfig for the take (01 §5.6). Click arrivals are `t + RTL`, and only matter on speakers. */
export function sliceDspConfig(take: SliceTake, cfg: Configs, o: { analysisRate: number; outputMode: OutputMode; clicks: ClickSpec[]; rtlSec: number }): DspConfig {
  const d = take.inst.detection;
  const speakers = o.outputMode === 'speakers';
  return {
    analysisRate: o.analysisRate,
    windowSamples: d.windowSamples,
    hopSamples: 128,
    minHz: d.minHz,
    maxHz: d.maxHz,
    a4Hz: 440,
    clarityThreshold: d.clarityThreshold,
    changeCents: d.changeCents,
    onsetProfile: d.onsetProfile,
    vibratoClass: d.vibratoClass,
    outputMode: o.outputMode,
    clicks: speakers ? o.clicks.map((c) => ({ arrival: ((c.t as number) + o.rtlSec) as ClockSeconds, accent: c.accent })) : [],
    clickTemplate: null,
    repeatHints: [],
    attackExcludeMs: cfg.grading.intonation.attackExcludeMsByFamily[take.inst.family],
    clickLeakDb: null,
  };
}

/** FollowConfig (01 §5.7): t0 is bar 1 beat 1 on the output timeline, the RTL is subtracted from every onset. */
export function sliceFollowConfig(take: SliceTake, cfg: Configs, o: { t0: ClockSeconds; rtlSec: number; analysisRate: number }): FollowConfig {
  return {
    expected: take.expected,
    tolerances: take.tolerances,
    t0: o.t0,
    latencyCompensationSec: o.rtlSec,
    bpm: take.bpm,
    beatsPerBar: take.beatsPerBar,
    instrument: take.inst,
    cfg,
    voiceReferenceCents: 0,
    analysisRate: o.analysisRate,
    writtenKey: take.writtenKey,
  };
}

export interface SliceGradeFacts {
  alignment: FinalAlignment;
  detected: DetectedNote[];
  signal: { medianClarity: number | null; clippingFrac: number };
  /** False with testClock or a typed RTL: the take is practice (R16). */
  calibrationMeasured: boolean;
}

/** GradeInput for the take: a practice take (no calibration in the slice), no tuning note, no XP context. */
export function sliceGradeInput(take: SliceTake, cfg: Configs, f: SliceGradeFacts): GradeInput {
  return {
    expected: take.expected,
    tolerances: take.tolerances,
    alignment: f.alignment,
    detected: f.detected,
    instrument: take.inst,
    level: take.level,
    bpm: take.bpm,
    meter: take.prepared.meter,
    writtenKey: take.writtenKey,
    cfg,
    tuning: take.inst.family === 'voice' || take.inst.pitchKind === 'fixed' ? null : { used: false, offsetCents: 0 },
    voiceReference: null,
    signal: f.signal,
    calibrationMeasured: f.calibrationMeasured,
    ranking: { mode: 'practice', seenBefore: false, scanStrict: true, familiarity: 0, skipLimitHit: false, metronome: 'audible', gateFailures: f.calibrationMeasured ? [] : ['calibration-unmeasured'] },
    xp: { playerLevel: take.level, randomized: { key: false, meter: false, tempo: false }, streakDays: 0, dailyCountBefore: 0, repeatIndexToday: 0, placement: false },
  };
}

/** The slice's grade (P12 `grade`, no patterns or tips: S1 shows bare results). */
export function sliceGrade(take: SliceTake, cfg: Configs, f: SliceGradeFacts): AttemptScore {
  return grade(sliceGradeInput(take, cfg, f));
}

export interface SliceRecordFacts extends SliceGradeFacts {
  id: string;
  createdAt: string;
  score: AttemptScore;
  live: LiveJudgment[];
  rtlSec: number;
  outputMode: OutputMode;
  audioEnv: AudioEnv;
}

/** The attempt record the slice stores (01 §6.5); never audio. */
export function sliceAttemptRecord(take: SliceTake, cfg: Configs, f: SliceRecordFacts): AttemptRecord {
  const s = take.doc.source;
  const settings = take.selection.settings;
  return {
    schemaVersion: 1,
    id: f.id,
    profileId: 'dev-slice',
    createdAt: f.createdAt,
    appVersion: 'dev',
    configVersion: cfg.configVersion,
    corpusVersion: 'fixtures',
    coreVersion: 'dev',
    excerptId: take.doc.id,
    dedupeGroup: take.doc.dedupeGroup,
    instrumentId: take.inst.id,
    beta: take.inst.status !== 'launch',
    levelServed: take.level,
    stretch: false,
    placement: false,
    settingsResolved: {
      instrumentId: settings.instrumentId,
      level: settings.level,
      writtenKey: settings.writtenKey,
      meter: settings.meter,
      bpm: settings.bpm,
      bars: settings.bars,
      mode: 'practice',
      listening: true,
      metronome: 'audible',
      clickTimbre: SLICE.timbre,
      outputMode: f.outputMode,
      a4Hz: 440,
      seed: settings.seed,
    },
    transposition: take.prepared.transposition,
    writtenKey: take.writtenKey,
    concertKey: take.prepared.concertKey,
    clef: take.prepared.clef,
    bpm: take.bpm,
    scanSeconds: 0,
    listening: true,
    calibration: { method: 'none', latencyCompensationMs: f.rtlSec * 1000, outputMode: f.outputMode, recheck: null },
    tuning: take.inst.family === 'voice' || take.inst.pitchKind === 'fixed' ? null : { used: false, offsetCents: 0 },
    audioEnv: f.audioEnv,
    detected: f.detected,
    judgments: f.alignment.judgments,
    extras: f.alignment.extras,
    displaced: f.alignment.displaced,
    score: f.score,
    endReason: 'complete',
    excerptBurned: false,
    countsAsSkip: false,
    credit: {
      composer: s.composer,
      ...(s.composerDates !== undefined ? { composerDates: s.composerDates } : {}),
      work: s.work,
      ...(s.catalog !== undefined ? { catalog: s.catalog } : {}),
      ...(s.movement !== undefined ? { movement: s.movement } : {}),
      sourceMeasures: s.sourceMeasures,
      corpus: s.corpus,
      license: s.license,
    },
    debug: { live: f.live },
  };
}
