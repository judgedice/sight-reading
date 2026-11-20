/**
 * "Hear what we heard" (round 2, 01-ux.md §5.3): a pure plan that re-synthesises a try's detected notes at their
 * onsets and pitches, with the bars they fall in. No audio is stored (PLAN 9): this plays what the app detected, in
 * the instrument's sound, so a player can hear why a mark is where it is.
 *
 * Time: the try's detected notes are on the take's input clock. `scoreZeroClock` is the clock time of bar 1 beat 1
 * as heard (the take's `t0` plus the latency compensation), so `onset - scoreZeroClock` is score seconds, the same
 * scale as `ExpectedNote.onsetSec` and `ExtraNote.onsetSec`. Every time in the plan is seconds from its origin, the
 * first note played; the session adds the backend's clock when it schedules.
 */
import type { DetectedNote, ExtraNote, NoteJudgment } from '../core/types.ts';
import { midiToFreq } from '../theory/index.ts';
import type { ListenBar } from './listen-plan.ts';
import { barOfBeat } from './take-plan.ts';

/** Fixed values of the re-synthesis. */
export const HEARD = {
  /** A note shorter than this still sounds this long, seconds (a click of sound is not heard as a pitch). */
  minNoteSec: 0.12,
  /** A note held longer than this is cut here, seconds. */
  maxNoteSec: 4,
  /** Notes starting this many beats before the music's first beat (pickup included) are not the player's. */
  beforeMusicBeats: 1,
} as const;

/** What the plan needs from a detected note. */
export type HeardNoteIn = Pick<DetectedNote, 'onset' | 'offset' | 'midi' | 'steadyMs'> & Partial<Pick<DetectedNote, 'id'>>;

export interface HeardFacts {
  detected: readonly HeardNoteIn[];
  /** Clock time of score second 0 (bar 1 beat 1 as heard), seconds. */
  scoreZeroClock: number;
  /** The try's tempo, metronome beats per minute. */
  bpm: number;
  beatsPerBar: number;
  /** Length of the pickup, metronome beats (0 without one). */
  pickupBeats: number;
  /** Displayed bars, pickup excluded (the "of" in "bar {n} of {total}"). */
  totalBars: number;
  a4Hz: number;
}

export interface HeardNote {
  /** The detected note's id, when the input had one (the sounding-note highlight finds its written note by it). */
  id?: number;
  /** Fractional concert MIDI as detected. */
  midi: number;
  hz: number;
  /** Displayed bar the note starts in. */
  bar: number;
  startSec: number;
  durSec: number;
}

export interface HeardPlan {
  notes: HeardNote[];
  /** The bars from the first note's to the last note's, on the plan's timeline (the first may start before 0). */
  bars: ListenBar[];
  totalBars: number;
  /** Seconds from the origin to the end of the last note. */
  endSec: number;
}

const EPS = 1e-9;

/** Seconds a detected note sounds: its offset, else its steady time, inside HEARD's limits. */
function heardDurSec(d: HeardNoteIn): number {
  const raw = d.offset !== null ? (d.offset as number) - (d.onset as number) : d.steadyMs / 1000;
  return Math.min(HEARD.maxNoteSec, Math.max(HEARD.minNoteSec, raw));
}

/** The re-synthesis of a try's detected notes (sorted by onset). Notes before the music are left out. */
export function planHeard(f: HeardFacts): HeardPlan {
  if (!(f.bpm > 0)) throw new RangeError(`bpm must be positive, got ${f.bpm}`);
  const beatSec = 60 / f.bpm;
  const bpb = f.beatsPerBar;
  const hasPickup = f.pickupBeats > EPS;
  const fromBeat = -f.pickupBeats - HEARD.beforeMusicBeats;
  const kept = [...f.detected]
    .map((d) => ({ d, beat: ((d.onset as number) - f.scoreZeroClock) / beatSec }))
    .filter((x) => x.beat >= fromBeat - EPS)
    .sort((a, b) => a.beat - b.beat);
  const first = kept[0];
  if (!first) return { notes: [], bars: [], totalBars: f.totalBars, endSec: 0 };
  const lo = hasPickup ? 0 : 1;
  const hi = Math.max(lo, f.totalBars);
  const barOf = (beat: number): number => Math.min(hi, Math.max(lo, barOfBeat(beat, bpb, hasPickup)));
  const originBeat = first.beat;
  const at = (beat: number): number => (beat - originBeat) * beatSec;
  const notes: HeardNote[] = kept.map(({ d, beat }) => ({ ...(d.id !== undefined ? { id: d.id } : {}), midi: d.midi, hz: midiToFreq(d.midi, f.a4Hz), bar: barOf(beat), startSec: at(beat), durSec: heardDurSec(d) }));
  const startBeat = (bar: number): number => (bar <= 0 ? -f.pickupBeats : (bar - 1) * bpb);
  const endBeat = (bar: number): number => (bar <= 0 ? 0 : bar * bpb);
  const firstBar = (notes[0] as HeardNote).bar;
  const lastBar = notes.reduce((m, n) => Math.max(m, n.bar), firstBar);
  const endSec = notes.reduce((m, n) => Math.max(m, n.startSec + n.durSec), 0);
  const bars: ListenBar[] = [];
  for (let b = firstBar; b <= lastBar; b++) bars.push({ bar: b, startSec: at(startBeat(b)), endSec: b === hi ? Math.max(at(endBeat(b)), endSec) : at(endBeat(b)) });
  return { notes, bars, totalBars: f.totalBars, endSec };
}

/** What `scoreZeroOf` reads from a stored try. */
export interface ScoreZeroFacts {
  detected: readonly Pick<DetectedNote, 'id' | 'onset'>[];
  judgments: readonly Pick<NoteJudgment, 'expectedIdx' | 'detectedId' | 'timingErrorMs'>[];
  extras: readonly Pick<ExtraNote, 'detectedId' | 'onsetSec'>[];
  /** Score seconds of each expected note, by index. */
  expectedOnsetSec: readonly number[];
}

/**
 * The clock time of score second 0 for a stored try, when its trace (which has the take's `t0`) is gone: every
 * matched note gives `onset - (written onset + timing error)` and every extra `onset - its score onset`; the median
 * of them. Without either, the first detected note is taken as the first written note. Null without notes.
 */
export function scoreZeroOf(f: ScoreZeroFacts): number | null {
  const onset = new Map(f.detected.map((d) => [d.id, d.onset as number]));
  const xs: number[] = [];
  for (const j of f.judgments) {
    const o = j.detectedId === null ? undefined : onset.get(j.detectedId);
    const e = f.expectedOnsetSec[j.expectedIdx];
    if (o !== undefined && e !== undefined && j.timingErrorMs !== null) xs.push(o - (e + j.timingErrorMs / 1000));
  }
  for (const x of f.extras) {
    const o = onset.get(x.detectedId);
    if (o !== undefined) xs.push(o - (x.onsetSec as number));
  }
  if (xs.length > 0) {
    xs.sort((a, b) => a - b);
    const m = xs.length >> 1;
    return xs.length % 2 ? (xs[m] as number) : ((xs[m - 1] as number) + (xs[m] as number)) / 2;
  }
  const firstOnset = f.detected.reduce((m, d) => Math.min(m, d.onset as number), Infinity);
  const firstWritten = f.expectedOnsetSec[0];
  return Number.isFinite(firstOnset) && firstWritten !== undefined ? firstOnset - firstWritten : null;
}
