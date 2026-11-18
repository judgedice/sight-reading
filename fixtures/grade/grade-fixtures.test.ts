// Contract tests for fixtures/grade/ (01 §14 item 10, P0f row; 02 §4.9 acceptance cases 1 to 14 and the 02 §4.6
// stop / restart / skip rules). Checks: schema-valid; byte-identical to the generator; inputs internally
// consistent; every predicate over components, score, gate, counts, diagnostics and tolerances holds on the
// reference arithmetic (fixtures/follow/gen/reference.ts). Pattern, ranking and XP predicates restate 02 directly
// and are for P12 / P12b.
//
// How P12 uses these files:
//   const instrument = cfg.instrumentById[fx.instrumentId];
//   const tolerances = resolveTolerances(fx.input.expected, { instrument, level: fx.input.level, bpm: fx.input.bpm, meter: fx.input.meter }, cfg);
//   const input = { ...fx.input, instrument, cfg, tolerances };
//   assertPredicates(gradeSubject(grade(input), detectPatterns(input), tolerances), fx.expect);
import Ajv from 'ajv';
import { readdirSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { GradeFixture } from '../../src/core/types.ts';
import { checkPredicates, formatFailures } from '../../src/testkit/predicates/index.ts';
import { buildGradeFiles } from '../follow/gen/build.ts';
import { GRADE_SCENARIOS, isReferenceCheckable, referenceGradeSubject, runGradeScenario } from '../follow/gen/grade-scenarios.ts';
import { configs } from '../follow/gen/io.ts';
import { refTolerances } from '../follow/gen/reference.ts';
import type { Run } from '../follow/gen/scenario.ts';

const dir = new URL('./', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const read = (f: string): string => readFileSync(new URL(f, dir), 'utf8');
const fixtures = files.map((f) => [f, JSON.parse(read(f)) as GradeFixture] as const);
const cfg = configs();

let built: Record<string, string>;
const runs = new Map<string, Run>();
beforeAll(() => {
  built = buildGradeFiles();
  for (const s of GRADE_SCENARIOS) runs.set(s.id, runGradeScenario(s));
}, 120_000);

describe('fixtures/grade', () => {
  it('covers 02 §4.9 cases 1 to 14 (15 and 16 are CI jobs, not fixtures) with at least 10 files', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files).toEqual(GRADE_SCENARIOS.map((s) => `${s.id}.json`).sort());
    const cases = new Set(fixtures.map(([, f]) => f.case));
    for (let c = 1; c <= 14; c++) expect(cases.has(c), `case ${c}`).toBe(true);
  });

  it.each(files)('%s is byte-identical to the generator output', (f) => {
    expect(read(f)).toBe(built[f]);
  });

  it.each(fixtures)('%s validates against grade-fixture.schema.json', (_f, fx) => {
    const schema = JSON.parse(readFileSync(new URL('../../schemas/grade-fixture.schema.json', import.meta.url), 'utf8')) as object;
    const v = new Ajv({ strict: true, allowUnionTypes: true, allErrors: true }).compile(schema);
    expect(v(fx), JSON.stringify(v.errors?.slice(0, 3))).toBe(true);
  });

  it.each(fixtures)('%s: the input is consistent', (_f, fx) => {
    const { expected, alignment, detected } = fx.input;
    expect(cfg.instrumentById[fx.instrumentId], 'known instrument').toBeDefined();
    expect(alignment.judgments.map((j) => j.expectedIdx)).toEqual(expected.map((e) => e.idx));
    const ids = new Set(detected.map((d) => d.id));
    const used = new Set<number>();
    for (const j of alignment.judgments) {
      for (const c of [j.credit.p, j.credit.o, j.credit.n ?? 0, j.credit.d ?? 0]) expect(c >= 0 && c <= 1).toBe(true);
      if (j.status === 'matched') {
        expect(ids.has(j.detectedId!)).toBe(true);
        expect(used.has(j.detectedId!), 'a detected note matches once').toBe(false);
        used.add(j.detectedId!);
      } else expect(j.detectedId).toBeNull();
    }
    for (const x of alignment.extras) expect(used.has(x.detectedId)).toBe(false);
    for (const s of alignment.displaced) for (const id of s.detectedIds) expect(used.has(id) || alignment.extras.some((x) => x.detectedId === id)).toBe(false);
    expect(fx.expect.length).toBeGreaterThan(0);
    expect(fx.expect.every((p) => p.note === undefined || p.note.length > 0)).toBe(true);
  });

  it.each(GRADE_SCENARIOS.map((s) => [s.id] as const))('%s: reference-checkable predicates hold on the reference', (id) => {
    const r = runs.get(id)!;
    const fx = fixtures.find(([, f]) => f.id === id)![1];
    const ps = fx.expect.filter(isReferenceCheckable);
    const fails = checkPredicates(referenceGradeSubject(r), ps);
    expect(fails, formatFailures(fails)).toEqual([]);
    // the tolerances the fixture's grader will resolve are the ones the reference used
    const inst = cfg.instrumentById[fx.instrumentId]!;
    expect(refTolerances(fx.input.expected, inst, fx.input.level, fx.input.bpm, cfg)).toEqual(r.tol);
  });
});
