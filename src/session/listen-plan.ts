/**
 * Pure "Hear it" plans (05 §9): what plays, when, for Listen, Hear bar n, Hear the tempo, Hear the key and the sound
 * previews. No clock and no platform: every time is seconds from the plan's origin (the first click), and the session
 * adds the backend's clock when it schedules.
 *
 * Listen (05 §9.2): sounding (concert) pitch at the player's tuning pitch; written values at the tempo, each note
 * ending 10% early; a tie chain is one note and rests are silent (both come from `buildExpectedNotes`); a pickup
 * starts on its beat inside the lead-in bar. One bar of clicks leads in; "Click along" keeps the clicks through the
 * music; "Slower" plays at 75% of the tempo. The bar timeline drives "Playing bar n of m" and the bar highlight.
 */
import type { Configs, ExpectedNote, KeySig, PreparedExcerpt } from '../core/types.ts';
import { buildExpectedNotes } from '../corpus/index.ts';
import { midiToFreq, toMidi, tonicOf } from '../theory/index.ts';
import { VOICE_REFERENCE } from './take-plan.ts';

/** Fixed values of the playback rules (05 §9.1 to §9.3, §11.2). */
export const LISTEN = {
  /** Notes sound for this fraction of their written length. */
  articulation: 0.9,
  /** "Slower" plays at this fraction of the tempo. */
  slower: 0.75,
  /** Peak level of the Listen voice, about −12 dBFS. */
  peak: 10 ** (-12 / 20),
  /** A range-picture note sounds for this long, seconds. */
  noteSec: 1,
  /** Sound previews in Settings and calibration: one bar at this tempo. */
  previewBpm: 90,
  previewBeats: 4,
  /** "Hear bar n" plays the bar this many times after the lead-in. */
  barRepeats: 2,
} as const;

export interface ListenOptions {
  /** Displayed bar to start from. 1 or less (the default) starts at the beginning, the pickup included, since a pickup leads into bar 1. */
  fromBar?: number;
  /** 75% of the tempo. */
  slower?: boolean;
  /** Keep the clicks through the music (results and attempt detail). */
  clickAlong?: boolean;
}

export interface ListenNote {
  /** Index of the expected note it plays. */
  idx: number;
  /** Displayed bar of the note. */
  bar: number;
  concertMidi: number;
  hz: number;
  startSec: number;
  durSec: number;
}

export interface ListenClick {
  atSec: number;
  accent: boolean;
}

/** One bar on the timeline (a bar heard twice appears twice). */
export interface ListenBar {
  bar: number;
  startSec: number;
  endSec: number;
}

export interface ListenPlan {
  /** The tempo played, bpm (after "Slower"). */
  bpm: number;
  beatSec: number;
  beatsPerBar: number;
  /** The first displayed bar played. */
  startBar: number;
  /** Displayed bars in the excerpt, pickup excluded (the "of m" in "Playing bar n of m"). */
  totalBars: number;
  /** Seconds from the first click to the start bar's downbeat (one bar). With a pickup, the pickup sounds inside it. */
  leadInSec: number;
  clicks: ListenClick[];
  notes: ListenNote[];
  bars: ListenBar[];
  /** Seconds from the origin to the end of the last sound. */
  endSec: number;
}

/** What a plan needs from an excerpt. `listenSourceOf` builds it from a prepared excerpt. */
export interface ListenSource {
  expected: readonly Pick<ExpectedNote, 'idx' | 'bar' | 'onsetBeat' | 'durBeats' | 'concertMidi'>[];
  beatsPerBar: number;
  /** Length of the pickup, metronome beats (0 without one). */
  pickupBeats: number;
  /** Displayed bars, pickup excluded. */
  totalBars: number;
}

export interface ListenFacts {
  /** The tempo before "Slower", bpm. */
  bpm: number;
  a4Hz: number;
  /** "Accent the first beat". */
  accent: boolean;
}

const EPS = 1e-9;

/** The listen source of a prepared excerpt (ties joined and rests dropped by `buildExpectedNotes`). */
export function listenSourceOf(prepared: PreparedExcerpt, cfg: Configs): ListenSource {
  const expected = buildExpectedNotes(prepared, prepared.selection.settings.bpm, cfg);
  const totalBars = prepared.measures.reduce((m, x) => Math.max(m, x.displayBar), 0);
  return {
    expected,
    beatsPerBar: prepared.meter.countsPerBar,
    pickupBeats: prepared.pickupTicks / prepared.meter.countUnitTicks,
    totalBars,
  };
}

/** Score beat of a bar's downbeat (bar 1 beat 1 = 0; the pickup bar starts at −pickupBeats). */
function barStartBeat(src: ListenSource, bar: number): number {
  return bar <= 0 ? -src.pickupBeats : (bar - 1) * src.beatsPerBar;
}

function barEndBeat(src: ListenSource, bar: number): number {
  return bar <= 0 ? 0 : bar * src.beatsPerBar;
}

function firstBar(src: ListenSource): number {
  return src.pickupBeats > EPS ? 0 : 1;
}

function leadInClicks(beats: number, beatSec: number, accent: boolean): ListenClick[] {
  return Array.from({ length: beats }, (_, k) => ({ atSec: k * beatSec, accent: accent && k === 0 }));
}

function tempoOf(f: ListenFacts, slower: boolean | undefined): { bpm: number; beatSec: number } {
  const bpm = slower ? f.bpm * LISTEN.slower : f.bpm;
  return { bpm, beatSec: 60 / bpm };
}

/** Listen (05 §9.2, §9.3): one bar of clicks, then the excerpt from `fromBar`. */
export function planListen(src: ListenSource, f: ListenFacts, o: ListenOptions = {}): ListenPlan {
  const { bpm, beatSec } = tempoOf(f, o.slower);
  const bpb = src.beatsPerBar;
  const lo = firstBar(src);
  const startBar = o.fromBar === undefined || o.fromBar <= 1 ? lo : Math.min(Math.max(1, Math.round(o.fromBar)), Math.max(1, src.totalBars));
  // The lead-in is the bar before bar 1 (a pickup sounds on its beats inside it), or the bar before the start bar.
  const refBeat = startBar === 0 ? 0 : barStartBeat(src, startBar);
  const leadInSec = bpb * beatSec;
  const at = (beat: number): number => leadInSec + (beat - refBeat) * beatSec;
  const fromBeat = barStartBeat(src, startBar);

  const notes: ListenNote[] = src.expected
    .filter((e) => e.onsetBeat >= fromBeat - EPS)
    .map((e) => ({
      idx: e.idx,
      bar: e.bar,
      concertMidi: e.concertMidi,
      hz: midiToFreq(e.concertMidi, f.a4Hz),
      startSec: at(e.onsetBeat),
      durSec: e.durBeats * beatSec * LISTEN.articulation,
    }));

  const bars: ListenBar[] = [];
  for (let b = startBar; b <= src.totalBars; b++) bars.push({ bar: b, startSec: at(barStartBeat(src, b)), endSec: at(barEndBeat(src, b)) });
  const lastBarEnd = bars.length > 0 ? (bars[bars.length - 1] as ListenBar).endSec : leadInSec;

  const clicks = leadInClicks(bpb, beatSec, f.accent);
  if (o.clickAlong) {
    for (let j = 0; leadInSec + j * beatSec < lastBarEnd - EPS; j++) clicks.push({ atSec: leadInSec + j * beatSec, accent: f.accent && j % bpb === 0 });
  }
  const lastNoteEnd = notes.reduce((m, n) => Math.max(m, n.startSec + n.durSec), leadInSec);
  return { bpm, beatSec, beatsPerBar: bpb, startBar, totalBars: src.totalBars, leadInSec, clicks, notes, bars, endSec: o.clickAlong ? Math.max(lastBarEnd, lastNoteEnd) : lastNoteEnd };
}

/** "Hear bar n" or "Hear bars n to m" (05 §9.1): one bar of clicks, then the bars twice. */
export function planBars(src: ListenSource, f: ListenFacts, from: number, to: number = from, o: Pick<ListenOptions, 'slower'> = {}): ListenPlan {
  const { bpm, beatSec } = tempoOf(f, o.slower);
  const bpb = src.beatsPerBar;
  const lo = firstBar(src);
  const hi = Math.max(lo, src.totalBars);
  const a = Math.min(Math.max(lo, Math.round(from)), hi);
  const b = Math.min(Math.max(a, Math.round(to)), hi);
  const startBeat = barStartBeat(src, a);
  const endBeat = barEndBeat(src, b);
  const segSec = (endBeat - startBeat) * beatSec;
  const leadInSec = bpb * beatSec;
  const inSegment = src.expected.filter((e) => e.onsetBeat >= startBeat - EPS && e.onsetBeat < endBeat - EPS);
  const notes: ListenNote[] = [];
  const bars: ListenBar[] = [];
  for (let r = 0; r < LISTEN.barRepeats; r++) {
    const origin = leadInSec + r * segSec;
    for (const e of inSegment) {
      const off = (e.onsetBeat - startBeat) * beatSec;
      // A note tied over the segment's end stops at the end, so the repeat starts clean.
      const written = Math.min(e.durBeats * beatSec, segSec - off);
      notes.push({ idx: e.idx, bar: e.bar, concertMidi: e.concertMidi, hz: midiToFreq(e.concertMidi, f.a4Hz), startSec: origin + off, durSec: written * LISTEN.articulation });
    }
    for (let k = a; k <= b; k++) bars.push({ bar: k, startSec: origin + (barStartBeat(src, k) - startBeat) * beatSec, endSec: origin + (barEndBeat(src, k) - startBeat) * beatSec });
  }
  return {
    bpm,
    beatSec,
    beatsPerBar: bpb,
    startBar: a,
    totalBars: src.totalBars,
    leadInSec,
    clicks: leadInClicks(bpb, beatSec, f.accent),
    notes,
    bars,
    endSec: leadInSec + LISTEN.barRepeats * segSec,
  };
}

/** One bar of clicks at a tempo (Hear the tempo, sound previews). Seconds from the first click. */
export function planClickBar(bpm: number, beatsPerBar: number, accent: boolean): { clicks: ListenClick[]; endSec: number; beatSec: number } {
  if (!(bpm > 0)) throw new RangeError(`bpm must be positive, got ${bpm}`);
  const beatSec = 60 / bpm;
  const beats = Math.max(1, Math.round(beatsPerBar));
  return { clicks: leadInClicks(beats, beatSec, accent), endSec: beats * beatSec, beatSec };
}

/** One tone of a key chord, seconds from its start. */
export interface ChordTone {
  midi: number;
  hz: number;
  atSec: number;
  durSec: number;
}

/**
 * Hear the key (05 §9.1, §10): the concert key's home chord (root, third, fifth), arpeggiated with the voice
 * reference's timing, in the octave whose root is at or below the first note's sounding pitch.
 */
export function keyChordTones(concertKey: KeySig, firstConcertMidi: number, a4Hz: number): ChordTone[] {
  const tonicPc = ((toMidi(tonicOf(concertKey)) % 12) + 12) % 12;
  const root = firstConcertMidi - ((((firstConcertMidi - tonicPc) % 12) + 12) % 12);
  const third = concertKey.mode === 'minor' ? 3 : 4;
  const r = VOICE_REFERENCE;
  return [root, root + third, root + 7].map((m, i) => ({ midi: m, hz: midiToFreq(m, a4Hz), atSec: i * (r.triadToneSec + r.gapSec), durSec: r.triadToneSec }));
}

/** Seconds a key chord lasts. */
export const chordLengthSec = (tones: readonly ChordTone[]): number => tones.reduce((m, t) => Math.max(m, t.atSec + t.durSec), 0);

/** The bar sounding at `t` seconds from a plan's origin, or null (lead-in, after the end). */
export function barAt(plan: Pick<ListenPlan, 'bars'>, t: number): number | null {
  for (const b of plan.bars) if (t >= b.startSec - EPS && t < b.endSec - EPS) return b.bar;
  return null;
}

/** "Play my range" (round 2, 01-ux.md §2): each note this long, then this gap, seconds. */
export const RANGE = { noteSec: 0.8, gapSec: 0.15 } as const;

/** One note of a range run, seconds from its start. */
export interface RangeNote {
  /** Position in the notes asked for, 0-based (the chip to light). */
  index: number;
  midi: number;
  hz: number;
  atSec: number;
  durSec: number;
}

/** "Play my range": the notes in the order given, `noteSec` each with `gapSec` between. */
export function planRange(concertMidis: readonly number[], a4Hz: number, o: { noteSec?: number; gapSec?: number } = {}): { notes: RangeNote[]; endSec: number } {
  const noteSec = o.noteSec ?? RANGE.noteSec;
  const gapSec = o.gapSec ?? RANGE.gapSec;
  if (!(noteSec > 0) || !(gapSec >= 0)) throw new RangeError(`bad range timing: note ${noteSec} s, gap ${gapSec} s`);
  const notes = concertMidis.map((midi, index) => ({ index, midi, hz: midiToFreq(midi, a4Hz), atSec: index * (noteSec + gapSec), durSec: noteSec }));
  const last = notes[notes.length - 1];
  return { notes, endSec: last ? last.atSec + last.durSec : 0 };
}
