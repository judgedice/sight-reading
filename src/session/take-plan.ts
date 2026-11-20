/**
 * Pure helpers for one take (01 §5.6, §5.7, §7.1, §7.5, §7.10; 02 §2.3, §4.5, §4.6): the take plan (expected notes,
 * tolerances, count-in, end of take), the DSP and follow configs, the voice reference tones and the tuning-note
 * reading. No clock, no platform: the session supplies times and the backend's facts.
 */
import type {
  Calibration,
  ClickTimbre,
  ClockSeconds,
  Configs,
  DetectedNote,
  DspConfig,
  ExcerptDoc,
  ExcerptCreditSnapshot,
  ExpectedNote,
  FollowConfig,
  Instrument,
  OutputMode,
  PreparedExcerpt,
  ResolvedTolerance,
} from '../core/types.ts';
import type { ClickSpec } from '../core/platform.ts';
import { buildExpectedNotes } from '../corpus/index.ts';
import { resolveOneNote, resolveTolerances } from '../rules/index.ts';
import { midiToFreq, toMidi, tonicOf } from '../theory/index.ts';

/** Everything the session needs to schedule, follow and grade one take of a prepared excerpt. */
export interface TakePlan {
  inst: Instrument;
  bpm: number;
  level: number;
  expected: ExpectedNote[];
  tolerances: ResolvedTolerance[];
  beatsPerBar: number;
  countInBars: number;
  countInBeats: number;
  /** Beats from bar 1 beat 1 to the take end (R14). */
  totalBeats: number;
  /** Score seconds of the take end (R14: one beat after the last note's written end). */
  endSec: number;
  /** Score seconds of the first expected note (negative in a pickup). */
  firstNoteSec: number;
}

/** Count-in bars (02 §2.3): the level's, or `countIn.slowBars` below `countIn.slowBelowBpm`. */
export function countInBarsFor(cfg: Configs, level: number, bpm: number): number {
  const def = cfg.levelByNumber[level];
  const base = def?.countInBars ?? 1;
  const slow = cfg.levels.countIn;
  return bpm < slow.slowBelowBpm ? Math.max(base, slow.slowBars) : base;
}

export function planTake(prepared: PreparedExcerpt, cfg: Configs): TakePlan {
  const inst = cfg.instrumentById[prepared.instrumentId];
  if (!inst) throw new Error(`session: unknown instrument ${prepared.instrumentId}`);
  const bpm = prepared.selection.settings.bpm;
  const level = prepared.levelServed;
  const expected = buildExpectedNotes(prepared, bpm, cfg);
  if (expected.length === 0) throw new Error(`session: excerpt ${prepared.excerptId} has no notes`);
  const tolerances = resolveTolerances(expected, { instrument: inst, level, bpm, meter: prepared.meter }, cfg);
  const beatsPerBar = prepared.meter.countsPerBar;
  const countInBars = countInBarsFor(cfg, level, bpm);
  const last = expected[expected.length - 1] as ExpectedNote;
  const after = cfg.grading.endOfTake.afterLastNoteEndBeats;
  return {
    inst,
    bpm,
    level,
    expected,
    tolerances,
    beatsPerBar,
    countInBars,
    countInBeats: countInBars * beatsPerBar,
    totalBeats: last.onsetBeat + last.durBeats + after,
    endSec: last.onsetSec + last.durSec + (after * 60) / bpm,
    firstNoteSec: (expected[0] as ExpectedNote).onsetSec,
  };
}

/** Score-informed re-articulation hints (01 §7.5): every `repeat` note's expected arrival on the input timeline. */
export function repeatHints(plan: TakePlan, t0: number, rtlSec: number): DspConfig['repeatHints'] {
  const out: DspConfig['repeatHints'] = [];
  plan.expected.forEach((e, i) => {
    if (e.onsetKind !== 'repeat') return;
    const tol = plan.tolerances[i] as ResolvedTolerance;
    out.push({ t: (t0 + rtlSec + e.onsetSec) as ClockSeconds, halfWidthSec: tol.matchWindowSec });
  });
  return out;
}

/** Every written onset on the input timeline, sorted (round 2: `DspConfig.onsetHints`). */
export function onsetHints(plan: TakePlan, t0: number, rtlSec: number): ClockSeconds[] {
  return plan.expected.map((e) => (t0 + rtlSec + e.onsetSec) as ClockSeconds).sort((a, b) => a - b);
}

export interface DspConfigFacts {
  analysisRate: number;
  outputMode: OutputMode;
  a4Hz: number;
  /** Scheduled clicks of the take (speakers only matter). */
  clicks: readonly ClickSpec[];
  rtlSec: number;
  timbre: ClickTimbre;
  /** Calibration of the route, for the click template and leak floor (speakers only). */
  calibration: Calibration | null;
  repeatHints: DspConfig['repeatHints'];
  /** The take's difficulty, for the one-note tolerances (round 2 detection); absent: none (the tuning note). */
  level?: number;
  /** Written onsets (`onsetHints`), for the scoop rule. */
  onsetHints?: ClockSeconds[];
}

/** DspConfig for a take or a tuning note (01 §5.6). Bleed handling is speakers only (01 §7.6). */
export function dspConfigFor(inst: Instrument, cfg: Configs, f: DspConfigFacts): DspConfig {
  const d = inst.detection;
  const speakers = f.outputMode === 'speakers';
  const tpl = speakers ? f.calibration?.templates[f.timbre] : undefined;
  return {
    analysisRate: f.analysisRate,
    windowSamples: d.windowSamples,
    hopSamples: 128,
    minHz: d.minHz,
    maxHz: d.maxHz,
    a4Hz: f.a4Hz,
    clarityThreshold: d.clarityThreshold,
    changeCents: d.changeCents,
    onsetProfile: d.onsetProfile,
    vibratoClass: d.vibratoClass,
    outputMode: f.outputMode,
    clicks: speakers ? f.clicks.map((c) => ({ arrival: ((c.t as number) + f.rtlSec) as ClockSeconds, accent: c.accent })) : [],
    // P4d: the template is used as calibrated; the take's metronome gain equals the calibration's in v1 (one volume).
    clickTemplate: tpl && Math.abs(tpl.rate - f.analysisRate) < 1e-6 ? Float32Array.from(tpl.samples) : null,
    repeatHints: f.repeatHints,
    attackExcludeMs: cfg.grading.intonation.attackExcludeMsByFamily[inst.family],
    clickLeakDb: speakers && f.calibration && f.calibration.method !== 'reported' ? f.calibration.clickLeakDb : null,
    oneNote: f.level === undefined ? null : resolveOneNote(cfg, inst, f.level),
    ...(f.onsetHints ? { onsetHints: f.onsetHints } : {}),
  };
}

/** FollowConfig (01 §5.7): t0 is bar 1 beat 1 on the output timeline, the RTL is subtracted from every onset. */
export function followConfigFor(plan: TakePlan, prepared: PreparedExcerpt, cfg: Configs, f: { t0: number; rtlSec: number; analysisRate: number; tuningCents: number }): FollowConfig {
  return {
    expected: plan.expected,
    tolerances: plan.tolerances,
    t0: f.t0 as ClockSeconds,
    latencyCompensationSec: f.rtlSec,
    bpm: plan.bpm,
    beatsPerBar: plan.beatsPerBar,
    instrument: plan.inst,
    cfg,
    voiceReferenceCents: f.tuningCents,
    analysisRate: f.analysisRate,
    writtenKey: prepared.writtenKey,
    oneNote: resolveOneNote(cfg, plan.inst, plan.level),
  };
}

/** True for families that take the optional tuning note (02 §4.5: winds, brass, strings). */
export function takesTuningNote(inst: Instrument): boolean {
  return inst.family !== 'voice' && inst.pitchKind === 'continuous';
}

/** One tone of the voice reference, seconds relative to its start. */
export interface ReferenceTone {
  midi: number;
  hz: number;
  atSec: number;
  durSec: number;
}

/** Voice reference timing (02 §4.5, R7): an arpeggiated tonic triad, then the starting note, held longer. */
export const VOICE_REFERENCE = { triadToneSec: 0.5, gapSec: 0.05, firstNoteSec: 1.0 } as const;

/**
 * The voice reference (02 §4.5, R7): the concert tonic triad in the singer's octave (root at or below the first
 * note), then the first note. The excerpt's key signature names the tonic; a church-mode excerpt uses its key
 * signature's major or minor tonic in v1.
 */
export function voiceReferenceTones(prepared: PreparedExcerpt, firstConcertMidi: number, a4Hz: number): ReferenceTone[] {
  const tonicPc = ((toMidi(tonicOf(prepared.concertKey)) % 12) + 12) % 12;
  const root = firstConcertMidi - ((((firstConcertMidi - tonicPc) % 12) + 12) % 12);
  const third = prepared.concertKey.mode === 'minor' ? 3 : 4;
  const r = VOICE_REFERENCE;
  const tones: ReferenceTone[] = [];
  let t = 0;
  for (const m of [root, root + third, root + 7]) {
    tones.push({ midi: m, hz: midiToFreq(m, a4Hz), atSec: t, durSec: r.triadToneSec });
    t += r.triadToneSec + r.gapSec;
  }
  t += r.gapSec;
  tones.push({ midi: firstConcertMidi, hz: midiToFreq(firstConcertMidi, a4Hz), atSec: t, durSec: r.firstNoteSec });
  return tones;
}

/** Total length of a reference, seconds. */
export const referenceLengthSec = (tones: readonly ReferenceTone[]): number => tones.reduce((m, x) => Math.max(m, x.atSec + x.durSec), 0);

/**
 * Tuning-note offset (02 §4.5, 01 §7.10): the steady median of the longest steady note, as cents from its nearest
 * semitone, capped at ±`grading.tuning.maxOffsetCents`. Null when no note was steady long enough to read.
 */
export function tuningOffsetFrom(notes: readonly DetectedNote[], cfg: Configs, minSteadyMs: number): number | null {
  let best: DetectedNote | null = null;
  for (const n of notes) if (n.steadyMs >= minSteadyMs && (!best || n.steadyMs > best.steadyMs)) best = n;
  if (!best) return null;
  const cap = cfg.grading.tuning.maxOffsetCents;
  const c = Math.max(-cap, Math.min(cap, best.stableMedianCents));
  return Math.round(c * 10) / 10;
}

/** Credit snapshot stored with the attempt (03 §9.1 item 5). */
export function creditOf(doc: Pick<ExcerptDoc, 'source'>): ExcerptCreditSnapshot {
  const s = doc.source;
  return {
    composer: s.composer,
    ...(s.composerDates !== undefined ? { composerDates: s.composerDates } : {}),
    work: s.work,
    ...(s.catalog !== undefined ? { catalog: s.catalog } : {}),
    ...(s.movement !== undefined ? { movement: s.movement } : {}),
    sourceMeasures: s.sourceMeasures,
    corpus: s.corpus,
    license: s.license,
  };
}

/** Displayed bar of a score beat (pickup = 0, first full bar = 1). */
export function barOfBeat(scoreBeat: number, beatsPerBar: number, hasPickup: boolean): number {
  if (scoreBeat < 0) return hasPickup ? 0 : 1;
  return Math.floor(scoreBeat / beatsPerBar + 1e-9) + 1;
}
