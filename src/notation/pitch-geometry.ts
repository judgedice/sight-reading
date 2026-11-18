// Staff positions, VexFlow keys, key signatures and displayed accidentals. Pure; no VexFlow import.

import type { Alter, Clef, KeySig, SpelledPitch, Step } from '../core/types.ts';

const STEPS: readonly Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** Diatonic index: octave * 7 + letter (C4 = 28). */
export function diatonicIndex(p: SpelledPitch): number {
  return p.octave * 7 + STEPS.indexOf(p.step);
}

/**
 * Diatonic index of the top staff line per clef. Pitches are written pitches, so `treble-8vb` (tenor voice, guitar)
 * uses the treble lines: the written part is already an octave above sounding.
 */
const TOP_LINE: Record<Clef, number> = {
  treble: 5 * 7 + 3, // F5
  'treble-8vb': 5 * 7 + 3,
  bass: 3 * 7 + 5, // A3
  alto: 4 * 7 + 4, // G4
  tenor: 4 * 7 + 2, // E4
};

/** Staff steps below the top line (0 = top line, 8 = bottom line, negative above the staff). */
export function stepsBelowTopLine(p: SpelledPitch, clef: Clef): number {
  return TOP_LINE[clef] - diatonicIndex(p);
}

/** y of a written pitch on a staff whose top line is at `staffTopY` with line spacing `lineSpacing` (same unit). */
export function pitchY(p: SpelledPitch, clef: Clef, staffTopY: number, lineSpacing: number): number {
  return staffTopY + (stepsBelowTopLine(p, clef) * lineSpacing) / 2;
}

/** Ledger lines a written pitch needs (positive count, above or below). */
export function ledgerLineCount(p: SpelledPitch, clef: Clef): number {
  const s = stepsBelowTopLine(p, clef);
  if (s < 0) return Math.floor(-s / 2);
  if (s > 8) return Math.floor((s - 8) / 2);
  return 0;
}

/** VexFlow clef name and annotation. */
export function vexClef(clef: Clef): { name: 'treble' | 'bass' | 'alto' | 'tenor'; annotation?: '8vb' } {
  return clef === 'treble-8vb' ? { name: 'treble', annotation: '8vb' } : { name: clef };
}

/** VexFlow key string `step[#|b]/octave` (accidentals are drawn as separate modifiers). */
export function vexKey(p: SpelledPitch): string {
  return `${p.step.toLowerCase()}/${p.octave}`;
}

const MAJOR_BY_FIFTHS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];

/** VexFlow key-signature spec; minor keys use their relative major's signature (same accidentals). */
export function vexKeySignature(k: KeySig): string {
  const name = MAJOR_BY_FIFTHS[k.fifths + 7];
  if (name === undefined) throw new RangeError(`key signature fifths out of range: ${k.fifths}`);
  return name;
}

const SHARP_ORDER: readonly Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: readonly Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** The alteration a key signature gives each letter. */
export function keyAlterations(k: KeySig): Record<Step, Alter> {
  const out: Record<Step, Alter> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (k.fifths > 0) for (const s of SHARP_ORDER.slice(0, k.fifths)) out[s] = 1;
  if (k.fifths < 0) for (const s of FLAT_ORDER.slice(0, -k.fifths)) out[s] = -1;
  return out;
}

const ACC_CODE: Record<Alter, string> = { [-2]: 'bb', [-1]: 'b', 0: 'n', 1: '#', 2: '##' } as Record<Alter, string>;

/** VexFlow accidental code for an alteration. */
export function vexAccidental(a: Alter): string {
  return ACC_CODE[a];
}

/**
 * Tracks displayed accidentals through one bar (standard engraving: an accidental holds for the same letter and
 * octave until the barline; a note tied over the barline carries its alteration without printing it).
 */
export class BarAccidentals {
  private readonly key: Record<Step, Alter>;
  private state = new Map<number, Alter>();

  constructor(key: KeySig) {
    this.key = keyAlterations(key);
  }

  /** Start a new bar: alterations revert to the key signature. */
  barline(): void {
    this.state = new Map();
  }

  /**
   * The accidental to print for this note, or null. A note tied from the previous note prints nothing and does not
   * change the bar's state: after a tie over the barline, a later untied note on that line needs its accidental again
   * (Gould, "Behind Bars", ties and accidentals).
   */
  next(p: SpelledPitch, tiedFromPrevious: boolean): Alter | null {
    if (tiedFromPrevious) return null;
    const idx = diatonicIndex(p);
    const current = this.state.get(idx) ?? this.key[p.step];
    this.state.set(idx, p.alter);
    return current === p.alter ? null : p.alter;
  }
}
