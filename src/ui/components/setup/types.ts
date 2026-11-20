/**
 * What the setup controls read. Each interface is the part of a row of the app's setup model
 * (`src/app/screens/setup/model.ts`, `setupModel`) that its control uses, so the screen passes `model.key`,
 * `model.time` and so on unchanged. The UI layer may not import the app layer, hence the structural copies.
 */
import type { KeySig } from '../../../core/types.ts';
import type { TextLine } from './text.ts';

export interface DifficultySegmentView {
  level: number;
  filled: boolean;
  hasMusic: boolean;
}

export interface DifficultyRowView {
  value: number;
  max: number;
  /** "Follow my progress" is on: the stepper is hidden. */
  follow: boolean;
  /** Difficulties with no music for this instrument; the stepper skips them. */
  skipped: readonly number[];
  segments: readonly DifficultySegmentView[];
  skippedNote: TextLine | null;
  /** The full few-pieces sentence: the tag's tooltip and accessible name. */
  fewNote: TextLine | null;
  /** "Few pieces": the caution tag at the end of the description. */
  fewTag?: TextLine | null;
  /** "Simpler? Match a note first." (difficulty 1). Shown only with `onMatch`. */
  matchHint?: TextLine | null;
  description: string;
  /** "At difficulty 2: C3 to C4". Not shown by the control: the range card shows it (round 2, 01-ux section 6). */
  servedLine?: TextLine;
  followValue: TextLine | null;
  followHint: TextLine | null;
}

export interface KeyOptionView {
  key: KeySig;
  value: string;
  name: string;
  /** "G", "B♭": the popover groups by mode, so its chips show the tonic only. */
  tonic?: string;
  accidentals: number;
  side: 'none' | 'sharp' | 'flat';
  /** Transposing instruments: "concert F major". `vars.key` is the concert key's name. */
  concert: TextLine | null;
  selected: boolean;
}

export interface KeyGroupView {
  mode: 'major' | 'minor';
  label: TextLine;
  keys: readonly KeyOptionView[];
}

export interface KeyRowView {
  any: { selected: boolean; label: TextLine; hint: TextLine; xpTag: TextLine };
  groups: readonly KeyGroupView[];
  /** "Difficulty 1 uses major keys with up to 1 sharp or flat." */
  uses: TextLine;
  /** "Minor keys start at difficulty 2.", or null. */
  next: TextLine | null;
  /** More than eight keys: "18 keys: major and minor, up to 4 sharps or flats."; the chips open from one button. */
  many: TextLine | null;
}

export interface TimeOptionView {
  meter: string;
  beats: number;
  unit: number;
  few: boolean;
  selected: boolean;
  a11y: TextLine;
}

export interface TimeRowView {
  any: { selected: boolean; label: TextLine; xpTag: TextLine };
  options: readonly TimeOptionView[];
  /** "No 2/4 at difficulty 1 yet." */
  hiddenNote: TextLine | null;
  fewNote: TextLine | null;
  /** Tooltip of the few-pieces dot ("Few pieces"). */
  fewTip: TextLine;
  /** The meters in the row; with more than seven, the five most used. */
  top: readonly TimeOptionView[];
  /** The meters behind "More" (empty up to seven meters). */
  more: readonly TimeOptionView[];
}

export interface TempoRowView {
  any: boolean;
  range: { min: number; max: number };
  beatUnit: string;
  anyLabel: TextLine;
  anyValue: TextLine;
  xpTag: TextLine;
}

export type LengthRowView =
  | { kind: 'only'; bars: 8 | 10 | 12; note: TextLine }
  | {
      kind: 'choice';
      any: { selected: boolean; label: TextLine };
      options: readonly { bars: 8 | 10 | 12; selected: boolean }[];
    };

export type PracticeMode = 'ranked' | 'practice';

/** Why Ranked cannot be chosen right now (05 section 5.8), or null when it can. */
export type RankedBlock = 'calibration' | 'mic';
