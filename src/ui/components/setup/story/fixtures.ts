/**
 * Dev-only fixtures for the setup controls story page: the states the mockups show (`home`, `setup-sheet`,
 * `setup-states`), written as the setup model would return them. Not shipped (the story page is not a build input).
 * The unit tests check the real model's rows fit these shapes.
 */
import type { KeySig } from '../../../../core/types.ts';
import type { DifficultyRowView, KeyOptionView, KeyRowView, LengthRowView, TempoRowView, TimeRowView } from '../types.ts';

const NAME = 'Baritone voice';
const TONIC_MAJOR = ['G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯'];
const TONIC_MINOR = ['E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯'];
const keyName = (k: KeySig): string => `${(k.mode === 'major' ? TONIC_MAJOR : TONIC_MINOR)[k.fifths + 6]} ${k.mode}`;

function keyOption(k: KeySig, chosen: string | null, concertShift: number | null): KeyOptionView {
  const value = `${k.fifths}:${k.mode}`;
  return {
    key: k,
    value,
    name: keyName(k),
    accidentals: Math.abs(k.fifths),
    side: k.fifths === 0 ? 'none' : k.fifths > 0 ? 'sharp' : 'flat',
    concert: concertShift === null ? null : { key: 'setup.key.concert', vars: { key: keyName({ fifths: k.fifths + concertShift, mode: k.mode }) } },
    selected: chosen === value,
  };
}

function order(max: number): number[] {
  const out = [0];
  for (let n = 1; n <= max; n++) out.push(n, -n);
  return out;
}

export function keyRow(max: number, chosen: string | null, more: number | null, concertShift: number | null = null): KeyRowView {
  const group = (mode: 'major' | 'minor') => ({
    mode,
    label: { key: mode === 'major' ? 'setup.key.major' : 'setup.key.minor', vars: {} },
    keys: order(max).map((f) => keyOption({ fifths: f, mode }, chosen, concertShift)),
  });
  return {
    any: {
      selected: chosen === null,
      label: { key: 'setup.key.any', vars: {} },
      hint: { key: 'home.keyRandom', vars: { max } },
      xpTag: { key: 'setup.xpTag', vars: { percent: 8 } },
    },
    groups: [group('major'), group('minor')],
    moreNote: more === null ? null : { key: 'home.keyFootnote', vars: { n: more } },
  };
}

export function difficultyRow(follow = false): DifficultyRowView {
  const skipped = [7, 8];
  return {
    value: 2,
    max: 10,
    follow,
    skipped,
    segments: Array.from({ length: 10 }, (_, i) => ({ level: i + 1, filled: i < 2, hasMusic: !skipped.includes(i + 1) })),
    skippedNote: { key: 'home.levelNoMusic', vars: { instrument: NAME, levels: '7 to 8' } },
    fewNote: null,
    description: 'Adds eighths, minor keys and one-beat pickups.',
    servedLine: { key: 'range.atDifficulty', vars: { level: 2, low: 'C3', high: 'C4' } },
    followValue: follow ? { key: 'setup.difficulty.followValue', vars: { level: 2, max: 10 } } : null,
    followHint: follow ? { key: 'setup.difficulty.followHint', vars: {} } : null,
  };
}

export function timeRow(selected: 'random' | '4/4' | '3/4'): TimeRowView {
  const opt = (beats: number, few: boolean) => ({
    meter: `${beats}/4`,
    beats,
    unit: 4,
    few,
    selected: selected === `${beats}/4`,
    a11y: { key: 'setup.time.a11y', vars: { beats, unit: 4 } },
  });
  return {
    any: { selected: selected === 'random', label: { key: 'setup.time.any', vars: {} }, xpTag: { key: 'setup.xpTag', vars: { percent: 8 } } },
    options: [opt(4, false), opt(3, true)],
    hiddenNote: { key: 'setup.time.unavailable', vars: { meters: '2/4', instrument: NAME, level: 2 } },
    fewNote: selected === '3/4' ? { key: 'home.levelFewMusic', vars: {} } : null,
  };
}

export function tempoRow(any: boolean): TempoRowView {
  return {
    any,
    range: { min: 60, max: 84 },
    beatUnit: '♩',
    anyLabel: { key: 'setup.tempo.any', vars: {} },
    anyValue: { key: 'setup.tempo.anyValue', vars: { min: 60, max: 84 } },
    xpTag: { key: 'setup.xpTag', vars: { percent: 8 } },
  };
}

export const lengthOnly: LengthRowView = { kind: 'only', bars: 8, note: { key: 'setup.length.only', vars: { bars: 8, level: 2 } } };

export const lengthChoice: LengthRowView = {
  kind: 'choice',
  any: { selected: true, label: { key: 'setup.length.any', vars: {} } },
  options: [
    { bars: 8, selected: false },
    { bars: 10, selected: false },
    { bars: 12, selected: false },
  ],
};
