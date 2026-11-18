/**
 * Feature-to-level tagger (02 §2.1 to §2.4, 03 §6.8). Level = max over per-feature levels; each feature level is the
 * lowest level of config/levels.json whose limit admits the window. Pure: reads only the configs passed in.
 */
import { makeMeter } from '../../core/time.ts';
import type { DifficultyFeatures, FeatureKey, FeatureLevels, LevelDef, LevelsConfig, MeasurementBudget, Meter, Mode } from '../../core/types.ts';

const MAX_LEVEL = 10;
const EPS = 1e-9;

/** Input of the tagger: the window's features plus its meter, mode and rhythm cell ids. */
export interface TaggerInput {
  /** "beats/beatType", e.g. "6/8". */
  meter: string;
  mode: Mode;
  /** Only read for mode 'minor'; defaults to natural. */
  minorForm?: 'natural' | 'harmonic' | 'melodic';
  rhythmCells: readonly string[];
  features: DifficultyFeatures;
}

export interface TaggerResult {
  featureLevels: FeatureLevels;
  /** max(featureLevels), 1..10. */
  level: number;
  /** Number of features at the maximum (1 = stretch candidate). */
  levelConfidence: number;
}

export const FEATURE_KEYS: readonly FeatureKey[] = ['meter', 'rhythm', 'interval', 'leaps', 'span', 'mode', 'chromatic', 'double', 'density'];

/** Metronome beat in ticks for a "n/d" meter (02 conventions); same as makeMeter. */
export function meterBeatTicks(meter: string): number {
  const [num, den] = meter.split('/').map(Number);
  if (!num || !den) throw new Error(`bad meter ${meter}`);
  return makeMeter(num, den as Meter['beatType']).countUnitTicks;
}

function firstLevel(levels: readonly LevelDef[], pred: (l: LevelDef) => boolean): number {
  return levels.find(pred)?.level ?? MAX_LEVEL;
}

/** Level of one rhythm cell id: first level whose vocabulary has it; unknown cells are "any other" (10). */
export function cellLevel(levels: readonly LevelDef[], cell: string): number {
  return firstLevel(levels, (l) => l.rhythmCells.includes(cell));
}

/** Rhythm feature level of a set of cells (at least 1). */
export function rhythmLevel(levels: readonly LevelDef[], cells: readonly string[]): number {
  return Math.max(1, ...cells.map((c) => cellLevel(levels, c)));
}

/** Lowest level whose tempo range permits the window's peak density under the NPS cap and IOI floors (03 §6.8). */
function densityLevel(levels: readonly LevelDef[], budget: MeasurementBudget, input: TaggerInput): number {
  const f = input.features;
  const beat = meterBeatTicks(input.meter);
  const pitchFloor = budget.ioiFloors.pitchChangeMs['512'];
  const smallestFloor = Math.min(pitchFloor, budget.ioiFloors.repeatMs.tonguedOrStruck);
  for (const l of levels) {
    const bpm = l.tempo.minBpm;
    const nps = (f.peakNotesPerBeat * bpm) / 60;
    const cap = Math.min(l.npsCap['512'], 1000 / pitchFloor);
    const ioiMs = (f.minIoiTicks / beat) * (60000 / bpm);
    if (nps <= cap + EPS && ioiMs >= smallestFloor) return l.level;
  }
  return MAX_LEVEL;
}

function modeLevel(levels: readonly LevelDef[], input: TaggerInput): number {
  if (input.mode === 'major') return firstLevel(levels, (l) => l.modes.includes('major'));
  if (input.mode === 'minor') {
    const form = input.minorForm ?? 'natural';
    return firstLevel(levels, (l) => l.modes.includes('minor') && l.minorForms.includes(form));
  }
  return firstLevel(levels, (l) => l.modal.includes(input.mode));
}

/** Per-feature levels, their maximum and how many features sit at it. */
export function tagLevels(input: TaggerInput, cfg: LevelsConfig, budget: MeasurementBudget): TaggerResult {
  const levels = cfg.levels;
  const f = input.features;
  const featureLevels: FeatureLevels = {
    meter: firstLevel(levels, (l) => l.meters.includes(input.meter)),
    rhythm: rhythmLevel(levels, input.rhythmCells),
    interval: firstLevel(
      levels,
      (l) =>
        l.maxIntervalSemis === null ||
        f.maxLeapSemis <= l.maxIntervalSemis ||
        (f.tonicTriadLeapsOnly && l.largerLeaps !== null && f.maxLeapSemis <= l.largerLeaps.maxSemis),
    ),
    leaps: firstLevel(levels, (l) => l.maxLeapsPer4Bars === null || f.leapsPer4BarsMax <= l.maxLeapsPer4Bars),
    span: firstLevel(levels, (l) => l.maxSpanSemis === null || f.spanSemis <= l.maxSpanSemis),
    mode: modeLevel(levels, input),
    chromatic: firstLevel(levels, (l) => l.chromaticPer4Bars === null || f.chromaticPer4BarsMax <= l.chromaticPer4Bars),
    double: f.doubleAccidentals > 0 ? firstLevel(levels, (l) => l.doubleAccidentals) : 1,
    density: densityLevel(levels, budget, input),
  };
  const values = FEATURE_KEYS.map((k) => featureLevels[k]);
  const level = Math.max(...values);
  return { featureLevels, level, levelConfidence: values.filter((v) => v === level).length };
}
