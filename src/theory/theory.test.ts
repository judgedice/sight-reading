import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TheoryApi } from '../core/api.ts';
import type { Interval, KeySig, SpelledPitch, Step } from '../core/types.ts';
import * as theory from './index.ts';
import { enharmonicKey, intervalBetweenKeys, isValidKey, midiToFreq, freqToMidi, spellGhost, toMidi, tonicOf, transposeKey, transposePitch, tryTransposePitch } from './index.ts';

const api: TheoryApi = theory;
const P = (step: Step, alter: SpelledPitch['alter'], octave: number): SpelledPitch => ({ step, alter, octave });
const neg = (iv: Interval): Interval => ({ diatonic: -iv.diatonic, chromatic: -iv.chromatic });

const insts = (JSON.parse(readFileSync(new URL('../../config/instruments.json', import.meta.url), 'utf8')) as {
  instruments: { id: string; semis: number; writtenMinusSounding: Interval }[];
}).instruments;

describe('toMidi', () => {
  it('anchors', () => {
    expect(toMidi(P('C', 0, 4))).toBe(60);
    expect(toMidi(P('A', 0, 4))).toBe(69);
    expect(toMidi(P('B', 1, 3))).toBe(60);
    expect(toMidi(P('C', -1, 4))).toBe(59);
    expect(toMidi(P('F', 1, 5))).toBe(78);
  });
  it('api conformance', () => expect(api.toMidi(P('C', 0, 4))).toBe(60));
});

describe('transposePitch', () => {
  const M2: Interval = { diatonic: 1, chromatic: 2 };
  it('spells by letter distance', () => {
    expect(transposePitch(P('C', 0, 4), M2)).toEqual(P('D', 0, 4));
    expect(transposePitch(P('F', 1, 4), M2)).toEqual(P('G', 1, 4));
    expect(transposePitch(P('B', 0, 4), M2)).toEqual(P('C', 1, 5));
    expect(transposePitch(P('B', -1, 4), { diatonic: 5, chromatic: 9 })).toEqual(P('G', 0, 5));
    expect(transposePitch(P('E', 0, 4), { diatonic: 2, chromatic: 3 })).toEqual(P('G', 0, 4));
    expect(transposePitch(P('C', 0, 4), { diatonic: 3, chromatic: 6 })).toEqual(P('F', 1, 4));
    expect(transposePitch(P('C', 0, 4), { diatonic: 4, chromatic: 6 })).toEqual(P('G', -1, 4));
  });
  it('octave and negative intervals', () => {
    expect(transposePitch(P('C', 0, 4), { diatonic: 7, chromatic: 12 })).toEqual(P('C', 0, 5));
    expect(transposePitch(P('D', 0, 4), { diatonic: -1, chromatic: -2 })).toEqual(P('C', 0, 4));
    expect(transposePitch(P('C', 0, 4), { diatonic: -1, chromatic: -1 })).toEqual(P('B', 0, 3));
    expect(transposePitch(P('C', 0, 4), { diatonic: -7, chromatic: -12 })).toEqual(P('C', 0, 3));
  });
  it('double accidentals ok, triple rejected', () => {
    expect(transposePitch(P('F', 1, 4), { diatonic: 1, chromatic: 3 })).toEqual(P('G', 2, 4) );
    expect(tryTransposePitch(P('F', 2, 4), { diatonic: 0, chromatic: 1 })).toBeNull();
    expect(() => transposePitch(P('F', 2, 4), { diatonic: 0, chromatic: 1 })).toThrow(RangeError);
  });
  it('midi shifts by chromatic', () => {
    for (const s of ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as Step[])
      for (const a of [-1, 0, 1] as const)
        for (const iv of [M2, { diatonic: 5, chromatic: 9 }, { diatonic: -4, chromatic: -7 }]) {
          const p = P(s, a, 4);
          const r = tryTransposePitch(p, iv);
          if (r) expect(toMidi(r)).toBe(toMidi(p) + iv.chromatic);
        }
  });
});

describe('keys', () => {
  it('tonics', () => {
    expect(tonicOf({ fifths: 0, mode: 'major' })).toMatchObject({ step: 'C', alter: 0 });
    expect(tonicOf({ fifths: 3, mode: 'minor' })).toMatchObject({ step: 'F', alter: 1 });
    expect(tonicOf({ fifths: -2, mode: 'major' })).toMatchObject({ step: 'B', alter: -1 });
    expect(tonicOf({ fifths: 7, mode: 'major' })).toMatchObject({ step: 'C', alter: 1 });
    expect(tonicOf({ fifths: -7, mode: 'major' })).toMatchObject({ step: 'C', alter: -1 });
    expect(tonicOf({ fifths: -3, mode: 'minor' })).toMatchObject({ step: 'C', alter: 0 });
  });
  it('Bb instruments, alto sax, horn', () => {
    expect(transposeKey({ fifths: -1, mode: 'major' }, { diatonic: 1, chromatic: 2 })).toEqual({ fifths: 1, mode: 'major' }); // F -> G
    expect(transposeKey({ fifths: 0, mode: 'major' }, { diatonic: 1, chromatic: 2 })).toEqual({ fifths: 2, mode: 'major' }); // C -> D
    expect(transposeKey({ fifths: 0, mode: 'major' }, { diatonic: 5, chromatic: 9 })).toEqual({ fifths: 3, mode: 'major' }); // C -> A
    expect(transposeKey({ fifths: 0, mode: 'minor' }, { diatonic: 4, chromatic: 7 })).toEqual({ fifths: 1, mode: 'minor' }); // Am -> Em
    expect(transposeKey({ fifths: 0, mode: 'major' }, { diatonic: 7, chromatic: 12 })).toEqual({ fifths: 0, mode: 'major' });
  });
  it('more than 7 accidentals is returned unclamped', () => {
    const k = transposeKey({ fifths: 6, mode: 'major' }, { diatonic: 1, chromatic: 2 }); // F# -> G#
    expect(k.fifths).toBe(8);
    expect(isValidKey(k)).toBe(false);
    expect(enharmonicKey(k)).toEqual({ fifths: -4, mode: 'major' });
  });
  it('intervalBetweenKeys', () => {
    const C: KeySig = { fifths: 0, mode: 'major' };
    expect(intervalBetweenKeys(C, { fifths: 2, mode: 'major' }, 2)).toEqual({ diatonic: 1, chromatic: 2 });
    expect(intervalBetweenKeys(C, { fifths: 2, mode: 'major' }, -10)).toEqual({ diatonic: -6, chromatic: -10 });
    expect(intervalBetweenKeys(C, { fifths: 2, mode: 'major' }, 14)).toEqual({ diatonic: 8, chromatic: 14 });
    expect(intervalBetweenKeys(C, { fifths: -7, mode: 'major' }, 11)).toEqual({ diatonic: 7, chromatic: 11 });
    expect(intervalBetweenKeys(C, { fifths: -7, mode: 'major' }, -1)).toEqual({ diatonic: 0, chromatic: -1 });
    expect(intervalBetweenKeys(C, { fifths: 7, mode: 'major' }, 1)).toEqual({ diatonic: 0, chromatic: 1 });
    expect(intervalBetweenKeys(C, C, 0)).toEqual({ diatonic: 0, chromatic: 0 });
    expect(intervalBetweenKeys(C, C, -12)).toEqual({ diatonic: -7, chromatic: -12 });
  });
  it('every key x shift: interval carries the tonic to the target key', () => {
    for (const mode of ['major', 'minor'] as const)
      for (let f1 = -7; f1 <= 7; f1++)
        for (let f2 = -7; f2 <= 7; f2++)
          for (let shift = -17; shift <= 17; shift++) {
            const from: KeySig = { fifths: f1, mode };
            const to: KeySig = { fifths: f2, mode };
            const pcDiff = (toMidi(tonicOf(to)) - toMidi(tonicOf(from)) - shift) % 12;
            if (pcDiff !== 0) continue;
            const iv = intervalBetweenKeys(from, to, shift);
            expect(iv.chromatic).toBe(shift);
            const t = tryTransposePitch(tonicOf(from), iv);
            expect(t).not.toBeNull();
            expect(t).toMatchObject({ step: tonicOf(to).step, alter: tonicOf(to).alter });
            expect(transposeKey(from, iv)).toEqual(to);
          }
  });
});

describe('every key x instrument', () => {
  it('concert -> written -> concert round trip, correct spelling', () => {
    expect(insts.length).toBeGreaterThanOrEqual(20);
    for (const inst of insts) {
      expect(inst.writtenMinusSounding.chromatic).toBe(inst.semis);
      for (const mode of ['major', 'minor'] as const)
        for (let f = -7; f <= 7; f++) {
          const concert: KeySig = { fifths: f, mode };
          const written = transposeKey(concert, inst.writtenMinusSounding);
          const t = tryTransposePitch(tonicOf(concert), inst.writtenMinusSounding);
          const tonicOk = !!t && Math.abs(t.alter) <= 1;
          if (isValidKey(written)) {
            expect(tonicOk).toBe(true);
            expect(mod12(toMidi(tonicOf(written)) - toMidi(tonicOf(concert)) - inst.semis)).toBe(0);
            expect(transposeKey(written, neg(inst.writtenMinusSounding))).toEqual(concert);
          }
        }
      // C major concert key spelled for the instrument: known cases.
    }
    const byId = Object.fromEntries(insts.map((i) => [i.id, i.writtenMinusSounding]));
    const C: KeySig = { fifths: 0, mode: 'major' };
    expect(transposeKey(C, byId['clarinet-bb']!).fifths).toBe(2);
    expect(transposeKey(C, byId['sax-alto']!).fifths).toBe(3);
    expect(transposeKey(C, byId['horn-f']!).fifths).toBe(1);
    expect(transposeKey(C, byId['sax-tenor']!).fifths).toBe(2);
    expect(transposeKey(C, byId['sax-bari']!).fifths).toBe(3);
    expect(transposeKey(C, byId['voice-tenor']!).fifths).toBe(0);
  });
  it('pitches round trip', () => {
    for (const inst of insts)
      for (const s of ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as Step[])
        for (const a of [-1, 0, 1] as const) {
          const p = P(s, a, 4);
          const w = tryTransposePitch(p, inst.writtenMinusSounding);
          if (!w) continue;
          expect(toMidi(w)).toBe(toMidi(p) + inst.semis);
          expect(transposePitch(w, neg(inst.writtenMinusSounding))).toEqual(p);
        }
  });
});
const mod12 = (n: number): number => ((n % 12) + 12) % 12;

describe('spellGhost (02 §4.8)', () => {
  const D: KeySig = { fifths: 2, mode: 'major' };
  const Bb: KeySig = { fifths: -2, mode: 'major' };
  it('target letter plus needed accidental', () => {
    expect(spellGhost(77, P('F', 1, 5), D)).toEqual(P('F', 0, 5)); // F#5 played F
    expect(spellGhost(71, P('B', -1, 4), Bb)).toEqual(P('B', 0, 4)); // Bb4 played B
    expect(spellGhost(79, P('F', 1, 5), D)).toEqual(P('F', 2, 5)); // two above: double sharp, per rule
    expect(spellGhost(78, P('F', 1, 5), D)).toEqual(P('F', 1, 5));
    expect(spellGhost(72, P('B', 0, 4), D)).toEqual(P('B', 1, 4)); // B#4 = 72, letter kept
    expect(spellGhost(59, P('C', 0, 4), D)).toEqual(P('C', -1, 4));
  });
  it('key spelling beyond 2 semitones', () => {
    expect(spellGhost(70, P('F', 0, 5), Bb)).toEqual(P('B', -1, 4));
    expect(spellGhost(70, P('F', 0, 5), D)).toEqual(P('A', 1, 4));
    expect(spellGhost(61, P('G', 0, 4), { fifths: 0, mode: 'major' })).toEqual(P('C', 1, 4));
    expect(spellGhost(61, P('G', 0, 4), { fifths: -1, mode: 'major' })).toEqual(P('D', -1, 4));
    expect(spellGhost(60, P('G', 0, 5), D)).toEqual(P('C', 0, 4));
    expect(spellGhost(-1 + 12, P('G', 0, 3), Bb)).toEqual(P('B', 0, -1));
  });
  it('always lands on the played midi', () => {
    for (let m = 40; m < 100; m++)
      for (const t of [P('F', 1, 4), P('B', -1, 4), P('C', 0, 5), P('E', -1, 3)])
        for (const f of [-5, 0, 4]) expect(toMidi(spellGhost(m, t, { fifths: f, mode: 'major' }))).toBe(m);
  });
});

describe('frequency', () => {
  it('maps', () => {
    expect(freqToMidi(440, 440)).toBeCloseTo(69, 12);
    expect(freqToMidi(880, 440)).toBeCloseTo(81, 12);
    expect(freqToMidi(442, 442)).toBeCloseTo(69, 12);
    expect(freqToMidi(261.6255653, 440)).toBeCloseTo(60, 5);
    expect(midiToFreq(69, 440)).toBe(440);
    expect(midiToFreq(60, 440)).toBeCloseTo(261.6256, 3);
    expect(freqToMidi(450, 440) - 69).toBeCloseTo(0.38906, 4);
    for (const m of [30, 55.5, 69, 100.25]) expect(freqToMidi(midiToFreq(m, 443), 443)).toBeCloseTo(m, 10);
  });
});
