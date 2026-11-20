/**
 * What the follower does not count as the player's (round 2 detection, docs/redesign/round2/03-detection.md).
 *
 * - Before the music: a note that starts before `FollowConfig.judgeFromScoreSec` (the first written note's onset minus
 *   its match window) is not judged, not drawn and not an extra. On speakers the mic hears the voice starting-pitch
 *   reference and the count-in; a singer may also hum or breathe before bar 1.
 * - The app's own sounds (`FollowConfig.ownPlayback`): a note that starts inside a tone (plus the room tail) at the
 *   tone's pitch class is the tone. A note that starts at a click is the click unless it sounds longer than
 *   `clickMaxMs`; it can still match a written note (a sung note on the beat starts at a click too).
 *
 * Every threshold is in `grading.detection.ownPlayback`.
 */
import type { DetectedNote, ExpectedNote, FollowConfig, OwnSound, ResolvedTolerance } from '../core/types.ts';
import { scoreSecondsOf } from './cost.ts';

const MS = 1000;

/** The 12-tone pitch-class distance between two fractional MIDI values, cents. */
function pcDistanceCents(a: number, b: number): number {
  const d = (((a - b) % 12) + 12) % 12;
  return Math.min(d, 12 - d) * 100;
}

const A4_HZ = 440;
const hzToMidi = (hz: number, a4: number): number => 69 + 12 * Math.log2(hz / a4);

/** Score seconds of a detected note's onset. */
const onsetScoreSec = (c: FollowConfig, d: DetectedNote): number => scoreSecondsOf(d.onset, c.t0, c.latencyCompensationSec);

/** The own sound a note starting at score second `s` falls in, or null. */
function soundAt(c: FollowConfig, s: number): OwnSound | null {
  const own = c.ownPlayback;
  if (!own || own.length === 0) return null;
  const tail = c.cfg.grading.detection.ownPlayback.tailMs / MS;
  for (const o of own) {
    const from = (o.t as number) - (c.t0 as number);
    if (s >= from && s <= from + o.durSec + tail) return o;
  }
  return null;
}

/** True when the note is never the player's: it starts before the music, or it is one of the app's tones. */
export function ignoredNote(c: FollowConfig, d: DetectedNote): boolean {
  const s = onsetScoreSec(c, d);
  if (c.judgeFromScoreSec !== undefined && s < c.judgeFromScoreSec) return true;
  const o = soundAt(c, s);
  if (!o || o.hz === null) return false;
  // A4 = 440 Hz here: a tuning pitch of 415 to 466 Hz moves both sides alike, and 442 Hz is 8 c (within toneCents).
  return pcDistanceCents(d.provisionalMidi, hzToMidi(o.hz, A4_HZ)) <= c.cfg.grading.detection.ownPlayback.toneCents;
}

/** True when an unmatched note starts at a click: it is drawn or counted as an extra only past `clickMaxMs`. */
export function atClick(c: FollowConfig, d: DetectedNote): boolean {
  const o = soundAt(c, onsetScoreSec(c, d));
  return o !== null && o.hz === null;
}

/**
 * Shortest sounding time, ms, for an unmatched note to be drawn or counted as an extra: 02 §4.1's `extraMinDurMs`,
 * the profile's `oneNote.extraMinMs` (voice: a breath, a consonant or a scoop fragment is not a note), longer at a
 * click, and `oneNote.absorbMs` when `absorbed` (the note re-articulates the note before it at the same pitch class).
 */
export function extraMinMs(c: FollowConfig, d: DetectedNote, absorbed = false): number {
  let ms = c.cfg.grading.credit.extraMinDurMs;
  const one = c.oneNote ?? null;
  if (one) ms = Math.max(ms, one.extraMinMs);
  if (atClick(c, d)) ms = Math.max(ms, c.cfg.grading.detection.ownPlayback.clickMaxMs);
  if (one && absorbed) ms = Math.max(ms, one.absorbMs);
  return ms;
}

/**
 * True when `d` starts within `oneNote.absorbGapMs` of the end of `prev` (or while it sounds) at the same pitch class
 * (within `intonation.wrongPitchAboveCents`, the same semitone): a short note there is `prev` sung on, not a new note
 * (round 2 detection).
 */
export function absorbedBy(c: FollowConfig, d: DetectedNote, prev: DetectedNote | null): boolean {
  const one = c.oneNote ?? null;
  if (!one || !prev) return false;
  const end = prev.offset ?? Infinity;
  if ((d.onset as number) - (end as number) > one.absorbGapMs / MS) return false;
  return pcDistanceCents(d.provisionalMidi, prev.midi) <= c.cfg.grading.intonation.wrongPitchAboveCents;
}

/** True when the take shows no wrong pitch at confirmation (`oneNote.wrongAtConfirm` false: a scoop is not a wrong note). */
export function holdWrongAtConfirm(c: FollowConfig): boolean {
  return c.oneNote?.wrongAtConfirm === false;
}

/** The detected notes the follower and the final alignment may use. */
export function playerNotes(c: FollowConfig, detected: readonly DetectedNote[]): DetectedNote[] {
  return detected.filter((d) => !ignoredNote(c, d));
}

/** Score second from which notes count: the earliest written onset minus its match window (-Infinity without notes). */
export function judgeFromScoreSec(expected: readonly ExpectedNote[], tolerances: readonly ResolvedTolerance[]): number {
  let from = Infinity;
  expected.forEach((e, i) => {
    const w = (tolerances[i] as ResolvedTolerance | undefined)?.matchWindowSec ?? 0;
    from = Math.min(from, (e.onsetSec as number) - w);
  });
  return Number.isFinite(from) ? from : -Infinity;
}

/** The follow config with the music's start (`judgeFromScoreSec`) and the app's own sounds around the take. */
export function withOwnPlayback(c: FollowConfig, sounds: readonly OwnSound[]): FollowConfig {
  const from = judgeFromScoreSec(c.expected, c.tolerances);
  return { ...c, ...(Number.isFinite(from) ? { judgeFromScoreSec: from } : {}), ownPlayback: sounds.map((o) => ({ ...o })) };
}
