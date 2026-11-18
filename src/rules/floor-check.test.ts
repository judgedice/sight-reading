// CI floor check (01 §0, §8; R2): the seeded 02 configs must have zero violations, and the check must fail when a
// value is pushed below its floor.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Configs, FloorViolation, MeasurementBudget, RawConfigs } from '../core/types.ts';
import { checkFloors } from './floor-check.ts';
import { loadConfigs } from './load-configs.ts';

const readJson = (rel: string): unknown => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')) as unknown;

const raw = (): RawConfigs => ({
  grading: readJson('config/grading-config.json'),
  levels: readJson('config/levels.json'),
  instruments: readJson('config/instruments.json'),
  progression: readJson('config/progression.json'),
  tips: readJson('config/tips.json'),
  budget: readJson('config/measurement-budget.json'),
  trumpetValves: readJson('data/trumpet-valves.json'),
});

function check(mutate?: (r: RawConfigs) => void): { violations: FloorViolation[]; cfg: Configs } {
  const r = raw();
  mutate?.(r);
  const cfg = loadConfigs(r);
  return { violations: checkFloors(cfg, cfg.budget), cfg };
}

const g = (r: RawConfigs) => r.grading as { timing: { onsetClassFloors: Record<string, Record<string, number>>; levelBands: { good: { absMs: number }; red: { absMs: number } }[] }; intonation: { minSteadyMs: { none: number; vibrato: number }; bands: { goodCents: number | null; redCents: number | null }[]; vibratoWiden: { minGoodCents: number } }; live: { provisionalMs: number; hysteresisCents: number } };
const inst = (r: RawConfigs) => (r.instruments as { instruments: { id: string; fullWrittenRange: number[]; tiers: Record<string, number[]> }[] }).instruments;

describe('checkFloors on the seeded configs', () => {
  it('reports zero violations', () => {
    const { violations } = check();
    expect(violations).toEqual([]);
  });

  it('uses the budget the loader holds when none is passed separately', () => {
    const { cfg } = check();
    const budget: MeasurementBudget = cfg.budget;
    expect(checkFloors(cfg, budget)).toEqual([]);
  });
});

describe('checkFloors catches values below the floor', () => {
  it('hard-onset good floor under 2 sigma', () => {
    const { violations } = check((r) => {
      g(r).timing.onsetClassFloors['hard']!['goodMs'] = 30;
    });
    expect(violations.map((v) => v.path)).toContain('timing.onsetClassFloors.hard.goodMs');
    expect(violations.find((v) => v.path === 'timing.onsetClassFloors.hard.goodMs')).toMatchObject({ file: 'grading-config', value: 30, floor: 35 });
  });

  it('soft-onset red floor under 3 sigma for voice', () => {
    const { violations } = check((r) => {
      g(r).timing.onsetClassFloors['soft']!['redMs'] = 70;
    });
    expect(violations).toContainEqual(expect.objectContaining({ path: 'timing.onsetClassFloors.soft.redMs', floor: 75 }));
  });

  it('a larger measured sigma raises the floor', () => {
    const r = raw();
    const cfg = loadConfigs(r);
    const harsher = structuredClone(cfg.budget) as MeasurementBudget;
    for (const t of harsher.onsetError.totals) if (t.floorClass === 'articulated' && t.path === 'phone-play-along') t.sigmaMs = 22;
    const v = checkFloors(cfg, harsher);
    expect(v).toContainEqual(expect.objectContaining({ path: 'timing.onsetClassFloors.hard.goodMs', floor: 44 }));
  });

  it('level-band absolute terms under the weakest class floor', () => {
    const { violations } = check((r) => {
      g(r).timing.levelBands[2]!.good.absMs = 20;
    });
    expect(violations.map((v) => v.path)).toContain('timing.levelBands[2].good.absMs');
  });

  it('intonation good under 2 x c90 and red under 3 x c90 + 5', () => {
    const { violations } = check((r) => {
      const b = g(r).intonation.bands[5]!;
      b.goodCents = 15;
      b.redCents = 30;
    });
    const paths = violations.map((v) => v.path);
    expect(paths).toContain('intonation.bands[5].goodCents');
    expect(paths).toContain('intonation.bands[5].redCents');
  });

  it('intonationMinSteadyMs of 120 (the old 02 value)', () => {
    const { violations } = check((r) => {
      g(r).intonation.minSteadyMs.none = 120;
      g(r).intonation.minSteadyMs.vibrato = 120;
    });
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'intonation.minSteadyMs.none', floor: 150, value: 120 }),
        expect.objectContaining({ path: 'intonation.minSteadyMs.vibrato', floor: 180, value: 120 }),
      ]),
    );
  });

  it('vibrato widened band under the budget', () => {
    const { violations } = check((r) => {
      g(r).intonation.vibratoWiden.minGoodCents = 15;
    });
    expect(violations.map((v) => v.path)).toContain('intonation.vibratoWiden.minGoodCents');
  });

  it('live provisional window under 80 ms and hysteresis under 10 cents', () => {
    const { violations } = check((r) => {
      g(r).live.provisionalMs = 60;
      g(r).live.hysteresisCents = 5;
    });
    const paths = violations.map((v) => v.path);
    expect(paths).toContain('live.provisionalMs');
    expect(paths).toContain('live.hysteresisCents');
  });

  it('a 150 ms live window may use 5 cents of hysteresis', () => {
    const { violations } = check((r) => {
      g(r).live.provisionalMs = 150;
      g(r).live.hysteresisCents = 5;
    });
    expect(violations).toEqual([]);
  });

  it('notes-per-second cap above 1000 / pitch-change floor on the 2048 window', () => {
    const { violations } = check((r) => {
      const levels = (r.levels as { levels: { npsCap: Record<string, number> }[] }).levels;
      levels[9]!.npsCap['2048'] = 8;
    });
    expect(violations).toContainEqual(expect.objectContaining({ file: 'levels', path: 'levels[9].npsCap.2048' }));
  });

  it('piano LH served below C2', () => {
    const { violations } = check((r) => {
      const lh = inst(r).find((i) => i.id === 'piano-lh')!;
      lh.fullWrittenRange[0] = 33;
      lh.tiers['D']![0] = 33;
      lh.tiers['E']![0] = 33;
    });
    expect(violations.some((v) => v.rule.startsWith('piano-lh served below C2'))).toBe(true);
  });

  it('a launch instrument served under 80 Hz (cello at C2)', () => {
    const { violations } = check((r) => {
      const cello = inst(r).find((i) => i.id === 'cello')!;
      cello.fullWrittenRange[0] = 36;
      cello.tiers['E']![0] = 36;
    });
    expect(violations.some((v) => v.file === 'instruments' && v.rule.includes('launch instrument'))).toBe(true);
  });

  it('a fundamental under three periods of the window (tuba on a 1024 window)', () => {
    const { violations } = check((r) => {
      const tuba = inst(r).find((i) => i.id === 'tuba') as unknown as { detection: { windowSamples: number } };
      tuba.detection.windowSamples = 1024;
    });
    expect(violations.some((v) => v.rule.includes('3 periods') && v.rule.includes('tuba'))).toBe(true);
  });
});
