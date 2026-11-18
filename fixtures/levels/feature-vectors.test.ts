// Golden feature-to-level cases (02 §2.1, §2.3; 03 §6.8). Checks the fixture against its schema and against an
// independent reference tagger that reads only config/levels.json and config/measurement-budget.json. The TypeScript
// and Python level taggers must reproduce `expected` for every case.
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeMeter } from '../../src/core/time.ts';
import type { DifficultyFeatures, FeatureLevels, LevelDef, LevelsConfig, LevelTaggerGolden, MeasurementBudget, Meter, Mode } from '../../src/core/types.ts';

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')) as T;

const golden = readJson<LevelTaggerGolden>('fixtures/levels/feature-vectors.json');
const levels = readJson<LevelsConfig>('config/levels.json').levels;
const budget = readJson<MeasurementBudget>('config/measurement-budget.json');

const firstLevel = (pred: (l: LevelDef) => boolean): number => levels.find(pred)?.level ?? 10;

/**
 * Ticks of one metronome beat at TPQ 480 (02 conventions: dotted quarter = 720 ticks in 6/8, 9/8, 12/8; eighth in
 * 3/8, 5/8, 7/8 and other irregular x/8; half in x/2). Matches makeMeter in src/core/time.ts.
 */
function beatTicks(meter: string): number {
  const [num, den] = meter.split('/').map(Number) as [number, number];
  return makeMeter(num, den as Meter['beatType']).countUnitTicks;
}

function referenceTag(c: LevelTaggerGolden['cases'][number]): FeatureLevels {
  const f: DifficultyFeatures = c.features;
  const cellLevel = (cell: string): number => firstLevel((l) => l.rhythmCells.includes(cell));
  const modeLevel = ((): number => {
    if (c.mode === 'major') return firstLevel((l) => l.modes.includes('major'));
    if (c.mode === 'minor') return firstLevel((l) => l.modes.includes('minor') && l.minorForms.includes(c.minorForm ?? 'natural'));
    return firstLevel((l) => l.modal.includes(c.mode as Mode));
  })();
  const density = ((): number => {
    for (const l of levels) {
      const bpm = l.tempo.minBpm;
      const nps = (f.peakNotesPerBeat * bpm) / 60;
      const cap = Math.min(l.npsCap['512'], 1000 / budget.ioiFloors.pitchChangeMs['512']);
      const ioiMs = (f.minIoiTicks / beatTicks(c.meter)) * (60000 / bpm);
      const smallestFloor = Math.min(budget.ioiFloors.pitchChangeMs['512'], budget.ioiFloors.repeatMs.tonguedOrStruck);
      if (nps <= cap + 1e-9 && ioiMs >= smallestFloor) return l.level;
    }
    return 10;
  })();
  return {
    meter: firstLevel((l) => l.meters.includes(c.meter)),
    rhythm: Math.max(1, ...c.rhythmCells.map(cellLevel)),
    interval: firstLevel(
      (l) =>
        l.maxIntervalSemis === null ||
        f.maxLeapSemis <= l.maxIntervalSemis ||
        (f.tonicTriadLeapsOnly && l.largerLeaps !== null && f.maxLeapSemis <= l.largerLeaps.maxSemis),
    ),
    leaps: firstLevel((l) => l.maxLeapsPer4Bars === null || f.leapsPer4BarsMax <= l.maxLeapsPer4Bars),
    span: firstLevel((l) => l.maxSpanSemis === null || f.spanSemis <= l.maxSpanSemis),
    mode: modeLevel,
    chromatic: firstLevel((l) => l.chromaticPer4Bars === null || f.chromaticPer4BarsMax <= l.chromaticPer4Bars),
    double: f.doubleAccidentals > 0 ? firstLevel((l) => l.doubleAccidentals) : 1,
    density,
  };
}

describe('fixtures/levels/feature-vectors.json', () => {
  it('validates against level-tagger-golden.schema.json', () => {
    const ajv = new Ajv({ strict: true, allowUnionTypes: true, allErrors: true });
    const validate = ajv.compile(readJson<object>('schemas/level-tagger-golden.schema.json'));
    expect(validate(golden), JSON.stringify(validate.errors)).toBe(true);
  });

  it('has unique ids and covers every level 1 to 10 and every feature as the binding one', () => {
    const ids = golden.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let lvl = 1; lvl <= 10; lvl++) expect(golden.cases.some((c) => c.expected.level === lvl), `level ${lvl}`).toBe(true);
    const keys = Object.keys(golden.cases[0]?.expected.featureLevels ?? {}) as (keyof FeatureLevels)[];
    for (const key of keys) {
      expect(
        golden.cases.some((c) => c.expected.featureLevels[key] === c.expected.level && c.expected.level > 1),
        `feature ${key} binds some case above level 1`,
      ).toBe(true);
    }
  });

  it('level is the maximum over feature levels in every case (02 §2.1)', () => {
    for (const c of golden.cases) expect(c.expected.level, c.id).toBe(Math.max(...Object.values(c.expected.featureLevels)));
  });

  it.each(golden.cases.map((c) => [c.id, c] as const))('reference tagger reproduces %s', (_id, c) => {
    expect(referenceTag(c)).toEqual(c.expected.featureLevels);
  });
});
