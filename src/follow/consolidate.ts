/**
 * One sung note is one note, after the fact (round 2 real voice, docs/redesign/round2/08-real-voice.md).
 *
 * The first real traces (an untrained baritone on a laptop's built-in mic) showed the segmenter splitting one sung
 * note in ways the synthetic voice never did. The segmenter decides live, a frame at a time, and cannot take back a
 * note it has started without delaying every note-on (the 1024-window latency budget has 3 ms to spare). This pass
 * joins the pieces again on the finished note list, before the final alignment and before the try is stored. Every
 * rule needs two notes that meet at a pitch change (the second starts where the first ends, `onsetCause`
 * 'pitch-change'): a breath, a re-articulation or a rest between them always keeps them apart.
 *
 * 1. Glitch (`glitchMs`, `glitchSemitones`): a short note `glitchSemitones` or more from every neighbour it meets is a
 *    subharmonic or creak reading (the real voice dropped 11 to 15 semitones for 160 ms in a held note). It is not a
 *    note: its time goes to the note after it (or the note before, at the end of a note).
 * 2. Fragment (`fragmentMs`): a note shorter than this that meets a neighbour is part of the neighbour nearer in pitch
 *    (a falling end, a dip under the next note, the top of an overshoot).
 * 3. Long scoop (`longScoopMs`, `scoopMaxCents`): a note shorter than `longScoopMs` that runs into a longer note within
 *    `scoopMaxCents` is that note's scoop: the joined note starts where the sound starts and has the settled pitch.
 * 4. Same note (`mergeCents`): two notes that meet within `mergeCents` of each other are one note.
 *
 * Written notes keep real notes apart (the written onsets, as the segmenter's scoop rule uses them, and the written
 * pitches, which the follower has):
 * - Rules 3 and 4 never join two notes whose onsets lie nearest different written notes, when the second is within
 *   that written note's match window: that is the singer moving on to the next written note (legato).
 * - Rules 1 to 3 never absorb a short note that sings the written note nearest it (rule 1: the exact pitch; rules 2
 *   and 3: the pitch class for voice, octave-equivalent as R7) into a neighbour that does not.
 * So the pass can only join what the score cannot tell apart; a wrong note held as a note stays a wrong note.
 *
 * Off (the list is returned as it is) for profiles without a `grading.detection.oneNote` row. Idempotent: the result
 * of a pass is a fixed point.
 */
import type { DetectedNote, ExpectedNote, FollowConfig, OneNoteTolerance, ResolvedTolerance } from '../core/types.ts';
import { scoreSecondsOf } from './cost.ts';

const MS = 1000;
/** Two notes meet when the second starts within this of the first one's end, seconds. */
const TOUCH_SEC = 0.012;
/**
 * The rule lengths are capped at these fractions of the shortest inter-onset interval around the nearest written note,
 * so a fast written note is never short enough to be a fragment, a glitch or a scoop.
 */
const FRAGMENT_IOI_FRAC = 0.5;
const GLITCH_IOI_FRAC = 0.75;
const SCOOP_IOI_FRAC = 0.75;
/** Passes over the list; each joins at least one pair, and a take rarely needs more than three. */
const MAX_PASSES = 64;

interface Item {
  d: DetectedNote;
  /** Onset, score seconds. */
  s: number;
  /** Written note nearest the onset. */
  own: number;
}

const durSec = (d: DetectedNote): number => (d.offset === null ? Infinity : (d.offset as number) - (d.onset as number));

/** The second note starts where the first ends, at a pitch change. */
const meets = (a: DetectedNote, b: DetectedNote): boolean =>
  b.onsetCause === 'pitch-change' && a.offset !== null && Math.abs((b.onset as number) - (a.offset as number)) <= TOUCH_SEC;

/** Joins the pieces of one sung note (see the file header). Notes in, notes out, sorted by onset. */
export function consolidateNotes(c: FollowConfig, notes: readonly DetectedNote[]): DetectedNote[] {
  const one = c.oneNote ?? null;
  const sorted = [...notes].sort((a, b) => a.onset - b.onset || a.id - b.id);
  if (!one || c.expected.length === 0) return sorted;
  const items = sorted.map((d) => item(c, d));
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if (!(glitchPass(c, one, items) || fragmentPass(c, one, items) || pairPass(c, one, items))) break;
  }
  return items.map((x) => x.d);
}

function item(c: FollowConfig, d: DetectedNote): Item {
  const s = scoreSecondsOf(d.onset, c.t0, c.latencyCompensationSec);
  let own = 0;
  let best = Infinity;
  for (const e of c.expected) {
    const dt = Math.abs((e.onsetSec as number) - s);
    if (dt < best) {
      best = dt;
      own = e.idx;
    }
  }
  return { d, s, own };
}

/** Shortest inter-onset interval around written note `i`, seconds (Infinity for a lone note). */
function localIoi(c: FollowConfig, i: number): number {
  const e = c.expected[i] as ExpectedNote;
  return Math.min(e.ioiPrevSec ?? Infinity, e.ioiNextSec ?? Infinity);
}

/** `x` sings the written note nearest it: within its match window, at its pitch (class, for voice). */
function singsOwn(c: FollowConfig, x: Item, exact = false): boolean {
  const e = c.expected[x.own] as ExpectedNote;
  const tol = c.tolerances[x.own] as ResolvedTolerance;
  if (Math.abs(x.s - (e.onsetSec as number)) > tol.matchWindowSec) return false;
  return pitchMatches(c, x.d.midi, e.concertMidi, exact);
}

function pitchMatches(c: FollowConfig, midi: number, target: number, exact: boolean): boolean {
  let d = midi - target;
  if (!exact && c.instrument.relativePitch) d -= 12 * Math.round(d / 12);
  return Math.abs(d) * 100 <= c.cfg.grading.intonation.wrongPitchAboveCents;
}

/** `b` (after `a`) is plausibly the singer moving on to the next written note: never join them as one note. */
function writtenApart(c: FollowConfig, a: Item, b: Item): boolean {
  if (a.own === b.own) return false;
  const e = c.expected[b.own] as ExpectedNote;
  return Math.abs(b.s - (e.onsetSec as number)) <= (c.tolerances[b.own] as ResolvedTolerance).matchWindowSec;
}

/**
 * `into` takes `from`'s time. `into` keeps its id and pitch; the onset is the earlier one (with its cause) and the
 * offset the later one. `sameNote`: both were steady at one pitch, so the steady time adds up.
 */
function join(c: FollowConfig, items: Item[], from: number, into: number, sameNote = false): void {
  const a = items[from] as Item;
  const b = items[into] as Item;
  const first = a.d.onset <= b.d.onset ? a : b;
  const last = a.d.offset === null || (b.d.offset !== null && a.d.offset > b.d.offset) ? a : b;
  const d: DetectedNote = {
    ...b.d,
    onset: first.d.onset,
    offset: last.d.offset,
    onsetCause: first.d.onsetCause,
    steadyMs: sameNote ? b.d.steadyMs + a.d.steadyMs : b.d.steadyMs,
  };
  items[into] = item(c, d);
  items.splice(from, 1);
}

/** Rule 1. Returns true when it changed the list. */
function glitchPass(c: FollowConfig, one: OneNoteTolerance, items: Item[]): boolean {
  for (let k = 0; k < items.length; k++) {
    const x = items[k] as Item;
    const max = Math.min(one.glitchMs / MS, GLITCH_IOI_FRAC * localIoi(c, x.own));
    if (durSec(x.d) >= max) continue;
    const p = k > 0 && meets((items[k - 1] as Item).d, x.d) ? (items[k - 1] as Item) : null;
    const n = k + 1 < items.length && meets(x.d, (items[k + 1] as Item).d) ? (items[k + 1] as Item) : null;
    if (!p && !n) continue;
    const far = (y: Item | null): boolean => !y || Math.abs(y.d.midi - x.d.midi) >= one.glitchSemitones;
    if (!far(p) || !far(n) || singsOwn(c, x, true)) continue;
    join(c, items, k, n ? k + 1 : k - 1);
    return true;
  }
  return false;
}

/** Rule 2. */
function fragmentPass(c: FollowConfig, one: OneNoteTolerance, items: Item[]): boolean {
  for (let k = 0; k < items.length; k++) {
    const x = items[k] as Item;
    const max = Math.min(one.fragmentMs / MS, FRAGMENT_IOI_FRAC * localIoi(c, x.own));
    if (durSec(x.d) >= max) continue;
    const p = k > 0 && meets((items[k - 1] as Item).d, x.d) ? k - 1 : -1;
    const n = k + 1 < items.length && meets(x.d, (items[k + 1] as Item).d) ? k + 1 : -1;
    const dist = (j: number): number => (j < 0 ? Infinity : Math.abs((items[j] as Item).d.midi - x.d.midi));
    const into = dist(p) <= dist(n) ? p : n;
    if (into < 0) continue;
    if (singsOwn(c, x) && !pitchMatches(c, (items[into] as Item).d.midi, (c.expected[x.own] as ExpectedNote).concertMidi, false)) continue;
    join(c, items, k, into);
    return true;
  }
  return false;
}

/** Rules 3 and 4. */
function pairPass(c: FollowConfig, one: OneNoteTolerance, items: Item[]): boolean {
  for (let k = 0; k + 1 < items.length; k++) {
    const a = items[k] as Item;
    const b = items[k + 1] as Item;
    if (!meets(a.d, b.d) || writtenApart(c, a, b)) continue;
    const cents = Math.abs(a.d.midi - b.d.midi) * 100;
    if (cents < one.mergeCents) {
      // The longer piece gives the pitch.
      const aLonger = durSec(a.d) > durSec(b.d);
      join(c, items, aLonger ? k + 1 : k, aLonger ? k : k + 1, true);
      return true;
    }
    const scoopMax = Math.min(one.longScoopMs / MS, SCOOP_IOI_FRAC * localIoi(c, a.own));
    if (cents <= one.scoopMaxCents && durSec(a.d) < scoopMax && durSec(b.d) > durSec(a.d)) {
      // A scoop that sings the written note while the note it runs into does not is that written note, sung short.
      if (singsOwn(c, a) && !pitchMatches(c, b.d.midi, (c.expected[a.own] as ExpectedNote).concertMidi, false)) continue;
      join(c, items, k, k + 1);
      return true;
    }
  }
  return false;
}
