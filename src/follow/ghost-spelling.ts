/**
 * Ghost spelling for the live follower (02 §4.8): `theory.spellGhost` with the written key.
 *
 * `FollowConfig` carries no written key, so the key signature's direction is recovered from the expected notes:
 * a note without an explicit accidental carries the key signature's alteration for its letter
 * (`ExpectedNote.explicitAccidental` is "the written alteration differs from the key signature"). Only the sign
 * matters to `spellGhost` (sharps for fifths ≥ 0, flats otherwise), so the count of distinct altered letters is
 * enough.
 */
import type { ExpectedNote, Instrument, KeySig, SpelledPitch } from '../core/types.ts';
import { spellGhost } from '../theory/index.ts';

/** Key signature implied by the expected notes' unaltered-by-accidental pitches. */
export function inferWrittenKey(expected: readonly ExpectedNote[]): KeySig {
  const sharps = new Set<string>();
  const flats = new Set<string>();
  for (const e of expected) {
    if (e.explicitAccidental) continue;
    if (e.writtenPitch.alter > 0) sharps.add(e.writtenPitch.step);
    else if (e.writtenPitch.alter < 0) flats.add(e.writtenPitch.step);
  }
  const fifths = sharps.size >= flats.size ? sharps.size : -flats.size;
  return { fifths, mode: 'major' };
}

/** Written spelling of a played concert pitch, against the target's letter when one is given (02 §4.8). */
export function ghostPitch(playedConcertMidi: number, target: ExpectedNote | null, key: KeySig, inst: Instrument): SpelledPitch {
  const written = Math.round(playedConcertMidi) + inst.writtenMinusSounding.chromatic;
  // No target: any reference more than 2 semitones away selects spellGhost's key-signature table. The C two
  // octaves above the played note's octave is always at least 13 semitones above it.
  if (target === null) return spellGhost(written, { step: 'C', alter: 0, octave: Math.floor(written / 12) + 1 }, key);
  return spellGhost(written, target.writtenPitch, key);
}
