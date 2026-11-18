import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeMeter } from '../core/time.ts';
import type { Configs, ExpectedNote, FollowFixture, GradeFixture, Instrument, RawConfigs, ResolvedTolerance } from '../core/types.ts';
import { configs } from '../../fixtures/follow/gen/io.ts';
import { refTolerances } from '../../fixtures/follow/gen/reference.ts';
import { checkPredicates, formatFailures } from '../testkit/predicates/index.ts';
import { loadConfigs } from './load-configs.ts';
import { expectedSteadyMs, intonationGroup, isIntonationGraded, minIoiMs, resolveTolerances, tuningOffsetCents } from './resolve-tolerances.ts';

const cfg = configs();
const inst = (id: string): Instrument => {
  const i = cfg.instrumentById[id];
  if (!i) throw new Error(`no instrument ${id}`);
  return i;
};
const meter = makeMeter(4, 4);

/** A minimal expected note; only the fields the resolver reads matter. */
function note(idx: number, durSec: number, ioiPrevSec: number | null, ioiNextSec: number | null): ExpectedNote {
  return {
    idx,
    eventIds: [`e${idx}`],
    bar: 1,
    beatInBar: 1,
    onsetBeat: 0,
    durBeats: 1,
    onsetSec: 0,
    durSec,
    concertMidi: 70,
    writtenPitch: { step: 'C', alter: 0, octave: 5 },
    ioiPrevSec,
    ioiNextSec,
    precededByRest: false,
    followedByRest: false,
    onsetKind: 'articulated',
    artic: 'normal',
    durationGraded: true,
    keySigAltered: false,
    explicitAccidental: false,
    ledgerLines: 0,
  };
}

/** A note in the middle of a run of equal values `ioiSec` apart. */
const mid = (ioiSec: number): ExpectedNote => note(1, ioiSec, ioiSec, ioiSec);

const ms = (t: ResolvedTolerance): [number, number, number, number] => [t.tGoodSec * 1000, t.tRedSec * 1000, t.tBadSec * 1000, t.matchWindowSec * 1000];
const one = (n: ExpectedNote, id: string, level: number, bpm: number): ResolvedTolerance => {
  const r = resolveTolerances([n], { instrument: inst(id), level, bpm, meter }, cfg)[0];
  if (!r) throw new Error('no tolerance');
  return r;
};

describe('resolveTolerances: 02 §4.2 worked examples (acceptance case 12)', () => {
  const b132 = 60 / 132; // seconds per beat
  // [case, instrument, level, bpm, minIOI s, [tGood, tRed, tBad, W] ms as in the table (rounded to 1 ms)]
  const table: [string, string, number, number, number, [number, number, number, number]][] = [
    ['Trumpet L1, 60 bpm, quarters', 'trumpet-bb', 1, 60, 1, [120, 200, 300, 500]],
    ['Trumpet L1, 132 bpm (formula check)', 'trumpet-bb', 1, 132, b132, [60, 100, 150, 227]],
    ['Trumpet L5, 60 bpm, quarters', 'trumpet-bb', 5, 60, 1, [100, 170, 250, 500]],
    ['Trumpet L5, 60 bpm, sixteenths', 'trumpet-bb', 5, 60, 0.25, [75, 100, 125, 125]],
    ['Trumpet L5, 132 bpm, quarters', 'trumpet-bb', 5, 132, b132, [50, 85, 120, 227]],
    ['Trumpet L5, 132 bpm, eighths', 'trumpet-bb', 5, 132, b132 / 2, [50, 85, 114, 114]],
    ['Trumpet L9, 60 bpm, quarters', 'trumpet-bb', 9, 60, 1, [80, 140, 200, 500]],
    ['Trumpet L9, 60 bpm, sixteenths', 'trumpet-bb', 9, 60, 0.25, [75, 100, 125, 125]],
    ['Trumpet L9, 60 bpm, 32nds (floor)', 'trumpet-bb', 9, 60, 0.125, [40, 60, 90, 90]],
    ['Trumpet L9, 132 bpm, quarters', 'trumpet-bb', 9, 132, b132, [40, 70, 100, 227]],
    ['Trumpet L9, 132 bpm, eighths', 'trumpet-bb', 9, 132, b132 / 2, [40, 70, 100, 114]],
    ['Trumpet L9, 132 bpm, triplet eighths (floor)', 'trumpet-bb', 9, 132, b132 / 3, [40, 61, 90, 90]],
    ['Violin L9, 132 bpm, quarters', 'violin', 9, 132, b132, [55, 85, 120, 227]],
    ['Voice L9, 132 bpm, quarters', 'voice-soprano', 9, 132, b132, [55, 85, 120, 227]],
  ];
  for (const [label, id, level, bpm, ioi, want] of table) {
    it(label, () => {
      const got = ms(one(mid(ioi), id, level, bpm));
      // The table is rounded to whole ms; the resolver must round to exactly those values.
      expect(got.map((x) => Math.round(x))).toEqual(want);
    });
  }

  it('reproduces the unrounded arithmetic exactly', () => {
    // L5 132 bpm eighths: tBad = min(max(120, 0.25 × 454.54), 0.5 × 227.27) = 113.636..., W = max(tBad, min(250, 113.64)).
    const t = one(mid(b132 / 2), 'trumpet-bb', 5, 132);
    expect(t.tBadSec).toBeCloseTo((0.5 * b132) / 2, 12);
    expect(t.matchWindowSec).toBeCloseTo((0.5 * b132) / 2, 12);
    // L9 132 bpm triplets: tRed = min(70, 0.4 × 151.5) = 60.6 > floor 60.
    const tr = one(mid(b132 / 3), 'trumpet-bb', 9, 132);
    expect(tr.tRedSec).toBeCloseTo((0.4 * b132) / 3, 12);
    expect(tr.tBadSec).toBe(0.09);
    expect(tr.matchWindowSec).toBe(0.09);
  });

  it('agrees with the predicates in fixtures/grade (case 12 and every tolerance predicate)', () => {
    const dir = new URL('../../fixtures/grade/', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    let checked = 0;
    for (const f of files) {
      const fx = JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as GradeFixture;
      const tolerances = resolveTolerances(fx.input.expected, { instrument: inst(fx.instrumentId), level: fx.input.level, bpm: fx.input.bpm, meter: fx.input.meter }, cfg);
      const preds = fx.expect.filter((p) => p.path.startsWith('tolerances'));
      checked += preds.length;
      const fails = checkPredicates({ tolerances }, preds);
      expect(fails, `${f}: ${formatFailures(fails)}`).toEqual([]);
    }
    expect(checked).toBeGreaterThanOrEqual(56);
  });

  it('equals the fixture generator reference on every grade and follow fixture note', () => {
    const cases: { id: string; expected: ExpectedNote[]; instrumentId: string; level: number; bpm: number }[] = [];
    const gdir = new URL('../../fixtures/grade/', import.meta.url);
    for (const f of readdirSync(gdir).filter((x) => x.endsWith('.json'))) {
      const fx = JSON.parse(readFileSync(new URL(f, gdir), 'utf8')) as GradeFixture;
      cases.push({ id: f, expected: fx.input.expected, instrumentId: fx.instrumentId, level: fx.input.level, bpm: fx.input.bpm });
    }
    const fdir = new URL('../../fixtures/follow/', import.meta.url);
    for (const f of readdirSync(fdir).filter((x) => x.endsWith('.json'))) {
      const fx = JSON.parse(readFileSync(new URL(f, fdir), 'utf8')) as FollowFixture;
      cases.push({ id: f, expected: fx.expected, instrumentId: fx.instrumentId, level: fx.level, bpm: fx.bpm });
    }
    expect(cases.length).toBeGreaterThan(30);
    for (const c of cases) {
      const i = inst(c.instrumentId);
      const got = resolveTolerances(c.expected, { instrument: i, level: c.level, bpm: c.bpm, meter }, cfg);
      const ref = refTolerances(c.expected, i, c.level, c.bpm, cfg);
      expect(got, c.id).toEqual(ref);
    }
  });
});

describe('resolveTolerances: rules', () => {
  it('the family floor always wins over the IOI cap', () => {
    // 64ths at 60 bpm: caps give 18.75 / 25 / 31.25 ms, below every floor.
    expect(ms(one(mid(0.0625), 'flute', 9, 60)).slice(0, 3)).toEqual([40, 60, 90]);
    expect(ms(one(mid(0.0625), 'cello', 9, 60)).slice(0, 3)).toEqual([55, 85, 120]);
  });

  it('skips the IOI cap for a note with no neighbour, and uses the one neighbour it has', () => {
    const lone = one(note(0, 1, null, null), 'trumpet-bb', 1, 60);
    expect(ms(lone)).toEqual([120, 200, 300, 500]);
    const first = one(note(0, 0.25, null, 0.25), 'trumpet-bb', 5, 60);
    expect(ms(first)).toEqual(ms(one(mid(0.25), 'trumpet-bb', 5, 60)));
    expect(minIoiMs(note(0, 1, 0.5, 0.25))).toBe(250);
    expect(minIoiMs(note(0, 1, 0.5, null))).toBe(500);
    expect(minIoiMs(note(0, 1, null, null))).toBeNull();
  });

  it('W is at least tBad and at least max(250 ms, 0.5 beat) without a close neighbour', () => {
    const slow = one(note(0, 2, 2, 2), 'flute', 1, 40); // beat 1500 ms; IOI 2000 ms
    expect(slow.matchWindowSec).toBeCloseTo(0.75, 12);
    expect(slow.matchWindowSec).toBeGreaterThanOrEqual(slow.tBadSec);
  });

  it('intonation bands by group and level (02 §4.2)', () => {
    const q = mid(1);
    expect([one(q, 'voice-alto', 2, 60).goodCents, one(q, 'voice-alto', 2, 60).redCents]).toEqual([30, 45]);
    expect([one(q, 'voice-alto', 5, 60).goodCents, one(q, 'voice-alto', 5, 60).redCents]).toEqual([25, 40]);
    expect([one(q, 'voice-alto', 8, 60).goodCents, one(q, 'voice-alto', 8, 60).redCents]).toEqual([20, 35]);
    expect([one(q, 'flute', 3, 60).goodCents, one(q, 'flute', 3, 60).redCents]).toEqual([25, 40]);
    expect([one(q, 'clarinet-bb', 6, 60).goodCents, one(q, 'clarinet-bb', 6, 60).redCents]).toEqual([20, 35]);
    expect([one(q, 'trumpet-bb', 10, 60).goodCents, one(q, 'trumpet-bb', 10, 60).redCents]).toEqual([20, 35]);
    expect([one(q, 'piano-rh', 4, 60).goodCents, one(q, 'piano-rh', 4, 60).redCents]).toEqual([null, null]);
    expect([one(q, 'guitar', 4, 60).goodCents, one(q, 'guitar', 4, 60).redCents]).toEqual([null, null]);
    expect(intonationGroup(inst('voice-bass'))).toBe('voice');
    expect(intonationGroup(inst('piano-lh'))).toBe('fixed');
    expect(intonationGroup(inst('cello'))).toBe('continuous');
  });

  it('vibrato families widen to at least 20 / 35 below 360 ms of expected steady pitch; non-vibrato do not', () => {
    // Violin L1: band 25 / 40 already wider. Voice L9 20 / 35 equals the widening. Use a config with a narrower
    // L7–L10 continuous band to see the widening act.
    const narrow = withGrading((g) => {
      const b = (g.intonation as { bands: { group: string; levels: number[]; goodCents: number; redCents: number }[] }).bands.find((x) => x.group === 'continuous' && x.levels[0] === 7);
      if (b) {
        b.goodCents = 12;
        b.redCents = 25;
      }
    });
    const short = note(1, 0.3, 0.3, 0.3); // 300 ms − 60 ms attack (strings) = 240 ms steady
    const long = note(1, 0.5, 0.5, 0.5); // 440 ms steady
    const r = (n: ExpectedNote, id: string): ResolvedTolerance => resolveTolerances([n], { instrument: narrow.instrumentById[id]!, level: 9, bpm: 120, meter }, narrow)[0]!;
    expect([r(short, 'violin').goodCents, r(short, 'violin').redCents]).toEqual([20, 35]);
    expect([r(long, 'violin').goodCents, r(long, 'violin').redCents]).toEqual([12, 25]);
    expect([r(short, 'flute').goodCents, r(short, 'flute').redCents]).toEqual([12, 25]);
    // Boundary: exactly 360 ms of expected steady pitch does not widen (rule is "below").
    const edge = note(1, 0.42, 0.42, 0.42); // 420 − 60 = 360
    expect(r(edge, 'violin').goodCents).toBe(12);
  });

  it('carries attack exclusion, minimum steady and the live window from config', () => {
    const f = one(mid(1), 'flute', 4, 60);
    expect(f.attackExcludeMs).toBe(cfg.grading.intonation.attackExcludeMsByFamily.flute);
    expect(f.minSteadyMs).toBe(150);
    expect(one(mid(1), 'violin', 4, 60).minSteadyMs).toBe(180);
    expect(one(mid(1), 'voice-tenor', 4, 60).minSteadyMs).toBe(180);
    expect(f.liveProvisionalMs).toBe(80);
    expect(f.liveHysteresisCents).toBe(10);
    expect(expectedSteadyMs(note(0, 0.2, null, null), f)).toBeCloseTo(150, 9);
  });

  it('isIntonationGraded needs a band and the minimum steady duration (acceptance case 13: 140 ms on flute)', () => {
    const f = one(mid(1), 'flute', 4, 90);
    expect(isIntonationGraded(f, 140)).toBe(false);
    expect(isIntonationGraded(f, 150)).toBe(true);
    expect(isIntonationGraded(one(mid(1), 'piano-rh', 4, 90), 1000)).toBe(false);
  });

  it('returns one tolerance per note, in order, and an empty list for no notes', () => {
    const ns = [note(0, 1, null, 1), note(1, 0.25, 1, 0.25), note(2, 1, 0.25, null)];
    const ts = resolveTolerances(ns, { instrument: inst('flute'), level: 5, bpm: 60, meter }, cfg);
    expect(ts).toHaveLength(3);
    expect(ts[0]!.tGoodSec).toBeCloseTo(0.1, 12);
    expect(ts[1]!.tGoodSec).toBeCloseTo(0.075, 12);
    expect(resolveTolerances([], { instrument: inst('flute'), level: 5, bpm: 60, meter }, cfg)).toEqual([]);
  });

  it('throws for a level with no band and for a non-positive tempo', () => {
    expect(() => one(mid(1), 'flute', 11, 60)).toThrow(RangeError);
    expect(() => one(mid(1), 'flute', 0, 60)).toThrow(RangeError);
    expect(() => one(mid(1), 'flute', 3, 0)).toThrow(RangeError);
    expect(() => one(mid(1), 'flute', 3, Number.NaN)).toThrow(RangeError);
  });

  it('every value follows config: changing the config changes the result (no constants in code)', () => {
    const changed = withGrading((g) => {
      const t = g.timing as { onsetClassFloors: { hard: { goodMs: number } }; ioiCap: { bad: number } };
      t.onsetClassFloors.hard.goodMs = 47;
      t.ioiCap.bad = 0.6;
      (g.matchWindow as { minMs: number }).minMs = 333;
      (g.live as { provisionalMs: number; hysteresisCents: number }).provisionalMs = 150;
      (g.live as { hysteresisCents: number }).hysteresisCents = 7;
    });
    const r = resolveTolerances([mid(0.125)], { instrument: changed.instrumentById['trumpet-bb']!, level: 9, bpm: 60, meter }, changed)[0]!;
    expect(r.tGoodSec).toBeCloseTo(0.047, 12);
    expect(r.tBadSec).toBeCloseTo(0.09, 12); // 0.6 × 125 = 75 < floor 90
    const lone = resolveTolerances([note(0, 1, null, null)], { instrument: changed.instrumentById['trumpet-bb']!, level: 9, bpm: 200, meter }, changed)[0]!;
    expect(lone.matchWindowSec).toBeCloseTo(0.333, 12);
    expect(r.liveProvisionalMs).toBe(150);
    expect(r.liveHysteresisCents).toBe(7);
  });
});

describe('tuningOffsetCents (02 §4.5)', () => {
  it('caps the measured offset at ±25 c and is 0 without a tuning note', () => {
    expect(tuningOffsetCents(12, cfg)).toBe(12);
    expect(tuningOffsetCents(-40, cfg)).toBe(-25);
    expect(tuningOffsetCents(31, cfg)).toBe(25);
    expect(tuningOffsetCents(null, cfg)).toBe(0);
    expect(tuningOffsetCents(Number.NaN, cfg)).toBe(0);
  });
});

/** Load configs with an edited grading-config.json. */
function withGrading(edit: (g: Record<string, unknown>) => void): Configs {
  const read = (rel: string): unknown => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')) as unknown;
  const raw: RawConfigs = {
    grading: read('config/grading-config.json'),
    levels: read('config/levels.json'),
    instruments: read('config/instruments.json'),
    progression: read('config/progression.json'),
    tips: read('config/tips.json'),
    budget: read('config/measurement-budget.json'),
    trumpetValves: read('data/trumpet-valves.json'),
  };
  edit(raw.grading as Record<string, unknown>);
  return loadConfigs(raw);
}
