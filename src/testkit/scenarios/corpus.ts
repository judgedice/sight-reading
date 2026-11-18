/**
 * Scenario bases from the fixture corpus (01 section 13.2: "from the 24-excerpt fixture corpus until P5
 * delivers"). Expected notes are built with the fixture generator's port of P0e's rules
 * (src/corpus/expected, P9c's buildExpectedNotes, proven against fixtures/expected/ by its own test) on an excerpt
 * prepared with the fixture generator's transposition plan. Node only (reads the fixture files).
 */
import type { Clef, Configs, ExcerptDoc, ExpectedNote, Instrument, KeySig, Meter, PreparedExcerpt, PreparedMeasure, SelectionResult, TestkitTimbre } from '../../core/types.ts';
import { plan, type Plan } from '../../../fixtures/follow/gen/expected.ts';
import { buildExpectedNotes } from '../../corpus/expected/index.ts';
import { planTransposition, spellExcerpt } from '../../corpus/transpose/spell.ts';
import { configs, corpusDocs } from '../../../fixtures/follow/gen/io.ts';

export interface ScenarioBase {
  excerptId: string;
  instrumentId: string;
  inst: Instrument;
  timbre: TestkitTimbre;
  level: number;
  bpm: number;
  meter: Meter;
  beatsPerBar: number;
  writtenKey: KeySig;
  clef: Clef;
  expected: ExpectedNote[];
}

export const scenarioConfigs = (): Configs => configs();
export const fixtureDocs = (): readonly ExcerptDoc[] => corpusDocs();

/** Launch instruments plus tuba (PLAN R21, 01 section 13.2), one testkit timbre each; voice picks a voice type. */
export const SCENARIO_INSTRUMENTS: Readonly<Record<TestkitTimbre, readonly string[]>> = {
  flute: ['flute'],
  clarinet: ['clarinet-bb'],
  sax: ['sax-alto'],
  trumpet: ['trumpet-bb'],
  violin: ['violin'],
  cello: ['cello'],
  voice: ['voice-soprano', 'voice-alto', 'voice-tenor', 'voice-bass'],
  piano: ['piano-rh'],
  tuba: ['tuba'],
};

/** The level's tempo range (dotted-beat range for compound meters where levels.json says so), met with the excerpt's. */
export function tempoRange(d: ExcerptDoc, cfg: Configs): [number, number] {
  const lv = cfg.levelByNumber[d.level];
  if (!lv) throw new Error(`no level ${d.level}`);
  let { minBpm: lo, maxBpm: hi } = lv.tempo;
  const compound = d.meter.beatType === 8 && d.meter.beats >= 6 && d.meter.beats % 3 === 0;
  if (compound && cfg.levels.compound.dottedBeatLevels.includes(d.level)) ({ minBpm: lo, maxBpm: hi } = cfg.levels.compound.dottedBpm);
  const a = Math.max(lo, d.tempo.minBpm);
  const b = Math.min(hi, d.tempo.maxBpm);
  return a <= b ? [a, b] : [lo, hi];
}

/**
 * The fastest tempo at or below `bpm` whose IOIs all respect the 01 section 8.3 floors for this instrument: the
 * pitch-change floor of its window class, and the same-pitch repeat floor (tongued or struck 100 ms, voice or bowed
 * 130 ms). Ties count as one note, so only real onsets matter.
 */
export function clipTempo(expectedAt60: readonly ExpectedNote[], inst: Instrument, bpm: number, cfg: Configs): number {
  const f = cfg.budget.ioiFloors;
  const pc = f.pitchChangeMs[String(inst.detection.windowSamples) as '512' | '1024' | '2048'] / 1000;
  const softRepeat = inst.detection.onsetProfile === 'voice' || inst.detection.onsetProfile === 'bowed';
  const rep = (softRepeat ? f.repeatMs.voiceOrBowed : f.repeatMs.tonguedOrStruck) / 1000;
  let maxBpm = Infinity;
  for (let i = 1; i < expectedAt60.length; i++) {
    const a = expectedAt60[i - 1] as ExpectedNote;
    const b = expectedAt60[i] as ExpectedNote;
    const beats = b.onsetBeat - a.onsetBeat;
    if (beats <= 0) continue;
    const floor = a.concertMidi === b.concertMidi ? rep : pc;
    maxBpm = Math.min(maxBpm, (60 * beats) / floor);
  }
  return Math.max(20, Math.min(bpm, Math.floor(maxBpm)));
}

/** The excerpt as prepareExcerpt would give it for the fixture plan, without the selection's tempo checks (scenarios pick their own tempo). */
function prepareForPlan(d: ExcerptDoc, inst: Instrument, pl: Plan, bpm: number, cfg: Configs): PreparedExcerpt | null {
  const tp = planTransposition(d.keyConcert, pl.writtenKey, pl.transposition.chromatic, inst);
  const spelled = spellExcerpt(d, tp, inst, cfg.levelByNumber[d.level]?.doubleAccidentals ?? false);
  if (spelled.verdict !== 'ok') return null;
  let bar = 1;
  const measures: PreparedMeasure[] = d.measures.map((m) => ({
    index: m.index,
    isPickup: m.isPickup,
    startTick: m.startTick,
    displayBar: m.isPickup ? 0 : bar++,
    events: m.events.map((e) => {
      if (e.kind === 'rest') return { ...e };
      const { pitch: _pitch, ...rest } = e;
      return { ...rest, concertPitch: spelled.concert.get(e.id)!, writtenPitch: spelled.written.get(e.id)! };
    }),
  }));
  return {
    excerptId: d.id,
    instrumentId: inst.id,
    source: d.source,
    meter: d.meter,
    pickupTicks: d.pickupTicks,
    writtenKey: pl.writtenKey,
    concertKey: tp.concertKey,
    modal: d.modal,
    clef: pl.clef,
    transposition: tp.concertInterval,
    measures,
    rangeWritten: { min: 0, max: 127 },
    modifications: [],
    barRhythmLevel: d.barRhythmLevel,
    extremes: d.extremes,
    dedupeGroup: d.dedupeGroup,
    levelServed: d.level,
    stretch: false,
    bpmRange: { minBpm: bpm, maxBpm: bpm },
    selection: {} as SelectionResult,
  };
}

/** Build a base, or null when the excerpt does not fit the instrument (03 section 7.3 planning). */
export function buildBase(d: ExcerptDoc, instrumentId: string, bpm: number, cfg: Configs = configs()): ScenarioBase | null {
  const inst = cfg.instrumentById[instrumentId];
  if (!inst || !inst.testkitTimbre) return null;
  const pl = plan(d, inst, cfg.levels);
  if (!pl) return null;
  const prepared = prepareForPlan(d, inst, pl, bpm, cfg);
  if (!prepared) return null;
  return {
    excerptId: d.id,
    instrumentId,
    inst,
    timbre: inst.testkitTimbre,
    level: d.level,
    bpm,
    meter: d.meter,
    beatsPerBar: d.meter.countsPerBar,
    writtenKey: pl.writtenKey,
    clef: pl.clef,
    expected: buildExpectedNotes(prepared, bpm, cfg),
  };
}

/** Docs that fit an instrument. */
export function fittingDocs(instrumentId: string, cfg: Configs = configs()): ExcerptDoc[] {
  const inst = cfg.instrumentById[instrumentId];
  if (!inst) return [];
  return corpusDocs().filter((d) => plan(d, inst, cfg.levels) !== null);
}
