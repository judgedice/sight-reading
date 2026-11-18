import { describe, expect, it } from 'vitest';
import type { FinalAlignment, FollowerEvent, LiveJudgment, Predicate, RenderStreamLine } from '../../core/types.ts';
import { assertPredicates, checkPredicate, checkPredicates, deepEqual, P, parsePath, PathSyntaxError, resolvePath } from './dsl.ts';
import { finalSubject, liveSubject, reduceOverlay, streamViolations } from './subjects.ts';

const subject = {
  judgments: [
    { expectedIdx: 0, timing: 'on-time', timingErrorMs: 3, pitch: 'in-tune', credit: { p: 1, n: null } },
    { expectedIdx: 1, timing: 'late', timingErrorMs: 152, pitch: 'in-tune', credit: { p: 1, n: 0.5 } },
    { expectedIdx: 2, timing: 'on-time', timingErrorMs: -2, pitch: 'wrong-pitch', credit: { p: 0, n: null } },
    null,
  ],
  events: [
    { type: 'note-start', detectedId: 1 },
    { type: 'ghost', ghost: { detectedId: 2, kind: 'late' } },
    { type: 'status', kind: 'come-in-at', bar: 7 },
    { type: 'status', kind: 'lost-place' },
  ],
  patterns: [{ id: 'E12', notes: [1, 4] }, { id: 'E6', notes: [] }],
  score: { components: { P: 93.9, I: null, R: 100 } },
};
const ok = (p: Predicate): void => expect(checkPredicate(subject, p), JSON.stringify(p)).toBeNull();
const bad = (p: Predicate): void => expect(checkPredicate(subject, p), JSON.stringify(p)).not.toBeNull();

describe('path parsing', () => {
  it('parses keys, indices, slices, quantifiers and filters', () => {
    expect(parsePath('a.b[3][-1][1:4][:2][*][?][type=ghost&ghost.kind!=late]')).toEqual([
      { t: 'key', key: 'a' },
      { t: 'key', key: 'b' },
      { t: 'index', i: 3 },
      { t: 'index', i: -1 },
      { t: 'slice', from: 1, to: 4 },
      { t: 'slice', from: null, to: 2 },
      { t: 'all' },
      { t: 'any' },
      {
        t: 'filter',
        conds: [
          { path: ['type'], neg: false, value: 'ghost' },
          { path: ['ghost', 'kind'], neg: true, value: 'late' },
        ],
      },
    ]);
  });
  it('types filter literals', () => {
    const f = parsePath('x[a=3&b=true&c=null&d=-1.5&e=come-in-at]')[1] as { conds: { value: unknown }[] };
    expect(f.conds.map((c) => c.value)).toEqual([3, true, null, -1.5, 'come-in-at']);
  });
  it('rejects bad paths', () => {
    for (const p of ['', '[0]', 'a..b', 'a[', 'a[x]', 'a.', 'a b']) expect(() => parsePath(p), p).toThrow(PathSyntaxError);
  });
  it('resolvePath walks without quantifiers and never throws on missing values', () => {
    expect(resolvePath(subject, 'judgments[1].timingErrorMs')).toBe(152);
    expect(resolvePath(subject, 'judgments[-1]')).toBeNull();
    expect(resolvePath(subject, 'judgments[3].timing')).toBeUndefined();
    expect(resolvePath(subject, 'nothing.at.all')).toBeUndefined();
    expect(resolvePath(subject, 'judgments.length')).toBe(4);
    expect(resolvePath(subject, 'events[type=status].length')).toBe(2);
    expect(resolvePath(subject, 'events[type=status&kind=come-in-at][0].bar')).toBe(7);
    expect(() => resolvePath(subject, 'judgments[*].timing')).toThrow(PathSyntaxError);
  });
});

describe('ops', () => {
  it('eq / ne deep-compare', () => {
    ok(P.eq('judgments[1].credit', { p: 1, n: 0.5 }));
    bad(P.eq('judgments[1].credit', { p: 1 }));
    ok(P.ne('judgments[1].timing', 'on-time'));
    bad(P.ne('judgments[1].timing', 'late'));
    ok(P.ne('judgments[3].timing', 'late'));
  });
  it('numeric comparisons and approx', () => {
    ok(P.gt('judgments[1].timingErrorMs', 140));
    ok(P.le('judgments[1].timingErrorMs', 152));
    bad(P.lt('judgments[1].timingErrorMs', 152));
    ok(P.approx('score.components.P', 94, 0.2));
    bad(P.approx('score.components.P', 94, 0.05));
    bad(P.ge('score.components.I', 0));
    for (const p of P.between('judgments[1].timingErrorMs', 140, 160)) ok(p);
  });
  it('in, includes, excludes, length, exists, absent', () => {
    ok(P.in('judgments[2].pitch', ['wrong-pitch', 'octave']));
    bad(P.in('judgments[2].pitch', ['in-tune']));
    ok(P.includes('patterns[id=E12][0].notes', 4));
    ok(P.excludes('patterns[id=E12][0].notes', 2));
    bad(P.includes('score', 1));
    ok(P.length('judgments', 4));
    ok(P.length('events[type=ghost]', 1));
    bad(P.length('judgments', 3));
    ok(P.exists('judgments[0].credit.p'));
    bad(P.exists('judgments[0].credit.n'));
    ok(P.absent('judgments[0].credit.n'));
    ok(P.absent('judgments[3]'));
    bad(P.absent('judgments[1].credit.n'));
  });
  it('[*] needs every element and a non-empty array; [?] needs one', () => {
    ok(P.in('judgments[0:2][*].pitch', ['in-tune']));
    bad(P.eq('judgments[0:3][*].credit.p', 1));
    ok(P.eq('judgments[0:2][*].credit.p', 1));
    bad(P.eq('judgments[5:9][*].credit.p', 1));
    ok(P.eq('judgments[?].timing', 'late'));
    bad(P.eq('judgments[?].timing', 'early'));
    ok(P.ne('judgments[3:4][*].pitch', 'wrong-pitch'));
  });
  it('fires, not-fires, only-fires', () => {
    ok(P.fires('E12'));
    bad(P.fires('E2'));
    ok(P.notFires('E30'));
    bad(P.notFires('E6'));
    ok(P.onlyFires(['E6', 'E12']));
    bad(P.onlyFires(['E12']));
    expect(checkPredicate({ score: { patterns: [{ id: 'E30' }] } }, P.onlyFires(['E30']))).toBeNull();
    expect(checkPredicate({}, P.fires('E1'))?.message).toMatch(/no patterns/);
  });
  it('reports every failure with its note', () => {
    const ps = [P.eq('judgments[1].timing', 'early', 'why A'), P.eq('judgments[0].timing', 'on-time'), P.gt('judgments[2].timingErrorMs', 0, 'why B')];
    expect(checkPredicates(subject, ps)).toHaveLength(2);
    expect(() => assertPredicates(subject, ps, 'demo')).toThrow(/demo: 2 of 3 failed[\s\S]*why A[\s\S]*why B/);
    expect(() => assertPredicates(subject, [ps[1]!])).not.toThrow();
  });
  it('a bad path is a failure, not a throw', () => {
    expect(checkPredicate(subject, { path: 'a[', op: 'exists' })?.message).toMatch(/unclosed/);
  });
  it('deepEqual ignores undefined members', () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual([1, { x: [2] }], [1, { x: [2] }])).toBe(true);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
  });
});

const lj = (i: number, timing: LiveJudgment['timing'], provisional = true): LiveJudgment => ({
  expectedIdx: i,
  status: 'matched',
  detectedId: i + 1,
  timing,
  timingErrorMs: 0,
  pitch: 'in-tune',
  playedConcertMidi: 60,
  centsError: 0,
  octaveDisplaced: false,
  duration: 'not-graded',
  heldRatio: null,
  marginal: false,
  provisional,
});

describe('subjects', () => {
  const events: FollowerEvent[] = [
    { type: 'note-start', detectedId: 1, scoreBeat: 0, provisionalConcertMidi: 60, matchedExpected: 0, displaced: false },
    { type: 'judgment', judgment: lj(0, 'on-time') },
    { type: 'judgment', judgment: lj(0, 'on-time', false) },
    { type: 'note-end', detectedId: 1, durationBeats: 1 },
    { type: 'missed', expectedIdx: 2 },
    { type: 'note-start', detectedId: 2, scoreBeat: 1.2, provisionalConcertMidi: 62, matchedExpected: null, displaced: false },
    { type: 'ghost', ghost: { detectedId: 2, scoreBeat: 1.2, writtenPitch: { step: 'D', alter: 0, octave: 4 }, kind: 'extra', centsError: null, targetExpectedIdx: null, displaced: false } },
    { type: 'status', kind: 'come-in-at', bar: 3 },
    { type: 'end', reason: 'complete' },
  ];
  it('liveSubject keeps the latest judgment per note, dense with nulls', () => {
    const s = liveSubject(events, 3);
    expect(s.judgments).toHaveLength(3);
    expect(s.judgments[0]?.provisional).toBe(false);
    expect(s.judgments[1]).toBeNull();
    expect(s.missed).toEqual([2]);
    expect(s.ghosts.map((g) => g.kind)).toEqual(['extra']);
    expect(s.noteStarts).toHaveLength(2);
    expect(s.status).toHaveLength(1);
    expect(s.ends[0]?.reason).toBe('complete');
  });
  it('finalSubject sorts judgments by expected index', () => {
    const a = { judgments: [{ expectedIdx: 1 }, { expectedIdx: 0 }], extras: [], displaced: [] } as unknown as FinalAlignment;
    expect(finalSubject(a).judgments.map((j) => j.expectedIdx)).toEqual([0, 1]);
  });
  it('streamViolations accepts a well-formed render stream', () => {
    const final: FinalAlignment = { judgments: [], extras: [], displaced: [] };
    const all: FollowerEvent[] = [...events, { type: 'final', alignment: final }];
    const lines: RenderStreamLine[] = [
      { kind: 'header', schemaVersion: 1, excerptId: 'x', instrumentId: 'flute', writtenKey: { fifths: 0, mode: 'major' }, bpm: 60, level: 1, description: '' },
      ...all.map((event, k): RenderStreamLine => ({ kind: 'event', atMs: k * 10, event })),
    ];
    expect(streamViolations(lines, all, 0)).toEqual([]);
    expect(reduceOverlay(all).final).toBe(final);
  });
  it('streamViolations catches order, timing changes, judgments after missed and missing final', () => {
    const broken: FollowerEvent[] = [
      { type: 'ghost', ghost: { detectedId: 9, scoreBeat: 0, writtenPitch: { step: 'C', alter: 0, octave: 4 }, kind: 'late', centsError: null, targetExpectedIdx: 0, displaced: false } },
      { type: 'judgment', judgment: lj(0, 'on-time') },
      { type: 'judgment', judgment: lj(0, 'late') },
      { type: 'missed', expectedIdx: 1 },
      { type: 'judgment', judgment: lj(1, 'on-time') },
    ];
    const lines: RenderStreamLine[] = [
      { kind: 'event', atMs: 5, event: broken[0]! },
      { kind: 'event', atMs: 1, event: broken[1]! },
    ];
    const v = streamViolations(lines, broken, 2).join('\n');
    expect(v).toMatch(/first line is not the header/);
    expect(v).toMatch(/atMs decreases/);
    expect(v).toMatch(/does not end in final/);
    expect(v).toMatch(/ghost before note-start/);
    expect(v).toMatch(/timing changed for expected 0/);
    expect(v).toMatch(/judgment after missed for expected 1/);
  });
});
