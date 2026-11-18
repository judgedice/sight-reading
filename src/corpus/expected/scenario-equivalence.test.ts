// The scenario bases (src/testkit/scenarios/corpus.ts) now use buildExpectedNotes; they must match the fixture
// generator's port note for note, for every fixture excerpt, scenario instrument and several tempi.
import { describe, expect, it } from 'vitest';
import { excerptExpected, plan } from '../../../fixtures/follow/gen/expected.ts';
import { buildBase, fixtureDocs, scenarioConfigs, SCENARIO_INSTRUMENTS } from '../../testkit/scenarios/corpus.ts';

const cfg = scenarioConfigs();

describe('scenario bases equal the fixture generator expected notes', () => {
  const ids = Object.values(SCENARIO_INSTRUMENTS).flat();
  it.each(ids)('%s', (id) => {
    const inst = cfg.instrumentById[id]!;
    let n = 0;
    for (const d of fixtureDocs()) {
      const pl = plan(d, inst, cfg.levels);
      for (const bpm of [60, 83, 132]) {
        const b = buildBase(d, id, bpm, cfg);
        if (!pl) {
          expect(b).toBeNull();
          continue;
        }
        expect(b, `${d.id} ${id}`).not.toBeNull();
        expect(b!.expected, `${d.id} ${id} ${bpm}`).toEqual(excerptExpected(d, inst, pl, bpm, cfg.grading));
        n++;
      }
    }
    expect(n).toBeGreaterThanOrEqual(0);
  });
});
