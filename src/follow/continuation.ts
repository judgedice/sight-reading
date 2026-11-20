/**
 * The live side of `consolidate.ts` (round 2 real voice, docs/redesign/round2/08-real-voice.md). The live follower
 * keeps a matched note's judgment open while the note goes on in pieces: a piece that starts where the last one ended,
 * at a pitch change, and that the final pass would join to the note, continues it. The rules are the final pass's,
 * read at the piece's note-on (its pitch is the confirming pitch and its length is not known yet):
 *
 * - the last piece was a fragment (shorter than `fragmentMs`): whatever follows gives the note its pitch;
 * - the same note: within `mergeCents` of the pitch so far or of the last piece;
 * - a scoop settling: the note so far is shorter than a long scoop and the piece lies within `scoopMaxCents` of the
 *   last one, above it or on the written pitch;
 * - a glitch: `glitchSemitones` or more from the last piece (it is dropped again if it sounds past `glitchMs`), or the
 *   pitch coming back after one.
 *
 * Never when the piece starts nearer another written note and inside its match window (the next written note, sung
 * legato), and never when the last piece sings the written note and this one does not (that note, sung short). Off without a `grading.detection.oneNote` row.
 */
import type { DetectedNote, ExpectedNote, FollowConfig } from '../core/types.ts';
import { inWindow, meets, nearestWritten, oneNoteLimits, pitchMatches, realVoiceRow, singsWritten } from './consolidate.ts';
import { scoreSecondsOf } from './cost.ts';

const MS = 1000;

/** True when the take has the real-voice tolerances: the live follower then keeps a matched note open in pieces. */
export const chainsOn = (c: FollowConfig): boolean => realVoiceRow(c) !== null;

/** The open note of the live follower: its last piece, the piece that gives the pitch, and whether a piece sounds. */
export interface NoteChain {
  /** Onset of the matched note, the chain's first piece (input clock). */
  onset: number;
  last: DetectedNote;
  src: DetectedNote;
  sounding: boolean;
}

/** Sounded length of a piece so far, seconds. */
const soundedSec = (d: DetectedNote, c: FollowConfig): number =>
  d.offset !== null ? (d.offset as number) - (d.onset as number) : (d.steadyMs + c.cfg.grading.intonation.attackExcludeMsByFamily[c.instrument.family]) / MS;

/**
 * `d` (score second `s`) continues the chain of the note matched to written note `idx`. `ch.last` has ended (a piece
 * starts only after the previous one's note-off).
 */
export function continuesChain(c: FollowConfig, ch: NoteChain, idx: number, d: DetectedNote, s: number): boolean {
  const one = realVoiceRow(c);
  if (!one || !meets(ch.last, d)) return false;
  const last = ch.last;
  const m = d.provisionalMidi;
  const near = nearestWritten(c, s);
  const next = near !== idx && inWindow(c, near, s);
  // A reading far from the note that is not the next written pitch (its pitch class, for voice an octave off is that
  // note, R7) is a glitch until it lasts (`glitchOf`), and the
  // pitch coming back after one is the same note, even near the next written onset (`consolidate.ts`, rule 1).
  if (Math.abs(m - last.midi) >= one.glitchSemitones) return !(next && singsWritten(c, near, s, m));
  const back = Math.abs(last.midi - ch.src.midi) >= one.glitchSemitones && Math.abs(m - ch.src.midi) * 100 < one.mergeCents;
  if (back) return !(next && singsWritten(c, near, s, m));
  if (next) return false;
  const lim = oneNoteLimits(c, one, idx);
  const cents = (a: number, b: number): number => Math.abs(a - b) * 100;
  if (cents(m, ch.src.midi) < one.mergeCents || cents(m, last.midi) < one.mergeCents) return true;
  // A short last piece that sings the written note is that note, sung short, when the next piece does not (as the
  // final pass keeps it).
  const target = (c.expected[idx] as ExpectedNote).concertMidi;
  if (singsWritten(c, idx, scoreSecondsOf(last.onset, c.t0, c.latencyCompensationSec), last.midi) && !pitchMatches(c, m, target, false)) return false;
  if (soundedSec(last, c) < lim.fragmentSec) return true;
  const age = ((last.offset ?? last.onset) as number) - ch.onset;
  return cents(m, last.midi) <= one.scoopMaxCents && age < lim.scoopSec && (m > last.midi || singsWritten(c, idx, s, m));
}

/**
 * Whether `d`, a piece of the chain, is a glitch: 'no' within `glitchSemitones` of the pitch so far; 'maybe' farther
 * but shorter than `glitchMs` so far; 'not-a-glitch' farther and longer (a note of its own).
 */
export function glitchOf(c: FollowConfig, ch: NoteChain, d: DetectedNote): 'no' | 'maybe' | 'not-a-glitch' {
  const one = realVoiceRow(c);
  if (!one || d.id === ch.src.id || Math.abs(d.midi - ch.src.midi) < one.glitchSemitones) return 'no';
  return soundedSec(d, c) < one.glitchMs / MS ? 'maybe' : 'not-a-glitch';
}

/** Voice (`oneNote`): a wrong pitch is not shown live while the note is younger than a long scoop. */
export function wrongHeldWhileYoung(c: FollowConfig, ageSec: number): boolean {
  const one = realVoiceRow(c);
  return !!one && ageSec < one.longScoopMs / MS;
}
