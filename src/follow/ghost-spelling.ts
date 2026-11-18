/**
 * Ghost spelling for the live follower (02 §4.8): `theory.spellGhost` with the written key the player reads
 * (`FollowConfig.writtenKey`, PLAN ruling 44).
 */
import type { ExpectedNote, Instrument, KeySig, SpelledPitch } from '../core/types.ts';
import { spellGhost } from '../theory/index.ts';

/** Written spelling of a played concert pitch, against the target's letter when one is given (02 §4.8). */
export function ghostPitch(playedConcertMidi: number, target: ExpectedNote | null, key: KeySig, inst: Instrument): SpelledPitch {
  const written = Math.round(playedConcertMidi) + inst.writtenMinusSounding.chromatic;
  // No target: any reference more than 2 semitones away selects spellGhost's key-signature table. The C two
  // octaves above the played note's octave is always at least 13 semitones above it.
  if (target === null) return spellGhost(written, { step: 'C', alter: 0, octave: Math.floor(written / 12) + 1 }, key);
  return spellGhost(written, target.writtenPitch, key);
}
