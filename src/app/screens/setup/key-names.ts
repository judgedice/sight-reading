import type { Instrument, KeySig } from '../../../core/types.ts';

const LINE = ['F', 'C', 'G', 'D', 'A', 'E', 'B'] as const;
const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** Tonic name of a key on the line of fifths, for example "E♭" or "F♯". Double accidentals use two marks. */
export function tonicName(k: KeySig): string {
  const n = k.mode === 'major' ? k.fifths : k.fifths + 3;
  const letter = LINE[mod(n + 1, 7)]!;
  const alter = Math.floor((n + 1) / 7);
  const mark = alter > 0 ? '♯'.repeat(alter) : '♭'.repeat(-alter);
  return `${letter}${mark}`;
}

/** "E♭ major", "A minor". Mode words are the key-signature vocabulary, not UI copy. */
export function keyName(k: KeySig): string {
  return `${tonicName(k)} ${k.mode}`;
}

/** Concert key for a written key: written minus sounding is `chromatic` semitones, so fifths move by 7 per semitone. */
export function concertKey(k: KeySig, inst: Instrument): KeySig {
  const c = inst.writtenMinusSounding.chromatic;
  if (mod(c, 12) === 0) return { ...k };
  let f = mod(k.fifths - 7 * c + 5, 12) - 5; // -5..6
  if (f === 6 && k.fifths < 0) f = -6;
  return { fifths: f, mode: k.mode };
}

export const keyValue = (k: KeySig): string => `${k.fifths}:${k.mode}`;

export function parseKeyValue(v: string): KeySig | null {
  const [f, mode] = v.split(':');
  const fifths = Number(f);
  if (!Number.isInteger(fifths) || (mode !== 'major' && mode !== 'minor')) return null;
  return { fifths, mode };
}
