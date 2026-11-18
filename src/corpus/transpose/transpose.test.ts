// Range fit (03 §7.3), spelled transposition (03 §7.4) and rejection (03 §7.5) against brute force, the fixture
// goldens in fixtures/expected/ and hand-checked spelling cases.
import { describe, expect, it } from 'vitest';
import type { ExcerptDoc, Instrument, KeySig, SelectionResult } from '../../core/types.ts';
import { configs, corpusDoc, golden, goldenFiles } from '../../../fixtures/follow/gen/io.ts';
import { createRng } from '../../core/rng.ts';
import { toMidi, transposeKey } from '../../theory/index.ts';
import { bandFor, chooseClef, levelDef } from '../select/levels.ts';
import { chooseShift, fitsInKey, pitchClassShift, shiftWindow } from './fit.ts';
import { planTransposition, spellExcerpt } from './spell.ts';
import { prepareExcerpt, TranspositionError } from './prepare.ts';

const cfg = configs();
const inst = (id: string): Instrument => cfg.instrumentById[id]!;
const key = (fifths: number, mode: 'major' | 'minor' = 'major'): KeySig => ({ fifths, mode });

describe('03 §7.3 closed-form fit', () => {
  it('equals a brute-force search over shifts for random ranges, keys and instruments', () => {
    const rng = createRng(7);
    const insts = cfg.instruments.instruments;
    for (let i = 0; i < 4000; i++) {
      const ins = insts[rng.int(0, insts.length)]!;
      const level = rng.int(1, 11);
      const band = bandFor(ins, levelDef(cfg, level));
      const lo = rng.int(30, 90);
      const range: [number, number] = [lo, lo + rng.int(0, 24)];
      const mode = rng.next() < 0.5 ? 'major' : 'minor';
      const src = key(rng.int(-7, 8), mode);
      const kw = key(rng.int(-7, 8), mode);
      const got = fitsInKey(src, range, kw, ins, band);
      // Brute force: every t in [-60, 60] with the right pitch class whose written notes all sit in the band.
      const p = pitchClassShift(src, kw, ins);
      const cI = ins.writtenMinusSounding.chromatic;
      let best: { t: number; margin: number } | null = null;
      for (let t = -60; t <= 60; t++) {
        if ((((t - p) % 12) + 12) % 12 !== 0) continue;
        const wlo = range[0] + t + cI;
        const whi = range[1] + t + cI;
        if (wlo < band[0] || whi > band[1]) continue;
        const margin = Math.min(wlo - band[0], band[1] - whi);
        if (!best || margin > best.margin || (margin === best.margin && (Math.abs(t) < Math.abs(best.t) || (Math.abs(t) === Math.abs(best.t) && t < best.t)))) best = { t, margin };
      }
      expect(got).toEqual(best);
    }
  });

  it('rejects a span wider than the band (03 §7.5 rule 2) and a mode mismatch (rule 4)', () => {
    const fl = inst('flute');
    const band = bandFor(fl, levelDef(cfg, 1)); // 65-77, span 12
    expect(shiftWindow([60, 73], fl, band).tMin > shiftWindow([60, 73], fl, band).tMax).toBe(true);
    expect(fitsInKey(key(0), [60, 73], key(0), fl, band)).toBeNull();
    expect(fitsInKey(key(0), [60, 70], key(0, 'minor'), fl, band)).toBeNull();
    expect(fitsInKey(key(0), [60, 70], key(-1), fl, band)).toEqual({ t: 5, margin: 0 });
  });

  it('pitch class shift follows the concert key Kc = transposeKey(Kw, -I) (clarinet written D is concert C)', () => {
    const cl = inst('clarinet-bb');
    expect(pitchClassShift(key(0), key(2), cl)).toBe(0);
    expect(pitchClassShift(key(-1), key(2), cl)).toBe(7); // F -> C up a fifth
    expect(chooseShift({ tMin: -3, tMax: 20 }, 4, [60, 64], cl, [55, 90])).toEqual({ t: 4, margin: Math.min(60 + 2 + 4 - 55, 90 - (64 + 2 + 4)) });
  });
});

describe('03 §7.4 spelled transposition reproduces fixtures/expected', () => {
  for (const file of goldenFiles()) {
    it(file, () => {
      const g = golden(file);
      const doc = corpusDoc(g.excerptId);
      const ins = inst(g.instrumentId);
      const def = levelDef(cfg, g.level);
      const band = bandFor(ins, def);
      const shift = fitsInKey(doc.keyConcert, [doc.rangeConcert.min, doc.rangeConcert.max], g.writtenKey, ins, band);
      expect(shift).not.toBeNull();
      const plan = planTransposition(doc.keyConcert, g.writtenKey, shift!.t, ins);
      expect(plan.concertInterval).toEqual(g.transposition);
      expect(transposeKey(doc.keyConcert, plan.writtenInterval)).toEqual(g.writtenKey);
      const spelled = spellExcerpt(doc, plan, ins, def.doubleAccidentals);
      expect(spelled.verdict).toBe('ok');
      for (const n of g.notes) {
        for (const id of n.eventIds) expect(spelled.written.get(id)).toEqual(n.writtenPitch);
        expect(toMidi(spelled.concert.get(n.eventIds[0]!)!)).toBe(n.concertMidi);
      }
      const written = [...spelled.written.values()].map(toMidi);
      expect(chooseClef(ins, g.level, [Math.min(...written), Math.max(...written)])).toBe(g.clef);
    });
  }
});

/** A one-bar doc in a minor key with the raised 7th, for spelling cases. */
function leadingToneDoc(): ExcerptDoc {
  const base = corpusDoc('jaell-lc6157272-voice-m20-27');
  return {
    ...base,
    keyConcert: key(0, 'minor'),
    measures: [
      {
        index: 0,
        isPickup: false,
        startTick: 0,
        events: [
          { id: 'a', kind: 'note', tick: 0, dur: 480, pitch: { step: 'A', alter: 0, octave: 4 } },
          { id: 'b', kind: 'note', tick: 480, dur: 480, pitch: { step: 'G', alter: 1, octave: 4 } },
          { id: 'c', kind: 'note', tick: 960, dur: 960, pitch: { step: 'A', alter: 0, octave: 4 } },
        ],
      },
    ],
    rangeConcert: { min: 68, max: 69 },
  };
}

describe('03 §7.5 rule 3 spelling rejection', () => {
  const fl = inst('flute');
  it('A minor leading tone G# becomes F## in G# minor: a double sharp', () => {
    const doc = leadingToneDoc();
    const plan = planTransposition(doc.keyConcert, key(5, 'minor'), 11, fl);
    const s = spellExcerpt(doc, plan, fl, false);
    expect(s.written.get('b')).toEqual({ step: 'F', alter: 2, octave: 5 });
    expect(s.verdict).toBe('double-accidental');
    expect(spellExcerpt(doc, plan, fl, true).verdict).toBe('ok');
    // The enharmonic written key A♭ minor (7 flats) spells it G natural.
    const enh = spellExcerpt(doc, planTransposition(doc.keyConcert, key(-7, 'minor'), 11, fl), fl, false);
    expect(enh.written.get('b')).toEqual({ step: 'G', alter: 0, octave: 5 });
    expect(enh.verdict).toBe('ok');
  });

  it('more than 2 doubles reject at any level; a triple accidental rejects', () => {
    const doc = leadingToneDoc();
    const many: ExcerptDoc = {
      ...doc,
      measures: [{ ...doc.measures[0]!, events: [0, 1, 2].map((i) => ({ id: `g${i}`, kind: 'note' as const, tick: i * 480, dur: 480, pitch: { step: 'G' as const, alter: 1 as const, octave: 4 } })) }],
    };
    const plan = planTransposition(many.keyConcert, key(5, 'minor'), 11, fl);
    expect(spellExcerpt(many, plan, fl, true).verdict).toBe('too-many-doubles');
    const triple: ExcerptDoc = {
      ...doc,
      keyConcert: key(0),
      measures: [{ ...doc.measures[0]!, events: [{ id: 't', kind: 'note', tick: 0, dur: 480, pitch: { step: 'F', alter: 2, octave: 4 } }] }],
    };
    // C major to C# major is an augmented unison: F## would need a triple sharp.
    expect(spellExcerpt(triple, planTransposition(key(0), key(7), 1, fl), fl, true).verdict).toBe('triple-accidental');
  });

  it('alto sax in G♭ major (concert B double-flat) spells the written key exactly and the concert key validly', () => {
    const sax = inst('sax-alto');
    const plan = planTransposition(key(0), key(-6), 9, sax); // concert C -> A (t = 9), written G♭
    expect(plan.concertKey).toEqual(key(3)); // A major, not B𝄫 major
    expect(plan.concertInterval).toEqual({ diatonic: 5, chromatic: 9 });
    expect(transposeKey(key(0), plan.writtenInterval)).toEqual(key(-6));
  });
});

describe('prepareExcerpt', () => {
  // Level 7, 4/4, concert E♭ major, range 48-65: flute reads it in F major, shifted up.
  const doc = corpusDoc('stanford-sq10517302-viola-mv3-mp142-150');
  const fl = inst('flute');
  const def = levelDef(cfg, 7);
  const band = bandFor(fl, def);
  const shift = fitsInKey(doc.keyConcert, [doc.rangeConcert.min, doc.rangeConcert.max], key(-1), fl, band)!;
  const plan = planTransposition(doc.keyConcert, key(-1), shift.t, fl);
  const entry = { id: doc.id } as SelectionResult['entry'];
  const sel: SelectionResult = {
    entry,
    settings: { instrumentId: 'flute', level: 7, writtenKey: key(-1), meter: '4/4', bpm: 100, bars: 8, randomized: [], seed: 1 },
    levelServed: 7,
    stretch: false,
    fromLevelBelow: false,
    transposition: plan.concertInterval,
    writtenKey: key(-1),
    concertKey: plan.concertKey,
    clef: 'treble',
    bpmRange: { minBpm: 100, maxBpm: 126 },
    octaveDisplaced: false,
    enharmonicRetry: false,
  };

  it('builds written and concert pitches, display bars, range and modifications', () => {
    const p = prepareExcerpt(doc, sel, fl, cfg);
    expect(p.writtenKey).toEqual(key(-1));
    expect(p.transposition).toEqual(plan.concertInterval);
    expect(shift.t).toBeGreaterThanOrEqual(12);
    expect(p.modifications).toContain('transposed');
    expect(p.modifications).not.toContain('octave-displaced'); // the selection decides; it said false here
    expect(p.measures[0]!.displayBar).toBe(0); // pickup
    expect(p.measures[1]!.displayBar).toBe(1);
    expect(p.measures.length).toBe(doc.measures.length);
    const written = p.measures.flatMap((m) => m.events).flatMap((e) => (e.kind === 'note' ? [toMidi(e.writtenPitch)] : []));
    expect(p.rangeWritten).toEqual({ min: Math.min(...written), max: Math.max(...written) });
    expect(p.rangeWritten.min).toBeGreaterThanOrEqual(band[0]);
    expect(p.rangeWritten.max).toBeLessThanOrEqual(band[1]);
    expect(p.bpmRange.minBpm).toBeGreaterThanOrEqual(def.tempo.minBpm);
    expect(p.selection).toBe(sel);
  });

  it('throws TranspositionError rather than editing notes', () => {
    expect(() => prepareExcerpt(doc, { ...sel, entry: { id: 'other' } as SelectionResult['entry'] }, fl, cfg)).toThrow(TranspositionError);
    expect(() => prepareExcerpt(doc, { ...sel, settings: { ...sel.settings, bpm: 400 } }, fl, cfg)).toThrow(/tempo/);
    try {
      prepareExcerpt(doc, { ...sel, transposition: { diatonic: plan.concertInterval.diatonic + 21, chromatic: plan.concertInterval.chromatic + 36 } }, fl, cfg);
      throw new Error('expected a range error');
    } catch (e) {
      expect(e).toBeInstanceOf(TranspositionError);
      expect((e as TranspositionError).code).toBe('range');
    }
  });
});
