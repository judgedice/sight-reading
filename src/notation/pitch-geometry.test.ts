import { describe, expect, it } from 'vitest';
import type { Clef, SpelledPitch } from '../core/types.ts';
import { BarAccidentals, keyAlterations, ledgerLineCount, pitchY, stepsBelowTopLine, vexKeySignature } from './pitch-geometry.ts';

const P = (step: SpelledPitch['step'], octave: number, alter: SpelledPitch['alter'] = 0): SpelledPitch => ({ step, alter, octave });

describe('staff positions', () => {
  it('puts each clef reference pitch on its line', () => {
    const lines: [Clef, SpelledPitch, number][] = [
      ['treble', P('F', 5), 0],
      ['treble', P('E', 4), 8],
      ['treble', P('G', 4), 6], // G clef line
      ['treble-8vb', P('G', 4), 6],
      ['bass', P('F', 3), 2], // F clef line
      ['bass', P('G', 2), 8],
      ['alto', P('C', 4), 4], // middle line
      ['tenor', P('C', 4), 2], // fourth line
    ];
    for (const [clef, p, steps] of lines) expect(stepsBelowTopLine(p, clef), `${clef} ${p.step}${p.octave}`).toBe(steps);
  });

  it('ignores the accidental and spaces steps by half a line spacing', () => {
    expect(pitchY(P('F', 5, 1), 'treble', 40, 10)).toBe(40);
    expect(pitchY(P('B', 4), 'treble', 40, 10)).toBe(60);
    expect(pitchY(P('C', 4), 'treble', 30, 7.5)).toBe(30 + 10 * 3.75);
  });

  it('counts ledger lines', () => {
    expect(ledgerLineCount(P('C', 4), 'treble')).toBe(1);
    expect(ledgerLineCount(P('A', 3), 'treble')).toBe(2);
    expect(ledgerLineCount(P('A', 5), 'treble')).toBe(1);
    expect(ledgerLineCount(P('C', 6), 'treble')).toBe(2);
    expect(ledgerLineCount(P('E', 2), 'bass')).toBe(1);
    expect(ledgerLineCount(P('G', 4), 'treble')).toBe(0);
  });
});

describe('key signatures and accidentals', () => {
  it('names key signatures by fifths', () => {
    expect(vexKeySignature({ fifths: 0, mode: 'major' })).toBe('C');
    expect(vexKeySignature({ fifths: -3, mode: 'minor' })).toBe('Eb');
    expect(vexKeySignature({ fifths: 7, mode: 'major' })).toBe('C#');
    expect(() => vexKeySignature({ fifths: 8, mode: 'major' })).toThrow(RangeError);
    expect(keyAlterations({ fifths: 2, mode: 'major' })).toMatchObject({ F: 1, C: 1, G: 0 });
    expect(keyAlterations({ fifths: -2, mode: 'major' })).toMatchObject({ B: -1, E: -1, A: 0 });
  });

  it('prints accidentals against the key and earlier notes in the bar', () => {
    const a = new BarAccidentals({ fifths: 4, mode: 'major' }); // E major: F# C# G# D#
    expect(a.next(P('F', 5, 1), false)).toBeNull();
    expect(a.next(P('F', 5, 0), false)).toBe(0); // courtesy natural (target F#, played F)
    expect(a.next(P('F', 5, 0), false)).toBeNull(); // holds through the bar
    expect(a.next(P('F', 4, 0), false)).toBe(0); // other octave
    a.barline();
    expect(a.next(P('F', 5, 1), false)).toBeNull();
    expect(a.next(P('A', 4, 1), false)).toBe(1);
    expect(a.next(P('B', 4, -2), false)).toBe(-2);
  });

  it('a note tied over the barline prints nothing and leaves the bar state alone', () => {
    const a = new BarAccidentals({ fifths: 0, mode: 'major' });
    expect(a.next(P('F', 4, 1), false)).toBe(1);
    a.barline();
    expect(a.next(P('F', 4, 1), true)).toBeNull();
    expect(a.next(P('F', 4, 1), false)).toBe(1);
  });
});
