// How a heard wrong note is spelled on the score (PLAN R71). Small and pure, so the review model can use it without
// pulling the overlay in.
import type { GhostNote } from '../core/types.ts';
import { spellInKey, toMidi } from '../theory/index.ts';

/**
 * A wrong note is drawn at the pitch sung, on that pitch's own letter when the key has it (PLAN R71): E3 sung as F3 in
 * C major is an F3, a step above the written E3, not an E♯3 on the same line (`spellGhost` spells a slip within a
 * semitone on the written letter). A pitch outside the key keeps the follower's spelling. Other kinds are unchanged.
 */
export function heardOnItsLetter(g: GhostNote, key: { fifths: number }): GhostNote {
  if (g.kind !== 'wrong-pitch') return { ...g };
  const own = spellInKey(toMidi(g.writtenPitch), key);
  return own ? { ...g, writtenPitch: own } : { ...g };
}
