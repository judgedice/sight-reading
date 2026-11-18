/** Spelled pitch, intervals, keys, transposition and ghost spelling (01 §5.3). */
import type { Alter, Interval, KeySig, SpelledPitch, Step } from '../core/types.ts';
import type { TheoryApi } from '../core/api.ts';

const STEPS: readonly Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
/** Semitones of the natural notes above C. */
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11] as const;
/** Line of fifths, starting at F: tonic of the major key with `fifths = i - 1`. */
const FIFTHS_LINE: readonly Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];

const mod = (n: number, m: number): number => ((n % m) + m) % m;

function stepIndex(s: Step): number {
  return STEPS.indexOf(s);
}

/** Absolute diatonic position: octave * 7 + letter index. */
function diatonicPos(p: SpelledPitch): number {
  return p.octave * 7 + stepIndex(p.step);
}

/** MIDI number of the natural note at an absolute diatonic position. */
function naturalMidiAt(pos: number): number {
  const oct = Math.floor(pos / 7);
  return 12 * (oct + 1) + NATURAL_PC[mod(pos, 7)]!;
}

function asAlter(n: number): Alter | null {
  return n >= -2 && n <= 2 ? (n as Alter) : null;
}

/** MIDI number of a spelled pitch. C4 = 60. */
export const toMidi: TheoryApi['toMidi'] = (p) => 12 * (p.octave + 1) + NATURAL_PC[stepIndex(p.step)]! + p.alter;

/**
 * Transpose by a spelled interval. Throws RangeError if the result needs more than a double accidental
 * (03 §7.5 rule 3 treats that as a rejection; use `tryTransposePitch` to test without throwing).
 */
export const transposePitch: TheoryApi['transposePitch'] = (p, iv) => {
  const r = tryTransposePitch(p, iv);
  if (!r) throw new RangeError(`transposePitch: ${p.step}${p.octave} by (${iv.diatonic}, ${iv.chromatic}) needs a triple accidental`);
  return r;
};

/** Like `transposePitch` but returns null instead of throwing when the spelling would exceed a double accidental. */
export function tryTransposePitch(p: SpelledPitch, iv: Interval): SpelledPitch | null {
  const pos = diatonicPos(p) + iv.diatonic;
  const targetMidi = toMidi(p) + iv.chromatic;
  const alter = asAlter(targetMidi - naturalMidiAt(pos));
  if (alter === null) return null;
  return { step: STEPS[mod(pos, 7)]!, alter, octave: Math.floor(pos / 7) };
}

/** Tonic of a key as a spelled pitch in octave 4 (C4 base for the letter). */
export function tonicOf(k: KeySig): SpelledPitch {
  const n = k.mode === 'major' ? k.fifths : k.fifths + 3;
  return { step: FIFTHS_LINE[mod(n + 1, 7)]!, alter: Math.floor((n + 1) / 7) as Alter, octave: 4 };
}

/** Key from a tonic spelling. The result may lie outside -7..7 (more than 7 accidentals); see `isValidKey`. */
export function keyFromTonic(tonic: { step: Step; alter: number }, mode: 'major' | 'minor'): KeySig {
  const line = FIFTHS_LINE.indexOf(tonic.step);
  const major = line - 1 + 7 * tonic.alter;
  return { fifths: mode === 'major' ? major : major - 3, mode };
}

/** True when the key signature has at most 7 accidentals. */
export function isValidKey(k: KeySig): boolean {
  return Number.isInteger(k.fifths) && k.fifths >= -7 && k.fifths <= 7;
}

/**
 * Transpose a key signature by a spelled interval. A result needing more than 7 accidentals is returned as is
 * (fifths outside -7..7, check with `isValidKey`) so the caller can re-spell enharmonically (03 §7.5 rule 3).
 */
export const transposeKey: TheoryApi['transposeKey'] = (k, iv) => {
  const t = tryTransposePitch(tonicOf(k), iv);
  if (!t) {
    // Tonic would need a triple accidental: compute on the line of fifths directly.
    const base = tonicOf(k);
    const pos = diatonicPos(base) + iv.diatonic;
    const alter = toMidi(base) + iv.chromatic - naturalMidiAt(pos);
    return keyFromTonic({ step: STEPS[mod(pos, 7)]!, alter }, k.mode);
  }
  return keyFromTonic(t, k.mode);
};

/** The enharmonic key (same sounding tonic), e.g. C# major to Db major. Same mode. */
export function enharmonicKey(k: KeySig): KeySig {
  return { fifths: k.fifths > 0 ? k.fifths - 12 : k.fifths + 12, mode: k.mode };
}

/**
 * Spelled interval that takes the tonic of `from` to the tonic of `to`, rising when `chromaticShift >= 0` and
 * falling otherwise. `diatonic` is the letter distance in that direction, extended by 7 per octave (03 §7.4).
 * `chromaticShift` must agree with the two tonics modulo 12 (this is not checked).
 */
export const intervalBetweenKeys: TheoryApi['intervalBetweenKeys'] = (from, to, chromaticShift) => {
  const i0 = stepIndex(tonicOf(from).step);
  const i1 = stepIndex(tonicOf(to).step);
  if (chromaticShift >= 0) {
    const d = mod(i1 - i0, 7);
    const natural = naturalMidiAt(i0 + d) - naturalMidiAt(i0);
    const k = Math.round((chromaticShift - natural) / 12);
    return { diatonic: d + 7 * k, chromatic: chromaticShift };
  }
  const d = mod(i0 - i1, 7);
  const natural = naturalMidiAt(i0) - naturalMidiAt(i0 - d);
  const k = Math.round((-chromaticShift - natural) / 12);
  return { diatonic: -(d + 7 * k) || 0, chromatic: chromaticShift };
};

const SHARP_SPELL: readonly [Step, Alter][] = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
];
const FLAT_SPELL: readonly [Step, Alter][] = [
  ['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
];

/**
 * Ghost spelling (02 §4.8). Within 2 semitones of the target: the target's letter plus the accidental needed.
 * Otherwise spelled by the key signature: flats in flat keys, sharps in sharp keys (and in keys with none).
 */
export const spellGhost: TheoryApi['spellGhost'] = (playedWrittenMidi, target, key) => {
  if (Math.abs(playedWrittenMidi - toMidi(target)) <= 2) {
    const alter = asAlter(playedWrittenMidi - naturalMidiAt(diatonicPos(target)));
    if (alter !== null) return { step: target.step, alter, octave: target.octave };
  }
  const pc = mod(playedWrittenMidi, 12);
  const [step, alter] = (key.fifths < 0 ? FLAT_SPELL : SHARP_SPELL)[pc]!;
  return { step, alter, octave: Math.floor(playedWrittenMidi / 12) - 1 };
};

/** Fractional MIDI number of a frequency at the given A4 (Hz). */
export const freqToMidi: TheoryApi['freqToMidi'] = (hz, a4) => 69 + 12 * Math.log2(hz / a4);

/** Frequency of a (possibly fractional) MIDI number at the given A4 (Hz). */
export const midiToFreq: TheoryApi['midiToFreq'] = (midi, a4) => a4 * Math.pow(2, (midi - 69) / 12);
