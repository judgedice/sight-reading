// Tests of the fixture generator's reference pieces: the expected-notes port reproduces P0e's goldens, the
// tolerance reference reproduces 02 §4.2's worked-example table, ghost spelling follows 02 §4.8, and the build
// is deterministic.
import { describe, expect, it } from 'vitest';
import type { ExpectedNote } from '../../../src/core/types.ts';
import { buildGradeFiles, buildRenderFiles, fmt } from './build.ts';
import { excerptExpected, goldenBpm, plan, sp } from './expected.ts';
import { configs, corpusDoc, golden, goldenFiles } from './io.ts';
import { spellGhostRef } from './oracle.ts';
import { refScore, refTolerances } from './reference.ts';
import { corpusBase, run } from './scenario.ts';

const cfg = configs();

describe('expected-notes port (P0e rules)', () => {
  it.each(goldenFiles())('%s is reproduced exactly', (f) => {
    const g = golden(f);
    const d = corpusDoc(g.excerptId);
    const inst = cfg.instrumentById[g.instrumentId]!;
    const pl = plan(d, inst, cfg.levels)!;
    expect(pl.writtenKey).toEqual(g.writtenKey);
    expect(pl.transposition).toEqual(g.transposition);
    expect(pl.clef).toBe(g.clef);
    expect(goldenBpm(d, cfg.levels)).toBe(g.bpm);
    expect(excerptExpected(d, inst, pl, g.bpm, cfg.grading)).toEqual(g.notes);
  });
});

/** A note with the given neighbouring IOIs (ms); everything else irrelevant to 02 §4.2. */
const note = (ioiMs: number | null): ExpectedNote =>
  ({ idx: 0, ioiPrevSec: ioiMs === null ? null : ioiMs / 1000, ioiNextSec: ioiMs === null ? null : ioiMs / 1000, durSec: 1 }) as ExpectedNote;

describe('refTolerances reproduces the 02 §4.2 worked examples', () => {
  // [instrument, level, bpm, min IOI ms, tGood, tRed, tBad, W] — the table rounds to whole ms.
  const rows: [string, number, number, number, number, number, number, number][] = [
    ['trumpet-bb', 1, 60, 1000, 120, 200, 300, 500],
    ['trumpet-bb', 1, 132, 60000 / 132, 60, 100, 150, 227],
    ['trumpet-bb', 5, 60, 1000, 100, 170, 250, 500],
    ['trumpet-bb', 5, 60, 250, 75, 100, 125, 125],
    ['trumpet-bb', 5, 132, 60000 / 132, 50, 85, 120, 227],
    ['trumpet-bb', 5, 132, 30000 / 132, 50, 85, 114, 114],
    ['trumpet-bb', 9, 60, 1000, 80, 140, 200, 500],
    ['trumpet-bb', 9, 60, 250, 75, 100, 125, 125],
    ['trumpet-bb', 9, 60, 125, 40, 60, 90, 90],
    ['trumpet-bb', 9, 132, 60000 / 132, 40, 70, 100, 227],
    ['trumpet-bb', 9, 132, 30000 / 132, 40, 70, 100, 114],
    ['trumpet-bb', 9, 132, 20000 / 132, 40, 61, 90, 90],
    ['violin', 9, 132, 60000 / 132, 55, 85, 120, 227],
    ['voice-soprano', 9, 132, 60000 / 132, 55, 85, 120, 227],
  ];
  it.each(rows)('%s L%i %i bpm, IOI %f ms', (id, level, bpm, ioi, g, r, b, w) => {
    const [t] = refTolerances([note(ioi)], cfg.instrumentById[id]!, level, bpm, cfg);
    expect(Math.abs(t!.tGoodSec * 1000 - g)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(t!.tRedSec * 1000 - r)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(t!.tBadSec * 1000 - b)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(t!.matchWindowSec * 1000 - w)).toBeLessThanOrEqual(0.5);
  });
  it('uses the intonation bands and minimum steady times from grading-config', () => {
    const [fl] = refTolerances([note(500)], cfg.instrumentById['flute']!, 4, 90, cfg);
    expect([fl!.goodCents, fl!.redCents, fl!.minSteadyMs, fl!.attackExcludeMs]).toEqual([20, 35, 150, 50]);
    const [vo] = refTolerances([note(500)], cfg.instrumentById['voice-soprano']!, 2, 72, cfg);
    expect([vo!.goodCents, vo!.redCents, vo!.minSteadyMs]).toEqual([30, 45, 180]);
    const [pi] = refTolerances([note(500)], cfg.instrumentById['piano-rh']!, 4, 90, cfg);
    expect([pi!.goodCents, pi!.redCents]).toEqual([null, null]);
  });
});

describe('ghost spelling (02 §4.8)', () => {
  it('within ±2 semitones: the target letter with the needed accidental', () => {
    expect(spellGhostRef(65, sp('F#4'), { fifths: 2, mode: 'major' })).toEqual(sp('F4'));
    expect(spellGhostRef(71, sp('Bb4'), { fifths: -1, mode: 'major' })).toEqual(sp('B4'));
    expect(spellGhostRef(72, sp('C#5'), { fifths: 3, mode: 'major' })).toEqual(sp('C5'));
  });
  it('otherwise by the key signature', () => {
    expect(spellGhostRef(70, sp('E5'), { fifths: -2, mode: 'major' })).toEqual(sp('Bb4'));
    expect(spellGhostRef(70, sp('E5'), { fifths: 2, mode: 'major' })).toEqual(sp('A#4'));
  });
});

describe('reference follower sanity', () => {
  it('a perfect take scores 100 with every note matched', () => {
    const r = run(corpusBase('le-beau-lc5883655-voice-mp1-9', 'flute', 90), {});
    const s = refScore(r.final, r.base.inst, r.base.level, cfg);
    expect([s.P, s.I, s.R, s.score, s.grade]).toEqual([100, 100, 100, 100, 'S']);
    expect(r.final.extras).toEqual([]);
  });
  it('the stream is time-ordered and ends with the end item', () => {
    const r = run(corpusBase('le-beau-lc5883655-voice-mp1-9', 'flute', 90), {});
    const ts = r.stream.map((x) => x.t as number);
    expect(ts.every((t, k) => k === 0 || t >= ts[k - 1]!)).toBe(true);
    expect(r.stream[r.stream.length - 1]?.kind).toBe('end');
  });
});

describe('build', () => {
  it('fmt writes chosen arrays one element per line', () => {
    expect(fmt({ a: [1, 2], b: { c: [3] } }, new Set(['a']))).toBe('{\n "a": [\n  1,\n  2\n ],\n "b": {"c":[3]}\n}');
  });
  it('is deterministic', () => {
    expect(buildGradeFiles()).toEqual(buildGradeFiles());
    expect(buildRenderFiles()).toEqual(buildRenderFiles());
  });
});
