/**
 * Match a note: the pure model (round 2, 01-ux 3.1). One reducer, no clock of its own: every event carries the time in
 * milliseconds, so tests and the screen drive it with the same fake or real clock.
 *
 * Pitch frames are concert pitch. `MatchFrame.midi` is the nearest note and `cents` the deviation from it, as the
 * engine reports them (`MatchNoteService`, R2-07); `t` is in milliseconds on the clock the events use.
 */
import type { Configs, Instrument } from '../../../core/types.ts';
import { rangeModel } from '../../../instruments/range.ts';
import type { MatchFrame } from '../../../session/index.ts';

/** A frame from the pitch engine (`MatchNoteService`, R2-07). */
export type { MatchFrame };

export const ROUND_SIZE = 5;
/** In the band this long, in a row, is a hit. */
export const HIT_HOLD_MS = 800;
/** The next note comes this long after a hit, inside a round. */
export const NEXT_DELAY_MS = 1500;
/** No steady pitch for this long: not heard. */
export const NOT_HEARD_MS = 6000;
/** Further than this from the target (semitones) ... */
export const FAR_SEMITONES = 3;
/** ... for this long: too far. */
export const FAR_MS = 2000;
/** The needle spans plus and minus this many cents. */
export const NEEDLE_RANGE_CENTS = 50;

export type MatchPhase =
  | 'idle'
  | 'listening'
  | 'flat'
  | 'sharp'
  | 'in-band'
  | 'hit'
  /** The player is too low by more than 3 semitones for 2 s: the screen says "Higher". */
  | 'far-up'
  /** The player is too high by more than 3 semitones for 2 s: the screen says "Lower". */
  | 'far-down'
  | 'wrong-octave'
  | 'octave-lower'
  | 'octave-higher'
  | 'not-heard'
  | 'summary';

export type MatchMode = 'practice' | 'onboarding';

export interface MatchSummary {
  hit: number;
  total: number;
  /** Mean signed deviation of the hits, cents; negative is flat. Null with no hits. */
  meanCents: number | null;
  /** Whole cents for the line "{cents} cents {direction}". */
  cents: number;
  direction: 'flat' | 'sharp' | 'centre' | null;
}

export interface NoteResult {
  hit: boolean;
  /** Mean signed deviation while in the band, cents; null for a skipped note. */
  cents: number | null;
}

export interface MatchState {
  mode: MatchMode;
  voice: boolean;
  /** Half the in-tune band, cents (grading-config, difficulty 1). */
  bandCents: number;
  /** The instrument's full range, concert MIDI; the octave line shows only inside it. */
  fullRange: readonly [number, number];
  /** The served range at difficulty 1, concert MIDI. */
  servedRange: readonly [number, number];
  /** The round's notes in order (concert MIDI). */
  notes: readonly number[];
  roundNumber: number;
  /** Position in the round, 0 to 4. */
  index: number;
  /** Concert MIDI of the note to match. */
  target: number;
  /** The player chose this note from the range chips: it stays until another is chosen. */
  chosen: boolean;
  phase: MatchPhase;
  /** Last steady pitch heard, concert MIDI (for "You: F3"); null until one is heard. */
  you: number | null;
  /** Needle position, -50 to 50 cents; null until a steady pitch is heard. */
  needle: number | null;
  /** Octave of the sung note against the target, voice only, inside the full range. */
  octave: 'lower' | 'higher' | null;
  /** Onboarding only: the player's far notes sit above or below the voice's range. */
  otherVoice: 'above' | 'below' | null;
  results: readonly NoteResult[];
  summary: MatchSummary | null;
  /** When the target finished sounding and listening began; null before. */
  listenSince: number | null;
  lastSteadyAt: number | null;
  bandSince: number | null;
  bandSum: number;
  bandCount: number;
  farSince: number | null;
  hitAt: number | null;
}

export type MatchEvent =
  /** The target has sounded and the microphone is open. */
  | { type: 'played'; t: number }
  | { type: 'frame'; frame: MatchFrame }
  | { type: 'tick'; t: number }
  | { type: 'choose-note'; midi: number }
  /** Move on now: skips the note (a miss) unless it was hit. Not in onboarding. */
  | { type: 'next' }
  /** From the summary: five more. Anywhere else: play the same note again. */
  | { type: 'again' };

// ---- choosing notes -------------------------------------------------------------------------------------------

const CHORD_PCS: readonly number[] = [0, 4, 7];
const NATURAL_PCS: readonly number[] = [0, 2, 4, 5, 7, 9, 11];
const pc = (midi: number): number => ((midi % 12) + 12) % 12;

/** Written notes inside `[lo, hi]` whose pitch class is in `pcs`, nearest to `centre` first, lower first on a tie. */
function nearest(lo: number, hi: number, pcs: readonly number[], centre: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(pc(m))) out.push(m);
  return out.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre) || a - b);
}

/**
 * Notes for a round, concert MIDI: the first note (the middle of the served range at difficulty 1, rounded to a chord
 * tone of C major), then the other tonic-chord notes, then the other natural notes, each nearest the first note first.
 * Chosen in written pitch (so a B-flat trumpet reads a C major chord) and returned as sounding pitch.
 */
export function matchNotes(inst: Instrument, cfg: Configs): number[] {
  const [lo, hi] = rangeModel(cfg, inst, 1).written.served;
  const middle = (lo + hi) / 2;
  const chord = nearest(lo, hi, CHORD_PCS, middle);
  /* Every served range spans more than an octave, so it holds a chord tone (a test checks every instrument). */
  const first = chord[0]!;
  const rest = [...chord.slice(1), ...nearest(lo, hi, NATURAL_PCS, first).filter((m) => !chord.includes(m))];
  const shift = inst.writtenMinusSounding.chromatic;
  return [first, ...rest].map((m) => m - shift);
}

/** The first note of a round (concert MIDI). Baritone: E3 or G3. */
export function firstMatchNote(inst: Instrument, cfg: Configs): number {
  return matchNotes(inst, cfg)[0]!;
}

/**
 * The in-tune half-width in cents at difficulty 1, from grading-config. Read here because `app` may not import `rules`.
 * Voice has its own band; every other family uses the continuous band, which also stands in for fixed-pitch
 * instruments that have no intonation grade.
 */
export function matchBandCents(inst: Instrument, cfg: Configs): number {
  const group = inst.relativePitch || inst.family === 'voice' ? 'voice' : 'continuous';
  const band = cfg.grading.intonation.bands.find((b) => b.group === group && b.levels[0] <= 1 && 1 <= b.levels[1]);
  return band!.goodCents!;
}

// ---- state ---------------------------------------------------------------------------------------------------

const noteFor = (notes: readonly number[], roundNumber: number, index: number): number =>
  notes[(roundNumber * ROUND_SIZE + index) % notes.length]!;

/** A cleared per-note part of the state, for a note about to be played. */
function fresh(s: MatchState, over: Partial<MatchState>): MatchState {
  return {
    ...s,
    phase: 'idle',
    you: null,
    needle: null,
    octave: null,
    listenSince: null,
    lastSteadyAt: null,
    bandSince: null,
    bandSum: 0,
    bandCount: 0,
    farSince: null,
    hitAt: null,
    ...over,
  };
}

/** The state when the screen opens: the first note, waiting for the app to play it. */
export function initialMatchState(inst: Instrument, cfg: Configs, mode: MatchMode = 'practice'): MatchState {
  const rm = rangeModel(cfg, inst, 1);
  const notes = matchNotes(inst, cfg);
  return {
    mode,
    voice: rm.voice,
    bandCents: matchBandCents(inst, cfg),
    fullRange: rm.concert.full,
    servedRange: rm.concert.served,
    notes,
    roundNumber: 0,
    index: 0,
    target: notes[0]!,
    chosen: false,
    phase: 'idle',
    you: null,
    needle: null,
    octave: null,
    otherVoice: null,
    results: [],
    summary: null,
    listenSince: null,
    lastSteadyAt: null,
    bandSince: null,
    bandSum: 0,
    bandCount: 0,
    farSince: null,
    hitAt: null,
  };
}

// ---- reducer ---------------------------------------------------------------------------------------------------

/** Total offset of a heard pitch from the target, cents. */
const offsetCents = (f: { midi: number; cents: number }, target: number): number => (f.midi - target) * 100 + f.cents;

function summarise(results: readonly NoteResult[]): MatchSummary {
  const hits = results.filter((r) => r.hit);
  if (hits.length === 0) return { hit: 0, total: results.length, meanCents: null, cents: 0, direction: null };
  const mean = hits.reduce((sum, r) => sum + r.cents!, 0) / hits.length;
  const cents = Math.round(Math.abs(mean));
  return { hit: hits.length, total: results.length, meanCents: mean, cents, direction: cents === 0 ? 'centre' : mean < 0 ? 'flat' : 'sharp' };
}

/** Move to the next note of the round, or to the summary after the last. */
function advance(s: MatchState): MatchState {
  if (s.index + 1 >= ROUND_SIZE) return fresh(s, { phase: 'summary', summary: summarise(s.results) });
  const index = s.index + 1;
  return fresh(s, { index, target: noteFor(s.notes, s.roundNumber, index) });
}

/** Time-driven changes: the hit, the automatic next note, and not heard. */
function settle(s: MatchState, t: number): MatchState {
  if (s.phase === 'idle' || s.phase === 'summary') return s;
  if (s.phase === 'hit') {
    const auto = s.mode === 'practice' && !s.chosen && s.hitAt !== null && t - s.hitAt >= NEXT_DELAY_MS;
    return auto ? advance(s) : s;
  }
  if (s.bandSince !== null && t - s.bandSince >= HIT_HOLD_MS) {
    const cents = s.bandSum / s.bandCount;
    const counted = s.mode === 'practice' && !s.chosen;
    return { ...s, phase: 'hit', hitAt: t, results: counted ? [...s.results, { hit: true, cents }] : s.results };
  }
  if (t - s.lastSteadyAt! >= NOT_HEARD_MS) return { ...s, phase: 'not-heard', bandSince: null, bandSum: 0, bandCount: 0, farSince: null };
  if (s.farSince !== null && t - s.farSince >= FAR_MS && (s.phase === 'flat' || s.phase === 'sharp')) {
    return { ...s, phase: s.phase === 'flat' ? 'far-up' : 'far-down' };
  }
  return s;
}

function onFrame(s: MatchState, f: MatchFrame): MatchState {
  if (s.phase === 'idle' || s.phase === 'hit' || s.phase === 'summary') return s;
  if (f.midi === null || f.cents === null || !f.steady) {
    /* Not a steady pitch: the hold is broken, the needle stays where it was. */
    const held = s.phase === 'in-band' || s.phase === 'octave-lower' || s.phase === 'octave-higher';
    return settle({ ...s, phase: held ? 'listening' : s.phase, bandSince: null, bandSum: 0, bandCount: 0 }, f.t);
  }
  const total = offsetCents({ midi: f.midi, cents: f.cents }, s.target);
  const shift = Math.round(total / 1200);
  const folded = total - 1200 * shift;
  const inFull = f.midi >= s.fullRange[0] && f.midi <= s.fullRange[1];
  /* Voice is octave-free; an instrument is measured against the real octave. */
  const dev = s.voice ? folded : total;
  const base = { ...s, lastSteadyAt: f.t, you: f.midi, needle: Math.max(-NEEDLE_RANGE_CENTS, Math.min(NEEDLE_RANGE_CENTS, dev)) };
  const octave: MatchState['octave'] = s.voice && shift !== 0 && inFull ? (shift < 0 ? 'lower' : 'higher') : null;

  if (!s.voice && shift !== 0 && Math.abs(folded) <= NEEDLE_RANGE_CENTS) {
    return { ...base, phase: 'wrong-octave', octave: null, bandSince: null, bandSum: 0, bandCount: 0, farSince: null };
  }
  const far = Math.abs(dev) > FAR_SEMITONES * 100;
  const farSince = far ? (s.farSince ?? f.t) : null;
  const otherVoice = s.mode === 'onboarding' && s.voice && far && f.t - farSince! >= FAR_MS
    ? (f.midi > s.servedRange[1] ? 'above' : f.midi < s.servedRange[0] ? 'below' : s.otherVoice)
    : s.otherVoice;
  if (Math.abs(dev) <= s.bandCents) {
    const bandSince = s.bandSince ?? f.t;
    const phase: MatchPhase = octave === null ? 'in-band' : octave === 'lower' ? 'octave-lower' : 'octave-higher';
    return settle({ ...base, phase, octave, farSince: null, bandSince, bandSum: s.bandSum + dev, bandCount: s.bandCount + 1 }, f.t);
  }
  const phase: MatchPhase = dev < 0 ? 'flat' : 'sharp';
  const next = { ...base, phase, octave, otherVoice, farSince, bandSince: null, bandSum: 0, bandCount: 0 };
  return settle(next, f.t);
}

export function matchReducer(s: MatchState, e: MatchEvent): MatchState {
  switch (e.type) {
    case 'played':
      return s.phase === 'idle' ? { ...s, phase: 'listening', listenSince: e.t, lastSteadyAt: e.t } : s;
    case 'frame':
      return onFrame(s, e.frame);
    case 'tick':
      return settle(s, e.t);
    case 'choose-note':
      return fresh(s, { target: e.midi, chosen: true, summary: null });
    case 'next': {
      if (s.mode === 'onboarding' || s.phase === 'summary') return s;
      if (s.chosen) return fresh(s, { chosen: false, target: noteFor(s.notes, s.roundNumber, s.index) });
      const results = s.phase === 'hit' ? s.results : [...s.results, { hit: false, cents: null }];
      return advance({ ...s, results });
    }
    case 'again':
      if (s.phase === 'summary') {
        const roundNumber = s.roundNumber + 1;
        return fresh(s, { roundNumber, index: 0, results: [], summary: null, chosen: false, target: noteFor(s.notes, roundNumber, 0) });
      }
      return fresh(s, {});
  }
}
