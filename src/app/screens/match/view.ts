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
      return copy('match.hint.listening');
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

/** "You: E3, 34 cents low", or "You: F3" when the needle is pinned or dead centre. Null before anything is heard. */
export function youLine(s: MatchState, inst: Instrument): { note: string; text: string } | null {
  if (s.you === null || s.needle === null || s.phase === 'idle' || s.phase === 'summary') return null;
  const note = readName(inst, s.you);
  const cents = Math.round(Math.abs(s.needle));
  const pinned = Math.abs(s.needle) >= NEEDLE_RANGE_CENTS || s.phase === 'far-up' || s.phase === 'far-down' || s.phase === 'wrong-octave';
  if (pinned || cents === 0) return { note, text: copy('match.you', { note }) };
  const direction = copy(s.needle < 0 ? 'match.summary.direction.flat' : 'match.summary.direction.sharp');
  return { note, text: copy('match.youCents', { note, cents, direction }) };
}

export function needleView(s: MatchState): NeedleView {
  const band = Math.min(0.5, s.bandCents / (2 * NEEDLE_RANGE_CENTS));
  const dim = s.phase === 'idle' || s.phase === 'not-heard';
  if (s.needle === null || dim || s.phase === 'summary') return { at: null, tone: 'ink', band, dim };
  if (s.phase === 'far-up' || s.phase === 'far-down') return { at: s.phase === 'far-up' ? 0 : 1, tone: 'edge', band, dim };
  const at = (s.needle + NEEDLE_RANGE_CENTS) / (2 * NEEDLE_RANGE_CENTS);
  const inBand = s.phase === 'hit' || Math.abs(s.needle) <= s.bandCents;
  return { at: Math.max(0, Math.min(1, at)), tone: inBand && s.phase !== 'wrong-octave' ? 'in' : 'ink', band, dim };
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
