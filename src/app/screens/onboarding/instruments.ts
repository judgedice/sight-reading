/** Instrument cards for onboarding step 2 (04 section 5.1). */
import type { Instrument } from '../../../core/types.ts';
import { copy, isCopyKey } from '../../../ui/copy/copy.ts';
import { text, type TextKey } from '../states/text.ts';

export type FamilyGroup = 'voice' | 'woodwinds' | 'brass' | 'strings' | 'keyboard';

export const FAMILY_ORDER: readonly FamilyGroup[] = ['voice', 'woodwinds', 'brass', 'strings', 'keyboard'];

const GROUP_OF: Record<Instrument['family'], FamilyGroup> = {
  voice: 'voice',
  flute: 'woodwinds',
  'double-reed': 'woodwinds',
  clarinet: 'woodwinds',
  sax: 'woodwinds',
  'high-brass': 'brass',
  'low-brass': 'brass',
  'upper-strings': 'strings',
  'low-strings': 'strings',
  guitar: 'strings',
  keyboard: 'keyboard',
};

export const familyLabelKey = (g: FamilyGroup): TextKey => `onboarding.family.${g}`;

/** Launch instruments, plus beta ones when asked, grouped by family in display order. Voice parts are the Voice row. */
export function groupInstruments(all: readonly Instrument[], showBeta: boolean): { group: FamilyGroup; items: Instrument[] }[] {
  return FAMILY_ORDER.map((group) => ({
    group,
    items: all.filter((i) => GROUP_OF[i.family] === group && (i.status === 'launch' || showBeta)),
  })).filter((g) => g.items.length > 0);
}

/** The 40 px circle's text: `instrument.abbr.<id>` from the catalogue. */
export function abbreviation(i: Instrument): string {
  const key = `instrument.abbr.${i.id}`;
  return isCopyKey(key) ? copy(key) : i.label.slice(0, 2);
}

const KEY_BY_SEMIS: Record<number, string> = { 2: 'B♭', 7: 'F', 9: 'E♭' };

const INTERVAL_KEY: Record<number, TextKey> = {
  1: 'interval.minor2',
  2: 'interval.major2',
  3: 'interval.minor3',
  4: 'interval.major3',
  5: 'interval.perfect4',
  7: 'interval.perfect5',
  8: 'interval.minor6',
  9: 'interval.major6',
  10: 'interval.minor7',
  11: 'interval.major7',
};

/** "B♭: sounds a major 2nd lower", or null for a non-transposing instrument (octave transposition is not shown). */
export function transpositionLine(i: Pick<Instrument, 'semis'>): string | null {
  const chroma = ((i.semis % 12) + 12) % 12;
  const key = KEY_BY_SEMIS[chroma];
  const interval = INTERVAL_KEY[chroma];
  if (chroma === 0 || !key || !interval) return null;
  return copy('instrument.transposition', { key, interval: text(interval) });
}
