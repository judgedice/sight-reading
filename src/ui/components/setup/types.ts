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
  fewNote: TextLine | null;
  description: string;
  servedLine: TextLine;
  followValue: TextLine | null;
  followHint: TextLine | null;
}

export interface KeyOptionView {
  key: KeySig;
  value: string;
  name: string;
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
  moreNote: TextLine | null;
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
  hiddenNote: TextLine | null;
  fewNote: TextLine | null;
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
