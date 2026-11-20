// The try's visual clock (round 2, "Beat line"). Everything that moves with the beat on the try screen (the beat line,
// the count-in track, the strip's beat dots and bar number, the page turns) reads one time: the audio clock of what
// the player hears now (`AudioBackend.audibleNow`, which takes the output latency off the context clock). A click
// scheduled at time t is drawn when `audibleNow() >= t`, so the screen moves with the sound, not ahead of it by the
// output latency, and not behind it by the microphone's round trip as the follower's clock does. Pure: the screen's
// frame loop supplies the time.
import type { PreparedExcerpt } from '../../../core/types.ts';

/** When the try's beats fall on the audio clock: from the session's schedule (`takeClock`). */
export interface TakeTiming {
  /** Bar 1 beat 1 on the audio clock, seconds. */
  t0: number;
  /** One metronome beat, seconds (60 / bpm). */
  beatSec: number;
  /** Count-in clicks before bar 1 beat 1. */
  countInBeats: number;
}

/** The excerpt facts the clock needs: where the music starts and how long a bar is. */
export interface MusicFacts {
  /** Score beat of the first note (negative in a pickup). */
  firstNoteBeat: number;
  /** Score beat the beat line waits at during the count-in: the first note, or bar 1 beat 1 if a rest comes first. */
  waitBeat: number;
  beatsPerBar: number;
  hasPickup: boolean;
  /** Score beat where the try ends (the beat line hides after it). */
  endBeat: number;
}

/** What the screen shows at one audible instant. */
export interface VisualBeat {
  /** Score beat now (beats from bar 1 beat 1; negative during the count-in). */
  beat: number;
  /** Count-in clicks heard so far, 1-based; 0 before the first and `countInBeats` from the last on. */
  click: number;
  /** The music has started (the first note's time, which is in the count-in's last bar for a pickup). */
  music: boolean;
  /** Beat in the bar, 1-based, once the music has started; null before. */
  beatInBar: number | null;
  /** Displayed bar number (pickup = 0), once the music has started; null before. */
  bar: number | null;
  /** Where the beat line is drawn (score beat), or null when it is not drawn. */
  line: number | null;
}

/** Tolerance for float noise at beat boundaries (a click at exactly t counts as heard). */
const EPS = 1e-6;

export function musicFacts(p: Pick<PreparedExcerpt, 'measures' | 'pickupTicks' | 'meter'>, endBeat: number): MusicFacts {
  const unit = p.meter.countUnitTicks;
  const first = p.measures.flatMap((m) => m.events).find((e) => e.kind === 'note');
  const firstNoteBeat = first && unit > 0 ? (first.tick - p.pickupTicks) / unit : 0;
  return { firstNoteBeat, waitBeat: Math.min(firstNoteBeat, 0), beatsPerBar: Math.max(1, p.meter.countsPerBar), hasPickup: p.pickupTicks > 0, endBeat };
}

/** Score beat at an audible time. */
export const beatAt = (t: TakeTiming, audible: number): number => (audible - t.t0) / t.beatSec;

/** The audible time of a score beat (a click's scheduled time). */
export const timeOfBeat = (t: TakeTiming, beat: number): number => t.t0 + beat * t.beatSec;

/**
 * The visual state at an audible time. Under reduced motion the line steps from beat to beat instead of gliding.
 * During the count-in the line waits at the first note (or the pickup); after the end of the try it is hidden.
 */
export function visualAt(t: TakeTiming, m: MusicFacts, audible: number, reducedMotion: boolean): VisualBeat {
  const beat = beatAt(t, audible);
  const sinceFirstClick = beat + t.countInBeats;
  const click = sinceFirstClick < -EPS ? 0 : Math.min(t.countInBeats, Math.floor(sinceFirstClick + EPS) + 1);
  const music = beat >= Math.min(0, m.firstNoteBeat) - EPS;
  const whole = Math.floor(beat + EPS);
  const beatInBar = music ? (((whole % m.beatsPerBar) + m.beatsPerBar) % m.beatsPerBar) + 1 : null;
  const bar = music ? (beat < -EPS ? (m.hasPickup ? 0 : 1) : Math.floor(beat / m.beatsPerBar + EPS) + 1) : null;
  let line: number | null = null;
  if (sinceFirstClick >= -EPS && beat <= m.endBeat + EPS) {
    const moving = reducedMotion ? whole : beat;
    line = Math.max(m.waitBeat, moving);
  }
  return { beat, click, music, beatInBar, bar, line };
}

/** The timing from the session's `takeClock`, or null. */
export function timingOf(c: { t0: number; bpm: number; countInBeats: number } | null | undefined): TakeTiming | null {
  if (!c || !(c.bpm > 0) || !(c.t0 > 0)) return null;
  return { t0: c.t0, beatSec: 60 / c.bpm, countInBeats: c.countInBeats };
}

/**
 * The timing from a `count-in` session event (click `beat` of `of`, scheduled at `t`), for a session without
 * `takeClock`: count-in click k (1-based) sounds at t0 - (of - k + 1) beats.
 */
export function timingFromCountIn(e: { beat: number; of: number; t: number }, bpm: number): TakeTiming | null {
  if (!(bpm > 0) || !(e.t > 0) || e.of <= 0) return null;
  const beatSec = 60 / bpm;
  return { t0: e.t + (e.of - e.beat + 1) * beatSec, beatSec, countInBeats: e.of };
}
