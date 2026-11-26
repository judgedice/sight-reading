/**
 * Match a note: the pure model (round 2, 01-ux 3.1). One reducer, no clock of its own: every event carries the time in
 * milliseconds, so tests and the screen drive it with the same fake or real clock.
 *
 * Pitch frames are concert pitch. `MatchFrame.midi` is the nearest note and `cents` the deviation from it, as the
 * engine reports them (`MatchNoteService`, R2-07); `t` is in milliseconds on the clock the events use.
 *
 * Round 3 (03-pitch-steadiness, PLAN R74 onward): the needle shows the display filter's settled value
 * (`MatchFrame.reading`), folded to the target for a voice, and the in-tune state and the hit come from the centre of
 * the held note (`inTuneStep`): in tune when the judge median sits within the band, with hysteresis, and a hit after
 * 800 ms in tune whose 800 ms median is within the band. The band is the grading band at the player's difficulty
 * (difficulty 1 in onboarding).
 */
import type { Configs, Instrument } from '../../../core/types.ts';
import { rangeModel } from '../../../instruments/range.ts';
import { IN_TUNE_INITIAL, centsAgainst, inTuneStep, type InTuneState, type MatchFrame } from '../../../session/index.ts';

/** A frame from the pitch engine (`MatchNoteService`, R2-07). */
export type { MatchFrame };

export const ROUND_SIZE = 5;
/** In tune this long, without a break, with the median of that time within the band, is a hit. */
export const HIT_HOLD_MS = 800;
/** Out of tune, the words change side only when the needle is this far past the centre, cents. */
export const SIDE_DEADBAND_CENTS = 5;
/** The "You" line's value changes at most this often, ms (4 times a second). */
export const YOU_REFRESH_MS = 250;
/** Voiced again this long after a stop: the settled note from the last hold is taken off the staff. */
export const SETTLED_CLEAR_MS = 200;
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
  /** Signed deviation of the hold (the median of the 800 ms that earned the hit), cents; null for a skipped note. */
  cents: number | null;
}

/** The note the player settled on after a hold (the median of the last 800 ms), for the grey head on the staff. */
export interface SettledNote {
  /** Fractional concert MIDI, folded into the target's octave for a voice. */
  midi: number;
  /** Signed cents against the target. */
  cents: number;
}

export interface MatchState {
  mode: MatchMode;
  voice: boolean;
  /** Half the in-tune band, cents (grading-config, at the player's difficulty; difficulty 1 in onboarding). */
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
  /** Nearest note of the needle's value, concert MIDI, unfolded (for "You: F3"); null until one is shown. */
  you: number | null;
  /** Needle position, -50 to 50 cents; null while nothing is shown (before a pitch, or after 600 ms of silence). */
  needle: number | null;
  /** The needle is dimmed at its last place (120 to 600 ms of silence). */
  dim: boolean;
  /** The wobble width behind the needle: the 10th and 90th percentile of the last 400 ms, cents (±50), or null. */
  spread: readonly [number, number] | null;
  /** Signed cents against the target the "You" line reads, refreshed at most every `YOU_REFRESH_MS`. */
  youCents: number | null;
  youAt: number | null;
  /** The in-tune decision on the centre of the note (`inTuneStep`). */
  judge: InTuneState;
  /** The last full hold of the current run: its median (fractional MIDI, unfolded) and the run's length. */
  lastHold: { midi: number; voicedMs: number } | null;
  /** After a hit, or a stop after a hold: the note settled on (drawn grey beside the target). */
  settled: SettledNote | null;
  /** Octave of the sung note against the target, voice only, inside the full range. */
  octave: 'lower' | 'higher' | null;
  /** Onboarding only: the player's far notes sit above or below the voice's range. */
  otherVoice: 'above' | 'below' | null;
  results: readonly NoteResult[];
  summary: MatchSummary | null;
  /** When the target finished sounding and listening began; null before. */
  listenSince: number | null;
  lastSteadyAt: number | null;
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
 * The in-tune half-width in cents at a difficulty (default 1), from grading-config's good band. Read here because
 * `app` may not import `rules`. Voice has its own band; every other family uses the continuous band, which also stands
 * in for fixed-pitch instruments that have no intonation grade. Onboarding uses difficulty 1; Practice › Match a note
 * the player's difficulty (03-pitch-steadiness open question 3).
 */
export function matchBandCents(inst: Instrument, cfg: Configs, level = 1): number {
  const group = inst.relativePitch || inst.family === 'voice' ? 'voice' : 'continuous';
  const bands = cfg.grading.intonation.bands.filter((b) => b.group === group && b.goodCents !== undefined && b.goodCents !== null);
  const band = bands.find((b) => b.levels[0] <= level && level <= b.levels[1]) ?? bands.find((b) => b.levels[0] <= 1 && 1 <= b.levels[1]);
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
    dim: false,
    spread: null,
    youCents: null,
    youAt: null,
    judge: IN_TUNE_INITIAL,
    lastHold: null,
    settled: null,
    octave: null,
    listenSince: null,
    lastSteadyAt: null,
    farSince: null,
    hitAt: null,
    ...over,
  };
}

/**
 * The state when the screen opens: the first note, waiting for the app to play it. `level`: the player's difficulty,
 * which sets the band on Practice (onboarding always uses difficulty 1).
 */
export function initialMatchState(inst: Instrument, cfg: Configs, mode: MatchMode = 'practice', level = 1): MatchState {
  const rm = rangeModel(cfg, inst, 1);
  const notes = matchNotes(inst, cfg);
  return {
    mode,
    voice: rm.voice,
    bandCents: matchBandCents(inst, cfg, mode === 'onboarding' ? 1 : level),
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
    dim: false,
    spread: null,
    youCents: null,
    youAt: null,
    judge: IN_TUNE_INITIAL,
    lastHold: null,
    settled: null,
    octave: null,
    otherVoice: null,
    results: [],
    summary: null,
    listenSince: null,
    lastSteadyAt: null,
    farSince: null,
    hitAt: null,
  };
}

// ---- reducer ---------------------------------------------------------------------------------------------------

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

/** Time-driven changes: the automatic next note, not heard, and too far. The hit comes with a frame. */
function settle(s: MatchState, t: number): MatchState {
  if (s.phase === 'idle' || s.phase === 'summary') return s;
  if (s.phase === 'hit') {
    const auto = s.mode === 'practice' && !s.chosen && s.hitAt !== null && t - s.hitAt >= NEXT_DELAY_MS;
    return auto ? advance(s) : s;
  }
  if (t - s.lastSteadyAt! >= NOT_HEARD_MS) return { ...s, phase: 'not-heard', judge: IN_TUNE_INITIAL, farSince: null };
  if (s.farSince !== null && t - s.farSince >= FAR_MS && (s.phase === 'flat' || s.phase === 'sharp')) {
    return { ...s, phase: s.phase === 'flat' ? 'far-up' : 'far-down' };
  }
  return s;
}

/** The phases that say something about a pitch, which a silence takes back to listening. */
const PITCH_PHASES: readonly MatchPhase[] = ['flat', 'sharp', 'in-band', 'octave-lower', 'octave-higher', 'far-up', 'far-down', 'wrong-octave'];

/** The settled note of a hold, folded into the target's octave for a voice. */
function settledOf(s: MatchState, holdMidi: number): SettledNote {
  const cents = centsAgainst(holdMidi, s.target, s.voice);
  return { midi: s.target + cents / 100, cents };
}

const clampNeedle = (c: number): number => Math.max(-NEEDLE_RANGE_CENTS, Math.min(NEEDLE_RANGE_CENTS, c));

function onFrame(s: MatchState, f: MatchFrame): MatchState {
  if (s.phase === 'idle' || s.phase === 'hit' || s.phase === 'summary') return s;
  const r = f.reading;
  const fold = (m: number | null): number | null => (m === null ? null : centsAgainst(m, s.target, s.voice));
  const judge = inTuneStep(s.judge, { t: f.t, gap: r.gap, runId: r.runId, judgeCents: fold(r.judgeMidi), centreCents: fold(r.centreMidi), holdCents: fold(r.holdMidi) }, s.bandCents);
  const base: MatchState = { ...s, judge, lastSteadyAt: f.steady ? f.t : s.lastSteadyAt };

  if (r.gap === 'bridged') return settle(base, f.t);
  if (r.gap === 'dim' || r.gap === 'hidden' || r.settledMidi === null) {
    /* A silence: dimmed at the last place, then hidden after 600 ms. The state resets; a full hold leaves its note. */
    const hold = s.lastHold;
    const settled = hold && hold.voicedMs >= HIT_HOLD_MS ? settledOf(s, hold.midi) : s.settled;
    const quiet = r.gap === 'dim' ? { needle: s.needle, dim: true } : { needle: null, dim: false, you: null, youCents: null, youAt: null };
    const phase = PITCH_PHASES.includes(s.phase) ? 'listening' : s.phase;
    return settle({ ...base, ...quiet, phase, octave: null, spread: null, farSince: null, lastHold: null, settled }, f.t);
  }

  const settledMidi = r.settledMidi;
  const total = (settledMidi - s.target) * 100;
  const shift = Math.round(total / 1200);
  const folded = total - 1200 * shift;
  const you = Math.round(settledMidi);
  const inFull = you >= s.fullRange[0] && you <= s.fullRange[1];
  /* Voice is octave-free; an instrument is measured against the real octave. */
  const dev = s.voice ? folded : total;
  const needle = clampNeedle(dev);
  const fresh = s.youAt === null || f.t - s.youAt >= YOU_REFRESH_MS;
  const spreadOf = (m: number): number => clampNeedle((m - s.target) * 100 - (s.voice ? 1200 * shift : 0));
  const spread: MatchState['spread'] = r.spreadLoMidi !== null && r.spreadHiMidi !== null ? [spreadOf(r.spreadLoMidi), spreadOf(r.spreadHiMidi)] : null;
  const lastHold = r.holdMidi !== null ? { midi: r.holdMidi, voicedMs: r.voicedMs } : s.lastHold;
  const settled = s.settled !== null && r.voicedMs >= SETTLED_CLEAR_MS ? null : s.settled;
  const shown: MatchState = {
    ...base,
    you,
    needle,
    dim: false,
    spread,
    lastHold,
    settled,
    youCents: fresh ? dev : s.youCents,
    youAt: fresh ? f.t : s.youAt,
  };
  const octave: MatchState['octave'] = s.voice && shift !== 0 && inFull ? (shift < 0 ? 'lower' : 'higher') : null;

  if (!s.voice && shift !== 0 && Math.abs(folded) <= NEEDLE_RANGE_CENTS) {
    return { ...shown, phase: 'wrong-octave', octave: null, judge: IN_TUNE_INITIAL, farSince: null };
  }
  if (judge.hitAt !== null) {
    const cents = fold(r.holdMidi) ?? dev;
    const counted = s.mode === 'practice' && !s.chosen;
    return {
      ...shown,
      phase: 'hit',
      octave,
      hitAt: f.t,
      farSince: null,
      settled: settledOf(s, r.holdMidi ?? settledMidi),
      results: counted ? [...s.results, { hit: true, cents }] : s.results,
    };
  }
  const far = Math.abs(dev) > FAR_SEMITONES * 100;
  const farSince = far ? (s.farSince ?? f.t) : null;
  const otherVoice = s.mode === 'onboarding' && s.voice && far && f.t - farSince! >= FAR_MS
    ? (you > s.servedRange[1] ? 'above' : you < s.servedRange[0] ? 'below' : s.otherVoice)
    : s.otherVoice;
  if (judge.inTune) {
    const phase: MatchPhase = octave === null ? 'in-band' : octave === 'lower' ? 'octave-lower' : 'octave-higher';
    return settle({ ...shown, phase, octave, farSince: null }, f.t);
  }
  /*
   * Before the judge has a full window, a needle inside the band says "Sing E3 and hold it", never "a little high".
   * Otherwise the words follow the side of the drawn needle, which must cross 5 c past the centre to change side, so a
   * needle resting near the middle does not flip between low and high. A far phase stays until the pitch comes back
   * within 3 semitones.
   */
  if (r.judgeMidi === null && Math.abs(dev) <= s.bandCents) return settle({ ...shown, phase: 'listening', octave, otherVoice, farSince }, f.t);
  const was = s.phase === 'flat' || s.phase === 'far-up' ? 'flat' : s.phase === 'sharp' || s.phase === 'far-down' ? 'sharp' : null;
  const side: MatchPhase = dev < -SIDE_DEADBAND_CENTS ? 'flat' : dev > SIDE_DEADBAND_CENTS ? 'sharp' : (was ?? (dev < 0 ? 'flat' : 'sharp'));
  const keepFar = far && (s.phase === 'far-up' || s.phase === 'far-down') && (s.phase === 'far-up') === dev < 0;
  return settle({ ...shown, phase: keepFar ? s.phase : side, octave, otherVoice, farSince }, f.t);
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
