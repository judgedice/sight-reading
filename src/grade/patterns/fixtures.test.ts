// P12b over fixtures/grade (02 §4.9): every pattern predicate (fires, not-fires, only-fires, patterns[...]) in each
// fixture holds for detectPatterns. The non-pattern predicates are P12's (src/grade/grade.test.ts).
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { configs } from '../../../fixtures/follow/gen/io.ts';
import type { GradeFixture, GradeInput } from '../../core/types.ts';
import { resolveTolerances } from '../../rules/index.ts';
import { checkPredicates, formatFailures, gradeSubject } from '../../testkit/predicates/index.ts';
import { grade } from '../grade.ts';
import { detectPatterns } from './index.ts';

const cfg = configs();
const dir = new URL('../../../fixtures/grade/', import.meta.url);
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as GradeFixture);

export function fixtureInput(id: string): GradeInput {
  const fx = fixtures.find((f) => f.id === id);
  if (!fx) throw new Error(`no fixture ${id}`);
  const instrument = cfg.instrumentById[fx.instrumentId]!;
  const tolerances = resolveTolerances(fx.input.expected, { instrument, level: fx.input.level, bpm: fx.input.bpm, meter: fx.input.meter }, cfg);
  return structuredClone({ ...fx.input, instrument, cfg, tolerances }) as GradeInput;
}

const isPatternPredicate = (p: GradeFixture['expect'][number]): boolean =>
  p.op === 'fires' || p.op === 'not-fires' || p.op === 'only-fires' || p.path.startsWith('patterns');

describe('detectPatterns over fixtures/grade', () => {
  it.each(fixtures.map((f) => [f.id, f] as const))('%s', (id, fx) => {
    const input = fixtureInput(id);
    const patterns = detectPatterns(input);
    const subject = gradeSubject(grade(input), patterns, input.tolerances);
    const fails = checkPredicates(subject, fx.expect.filter(isPatternPredicate));
    expect(fails, `${formatFailures(fails)}\nfired: ${patterns.map((p) => p.id).join(', ')}`).toEqual([]);
  });

  it('fires exactly these patterns per fixture (regression map; no stray patterns on any fixture)', () => {
    const fired = Object.fromEntries(fixtures.map((f) => [f.id, detectPatterns(fixtureInput(f.id)).map((p) => p.id)]));
    const clean = ['case01-perfect-flute-l4', 'case01-perfect-voice-l2', 'case02-late-30ms-l1', 'case07-voice-30c-flat', 'case08-voice-octave-low', 'case13-short-steady-flute'];
    for (const id of clean) expect(fired[id], id).toEqual(['E30']);
    expect(fired['case04-drift-0.05']).toEqual(['E2']);
    expect(fired['case05-key-signature-f-sharp']).toEqual(['E12']);
    expect(fired['case09-trumpet-wrong-partial']).toEqual(['E16']);
    for (const id of ['case06-stop-2-beats-bar-5', 'case06-variant-skip-and-rejoin', 'case10-incomplete', 'case11-restart', 'case11-variant-skip-ahead']) expect(fired[id], id).toEqual(['E6']);
    expect(fired['case14-reported-calibration']).toEqual([]);
  });
});
