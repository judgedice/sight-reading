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
 * 1. Glitch (`glitchMs`, `glitchSemitones`): a short note `glitchSemitones` or more from every neighbour it meets, one
 *    of them longer than `glitchMs`, is a subharmonic or creak reading (the real voice dropped 11 to 15 semitones for 160 ms in a held note). It is not a
 *    note: its time goes to the note after it (or the note before, at the end of a note).
 * 2. Fragment (`fragmentMs`): a note shorter than this that meets a neighbour is part of the neighbour nearer in pitch
 *    (a falling end, a dip under the next note, the top of an overshoot). One that starts on time at the next written
 *    note is that note's attack and never joins the note before it.
 * 3. Long scoop (`longScoopMs`, `scoopMaxCents`): a note shorter than `longScoopMs` that runs into a longer note within
 *    `scoopMaxCents` is that note's scoop: the joined note starts where the sound starts and has the settled pitch. A
 *    scoop comes from below, or from above when the longer note settles on the written pitch (an overshoot).
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
/** Passes over the list; each joins at least one pair, and a take rarely needs more than three. */
const MAX_PASSES = 64;

interface Item {
  d: DetectedNote;
  /** Onset, score seconds. */
  s: number;
  /** Written note nearest the onset. */
  own: number;
  /** Time the note was sung at its own pitches, seconds: its length less any glitch it took in. */
  sung: number;
}

const spanSec = (d: DetectedNote): number => (d.offset === null ? Infinity : (d.offset as number) - (d.onset as number));

/** The second note starts where the first ends, at a pitch change. */
export const meets = (a: DetectedNote, b: DetectedNote): boolean =>
  b.onsetCause === 'pitch-change' && a.offset !== null && Math.abs((b.onset as number) - (a.offset as number)) <= TOUCH_SEC;

/**
 * The take's one-note row, when it has the real-voice tolerances (a row stored by a build before them, as in an old
 * diagnostics trace, turns this pass and the live chains off), or null.
 */
export function realVoiceRow(c: FollowConfig): OneNoteTolerance | null {
  const one = c.oneNote ?? null;
  if (!one) return null;
  const xs = [one.glitchMs, one.glitchSemitones, one.fragmentMs, one.longScoopMs, one.scoopMaxCents, one.mergeCents, one.fragmentIoiFrac, one.glitchIoiFrac, one.scoopIoiFrac];
  return xs.every((x) => Number.isFinite(x)) ? one : null;
}

/** Joins the pieces of one sung note (see the file header). Notes in, notes out, sorted by onset. */
export function consolidateNotes(c: FollowConfig, notes: readonly DetectedNote[]): DetectedNote[] {
  const one = realVoiceRow(c);
  const sorted = [...notes].sort((a, b) => a.onset - b.onset || a.id - b.id);
  if (!one || c.expected.length === 0) return sorted;
  const items = sorted.map((d) => item(c, d, spanSec(d)));
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if (!(glitchPass(c, one, items) || fragmentPass(c, one, items) || pairPass(c, one, items))) break;
  }
  return items.map((x) => x.d);
}

function item(c: FollowConfig, d: DetectedNote, sung: number): Item {
  const s = scoreSecondsOf(d.onset, c.t0, c.latencyCompensationSec);
  return { d, s, own: nearestWritten(c, s), sung };
}

/** The written note whose onset is nearest score second `s`. */
export function nearestWritten(c: FollowConfig, s: number): number {
  let own = 0;
  let best = Infinity;
  for (const e of c.expected) {
    const dt = Math.abs((e.onsetSec as number) - s);
    if (dt < best) {
      best = dt;
      own = e.idx;
    }
  }
  return own;
}

/** Shortest inter-onset interval around written note `i`, seconds (Infinity for a lone note). */
function localIoi(c: FollowConfig, i: number): number {
  const e = c.expected[i] as ExpectedNote;
  return Math.min(e.ioiPrevSec ?? Infinity, e.ioiNextSec ?? Infinity);
}

/** The rule lengths around written note `i`, seconds: the tolerances, capped by the written rhythm there. */
export function oneNoteLimits(c: FollowConfig, one: OneNoteTolerance, i: number): { glitchSec: number; fragmentSec: number; scoopSec: number } {
  const ioi = localIoi(c, i);
  return {
    glitchSec: Math.min(one.glitchMs / MS, one.glitchIoiFrac * ioi),
    fragmentSec: Math.min(one.fragmentMs / MS, one.fragmentIoiFrac * ioi),
    scoopSec: Math.min(one.longScoopMs / MS, one.scoopIoiFrac * ioi),
  };
}

/** A note at score second `s` with pitch `midi` sings written note `i`: within its match window, at its pitch. */
export function singsWritten(c: FollowConfig, i: number, s: number, midi: number, exact = false): boolean {
  return inWindow(c, i, s) && pitchMatches(c, midi, (c.expected[i] as ExpectedNote).concertMidi, exact);
}

/** `x` sings the written note nearest it (the pitch class for voice, R7, unless `exact`). */
const singsOwn = (c: FollowConfig, x: Item, exact = false): boolean => singsWritten(c, x.own, x.s, x.d.midi, exact);

/** Within `wrongPitchAboveCents` of `target` (octave-equivalent for voice, R7, unless `exact`). */
export function pitchMatches(c: FollowConfig, midi: number, target: number, exact: boolean): boolean {
  let d = midi - target;
  if (!exact && c.instrument.relativePitch) d -= 12 * Math.round(d / 12);
  return Math.abs(d) * 100 <= c.cfg.grading.intonation.wrongPitchAboveCents;
}

/** A note at score second `s` lies within the match window of written note `i`. */
export function inWindow(c: FollowConfig, i: number, s: number): boolean {
  return Math.abs(s - ((c.expected[i] as ExpectedNote).onsetSec as number)) <= (c.tolerances[i] as ResolvedTolerance).matchWindowSec;
}

/** A short `x` sings its written note and `y`, the note it would join, does not: `x` is that written note, sung short. */
const writtenShort = (c: FollowConfig, x: Item, y: Item): boolean =>
  singsOwn(c, x) && !pitchMatches(c, y.d.midi, (c.expected[x.own] as ExpectedNote).concertMidi, false);

/** `b` (after `a`) is plausibly the singer moving on to the next written note: never join them as one note. */
const writtenApart = (c: FollowConfig, a: Item, b: Item): boolean => a.own !== b.own && inWindow(c, b.own, b.s);

/**
 * `into` takes `from`'s time. `into` gives the pitch; the id is the first piece's; the onset is the earlier one (with its cause) and the
 * offset the later one. `sameNote`: both were steady at one pitch, so the steady time adds up. A glitch adds no sung
 * time.
 */
function join(c: FollowConfig, items: Item[], from: number, into: number, how: 'glitch' | 'part' | 'same'): void {
  const a = items[from] as Item;
  const b = items[into] as Item;
  const first = a.d.onset <= b.d.onset ? a : b;
  const last = a.d.offset === null || (b.d.offset !== null && a.d.offset > b.d.offset) ? a : b;
  const d: DetectedNote = {
    ...b.d,
    // The joined note is known by its first piece (the one the live follower matched at its onset).
    id: first.d.id,
    onset: first.d.onset,
    offset: last.d.offset,
    onsetCause: first.d.onsetCause,
    steadyMs: how === 'same' ? b.d.steadyMs + a.d.steadyMs : b.d.steadyMs,
  };
  items[into] = item(c, d, how === 'glitch' ? b.sung : b.sung + a.sung);
  items.splice(from, 1);
}

/** Neighbours of `items[k]` that meet it (index, or -1). */
function neighbours(items: readonly Item[], k: number): { p: number; n: number } {
  const x = (items[k] as Item).d;
  const p = k > 0 && meets((items[k - 1] as Item).d, x) ? k - 1 : -1;
  const n = k + 1 < items.length && meets(x, (items[k + 1] as Item).d) ? k + 1 : -1;
  return { p, n };
}

/**
 * Rule 1, glitch, and the excursion that comes back: a note shorter than a long scoop between two notes that meet it
 * and lie within `mergeCents` of each other, itself `mergeCents` or more from them, is a wobble of that one note (the
 * real voice rose a semitone for 270 ms in a held C4 and came back). Returns true when it changed the list.
 *
 * A note interrupted this way is one note even when the pitch comes back near the next written onset: the reading in
 * between is the tracker's or the voice's, not the singer moving on. The exception is a return that sings that next
 * written note.
 */
function glitchPass(c: FollowConfig, one: OneNoteTolerance, items: Item[]): boolean {
  for (let k = 0; k < items.length; k++) {
    const x = items[k] as Item;
    const { p, n } = neighbours(items, k);
    if (p < 0 && n < 0) continue;
    const P = p < 0 ? null : (items[p] as Item);
    const N = n < 0 ? null : (items[n] as Item);
    const lim = oneNoteLimits(c, one, x.own);
    // The two sides of `x` are one note that `x` interrupts.
    const oneNote = !!P && !!N && Math.abs(P.d.midi - N.d.midi) * 100 < one.mergeCents && !(writtenApart(c, P, N) && singsOwn(c, N));
    if (x.sung < lim.glitchSec) {
      const far = (y: Item | null): boolean => !y || Math.abs(y.d.midi - x.d.midi) >= one.glitchSemitones;
      // A glitch interrupts a note: at least one neighbour it meets is longer than a glitch (two short notes far apart
      // are left to the fragment rule, which keeps the one nearer the note they meet).
      const long = (y: Item | null): boolean => !!y && y.sung >= one.glitchMs / MS;
      if (far(P) && far(N) && (long(P) || long(N)) && !singsOwn(c, x, true)) {
        if (oneNote) bridge(c, items, k, 'glitch');
        else join(c, items, k, n >= 0 ? n : p, 'glitch');
        return true;
      }
    }
    if (!P || !N || !(x.sung < lim.scoopSec) || !oneNote) continue;
    const away = Math.abs(x.d.midi - P.d.midi) * 100 >= one.mergeCents && Math.abs(x.d.midi - N.d.midi) * 100 >= one.mergeCents;
    if (!away || x.sung >= Math.min(P.sung, N.sung) || writtenApart(c, P, x) || singsOwn(c, x)) continue;
    bridge(c, items, k, 'part');
    return true;
  }
  return false;
}

/** `items[k]` and the notes on both sides of it become one note; the longer side gives the pitch, the first the id. */
function bridge(c: FollowConfig, items: Item[], k: number, how: 'glitch' | 'part'): void {
  const P = items[k - 1] as Item;
  const N = items[k + 1] as Item;
  if (N.sung > P.sung) {
    join(c, items, k, k + 1, how); // x into N (now at k)
    join(c, items, k - 1, k, 'same'); // P into N (now at k)
  } else {
    join(c, items, k, k - 1, how); // x into P
    join(c, items, k, k - 1, 'same'); // N (now at k) into P
  }
}

/** Rule 2. */
function fragmentPass(c: FollowConfig, one: OneNoteTolerance, items: Item[]): boolean {
  for (let k = 0; k < items.length; k++) {
    const x = items[k] as Item;
    if (x.sung >= oneNoteLimits(c, one, x.own).fragmentSec) continue;
    const nb = neighbours(items, k);
    // A fragment that starts on time (within tGood) at another written note than the note before it is that written
    // note's attack: it may join the note after it, never the one before.
    const p = nb.p >= 0 && writtenApart(c, items[nb.p] as Item, x) && Math.abs(x.s - ((c.expected[x.own] as ExpectedNote).onsetSec as number)) <= (c.tolerances[x.own] as ResolvedTolerance).tGoodSec ? -1 : nb.p;
    const n = nb.n;
    const dist = (j: number): number => (j < 0 ? Infinity : Math.abs((items[j] as Item).d.midi - x.d.midi));
    const into = dist(p) <= dist(n) ? p : n;
    if (into < 0 || writtenShort(c, x, items[into] as Item)) continue;
    join(c, items, k, into, 'part');
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
      const aLonger = a.sung > b.sung;
      join(c, items, aLonger ? k + 1 : k, aLonger ? k : k + 1, 'same');
      return true;
    }
    if (cents > one.scoopMaxCents || a.sung >= oneNoteLimits(c, one, a.own).scoopSec || b.sung <= a.sung || writtenShort(c, a, b)) continue;
    // A scoop comes from below, or overshoots and settles on the written pitch. A held pitch that falls to another,
    // neither of them written, is left as the detector heard it.
    if (a.d.midi > b.d.midi && !singsOwn(c, b)) continue;
    join(c, items, k, k + 1, 'part');
    return true;
  }
  return false;
}
