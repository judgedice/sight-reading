// P12 acceptance (02 §4.9 cases 1 to 14 over fixtures/grade, plus XP and ranked rules, 02 §5.2 and §5.4).
// Pattern predicates (fires, not-fires, only-fires) belong to P12b and are skipped here by name; everything else
// in each fixture's predicate list is asserted.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { configs } from '../../fixtures/follow/gen/io.ts';
import type { GradeFixture, GradeInput } from '../core/types.ts';
import { resolveTolerances } from '../rules/index.ts';
import { checkPredicates, formatFailures, gradeSubject } from '../testkit/predicates/index.ts';
import { grade } from './grade.ts';
import { computeXp } from './xp.ts';

const cfg = configs();
const dir = new URL('../../fixtures/grade/', import.meta.url);
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as GradeFixture);

function inputOf(fx: GradeFixture): GradeInput {
  const instrument = cfg.instrumentById[fx.instrumentId]!;
  const tolerances = resolveTolerances(fx.input.expected, { instrument, level: fx.input.level, bpm: fx.input.bpm, meter: fx.input.meter }, cfg);
  return { ...fx.input, instrument, cfg, tolerances };
}

describe('grade() over fixtures/grade', () => {
  it('has fixtures', () => expect(fixtures.length).toBeGreaterThanOrEqual(10));
  it.each(fixtures.map((f) => [f.id, f] as const))('%s', (_id, fx) => {
    const input = inputOf(fx);
    const subject = gradeSubject(grade(input), [], input.tolerances);
    const preds = fx.expect.filter((p) => p.op !== 'fires' && p.op !== 'not-fires' && p.op !== 'only-fires' && !p.path.startsWith('patterns'));
    const fails = checkPredicates(subject, preds);
    expect(fails, formatFailures(fails)).toEqual([]);
  });

  it('is deterministic and does not mutate its input', () => {
    const input = inputOf(fixtures[0]!);
    const before = JSON.stringify(input.alignment);
    expect(JSON.stringify(grade(input))).toBe(JSON.stringify(grade(input)));
    expect(JSON.stringify(input.alignment)).toBe(before);
  });

  it('returns no tips and no patterns (the session fills them)', () => {
    const s = grade(inputOf(fixtures[0]!));
    expect(s.tipsShown).toEqual([]);
    expect(s.configVersion).toBe(cfg.configVersion);
  });
});

describe('letter grade and stars (02 §4.7)', () => {
  const base = fixtures.find((f) => f.id === 'case01-perfect-flute-l4')!;
  it('S/A/B/C/D/F cutoffs come from config', () => {
    const rows = cfg.grading.grades.scale;
    expect(rows.map((r) => [r.grade, r.minScore, r.stars])).toEqual([['S', 97, 3], ['A', 90, 3], ['B', 80, 2], ['C', 70, 1], ['D', 60, 0], ['F', 0, 0]]);
    expect(grade(inputOf(base)).grade).toBe('S');
  });
});

describe('ranked reasons (02 §5.2)', () => {
  const base = inputOf(fixtures.find((f) => f.id === 'case01-perfect-flute-l4')!);
  const withRanking = (r: Partial<GradeInput['ranking']>, extra: Partial<GradeInput> = {}): GradeInput => ({ ...base, ...extra, ranking: { ...base.ranking, ...r } });
  it('ranked when every condition holds', () => expect(grade(base).ranked).toBe(true));
  it.each([
    ['practice-mode', withRanking({ mode: 'practice' })],
    ['seen-before', withRanking({ seenBefore: true })],
    ['scan-extended', withRanking({ scanStrict: false })],
    ['tempo-below-90pct', { ...base, bpm: 40 }],
    ['calibration', withRanking({}, { calibrationMeasured: false })],
    ['calibration', withRanking({ gateFailures: ['calibration-unmeasured'] })],
    ['measurement', withRanking({ gateFailures: ['rtl-high'] })],
    ['familiar', withRanking({ familiarity: 2 })],
    ['skip-limit', withRanking({ skipLimitHit: true })],
  ] as const)('%s', (reason, input) => {
    const s = grade(input);
    expect(s.ranked).toBe(false);
    expect(s.rankedReasons).toContain(reason);
  });
  it('lists every failing condition', () => {
    const s = grade(withRanking({ mode: 'practice', seenBefore: true, skipLimitHit: true }));
    expect(s.rankedReasons).toEqual(['practice-mode', 'seen-before', 'skip-limit']);
  });
});

describe('XP (02 §5.4)', () => {
  const l4 = inputOf(fixtures.find((f) => f.id === 'case01-perfect-flute-l4')!);
  const xpFor = (over: Partial<GradeInput['xp']>, level = 5, bpm?: number, score = 85, ranked = true): number => {
    const mid = (cfg.levelByNumber[level]!.tempo.minBpm + cfg.levelByNumber[level]!.tempo.maxBpm) / 2;
    const input: GradeInput = { ...l4, level, bpm: bpm ?? mid, xp: { ...l4.xp, playerLevel: level, ...over } };
    return computeXp(input, score, 'ok', ranked).total;
  };
  it('worked example: L5, S 85, mid tempo, random key, streak 6 days = 35', () => {
    expect(xpFor({ randomized: { key: true, meter: false, tempo: false }, streakDays: 6 })).toBe(35);
  });
  it('farming an easy level at S 100 earns 3 (10 x 0.25 below, 2.5 rounds up)', () => {
    expect(xpFor({ playerLevel: 5 }, 1, undefined, 100)).toBe(3);
  });
  it('q is 0 below 30', () => expect(xpFor({}, 5, undefined, 29)).toBe(0));
  it('random factor caps at 1.25 and tempo factor clamps', () => {
    const f = computeXp({ ...l4, xp: { ...l4.xp, randomized: { key: true, meter: true, tempo: true } } }, 100, 'ok', true).factors;
    expect(f.find((x) => x.id === 'm_random')!.value).toBeCloseTo(1.24, 9);
    const hi = computeXp({ ...l4, bpm: 10000 }, 100, 'ok', true).factors.find((x) => x.id === 'm_tempo')!.value;
    const lo = computeXp({ ...l4, bpm: 1 }, 100, 'ok', true).factors.find((x) => x.id === 'm_tempo')!.value;
    expect([lo, hi]).toEqual(cfg.progression.xp.tempoClamp);
  });
  it('daily cap, streak cap and count-in-only from L4', () => {
    const fac = (over: Partial<GradeInput['xp']>, extra: Partial<GradeInput> = {}) =>
      computeXp({ ...l4, ...extra, xp: { ...l4.xp, ...over } }, 100, 'ok', true).factors;
    expect(fac({ dailyCountBefore: 60 }).find((x) => x.id === 'm_daily')!.value).toBe(0.25);
    expect(fac({ dailyCountBefore: 59 }).find((x) => x.id === 'm_daily')!.value).toBe(1);
    expect(fac({ streakDays: 99 }).find((x) => x.id === 'm_streak')!.value).toBeCloseTo(1.2, 9);
    expect(fac({}, { ranking: { ...l4.ranking, metronome: 'countInOnly' } }).find((x) => x.id === 'm_mode')!.value).toBe(1.1);
    expect(fac({}, { level: 3, ranking: { ...l4.ranking, metronome: 'countInOnly' } }).find((x) => x.id === 'm_mode')!.value).toBe(1);
  });
  it('practice earns 25%, a first repeat 25%, later repeats 0, incomplete 0', () => {
    const full = xpFor({}, 5, undefined, 100, true);
    expect(xpFor({}, 5, undefined, 100, false)).toBe(Math.round(full * 0.25));
    expect(xpFor({ repeatIndexToday: 1 }, 5, undefined, 100, false)).toBe(Math.round(full * 0.25));
    expect(xpFor({ repeatIndexToday: 2 }, 5, undefined, 100, false)).toBe(0);
    expect(computeXp(l4, 40, 'incomplete', true).total).toBe(0);
  });
});
