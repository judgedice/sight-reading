import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LevelsConfig, LevelTaggerGolden, MeasurementBudget } from '../../core/types.ts';
import { cellLevel, meterBeatTicks, tagLevels } from './index.ts';

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8')) as T;
const golden = readJson<LevelTaggerGolden>('fixtures/levels/feature-vectors.json');
const cfg = readJson<LevelsConfig>('config/levels.json');
const budget = readJson<MeasurementBudget>('config/measurement-budget.json');

describe('tagLevels', () => {
  it.each(golden.cases.map((c) => [c.id, c] as const))('matches golden %s', (_id, c) => {
    const r = tagLevels({ meter: c.meter, mode: c.mode, ...(c.minorForm ? { minorForm: c.minorForm } : {}), rhythmCells: c.rhythmCells, features: c.features }, cfg, budget);
    expect(r.featureLevels).toEqual(c.expected.featureLevels);
    expect(r.level).toBe(c.expected.level);
    expect(r.levelConfidence).toBe(Object.values(c.expected.featureLevels).filter((v) => v === c.expected.level).length);
  });

  it('is deterministic and does not mutate input', () => {
    const c = golden.cases[0]!;
    const input = { meter: c.meter, mode: c.mode, rhythmCells: c.rhythmCells, features: c.features };
    const snap = JSON.stringify(input);
    expect(tagLevels(input, cfg, budget)).toEqual(tagLevels(input, cfg, budget));
    expect(JSON.stringify(input)).toBe(snap);
  });

  it('maps cells to their first level and unknown cells to 10', () => {
    expect(cellLevel(cfg.levels, 'Q')).toBe(1);
    expect(cellLevel(cfg.levels, 'EE')).toBe(2);
    expect(cellLevel(cfg.levels, 'SSSS')).toBe(4);
    expect(cellLevel(cfg.levels, 'nonsense')).toBe(10);
  });

  it('counts the beat in ticks per meter', () => {
    expect(meterBeatTicks('4/4')).toBe(480);
    expect(meterBeatTicks('6/8')).toBe(720);
    expect(meterBeatTicks('3/8')).toBe(240);
    expect(meterBeatTicks('2/2')).toBe(960);
  });
});
