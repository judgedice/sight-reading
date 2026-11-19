// Picker groups and order (05 section 6.2), driven by config: each instrument's `family` puts it in a group; within a
// group, launch instruments come first, then the less-tested ones, each ordered by family and then by config order.
import type { Clef, Family, Instrument } from '../../../core/types.ts';
import type { GlyphId } from '../../glyph-ids.ts';

export type PickerGroupId = 'voice' | 'woodwinds' | 'brass' | 'strings' | 'keyboard';

/** Groups in order, each with its families in the order the spec lists them. */
export const PICKER_GROUPS: readonly { id: PickerGroupId; families: readonly Family[] }[] = [
  { id: 'voice', families: ['voice'] },
  { id: 'woodwinds', families: ['flute', 'clarinet', 'double-reed', 'sax'] },
  { id: 'brass', families: ['high-brass', 'low-brass'] },
  { id: 'strings', families: ['upper-strings', 'low-strings', 'guitar'] },
  { id: 'keyboard', families: ['keyboard'] },
];

export interface PickerGroup {
  id: PickerGroupId;
  instruments: Instrument[];
}

export interface GroupOptions {
  /** Show the less-tested (`beta`) instruments. */
  showLessTested: boolean;
  /** Ids shown even when less tested and hidden (the current and pending choices), so a choice never disappears. */
  keep?: readonly string[];
}

/** The visible groups, in order, with their cards in order. Empty groups are left out. */
export function pickerGroups(instruments: readonly Instrument[], opts: GroupOptions): PickerGroup[] {
  const keep = new Set(opts.keep ?? []);
  const visible = instruments.filter((i) => i.status === 'launch' || opts.showLessTested || keep.has(i.id));
  const configIndex = new Map(instruments.map((i, n) => [i.id, n]));
  return PICKER_GROUPS.map((g) => {
    const rank = (i: Instrument): [number, number, number] => [
      i.status === 'launch' ? 0 : 1,
      g.families.indexOf(i.family),
      configIndex.get(i.id) ?? 0,
    ];
    const members = visible
      .filter((i) => g.families.includes(i.family))
      .sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
      });
    return { id: g.id, instruments: members };
  }).filter((g) => g.instruments.length > 0);
}

/** Cards in reading order across groups: the order arrow keys move in (05 section 6.3). */
export function readingOrder(groups: readonly PickerGroup[]): string[] {
  return groups.flatMap((g) => g.instruments.map((i) => i.id));
}

/** Line icon for an instrument card (06 section 8). Voices use a clef instead (see `voiceClef`). */
export function instrumentIcon(family: Family): GlyphId {
  switch (family) {
    case 'flute':
      return 'flute';
    case 'clarinet':
    case 'double-reed':
      return 'clarinet';
    case 'sax':
      return 'sax';
    case 'high-brass':
    case 'low-brass':
      return 'trumpet';
    case 'upper-strings':
    case 'guitar':
      return 'violin';
    case 'low-strings':
      return 'cello';
    case 'keyboard':
      return 'piano';
    case 'voice':
      return 'note';
  }
}

/** The first clef of a voice, drawn on its card. */
export function voiceClef(inst: Instrument): Clef {
  const sorted = [...inst.clefs].sort((a, b) => a.fromLevel - b.fromLevel);
  return sorted[0]?.clef ?? 'treble';
}
