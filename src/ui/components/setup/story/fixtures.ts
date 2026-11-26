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
    tonic: keyName(k).split(' ')[0]!,
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

/** `next`: the difficulty whose keys add more sharps and flats, or null. More than eight keys fold behind a button. */
export function keyRow(max: number, chosen: string | null, next: number | null, concertShift: number | null = null): KeyRowView {
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
    uses: { key: 'setup.key.uses', vars: { level: next === null ? 10 : next - 1, modes: 'major and minor', n: max } },
    next: next === null ? null : { key: 'setup.key.next.more', vars: { n: max + 1, next } },
    many: (2 * max + 1) * 2 > 8 ? { key: 'setup.key.many', vars: { n: (2 * max + 1) * 2, max } } : null,
  };
}

/** Practice (a stepper, your difficulty 1 marked) or Ranked (locked at your difficulty). */
export function difficultyRow(locked = false): DifficultyRowView {
  const skipped = [7, 8];
  return {
    value: locked ? 1 : 2,
    max: 10,
    yourLevel: 1,
    relationNote: locked ? null : { key: 'setup.difficulty.above', vars: { n: 1, level: 1 } },
    locked,
    skipped,
    segments: Array.from({ length: 10 }, (_, i) => ({ level: i + 1, filled: i < 2, hasMusic: !skipped.includes(i + 1) })),
    skippedNote: { key: 'home.levelNoMusic', vars: { instrument: NAME, levels: '7 to 8' } },
    fewNote: { key: 'home.levelFewMusic', vars: {} },
    fewTag: { key: 'setup.difficulty.fewTag', vars: {} },
    description: 'Adds eighths, minor keys and one-beat pickups.',
    servedLine: { key: 'range.atDifficulty', vars: { level: 2, low: 'C3', high: 'C4' } },
  };
}

export function timeRow(selected: 'random' | '4/4' | '3/4'): TimeRowView {
  const opt = (beats: number, few: boolean) => ({
    meter: `${beats}/4`,
    beats,
    unit: 4,
    few,
    selected: selected === `${beats}/4`,
    a11y: few ? { key: 'setup.time.a11yFew', vars: { beats, unit: 4 } } : { key: 'setup.time.a11y', vars: { beats, unit: 4 } },
  });
  const options = [opt(4, false), opt(3, true)];
  return {
    any: { selected: selected === 'random', label: { key: 'setup.time.any', vars: {} }, xpTag: { key: 'setup.xpTag', vars: { percent: 8 } } },
    options,
    hiddenNote: { key: 'setup.time.noneShort', vars: { meter: '2/4', level: 2 } },
    fewNote: selected === '3/4' ? { key: 'home.levelFewMusic', vars: {} } : null,
    fewTip: { key: 'setup.time.fewTip', vars: {} },
    top: options,
    more: [],
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
