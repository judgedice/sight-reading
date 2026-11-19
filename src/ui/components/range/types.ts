// View data for the range picture (05 section 7, 06 sections 6.10 and 6.11).
//
// `src/ui` may import only `src/core` (01 section 4.2), so these types restate, structurally, the parts of the range
// model in `src/instruments/range.ts` that the components draw. The app passes that model straight in:
// `rangeModel(cfg, inst, level)` satisfies `RangeView`, `staffPlan(inst, pictureNotes(model))` satisfies
// `StaffView`, and `keyboardSpan(model, inst)` satisfies `KeyboardView`.
import type { Clef } from '../../../core/types.ts';

/** A line of text as a copy key and its variables. `keyVars` values are copy keys formatted first. */
export interface RangeTextView {
  key: string;
  vars: Readonly<Record<string, string | number>>;
  keyVars?: Readonly<Record<string, string>> | undefined;
}

export type MidiRange = readonly [number, number];

/** Transposition kinds (`TranspositionKind` in the range model); only the tag is read here. */
export interface TranspositionView {
  kind: 'none' | 'voice-octave' | 'octave' | 'simple' | 'compound';
}

export interface RangeView {
  instrumentId: string;
  level: number;
  voice: boolean;
  transposing: boolean;
  written: { full: MidiRange; served: MidiRange };
  /** Sounding (concert) pitch: the ruler, the keyboard and the note buttons use this frame. */
  concert: { full: MidiRange; served: MidiRange };
  /** Names the player reads: sung for voices, written for everyone else. */
  names: { full: readonly [string, string]; served: readonly [string, string] };
  transposition: TranspositionView;
  /** Lines under the large picture, in order (05 section 7.5). */
  lines: readonly RangeTextView[];
  /** The difficulty line, "At difficulty 2: C3 to C4". */
  servedLine: RangeTextView;
  /** Card second line: tenor "Written an octave higher"; transposing "Sounds a major 2nd lower: …". */
  cardNote: RangeTextView | null;
  /** `range.a11y` without the instrument name. */
  a11y: RangeTextView;
}

export interface StaffNoteView {
  /** Written MIDI. */
  midi: number;
  /** Name under the note (sung for voices, written otherwise). */
  label: string;
  clef: Clef;
  clefChange: boolean;
  octaveMark: '8va' | '8vb' | null;
  /** Staff steps from the middle line after any octave mark. */
  position: number;
  ledgerLines: number;
}

export interface StaffView {
  firstClef: Clef;
  /** Full low, served low, served high, full high. */
  notes: readonly StaffNoteView[];
}

export interface KeyboardView {
  /** Sounding MIDI of the first and last key; both are C's. */
  low: number;
  high: number;
  full: MidiRange;
  served: MidiRange;
  middleC: number | null;
  cs: readonly number[];
}

/** Everything one instrument's range picture needs. */
export interface RangeData {
  model: RangeView;
  staff: StaffView;
  keyboard: KeyboardView;
}
