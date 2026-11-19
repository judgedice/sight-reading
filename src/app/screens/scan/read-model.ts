/**
 * Pure helpers for the read-through's sounds (05 sections 8.8, 9 and 10): which sound control is playing, what the
 * live caption says, which part of the score it highlights, and what the polite region announces.
 */
import type { Instrument, PreparedExcerpt, SpelledPitch } from '../../../core/types.ts';
import type { SoundCaption, SoundKind } from '../../../session/index.ts';
import type { SoundId } from '../../../ui/components/sounds/index.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { beatUnit } from '../setup/model.ts';
import { keyName } from '../setup/key-names.ts';
import { meterString } from './model.ts';

/** The read-through control that a session sound belongs to; null for sounds this screen does not start. */
export function soundIdOf(kind: SoundKind | null): SoundId | null {
  if (kind === 'listen') return 'listen';
  if (kind === 'tempo') return 'tempo';
  if (kind === 'key' || kind === 'reference') return 'reference';
  return null;
}

/** The beat unit and tempo of the excerpt, as the sounds draw them ("♩ = 72"). */
export function tempoOf(p: PreparedExcerpt): { unit: string; bpm: number } {
  return { unit: beatUnit(meterString(p)), bpm: p.selection.settings.bpm };
}

const ALTER_SIGN: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' };
const STEP_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MIDI number of a spelled pitch. */
export function midiOf(p: SpelledPitch): number {
  return 12 * (p.octave + 1) + (STEP_SEMITONE[p.step] ?? 0) + p.alter;
}

/**
 * The first note's name as the player hears it: the written spelling, moved to the octave that sounds (tenor voice
 * reads an octave above what it sings; the mockup's baritone hears "G3"). "D3", "F♯4".
 */
export function firstNoteLabel(written: SpelledPitch, concertMidi: number): string {
  const shift = Math.round((concertMidi - midiOf(written)) / 12);
  return `${written.step}${ALTER_SIGN[written.alter] ?? ''}${written.octave + shift}`;
}

/** The excerpt's first note (for the first-note highlight), or null. */
export function firstNoteOf(p: PreparedExcerpt): { written: SpelledPitch; concertMidi: number } | null {
  for (const m of p.measures) for (const e of m.events) if (e.kind === 'note') return { written: e.writtenPitch, concertMidi: midiOf(e.concertPitch) };
  return null;
}

/** 0-based measure index of a displayed bar number (pickup = 0), or null. */
export function measureIndexOf(p: PreparedExcerpt, bar: number | null): number | null {
  if (bar === null) return null;
  const i = p.measures.findIndex((m) => m.displayBar === bar);
  return i >= 0 ? i : null;
}

/** What the score highlights for a caption (05 section 8.8): the key signature, the first note, or a bar. */
export interface ScoreHighlight {
  key: boolean;
  firstNote: string | null;
  bar: number | null;
}

export function highlightFor(p: PreparedExcerpt, caption: SoundCaption | null, bar: number | null): ScoreHighlight {
  if (!caption) return { key: false, firstNote: null, bar: null };
  if (caption.kind === 'key-chord') return { key: true, firstNote: null, bar: null };
  if (caption.kind === 'first-note') return { key: false, firstNote: firstNoteLabel(caption.written, caption.concertMidi), bar: null };
  if (caption.kind === 'bar') return { key: false, firstNote: null, bar: measureIndexOf(p, bar ?? caption.bar) };
  return { key: false, firstNote: null, bar: null };
}

/**
 * The caption as plain text, for the polite region (05 section 14 item 7). Bars are not announced; the lead-in and
 * notes and previews say nothing. Null: announce nothing.
 */
export function announcementFor(caption: SoundCaption | null, p: PreparedExcerpt): string | null {
  if (!caption) return null;
  switch (caption.kind) {
    case 'key-chord':
      return copy('reference.playing.chord', { key: keyName(caption.writtenKey) });
    case 'first-note':
      return copy('reference.playing.first', { note: firstNoteLabel(caption.written, caption.concertMidi) });
    case 'tempo':
      return copy('sound.playing.tempo', { tempo: copy('tempo.marking', { unit: tempoOf(p).unit, bpm: caption.bpm }) });
    default:
      return null;
  }
}

/** Winds, brass and strings take a tuning note (02 section 4.5); the session's own predicate decides. */
export type TuningPredicate = (inst: Instrument) => boolean;

/** Ranked countdown announcements (05 section 14 item 7): at 10 and 5 seconds. */
export const COUNTDOWN_ANNOUNCE_AT: readonly number[] = [10, 5];

/** The announcement second crossed going from `prev` to `now` seconds left, or null. */
export function countdownCrossing(prev: number | null, now: number): number | null {
  for (const at of COUNTDOWN_ANNOUNCE_AT) if (now <= at && (prev === null ? now > at - 1 : prev > at)) return at;
  return null;
}
