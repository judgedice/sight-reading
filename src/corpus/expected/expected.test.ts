// buildExpectedNotes against the P0e goldens in fixtures/expected/, the chain order src/notation's expectedChains
// assumes, the fixture generator's port, and the IOI floors at the top of a prepared excerpt's tempo range.
import { describe, expect, it } from 'vitest';
import type { PreparedExcerpt, PreparedMeasure, SelectionResult } from '../../core/types.ts';
import { configs, corpusDoc, golden, goldenFiles } from '../../../fixtures/follow/gen/io.ts';
import { excerptExpected, plan } from '../../../fixtures/follow/gen/expected.ts';
import { expectedChains } from '../../notation/score-view.ts';
import { toMidi } from '../../theory/index.ts';
import { bandFor, levelDef } from '../select/levels.ts';
import { fitsInKey } from '../transpose/fit.ts';
import { planTransposition, spellExcerpt } from '../transpose/spell.ts';
import { buildExpectedNotes } from './expected.ts';

const cfg = configs();

/** A PreparedExcerpt as prepareExcerpt would build it, without the selection's tempo checks. */
function prepared(file: string): { p: PreparedExcerpt; bpm: number } {
  const g = golden(file);
  const doc = corpusDoc(g.excerptId);
  const inst = cfg.instrumentById[g.instrumentId]!;
  const def = levelDef(cfg, g.level);
  const shift = fitsInKey(doc.keyConcert, [doc.rangeConcert.min, doc.rangeConcert.max], g.writtenKey, inst, bandFor(inst, def))!;
  const pl = planTransposition(doc.keyConcert, g.writtenKey, shift.t, inst);
  const spelled = spellExcerpt(doc, pl, inst, def.doubleAccidentals);
  let bar = 1;
  const measures: PreparedMeasure[] = doc.measures.map((m) => ({
    index: m.index,
    isPickup: m.isPickup,
    startTick: m.startTick,
    displayBar: m.isPickup ? 0 : bar++,
    events: m.events.map((e) => {
      if (e.kind === 'rest') return { ...e };
      const { pitch: _pitch, ...rest } = e;
      return { ...rest, concertPitch: spelled.concert.get(e.id)!, writtenPitch: spelled.written.get(e.id)! };
    }),
  }));
  const p: PreparedExcerpt = {
    excerptId: doc.id,
    instrumentId: inst.id,
    source: doc.source,
    meter: doc.meter,
    pickupTicks: doc.pickupTicks,
    writtenKey: g.writtenKey,
    concertKey: pl.concertKey,
    modal: doc.modal,
    clef: g.clef,
    transposition: pl.concertInterval,
    measures,
    rangeWritten: { min: 0, max: 127 },
    modifications: [],
    barRhythmLevel: doc.barRhythmLevel,
    extremes: doc.extremes,
    dedupeGroup: doc.dedupeGroup,
    levelServed: g.level,
    stretch: false,
    bpmRange: { minBpm: g.bpm, maxBpm: g.bpm },
    selection: {} as SelectionResult,
  };
  return { p, bpm: g.bpm };
}

describe('buildExpectedNotes', () => {
  it.each(goldenFiles())('equals the golden %s', (file) => {
    const g = golden(file);
    const { p, bpm } = prepared(file);
    expect(buildExpectedNotes(p, bpm, cfg)).toEqual(g.notes);
  });

  it.each(goldenFiles())('keeps the tie-chain order and bars of notation expectedChains: %s', (file) => {
    const { p, bpm } = prepared(file);
    const notes = buildExpectedNotes(p, bpm, cfg);
    const chains = expectedChains(p);
    expect(notes.map((n) => n.eventIds)).toEqual(chains.map((c) => c.eventIds));
    expect(notes.map((n) => n.bar)).toEqual(chains.map((c) => c.bar));
    notes.forEach((n, i) => expect(n.idx).toBe(i));
  });

  it.each(goldenFiles())('agrees with the fixture generator port at another tempo: %s', (file) => {
    const g = golden(file);
    const { p } = prepared(file);
    const doc = corpusDoc(g.excerptId);
    const inst = cfg.instrumentById[g.instrumentId]!;
    const pl = plan(doc, inst, cfg.levels)!;
    expect(buildExpectedNotes(p, 97, cfg)).toEqual(excerptExpected(doc, inst, pl, 97, cfg.grading));
  });

  it('scales seconds with tempo and leaves beats alone', () => {
    const { p } = prepared(goldenFiles()[0]!);
    const a = buildExpectedNotes(p, 60, cfg);
    const b = buildExpectedNotes(p, 120, cfg);
    a.forEach((n, i) => {
      expect(b[i]!.onsetBeat).toBe(n.onsetBeat);
      expect(b[i]!.onsetSec).toBeCloseTo(n.onsetSec / 2, 9);
      expect(b[i]!.durSec).toBeCloseTo(n.durSec / 2, 9);
    });
    expect(a[0]!.ioiPrevSec).toBeNull();
    expect(a[a.length - 1]!.ioiNextSec).toBeNull();
  });

  it('marks onsetKind repeat, slurred and articulated, and merges ties', () => {
    const kinds = new Set<string>();
    let tied = 0;
    for (const f of goldenFiles()) {
      const { p, bpm } = prepared(f);
      for (const n of buildExpectedNotes(p, bpm, cfg)) {
        kinds.add(n.onsetKind);
        if (n.eventIds.length > 1) tied++;
        expect(toMidi(n.writtenPitch)).toBe(n.concertMidi + cfg.instrumentById[p.instrumentId]!.writtenMinusSounding.chromatic);
      }
    }
    expect([...kinds].sort()).toEqual(['articulated', 'repeat', 'slurred']);
    expect(tied).toBeGreaterThan(0);
  });

  it('rejects a non-positive tempo', () => {
    const { p } = prepared(goldenFiles()[0]!);
    expect(() => buildExpectedNotes(p, 0, cfg)).toThrow(RangeError);
  });

  it("respects the instrument's IOI floors at the top of the prepared tempo range when the range comes from prepareExcerpt", () => {
    // The clipped range's upper bound keeps every pitch-change IOI at or above the window-class floor (01 §8.3).
    for (const f of goldenFiles()) {
      const { p } = prepared(f);
      const inst = cfg.instrumentById[p.instrumentId]!;
      const floorMs = cfg.budget.ioiFloors.pitchChangeMs[String(inst.detection.windowSamples) as '512' | '1024' | '2048'];
      const notes = buildExpectedNotes(p, 60, cfg);
      let maxBpm = Infinity;
      for (let i = 1; i < notes.length; i++) {
        if (notes[i]!.concertMidi === notes[i - 1]!.concertMidi) continue;
        maxBpm = Math.min(maxBpm, (60 * (notes[i]!.onsetBeat - notes[i - 1]!.onsetBeat) * 1000) / floorMs);
      }
      const atMax = buildExpectedNotes(p, Math.floor(maxBpm), cfg);
      for (let i = 1; i < atMax.length; i++) {
        if (atMax[i]!.concertMidi !== atMax[i - 1]!.concertMidi) expect(atMax[i]!.ioiPrevSec! * 1000).toBeGreaterThanOrEqual(floorMs - 1e-6);
      }
    }
  });
});
