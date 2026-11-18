// Contract tests for fixtures/follow/ (01 §14 item 9, P0f row): about 20 DetectedNote streams with predicate
// expectations for live events and final judgments. Checks: schema-valid; byte-identical to the generator;
// streams well-formed; every predicate holds on the reference follower's output; the 01 §14 coverage list.
//
// How P10a / P10b use these files: see src/testkit/predicates/subjects.ts.
import Ajv from 'ajv';
import { readdirSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FollowFixture } from '../../src/core/types.ts';
import { checkPredicates, finalSubject, formatFailures, liveSubject, streamViolations } from '../../src/testkit/predicates/index.ts';
import { buildFollowFiles } from './gen/build.ts';
import { FOLLOW_SCENARIOS, runFollowScenario } from './gen/follow-scenarios.ts';
import type { Run } from './gen/scenario.ts';

const dir = new URL('./', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const read = (f: string): string => readFileSync(new URL(f, dir), 'utf8');
const fixtures = files.map((f) => [f, JSON.parse(read(f)) as FollowFixture] as const);

let built: Record<string, string>;
const runs = new Map<string, Run>();
beforeAll(() => {
  built = buildFollowFiles();
  for (const s of FOLLOW_SCENARIOS) runs.set(s.id, runFollowScenario(s));
}, 120_000);

describe('fixtures/follow', () => {
  it('holds about 20 fixtures, one per generator scenario', () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
    expect(files).toEqual(FOLLOW_SCENARIOS.map((s) => `${s.id}.json`).sort());
  });

  it('covers the 01 §14 item 9 list', () => {
    const ids = new Set(fixtures.map(([, f]) => f.id));
    for (const want of [
      'on-time', 'early-150', 'late-150', 'sharp', 'flat', 'wrong-note-key-signature', 'octave-non-voice', 'octave-voice', 'missed',
      'extra-in-rest', 'repeat-merge', 'repeat-split', 'tie', 'pickup-late', 'fast-run', 'slurred-run', 'stop-bar-5', 'back-2-beats',
      'skip-bar-ahead', 'rejoin-next-downbeat', 'live-final-divergence',
    ])
      expect(ids.has(want), want).toBe(true);
  });

  it.each(files)('%s is byte-identical to the generator output', (f) => {
    expect(read(f)).toBe(built[f]);
  });

  it.each(fixtures)('%s validates against follow-fixture.schema.json', (_f, fx) => {
    const schema = JSON.parse(readFileSync(new URL('../../schemas/follow-fixture.schema.json', import.meta.url), 'utf8')) as object;
    const v = new Ajv({ strict: true, allowUnionTypes: true, allErrors: true }).compile(schema);
    expect(v(fx), JSON.stringify(v.errors?.slice(0, 3))).toBe(true);
  });

  it.each(fixtures)('%s: the stream is well-formed', (_f, fx) => {
    let prevT = -Infinity;
    const state = new Map<number, 'on' | 'off'>();
    let lastNew = 0;
    fx.stream.forEach((it, k) => {
      expect(it.t, `item ${k} time`).toBeGreaterThanOrEqual(prevT);
      prevT = it.t;
      if (it.kind === 'end') expect(k, 'end is last').toBe(fx.stream.length - 1);
      if (it.kind !== 'dsp' || it.event.type === 'signal' || it.event.type === 'gap') return;
      const n = it.event.note;
      const st = state.get(n.id);
      if (it.event.type === 'note-on') {
        expect(st, `note-on once for ${n.id}`).toBeUndefined();
        expect(n.id, 'ids increase in onset order').toBeGreaterThan(lastNew);
        lastNew = n.id;
        state.set(n.id, 'on');
        expect(n.offset).toBeNull();
      } else {
        expect(st, `${it.event.type} for ${n.id} after note-on and before note-off`).toBe('on');
        if (it.event.type === 'note-off') {
          state.set(n.id, 'off');
          expect(n.offset).not.toBeNull();
        }
      }
      expect(it.t, 'reported after the onset').toBeGreaterThanOrEqual(n.onset);
    });
    expect([...state.values()].every((s) => s === 'off'), 'every note ends').toBe(true);
    expect(fx.expected.map((e) => e.idx)).toEqual(fx.expected.map((_, k) => k));
  });

  it.each(FOLLOW_SCENARIOS.map((s) => [s.id, s] as const))('%s: every predicate holds on the reference follower', (id) => {
    const r = runs.get(id)!;
    const fx = fixtures.find(([, f]) => f.id === id)![1];
    const lf = checkPredicates(liveSubject(r.live, fx.expected.length), fx.expectLive);
    const ff = checkPredicates(finalSubject(r.final), fx.expectFinal);
    expect(lf, `live:\n${formatFailures(lf)}`).toEqual([]);
    expect(ff, `final:\n${formatFailures(ff)}`).toEqual([]);
    expect(streamViolations(null, r.live, fx.expected.length)).toEqual([]);
    expect(fx.expectLive.length + fx.expectFinal.length).toBeGreaterThan(5);
  });
});
