/**
 * "Hear you" (round 3, 01-ux-review §3.3, R74): any note, a level meter, and a note name that is shown once the voice
 * is steady and then held still. Pure: frames in, a small state out. No target, no needle, no cents.
 *
 * It reads only the note-level part of each pitch-mode frame: the nearest note (`midi`), the engine's `steady` flag
 * and the window level. The frame's cents and the needle filter are Match a note's and are never used here.
 */
import type { Configs, Instrument } from '../../../core/types.ts';
import { noteName, rangeModel } from '../../../instruments/range.ts';
import { copy } from '../../../ui/copy/copy.ts';

/** "Sing" or "Play": the count-in's entry word, for the stage's lines. */
export const actWord = (voice: boolean): string => copy(voice ? 'countIn.entry.voice' : 'countIn.entry.instrument');

/** The part of a `MatchFrame` this stage reads. */
export interface HearFrame {
  /** Milliseconds on the audio clock. */
  t: number;
  midi: number | null;
  levelDb: number;
  steady: boolean;
}

export const HEAR = {
  /** Steady voice this long shows the note name, which then stays put, ms. */
  showMs: 500,
  /** Steady voice this long is "We hear you clearly" and enables Next, ms (about 1 s). */
  heardMs: 1000,
  /** An unvoiced gap shorter than this keeps the steady time (a breath, a consonant), ms. */
  gapMs: 200,
  /** No voice for this long after listening starts shows the "We can't hear you yet" line, ms. */
  quietMs: 4000,
  /** Frames quieter than this are not a voice, dBFS. */
  gateDb: -60,
  /** The meter's range, dBFS: empty at the floor, full at the top. */
  meterFloorDb: -60,
  meterTopDb: -12,
  /** One frame never adds more than this to the steady time, ms (a stalled stream does not count as singing). */
  maxStepMs: 100,
} as const;

export interface HearState {
  /** 0 to 1, the input level meter. */
  level: number;
  steadyMs: number;
  /** Notes (rounded MIDI) heard while steady; their median is the note shown. */
  notes: number[];
  /** The note shown, concert MIDI; fixed once set. */
  note: number | null;
  heard: boolean;
  quiet: boolean;
  startT: number | null;
  lastT: number | null;
  lastVoicedT: number | null;
}

export const initialHear = (): HearState => ({ level: 0, steadyMs: 0, notes: [], note: null, heard: false, quiet: false, startT: null, lastT: null, lastVoicedT: null });

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? 0;
};

export function meterLevel(levelDb: number): number {
  if (!Number.isFinite(levelDb)) return 0;
  return Math.min(1, Math.max(0, (levelDb - HEAR.meterFloorDb) / (HEAR.meterTopDb - HEAR.meterFloorDb)));
}

export function hearReducer(s: HearState, f: HearFrame): HearState {
  const startT = s.startT ?? f.t;
  const dt = s.lastT === null ? 0 : Math.min(HEAR.maxStepMs, Math.max(0, f.t - s.lastT));
  const voiced = f.midi !== null && f.levelDb > HEAR.gateDb;
  const next: HearState = { ...s, level: meterLevel(f.levelDb), startT, lastT: f.t };
  if (voiced) next.lastVoicedT = f.t;
  if (s.heard) return { ...next, quiet: false };
  if (voiced && f.steady && f.midi !== null) {
    next.steadyMs = s.steadyMs + dt;
    next.notes = [...s.notes, Math.round(f.midi)].slice(-100);
  } else if (!voiced && f.t - (s.lastVoicedT ?? startT) > HEAR.gapMs && s.note === null) {
    next.steadyMs = 0;
    next.notes = [];
  }
  if (next.note === null && next.steadyMs >= HEAR.showMs && next.notes.length > 0) next.note = median(next.notes);
  if (next.steadyMs >= HEAR.heardMs && next.note !== null) next.heard = true;
  next.quiet = !next.heard && f.t - (next.lastVoicedT ?? startT) > HEAR.quietMs;
  return next;
}

/** The note's name as the player reads it: sung pitch for voices, written pitch for everyone else. */
export function heardName(inst: Instrument, concertMidi: number): string {
  return noteName(inst.family === 'voice' ? concertMidi : concertMidi + inst.writtenMinusSounding.chromatic);
}

/**
 * The voice above, when the note sat above this voice's whole range: "Your notes sat above the baritone range. Would
 * tenor fit better?" (the round 2 offer, kept). Only "above" has copy. Null for instruments and in range.
 */
export function voiceAbove(cfg: Configs, inst: Instrument, concertMidi: number): Instrument | null {
  if (inst.family !== 'voice') return null;
  const own = rangeModel(cfg, inst, 1);
  if (concertMidi <= own.concert.full[1]) return null;
  const middle = (i: Instrument): number => {
    const [lo, hi] = rangeModel(cfg, i, 1).concert.served;
    return (lo + hi) / 2;
  };
  const mine = middle(inst);
  const above = cfg.instruments.instruments.filter((i) => i.family === 'voice' && i.id !== inst.id && i.status === 'launch' && middle(i) > mine);
  return above.sort((a, b) => middle(a) - middle(b))[0] ?? null;
}
