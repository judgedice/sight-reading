// Note colours (PLAN R69): with Settings > Display > Note colours on, every written notehead is filled in the colour
// of its letter name. The colour follows the note as written on the page (a transposing instrument colours its written
// note, not the concert pitch), and a sharp or flat keeps its letter's colour: F sharp is green like F, B flat is pink
// like B. Only the head is coloured; stems, beams, flags, accidentals and ledger lines stay ink.
//
// The renderer tags each note's <g> with `data-letter`; tokens.css carries `--head-c` to `--head-b` per theme, and
// note-colours.css applies them under `:root[data-note-colours="on"]`. With the setting off nothing reads the tag.

import type { SpelledPitch, Step } from '../core/types.ts';

export type NoteLetter = 'c' | 'd' | 'e' | 'f' | 'g' | 'a' | 'b';

/** The seven letters in the order of the colour key (C to B: red, orange, yellow, green, blue, purple, pink). */
export const NOTE_LETTERS: readonly NoteLetter[] = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];

const BY_STEP: Readonly<Record<Step, NoteLetter>> = { C: 'c', D: 'd', E: 'e', F: 'f', G: 'g', A: 'a', B: 'b' };

/** The letter whose colour a written pitch takes: its step, whatever its alteration or octave. */
export function noteLetter(written: Pick<SpelledPitch, 'step'>): NoteLetter {
  return BY_STEP[written.step];
}

/** The CSS colour of a letter's notehead (a token from tokens.css). */
export function headColour(letter: NoteLetter): string {
  return `var(--head-${letter})`;
}
