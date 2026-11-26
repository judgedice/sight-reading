/**
 * Match a note: what the screen says for a model state (04-design §4). Pure: the model state in, copy and display
 * flags out, so every line is testable without rendering.
 */
import type { Configs, Instrument } from '../../../core/types.ts';
import { noteName, rangeModel, staffPlan, type StaffNote } from '../../../instruments/range.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { instrumentShortName } from '../../../ui/copy/instrument-names.ts';
import { NEEDLE_RANGE_CENTS, type MatchState } from './model.ts';

/** How the state line looks: loud lines are the 46 px serif, quiet ones the 22 px sans in ink-2. */
export type LineTone = 'loud' | 'quiet' | 'hit';

export interface MatchLine {
  text: string;
  tone: LineTone;
  /** The chevron beside the words, on the needle's side: up on the left (low), down on the right (high). */
  chevron: 'left-up' | 'right-down' | null;
}

export type NeedleTone = 'ink' | 'in' | 'edge';

export interface NeedleView {
  /** 0 (left edge, 50 cents low) to 1 (right edge, 50 cents high); null: no needle. */
  at: number | null;
  tone: NeedleTone;
  /** The band's half-width as a fraction of the track (0 to 0.5). */
  band: number;
  /** The meter is dimmed (the note is playing, nothing is heard, or no microphone). */
  dim: boolean;
  /** The needle is dimmed at its last place: a short silence (120 to 600 ms). */
  stale?: boolean;
  /**
   * The wobble width behind the needle (03-pitch-steadiness §6.2): from and to, as fractions of the track, the 10th
   * to 90th percentile of the last 400 ms. Null: not drawn (Quick, or nothing heard).
   */
  spread?: readonly [number, number] | null;
}

/** The name the player reads for a concert note: sung for voices, written for everyone else (as the range card). */
export function readName(inst: Instrument, concertMidi: number): string {
  return noteName(inst.family === 'voice' ? concertMidi : concertMidi + inst.writtenMinusSounding.chromatic);
}

/** The target as a one-note staff plan, written pitch. */
export function targetStaff(inst: Instrument, concertMidi: number): { clef: StaffNote['clef']; note: StaffNote } {
  const plan = staffPlan(inst, [concertMidi + inst.writtenMinusSounding.chromatic]);
  const note = plan.notes[0]!;
  return { clef: note.clef, note };
}

/**
 * The settled note beside the target on the same staff (written pitch), or null when it would need another clef or
 * octave mark (the small staff draws one clef).
 */
export function heardStaff(inst: Instrument, targetConcert: number, heardConcert: number | null): StaffNote | null {
  if (heardConcert === null) return null;
  const shift = inst.writtenMinusSounding.chromatic;
  const [t, h] = staffPlan(inst, [targetConcert + shift, heardConcert + shift]).notes;
  return t && h && h.clef === t.clef && h.octaveMark === t.octaveMark ? h : null;
}

/** The range chips: the tonic chord tones of C major inside the served range at difficulty 1, concert MIDI, low first. */
export function rangeChips(inst: Instrument, cfg: Configs): number[] {
  const [lo, hi] = rangeModel(cfg, inst, 1).written.served;
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if ([0, 4, 7].includes(((m % 12) + 12) % 12)) out.push(m - inst.writtenMinusSounding.chromatic);
  return out;
}

const isVoice = (s: MatchState): boolean => s.voice;

/** The big line under the target. */
export function stateLine(s: MatchState, inst: Instrument): MatchLine {
  const target = readName(inst, s.target);
  const quiet = (text: string): MatchLine => ({ text, tone: 'quiet', chevron: null });
  const loud = (text: string, chevron: MatchLine['chevron'] = null): MatchLine => ({ text, tone: 'loud', chevron });
  switch (s.phase) {
    case 'idle':
      return quiet(copy('match.hint.idle'));
    case 'listening':
      // "Sing E3 and hold it." is a voice line; an instrument reads the lead, which says "play".
      return quiet(isVoice(s) ? copy('match.listening', { note: target }) : copy('match.lead.instrument'));
    case 'flat':
      return loud(copy('match.flat'), 'left-up');
    case 'sharp':
      return loud(copy('match.sharp'), 'right-down');
    case 'in-band':
      return loud(copy('match.inBand'));
    case 'octave-lower':
      return loud(copy('match.octave'));
    case 'octave-higher':
      return loud(copy('match.octaveHigher'));
    case 'hit':
      return { text: s.mode === 'onboarding' ? copy('match.onboarding.hit') : copy('match.hit', { note: target }), tone: 'hit', chevron: null };
    case 'far-up':
      return loud(copy('match.far.up', { note: target }), 'left-up');
    case 'far-down':
      return loud(copy('match.far.down', { note: target }), 'right-down');
    case 'wrong-octave':
      return loud(copy('match.wrongOctave'));
    case 'not-heard':
      return quiet(copy('match.notHeard'));
    case 'summary':
      return quiet('');
  }
}

/** The small line under the meter. Null: none. */
export function hintLine(s: MatchState): string | null {
  switch (s.phase) {
    case 'listening':
      // "The needle moves when we hear a steady note": not once it does.
      return s.needle === null ? copy('match.hint.listening') : null;
    case 'flat':
      return copy('match.hint.flat');
    case 'sharp':
      return copy('match.hint.sharp');
    case 'far-up':
      return copy('match.hint.far');
    case 'far-down':
      return copy('match.hint.far.down');
    case 'wrong-octave':
      return copy('match.hint.octave');
    case 'hit':
      // The next note comes by itself only inside a round, for a note the app chose.
      if (s.mode === 'onboarding') return null;
      return s.chosen ? null : copy('match.hint.hit');
    default:
      return null;
  }
}

/** Under this many cents from the target the "You" line adds no words. */
export const YOU_CENTRE_CENTS = 10;

/** Cents for the "You" line: whole multiples of 5 (03-pitch-steadiness §6.1). */
export const roundCents = (c: number): number => Math.round(Math.abs(c) / 5) * 5;

/** "a little low", "much too high", or null near the centre. */
function wordsFor(cents: number): string | null {
  const a = Math.abs(cents);
  if (a < YOU_CENTRE_CENTS) return null;
  if (a > NEEDLE_RANGE_CENTS) return copy(cents < 0 ? 'match.words.muchLow' : 'match.words.muchHigh');
  return copy(cents < 0 ? 'match.words.low' : 'match.words.high');
}

/**
 * The "You" line (03-pitch-steadiness §6.1): within 50 cents it names the target, so a singer 45 cents flat of E3 reads
 * "You: E3, a little low", never "E♭3". Words by default; with Settings › Display › show cents on, the cents too,
 * rounded to 5 ("You: E3, a little low (15 cents)"). Past 50 cents it names the nearest note and says "much too low".
 * It reads `youCents`, which the model refreshes at most 4 times a second. Null before anything is heard.
 */
export function youLine(s: MatchState, inst: Instrument, showCents = false): { note: string; text: string } | null {
  if (s.you === null || s.needle === null || s.phase === 'idle' || s.phase === 'summary') return null;
  const c = s.youCents ?? s.needle;
  const pinned = s.phase === 'far-up' || s.phase === 'far-down' || s.phase === 'wrong-octave';
  const near = !pinned && Math.abs(c) <= NEEDLE_RANGE_CENTS;
  const note = readName(inst, near ? s.target : s.you);
  if (s.phase === 'wrong-octave') return { note, text: copy('match.you', { note }) };
  const words = wordsFor(pinned ? (s.phase === 'far-down' ? 1 : -1) * (NEEDLE_RANGE_CENTS + 1) : c);
  if (words === null) return { note, text: copy('match.you', { note }) };
  if (showCents && near) return { note, text: copy('match.you.wordsCents', { note, words, cents: roundCents(c) }) };
  return { note, text: copy('match.you.words', { note, words }) };
}

/** "You sang: E♭3, a little high": the note settled on after a hold (§6.3). Null when there is none. */
export function settledLine(s: MatchState, inst: Instrument): { note: string; text: string } | null {
  if (!s.settled || s.phase === 'summary') return null;
  const midi = Math.round(s.settled.midi);
  const note = readName(inst, midi);
  const words = wordsFor((s.settled.midi - midi) * 100);
  return { note, text: words === null ? copy('match.sang', { note }) : copy('match.sang.words', { note, words }) };
}

/** The settled note as concert MIDI for the staff's grey head, or null. */
export function settledMidi(s: MatchState): number | null {
  return s.settled && s.phase !== 'summary' ? Math.round(s.settled.midi) : null;
}

/**
 * The meter. `wobble`: draw the wobble width (Steady and Balanced, §9 open question 2). The needle is green only in
 * tune (the centre of the note within the band, `inTuneStep`), ink otherwise, grey when held at an edge; it dims at its
 * last place in a short silence and is hidden after 600 ms of it.
 */
export function needleView(s: MatchState, wobble = false): NeedleView {
  const band = Math.min(0.5, s.bandCents / (2 * NEEDLE_RANGE_CENTS));
  const dim = s.phase === 'idle' || s.phase === 'not-heard';
  if (s.needle === null || dim || s.phase === 'summary') return { at: null, tone: 'ink', band, dim, stale: false, spread: null };
  if (s.phase === 'far-up' || s.phase === 'far-down') return { at: s.phase === 'far-up' ? 0 : 1, tone: 'edge', band, dim, stale: s.dim, spread: null };
  const frac = (c: number): number => Math.max(0, Math.min(1, (c + NEEDLE_RANGE_CENTS) / (2 * NEEDLE_RANGE_CENTS)));
  const inTune = s.phase === 'hit' || s.phase === 'in-band' || s.phase === 'octave-lower' || s.phase === 'octave-higher';
  const spread = wobble && s.spread && !s.dim && s.phase !== 'wrong-octave' ? ([frac(s.spread[0]), frac(s.spread[1])] as const) : null;
  return { at: frac(s.needle), tone: inTune ? 'in' : 'ink', band, dim, stale: s.dim, spread };
}

/** The round summary line: "4 of 5 hit. On average you were 8 cents low." Centre and no hits have their own line. */
export function summaryLine(s: MatchState): string | null {
  const sum = s.summary;
  if (!sum) return null;
  if (sum.direction === 'centre') return copy('match.summary.centre');
  if (sum.direction === null) return null;
  return copy('match.summary', { hit: sum.hit, total: sum.total, cents: sum.cents, direction: copy(`match.summary.direction.${sum.direction}`) });
}

// ---- the other voice (onboarding) -------------------------------------------------------------------------------

/** The voice next to this one above or below, by the middle of its served range at difficulty 1. Null at the ends. */
export function neighbourVoice(cfg: Configs, inst: Instrument, side: 'above' | 'below'): Instrument | null {
  if (inst.family !== 'voice') return null;
  const middle = (i: Instrument): number => {
    const [lo, hi] = rangeModel(cfg, i, 1).concert.served;
    return (lo + hi) / 2;
  };
  const own = middle(inst);
  const others = cfg.instruments.instruments.filter((i) => i.family === 'voice' && i.id !== inst.id && i.status === 'launch');
  const pick = side === 'above' ? others.filter((i) => middle(i) > own).sort((a, b) => middle(a) - middle(b)) : others.filter((i) => middle(i) < own).sort((a, b) => middle(b) - middle(a));
  return pick[0] ?? null;
}

/**
 * The offer to switch voices: "Your notes sat above the baritone range. Would tenor fit better?" Only "above" has copy
 * (`match.onboarding.otherVoice`); a "below" sentence is not in the catalogue yet, so that case offers nothing.
 */
export function otherVoiceOffer(s: MatchState, cfg: Configs, inst: Instrument): { other: Instrument; text: string; action: string } | null {
  if (s.otherVoice !== 'above') return null;
  const other = neighbourVoice(cfg, inst, 'above');
  if (!other) return null;
  const voice = instrumentShortName(inst).toLowerCase();
  const name = instrumentShortName(other);
  return { other, text: copy('match.onboarding.otherVoice', { voice, other: name.toLowerCase() }), action: copy('match.onboarding.changeVoice', { other: name }) };
}
