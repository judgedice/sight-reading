// Test helper: an ExcerptDoc as a PreparedExcerpt on a chosen clef, without the corpus package (P9b builds the
// real one). Octave-shifts the line so its median sits on the clef's middle line, which keeps ledger lines sane
// when a violin line is drawn in bass clef. Used by notation tests and the e2e bundle only.

import type { Clef, ExcerptDoc, ExpectedGolden, PreparedExcerpt, PreparedMeasure, SelectionResult, SpelledPitch } from '../../core/types.ts';
import { diatonicIndex, stepsBelowTopLine } from '../pitch-geometry.ts';

export const RENDER_CLEFS: readonly Clef[] = ['treble', 'bass', 'alto', 'tenor'];

function octaveShiftFor(doc: ExcerptDoc, clef: Clef): number {
  const idx: number[] = [];
  for (const m of doc.measures) for (const e of m.events) if (e.kind === 'note') idx.push(diatonicIndex(e.pitch));
  if (idx.length === 0) return 0;
  idx.sort((a, b) => a - b);
  const median = idx[Math.floor(idx.length / 2)]!;
  // stepsBelowTopLine of the middle line is 4.
  const probe: SpelledPitch = { step: 'C', alter: 0, octave: Math.floor(median / 7) };
  const medianSteps = stepsBelowTopLine(probe, clef) - (median - diatonicIndex(probe));
  return Math.round((medianSteps - 4) / 7);
}

export function preparedFromDoc(doc: ExcerptDoc, clef: Clef, opts: { octaves?: number } = {}): PreparedExcerpt {
  const oct = opts.octaves ?? octaveShiftFor(doc, clef);
  const shift = (p: SpelledPitch): SpelledPitch => ({ ...p, octave: p.octave + oct });
  let bar = doc.pickupTicks > 0 ? 0 : 1;
  const measures: PreparedMeasure[] = doc.measures.map((m) => ({
    index: m.index,
    isPickup: m.isPickup,
    startTick: m.startTick,
    displayBar: bar++,
    events: m.events.map((e) => {
      if (e.kind === 'rest') return e;
      const { pitch, ...rest } = e;
      return { ...rest, concertPitch: shift(pitch), writtenPitch: shift(pitch) };
    }),
  }));
  return {
    excerptId: doc.id,
    instrumentId: 'test',
    source: doc.source,
    meter: doc.meter,
    pickupTicks: doc.pickupTicks,
    writtenKey: doc.keyConcert,
    concertKey: doc.keyConcert,
    modal: doc.modal,
    clef,
    transposition: { diatonic: 7 * oct, chromatic: 12 * oct },
    measures,
    rangeWritten: { min: doc.rangeConcert.min + 12 * oct, max: doc.rangeConcert.max + 12 * oct },
    modifications: [],
    barRhythmLevel: doc.barRhythmLevel,
    extremes: doc.extremes,
    dedupeGroup: doc.dedupeGroup,
    levelServed: doc.level,
    stretch: false,
    bpmRange: { minBpm: doc.tempo.minBpm, maxBpm: doc.tempo.maxBpm },
    // The renderer never reads the selection; tests do not need a real one.
    selection: null as unknown as SelectionResult,
  };
}

/** The excerpt as an ExpectedGolden's instrument reads it: written pitches, written key and clef from the golden. */
export function preparedFromGolden(doc: ExcerptDoc, golden: ExpectedGolden): PreparedExcerpt {
  const written = new Map<string, SpelledPitch>();
  for (const n of golden.notes) for (const id of n.eventIds) written.set(id, n.writtenPitch);
  const base = preparedFromDoc(doc, golden.clef, { octaves: 0 });
  return {
    ...base,
    instrumentId: golden.instrumentId,
    writtenKey: golden.writtenKey,
    transposition: golden.transposition,
    measures: base.measures.map((m) => ({
      ...m,
      events: m.events.map((e) => {
        if (e.kind === 'rest') return e;
        const w = written.get(e.id);
        if (!w) throw new Error(`golden has no written pitch for ${e.id}`);
        return { ...e, writtenPitch: w };
      }),
    })),
  };
}
